/**
 * 调律提醒重算引擎
 *
 * 规则：
 * - 常规下次建议日期 = 上次调律日期 + 周期月数。
 * - 若上次调律之后存在越界环境记录，则最早一条越界记录起 ENV_OVERDUE_LEAD_DAYS 天内
 *   建议提前安排调律（环境波动会影响音准），取两者中更早的日期作为下次建议日期。
 * - 越界标记随阈值版本变化：阈值变更后以新版本重算全部环境记录，
 *   旧标记失效，提醒按新标记刷新；没有提醒但确实越界的琴也要补建，不能漏。
 */
import { db, ROW_REVISION, type EnvironmentRow, type ReminderRow, type TuningRow } from './db';
import { addDays, addMonths, deriveReminderState } from '$lib/types/reminder';
import { effectiveThreshold, rangesOf, type EnvThreshold } from '$lib/types/threshold';
import { isAbnormal, type EnvRanges, DEFAULT_RANGES } from '$lib/types/environment';
import { createId } from './uuid';

/** 环境越界后建议在多少天内安排调律 */
export const ENV_OVERDUE_LEAD_DAYS = 30;
/** 新建提醒时的默认周期（月） */
export const DEFAULT_CYCLE_MONTHS = 6;

export interface RecalcResult {
  /** 是否写入了提醒（新建或更新） */
  changed: boolean;
  /** 是否为原先没有提醒的琴补建 */
  created: boolean;
  /** 是否回收了一条失去依据的环境提醒 */
  deleted: boolean;
}

interface PianoContext {
  environments: EnvironmentRow[];
  tunings: TuningRow[];
}

function earliestDate(...dates: Array<string | undefined>): string {
  const valid = dates.filter((value): value is string => Boolean(value));
  if (valid.length === 0) return '';
  return valid.reduce((min, value) => (value < min ? value : min), valid[0]);
}

/**
 * 依据一台琴当前的越界标记重算其调律提醒。
 * - 已有提醒：按最新标记刷新下次建议日期与状态。
 * - 无提醒但存在越界：补建提醒（避免漏掉本该提醒的琴）。
 * - 无提醒且无越界：不做任何写入。
 * 必须在 environments / tunings / reminders 的事务内调用。
 */
export async function recalcReminderForPianoTx(pianoId: string, ctx: PianoContext): Promise<RecalcResult> {
  const envAsc = [...ctx.environments].sort((a, b) => a.date.localeCompare(b.date));
  const latestTuning = [...ctx.tunings].sort((a, b) => b.date.localeCompare(a.date))[0];
  const existing = await db.reminders.where('pianoId').equals(pianoId).first();

  const cycleMonths = existing?.cycleMonths ?? DEFAULT_CYCLE_MONTHS;
  const lastTuningDate = latestTuning?.date ?? existing?.lastTuningDate ?? '';
  const regularDue = lastTuningDate ? addMonths(lastTuningDate, cycleMonths) : '';

  // 只统计上次调律之后的越界（没有调律记录时全部纳入）
  const abnormalRecords = envAsc.filter((item) => item.abnormal && (!lastTuningDate || item.date >= lastTuningDate));
  const firstAbnormal = abnormalRecords[0]?.date ?? '';
  const envDue = firstAbnormal ? addDays(firstAbnormal, ENV_OVERDUE_LEAD_DAYS) : '';

  const nextDueDate = earliestDate(regularDue, envDue);
  if (!nextDueDate) {
    // 无调律基准且无越界：环境自动补建的提醒已失去依据，回收
    if (existing && existing.triggerSource === 'environment' && abnormalRecords.length === 0) {
      await db.reminders.delete(existing.id);
      return { changed: true, created: false, deleted: true };
    }
    return { changed: false, created: false, deleted: false };
  }
  const state = deriveReminderState(nextDueDate);

  const now = Date.now();
  if (existing) {
    if (
      existing.nextDueDate === nextDueDate &&
      existing.state === state &&
      existing.lastTuningDate === lastTuningDate
    ) {
      return { changed: false, created: false, deleted: false };
    }
    await db.reminders.update(existing.id, {
      lastTuningDate,
      nextDueDate,
      state,
      updatedAt: now
    } as never);
    return { changed: true, created: false, deleted: false };
  }

  if (abnormalRecords.length === 0) return { changed: false, created: false, deleted: false };

  const row: ReminderRow = {
    id: createId('rm'),
    pianoId,
    cycleMonths,
    lastTuningDate,
    nextDueDate,
    state,
    triggerSource: 'environment',
    revision: ROW_REVISION,
    createdAt: now,
    updatedAt: now
  };
  await db.reminders.put(row);
  return { changed: true, created: true, deleted: false };
}

