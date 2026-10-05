/**
 * 琴房环境入库编排
 *
 * - 单条录入：按记录当天生效的阈值判定越界；钢琴停用则拒写（草稿由调用方保存）；
 *   写入成功后重算该琴的调律提醒。
 * - 记录仪批量导入：跨标签页只放一份（另一页拿到冲突，保留选择并提示）；
 *   单日批量超过 200 条时拒绝超额部分，前 200 条入库，余下保留原日期排队，次日起分批放行。
 * - 阈值变更：以新版本全量重刷越界标记，再按新标记逐台重算提醒（见 reminderEngine）。
 */
import {
  db,
  ROW_REVISION,
  type EnvironmentRow,
  type EnvQueueRow,
  type PianoRow,
  type ThresholdRow
} from './db';
import type { Environment, EnvDevice } from '$lib/types/environment';
import { isAbnormal } from '$lib/types/environment';
import { effectiveThreshold, rangesOf, DEFAULT_THRESHOLD_ID } from '$lib/types/threshold';
import type { EnvThreshold } from '$lib/types/threshold';
import { addDays } from '$lib/types/reminder';
import { createId, today } from './uuid';
import { recalcReminderForPiano, recomputeAllWithThresholds } from './reminderEngine';
import { tryTabLockAsync, ENV_IMPORT_LOCK } from './tabLock';
import { DAILY_BATCH_LIMIT } from '$lib/types/importQueue';
import type { ParsedEnvRecord } from './envBatch';

/* ------------------------------ 阈值选择 ------------------------------ */

function pickThreshold(thresholds: ThresholdRow[], date: string): ThresholdRow | null {
  const current = effectiveThreshold(thresholds as EnvThreshold[], date);
  return (current as ThresholdRow | null) ?? null;
}

/** 按当天生效阈值计算越界标记与阈值版本 id（无版本时用内置默认） */
export function evaluateEnv(
  date: string,
  tempC: number,
  humidityPct: number,
  thresholds: ThresholdRow[]
): { abnormal: boolean; thresholdVersion: string } {
  const threshold = pickThreshold(thresholds, date);
  if (!threshold) {
    return { abnormal: isAbnormal(tempC, humidityPct), thresholdVersion: DEFAULT_THRESHOLD_ID };
  }
  return {
    abnormal: isAbnormal(tempC, humidityPct, rangesOf(threshold)),
    thresholdVersion: threshold.id
  };
}

/* ------------------------------ 单条录入 ------------------------------ */

export type SingleSubmitOutcome =
  | { ok: true; id: string; abnormal: boolean }
  | { ok: false; reason: 'piano-inactive' | 'piano-missing'; pianoState?: PianoRow['state'] };

/** 单条环境记录入库（停用琴拒写；成功后联动重算调律提醒） */
export async function submitSingleEnvironment(payload: Omit<Environment, 'id'>): Promise<SingleSubmitOutcome> {
  const piano = await db.pianos.get(payload.pianoId);
  if (!piano) return { ok: false, reason: 'piano-missing' };
  if (piano.state === '停用') return { ok: false, reason: 'piano-inactive', pianoState: piano.state };

  const thresholds = await db.thresholds.toArray();
  const verdict = evaluateEnv(payload.date, payload.tempC, payload.humidityPct, thresholds);
  const now = Date.now();
  const row: EnvironmentRow = {
    ...payload,
    abnormal: verdict.abnormal,
    thresholdVersion: verdict.thresholdVersion,
    id: createId('en'),
    revision: ROW_REVISION,
    createdAt: now,
    updatedAt: now
  };

  await db.transaction('rw', [db.environments], async () => {
    await db.environments.put(row);
  });
  // 越界记录接着重算对应琴的调律提醒（正常记录也重算，保证标记被改回时提醒同步刷新）
  await recalcReminderForPiano(payload.pianoId);
  return { ok: true, id: row.id, abnormal: verdict.abnormal };
}

/* ------------------------------ 批量导入 ------------------------------ */

export interface BatchImportInput {
  pianoId: string;
  records: ParsedEnvRecord[];
}

export type BatchImportOutcome =
  | {
      ok: true;
      accepted: number;
      queued: number;
      rejected: number;
      abnormal: number;
      batchId: string;
      queueEarliestDate: string | null;
    }
  | { ok: false; reason: 'lock-conflict'; holder: string }
  | { ok: false; reason: 'piano-inactive' | 'piano-missing'; pianoState?: PianoRow['state'] }
  | { ok: false; reason: 'empty' };

interface CapacityInfo {
  remaining: number;
}

/** 今日批量导入（含队列放行）还剩多少额度：按 environments 中今日落库的批次记录计数 */
async function batchCapacityToday(day: string): Promise<CapacityInfo> {
  // createdAt 为当天的批量记录（batchId 非空）即占用当日批量额度
  const dayStart = new Date(`${day}T00:00:00`).getTime();
  const dayEnd = dayStart + 86_400_000;
  const used = await db.environments
    .where('batchId').above('')
    .filter((row) => row.createdAt >= dayStart && row.createdAt < dayEnd)
    .count();
  return { remaining: Math.max(0, DAILY_BATCH_LIMIT - used) };
}

