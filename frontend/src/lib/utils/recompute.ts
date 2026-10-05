/**
 * 越界标记与调律提醒重算。
 * - 阈值变更后，旧的越界标记失效，需按每条记录「当天生效的阈值」重算
 * - 越界记录要接着把对应琴的调律提醒重算（有越界记录的琴至少置为临近）
 * - 全量扫描，不漏掉本该提醒的琴
 */
import { db, type EnvironmentRow, type ReminderRow, type ThresholdRow } from './db';
import { deriveReminderState } from '$lib/types/reminder';
import { getThresholdForDate, isAbnormalAt } from '$lib/types/threshold';

export interface RecomputeResult {
  /** 越界标记被刷新的记录数 */
  abnormalRefreshed: number;
  /** 提醒状态被刷新的条数 */
  remindersRefreshed: number;
}

/** 按每条记录当天生效的阈值重算全部越界标记 */
export async function recomputeAbnormalMarkers(
  thresholds?: ThresholdRow[],
  environments?: EnvironmentRow[]
): Promise<number> {
  const [thList, envList] = await Promise.all([
    thresholds ?? db.thresholds.toArray(),
    environments ?? db.environments.toArray()
  ]);
  let changed = 0;
  for (const env of envList) {
    const threshold = getThresholdForDate(env.date, thList);
    const abnormal = isAbnormalAt(env.tempC, env.humidityPct, threshold);
    if (abnormal !== env.abnormal) {
      await db.environments.update(env.id, { abnormal, updatedAt: Date.now() } as never);
      changed += 1;
    }
  }
  return changed;
}

/**
 * 按越界标记重算全部调律提醒。
 * 规则：有越界记录的琴，提醒至少置为「临近」；已超期的保持超期。
 * 全量扫描每一条提醒，确保不漏掉本该提醒的琴。
 */
export async function recomputeReminders(
  environments?: EnvironmentRow[],
  reminders?: ReminderRow[]
): Promise<number> {
  const [envList, reminderList] = await Promise.all([
    environments ?? db.environments.toArray(),
    reminders ?? db.reminders.toArray()
  ]);
  const abnormalPianoIds = new Set(envList.filter((e) => e.abnormal).map((e) => e.pianoId));
  let changed = 0;
  for (const reminder of reminderList) {
    const dateState = deriveReminderState(reminder.nextDueDate);
    const hasAbnormal = abnormalPianoIds.has(reminder.pianoId);
    const state = hasAbnormal && dateState === '正常' ? '临近' : dateState;
    if (state !== reminder.state) {
      await db.reminders.update(reminder.id, { state, updatedAt: Date.now() } as never);
      changed += 1;
    }
  }
  return changed;
}

/** 阈值变更后重算：先刷新越界标记，再按新标记刷新提醒 */
export async function recomputeAll(): Promise<RecomputeResult> {
  const [thresholds, environments, reminders] = await Promise.all([
    db.thresholds.toArray(),
    db.environments.toArray(),
    db.reminders.toArray()
  ]);
  const abnormalRefreshed = await recomputeAbnormalMarkers(thresholds, environments);
  // 重算标记后重新读取环境记录，确保提醒刷新用的是最新标记
  const refreshedEnvs = await db.environments.toArray();
  const remindersRefreshed = await recomputeReminders(refreshedEnvs, reminders);
  return { abnormalRefreshed, remindersRefreshed };
}