/** 独立事务内重算单台琴的提醒（单条环境写入后调用） */
export async function recalcReminderForPiano(pianoId: string): Promise<RecalcResult> {
  return db.transaction('rw', [db.environments, db.tunings, db.reminders], async () => {
    return recalcReminderForPianoTx(pianoId, {
      environments: await db.environments.where('pianoId').equals(pianoId).toArray(),
      tunings: await db.tunings.where('pianoId').equals(pianoId).toArray()
    });
  });
}

export interface RecomputeStats {
  /** 重刷的越界标记条数 */
  environmentsUpdated: number;
  /** 重算提醒的琴数 */
  pianosRecalculated: number;
  /** 新补建的提醒数 */
  remindersCreated: number;
  /** 越界清除后回收的环境提醒数 */
  remindersDeleted: number;
}

function rangesForDate(thresholds: EnvThreshold[], date: string): { ranges: EnvRanges; versionId: string } {
  const threshold = effectiveThreshold(thresholds, date);
  if (!threshold) return { ranges: DEFAULT_RANGES, versionId: '' };
  return { ranges: rangesOf(threshold), versionId: threshold.id };
}

/**
 * 阈值变更后的全量重刷：
 * 1. 以各记录「当天生效」的阈值重算全部环境记录的 abnormal 与 thresholdVersion；
 * 2. 对所有出现过环境记录的琴（越界集合可能发生双向变化）逐台重算提醒。
 */
export async function recomputeAllWithThresholds(thresholds: EnvThreshold[]): Promise<RecomputeStats> {
  const stats: RecomputeStats = {
    environmentsUpdated: 0,
    pianosRecalculated: 0,
    remindersCreated: 0,
    remindersDeleted: 0
  };
  await db.transaction('rw', [db.environments, db.tunings, db.reminders], async () => {
    const [allEnvironments, allTunings] = await Promise.all([
      db.environments.toArray(),
      db.tunings.toArray()
    ]);
    const now = Date.now();
    const envByPiano = new Map<string, EnvironmentRow[]>();
    const envPuts: EnvironmentRow[] = [];

    for (const row of allEnvironments) {
      const { ranges, versionId } = rangesForDate(thresholds, row.date);
      const abnormal = isAbnormal(row.tempC, row.humidityPct, ranges);
      envByPiano.set(row.pianoId, [...(envByPiano.get(row.pianoId) ?? []), row]);
      if (row.abnormal !== abnormal || row.thresholdVersion !== versionId) {
        envPuts.push({ ...row, abnormal, thresholdVersion: versionId, updatedAt: now });
        // 同步内存分组，供后续提醒重算使用
        const group = envByPiano.get(row.pianoId)!;
        group[group.length - 1] = { ...row, abnormal, thresholdVersion: versionId };
      }
    }
    if (envPuts.length > 0) {
      await db.environments.bulkPut(envPuts);
      stats.environmentsUpdated = envPuts.length;
    }

    const tuningsByPiano = new Map<string, TuningRow[]>();
    for (const tuning of allTunings) {
      tuningsByPiano.set(tuning.pianoId, [...(tuningsByPiano.get(tuning.pianoId) ?? []), tuning]);
    }

    for (const pianoId of envByPiano.keys()) {
      const result = await recalcReminderForPianoTx(pianoId, {
        environments: envByPiano.get(pianoId)!,
        tunings: tuningsByPiano.get(pianoId) ?? []
      });
      stats.pianosRecalculated += 1;
      if (result.created) stats.remindersCreated += 1;
      if (result.deleted) stats.remindersDeleted += 1;
    }
  });
  return stats;
}