function stampQueue(partial: Omit<EnvQueueRow, 'revision' | 'createdAt' | 'updatedAt'>): EnvQueueRow {
  const now = Date.now();
  return { ...partial, revision: ROW_REVISION, createdAt: now, updatedAt: now };
}

/**
 * 记录仪批量导入。返回写入条数、排队条数；超额的请求被拒绝写入，
 * 条目保留原始观测日期排入队列，按天顺延（次日起每天最多 200 条）。
 */
export async function importEnvironmentBatch(input: BatchImportInput): Promise<BatchImportOutcome> {
  if (input.records.length === 0) return { ok: false, reason: 'empty' };

  const piano = await db.pianos.get(input.pianoId);
  if (!piano) return { ok: false, reason: 'piano-missing' };
  if (piano.state === '停用') return { ok: false, reason: 'piano-inactive', pianoState: piano.state };

  const lock = await tryTabLockAsync(ENV_IMPORT_LOCK);
  if (!lock.acquired) {
    return { ok: false, reason: 'lock-conflict', holder: lock.conflict.holder };
  }

  try {
    const day = today();
    const thresholds = await db.thresholds.toArray();
    const batchId = createId('batch');

    const { remaining } = await batchCapacityToday(day);
    const accepted = input.records.slice(0, remaining);
    const overflow = input.records.slice(remaining);

    const now = Date.now();
    const envRows: EnvironmentRow[] = accepted.map((record) => {
      const verdict = evaluateEnv(record.date, record.tempC, record.humidityPct, thresholds);
      return {
        id: createId('en'),
        pianoId: input.pianoId,
        date: record.date,
        tempC: record.tempC,
        humidityPct: record.humidityPct,
        device: '记录仪' as EnvDevice,
        abnormal: verdict.abnormal,
        thresholdVersion: verdict.thresholdVersion,
        batchId,
        revision: ROW_REVISION,
        createdAt: now,
        updatedAt: now
      };
    });

    // 超额部分排队：每 200 条顺延一天（明天、后天……），原始观测日期不变
    const queueRows: EnvQueueRow[] = [];
    overflow.forEach((record, index) => {
      const dayOffset = Math.floor(index / DAILY_BATCH_LIMIT) + 1;
      queueRows.push(
        stampQueue({
          id: createId('qu'),
          date: record.date,
          pianoId: input.pianoId,
          tempC: record.tempC,
          humidityPct: record.humidityPct,
          device: '记录仪',
          scheduledFor: addDays(day, dayOffset),
          status: '待处理',
          batchId
        })
      );
    });

    await db.transaction('rw', [db.environments, db.envQueue], async () => {
      if (envRows.length > 0) await db.environments.bulkPut(envRows);
      if (queueRows.length > 0) await db.envQueue.bulkPut(queueRows);
    });

    if (envRows.length > 0) {
      await recalcReminderForPiano(input.pianoId);
    }

    return {
      ok: true,
      accepted: envRows.length,
      queued: queueRows.length,
      rejected: overflow.length,
      abnormal: envRows.filter((row) => row.abnormal).length,
      batchId,
      queueEarliestDate: queueRows[0]?.scheduledFor ?? null
    };
  } finally {
    lock.release();
  }
}

/* ------------------------------ 队列放行 ------------------------------ */

export interface QueueProcessOutcome {
  processed: number;
  skipped: number;
  rescheduled: number;
  remaining: number;
}

/**
 * 处理今天到期的队列条目（应用启动 / 环境页打开时调用，也可手动刷新）。
 * 仍受当日 200 条批量额度限制；目标钢琴停用的条目不顺延丢弃，
 * 而是标记错误并推到次日，等待钢琴恢复后再来。
 */
export async function processDueQueue(day = today()): Promise<QueueProcessOutcome> {
  const lock = await tryTabLockAsync(ENV_IMPORT_LOCK);
  if (!lock.acquired) {
    return { processed: 0, skipped: 0, rescheduled: 0, remaining: 0 };
  }

  try {
    const { remaining } = await batchCapacityToday(day);
    if (remaining === 0) return { processed: 0, skipped: 0, rescheduled: 0, remaining: 0 };

    const due = await db.envQueue
      .where('scheduledFor').belowOrEqual(day)
      .and((item) => item.status === '待处理')
      .sortBy('scheduledFor');
    if (due.length === 0) return { processed: 0, skipped: 0, rescheduled: 0, remaining: 0 };

    const thresholds = await db.thresholds.toArray();
    const envRows: EnvironmentRow[] = [];
    const updateQueue: Array<{ id: string; patch: Partial<EnvQueueRow> }> = [];
    const affectedPianos = new Set<string>();
    let processed = 0;
    let rescheduled = 0;

    for (const item of due) {
      if (processed >= remaining) break;
      const piano = await db.pianos.get(item.pianoId);
      if (!piano) {
        updateQueue.push({
          id: item.id,
          patch: { scheduledFor: addDays(day, 1), error: '钢琴不存在，顺延至次日' }
        });
        rescheduled += 1;
        continue;
      }
      if (piano.state === '停用') {
        updateQueue.push({
          id: item.id,
          patch: { scheduledFor: addDays(day, 1), error: '钢琴已停用，顺延至次日' }
        });
        rescheduled += 1;
        continue;
      }

      const verdict = evaluateEnv(item.date, item.tempC, item.humidityPct, thresholds);
      const now = Date.now();
      envRows.push({
        id: createId('en'),
        pianoId: item.pianoId,
        date: item.date,
        tempC: item.tempC,
        humidityPct: item.humidityPct,
        device: item.device,
        abnormal: verdict.abnormal,
        thresholdVersion: verdict.thresholdVersion,
        batchId: item.batchId,
        revision: ROW_REVISION,
        createdAt: now,
        updatedAt: now
      });
      updateQueue.push({ id: item.id, patch: { status: '已处理', error: '' } });
      affectedPianos.add(item.pianoId);
      processed += 1;
    }

    await db.transaction('rw', [db.environments, db.envQueue], async () => {
      if (envRows.length > 0) await db.environments.bulkPut(envRows);
      for (const change of updateQueue) {
        await db.envQueue.update(change.id, { ...change.patch, updatedAt: Date.now() } as never);
      }
    });

    for (const pianoId of affectedPianos) {
      await recalcReminderForPiano(pianoId);
    }

    const remainingQueue = await db.envQueue.where('status').equals('待处理').count();
    return { processed, skipped: 0, rescheduled, remaining: remainingQueue };
  } finally {
    lock.release();
  }
}

/* ------------------------------ 编辑 / 删除 ------------------------------ */

export type EnvEditOutcome =
  | { ok: true; id: string; abnormal: boolean }
  | { ok: false; reason: 'piano-inactive' | 'piano-missing' | 'not-found'; pianoState?: PianoRow['state'] };

/** 编辑环境记录：改了温湿度 / 日期 / 琴后重新按当天阈值判定，并联动新旧两台琴的提醒 */
export async function updateEnvironmentRecord(
  id: string,
  patch: Partial<Omit<Environment, 'id'>>
): Promise<EnvEditOutcome> {
  const existing = await db.environments.get(id);
  if (!existing) return { ok: false, reason: 'not-found' };
  const merged = { ...existing, ...patch };

  const piano = await db.pianos.get(merged.pianoId);
  if (!piano) return { ok: false, reason: 'piano-missing' };
  if (piano.state === '停用') return { ok: false, reason: 'piano-inactive', pianoState: piano.state };

  const thresholds = await db.thresholds.toArray();
  const verdict = evaluateEnv(merged.date, merged.tempC, merged.humidityPct, thresholds);
  const previousPianoId = existing.pianoId;

  await db.transaction('rw', [db.environments], async () => {
    await db.environments.update(id, {
      pianoId: merged.pianoId,
      date: merged.date,
      tempC: merged.tempC,
      humidityPct: merged.humidityPct,
      device: merged.device,
      abnormal: verdict.abnormal,
      thresholdVersion: verdict.thresholdVersion,
      updatedAt: Date.now()
    } as never);
  });

  await recalcReminderForPiano(merged.pianoId);
  if (previousPianoId !== merged.pianoId) {
    await recalcReminderForPiano(previousPianoId);
  }
  return { ok: true, id, abnormal: verdict.abnormal };
}

/** 删除环境记录后重算该琴提醒（越界记录被移除时提醒应同步回退） */
export async function deleteEnvironmentRecord(id: string): Promise<boolean> {
  const existing = await db.environments.get(id);
  if (!existing) return false;
  await db.environments.delete(id);
  await recalcReminderForPiano(existing.pianoId);
  return true;
}

/* ------------------------------ 阈值变更 ------------------------------ */

export interface ThresholdChangeOutcome {
  environmentsUpdated: number;
  pianosRecalculated: number;
  remindersCreated: number;
  remindersDeleted: number;
}

/** 新建阈值版本时的输入（id 由入库层生成） */
export type NewThreshold = Omit<EnvThreshold, 'id'>;

/** 保存新阈值版本并按它全量重刷越界标记与调律提醒 */
export async function applyThresholdChange(threshold: NewThreshold): Promise<{
  id: string;
  stats: ThresholdChangeOutcome;
}> {
  const id = createId('th');
  const now = Date.now();
  const row = {
    id,
    effectiveDate: threshold.effectiveDate,
    tempMin: threshold.tempMin,
    tempMax: threshold.tempMax,
    humidityMin: threshold.humidityMin,
    humidityMax: threshold.humidityMax,
    note: threshold.note,
    revision: ROW_REVISION,
    createdAt: now,
    updatedAt: now
  };
  await db.transaction('rw', [db.thresholds], async () => {
    const existing = await db.thresholds.get(id);
    await db.thresholds.put(existing ? { ...row, createdAt: existing.createdAt } : row);
  });
  const thresholds = await db.thresholds.toArray();
  const stats = await recomputeAllWithThresholds(thresholds);
  return { id, stats };
}
