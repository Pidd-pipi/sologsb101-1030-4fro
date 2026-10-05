/**
 * 批量导入编排。
 * - 跨标签页互斥锁：两标签页同时提交只锁一份，另一页保留选择并提示冲突
 * - 按记录当天生效的阈值评估越界
 * - 引用钢琴停用（或不存在）的记录不写入，留作草稿下次继续
 * - 每日批量超过 DAILY_BATCH_LIMIT 条时拒绝请求并排队分批，余下排到次日
 */
import { db, DAILY_BATCH_LIMIT, type EnvironmentRow, type ThresholdRow } from './db';
import { countEnvironmentsCreatedToday } from './db';
import { withBatchLock } from './locks';
import { buildRow } from '$lib/hooks/useIdbTable';
import { recomputeReminders } from './recompute';
import { getThresholdForDate, isAbnormalAt } from '$lib/types/threshold';
import { ENV_DEVICES } from '$lib/types/environment';
import type { BatchDraft, DraftRecord, DraftReason } from '$lib/types/batchDraft';
import { createId } from './uuid';

export interface BatchImportResult {
  /** 请求被接受（全部有效记录已写入） */
  accepted: boolean;
  /** 请求被拒绝（超出每日额度，已排队分批） */
  rejected: boolean;
  /** 两标签页争抢锁，本页未拿到 */
  conflict: boolean;
  batchId: string;
  /** 实际写入条数 */
  written: number;
  /** 因钢琴停用/不存在未写入的条数 */
  deactivated: number;
  /** 因额度溢出排队的条数 */
  overflow: number;
  /** 因记录无效未写入的条数 */
  invalid: number;
  /** 生成的草稿 id */
  draftIds: string[];
  message: string;
}

export interface FlushResult {
  conflict: boolean;
  processedDrafts: number;
  written: number;
  requeued: number;
}

/** 校验单条记录字段是否合法 */
function validateRecord(r: DraftRecord): string | null {
  if (!r.pianoId) return '缺少钢琴';
  if (!r.date) return '缺少日期';
  if (Number.isNaN(new Date(`${r.date}T00:00:00`).getTime())) return '日期格式无效';
  if (r.tempC < -10 || r.tempC > 45) return '温度应在 -10 ~ 45 ℃';
  if (r.humidityPct < 0 || r.humidityPct > 100) return '湿度应在 0 ~ 100 %';
  if (!ENV_DEVICES.includes(r.device)) return '监测方式无效';
  return null;
}

/** 组装一条带 id / 修订号 / 时间戳的环境记录 */
function buildEnvironmentRow(r: DraftRecord, thresholds: ThresholdRow[]): EnvironmentRow {
  const threshold = getThresholdForDate(r.date, thresholds);
  const abnormal = isAbnormalAt(r.tempC, r.humidityPct, threshold);
  return buildRow({ ...r, abnormal }, 'env');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** 落一条草稿 */
async function createDraft(
  batchId: string,
  reason: DraftReason,
  plannedDate: string,
  records: DraftRecord[],
  note: string
): Promise<string> {
  const row = buildRow<Omit<BatchDraft, 'id'>>(
    { batchId, reason, plannedDate, status: 'pending', records, note },
    'draft'
  );
  await db.batchDrafts.put(row);
  return row.id;
}

/**
 * 提交一批记录仪导出的温湿度记录。
 * 返回批量导入结果；conflict=true 表示另一标签页占用了锁，本页应保留选择并提示冲突。
 */
export async function submitBatch(records: DraftRecord[]): Promise<BatchImportResult> {
  const batchId = `batch-${createId('').replace(/^-/, '')}`;
  const empty: BatchImportResult = {
    accepted: false,
    rejected: false,
    conflict: false,
    batchId,
    written: 0,
    deactivated: 0,
    overflow: 0,
    invalid: 0,
    draftIds: [],
    message: ''
  };

  const outcome = await withBatchLock(async (): Promise<BatchImportResult> => {
    const [pianos, thresholds] = await Promise.all([db.pianos.toArray(), db.thresholds.toArray()]);
    const pianoMap = new Map(pianos.map((p) => [p.id, p]));

    const valid: DraftRecord[] = [];
    const deactivatedRecords: DraftRecord[] = [];
    const invalidRecords: DraftRecord[] = [];

    for (const record of records) {
      const fieldError = validateRecord(record);
      if (fieldError) {
        invalidRecords.push(record);
        continue;
      }
      const piano = pianoMap.get(record.pianoId);
      if (!piano || piano.state === '停用') {
        deactivatedRecords.push(record);
        continue;
      }
      valid.push(record);
    }

    const draftIds: string[] = [];
    let deactivated = deactivatedRecords.length;
    let invalid = invalidRecords.length;

    // 停用 / 无效记录直接落草稿，留待下次继续
    if (deactivatedRecords.length > 0) {
      const id = await createDraft(batchId, 'deactivated', today(), deactivatedRecords, '引用的钢琴已停用或不存在');
      draftIds.push(id);
    }
    if (invalidRecords.length > 0) {
      const id = await createDraft(batchId, 'invalid', today(), invalidRecords, '记录缺字段或数值越界');
      draftIds.push(id);
    }

    const alreadyToday = await countEnvironmentsCreatedToday();
    const remaining = Math.max(0, DAILY_BATCH_LIMIT - alreadyToday);

    if (valid.length <= remaining) {
      // 全部可写入
      const rows = valid.map((r) => buildEnvironmentRow(r, thresholds));
      await db.environments.bulkPut(rows);
      await recomputeReminders();
      return {
        ...empty,
        accepted: true,
        written: rows.length,
        deactivated,
        invalid,
        draftIds,
        message: `已写入 ${rows.length} 条记录` + (deactivated ? `，${deactivated} 条因钢琴停用留作草稿` : '') + (invalid ? `，${invalid} 条因无效留作草稿` : '')
      };
    }

    // 超出每日额度：拒绝请求，排队分批，余下排到次日
    const todayPart = valid.slice(0, remaining);
    const tomorrowPart = valid.slice(remaining);
    if (todayPart.length > 0) {
      const id = await createDraft(batchId, 'quota-overflow', today(), todayPart, '超出每日额度，今日分批');
      draftIds.push(id);
    }
    if (tomorrowPart.length > 0) {
      const id = await createDraft(batchId, 'quota-overflow', tomorrow(), tomorrowPart, '超出每日额度，余下排到次日');
      draftIds.push(id);
    }

    // 刷新今日到期的草稿（把今日分批写入）。已持有锁，直接调用无锁版本
    const flush = await processDueDrafts();

    return {
      ...empty,
      rejected: true,
      written: flush.written,
      overflow: tomorrowPart.length,
      deactivated,
      invalid,
      draftIds,
      message: `请求被拒绝：每日批量额度 ${DAILY_BATCH_LIMIT} 条，今日已用 ${alreadyToday} 条。已分批排队：今日 ${todayPart.length} 条（已写入 ${flush.written}），明日 ${tomorrowPart.length} 条请明日再来` + (deactivated ? `；${deactivated} 条因钢琴停用留作草稿` : '') + (invalid ? `；${invalid} 条因无效留作草稿` : '')
    };
  });

  if (!outcome.acquired) {
    return { ...empty, conflict: true, message: '另一标签页正在提交，请稍后再试（已保留本次选择）' };
  }
  return outcome.result ?? empty;
}

/** 无锁版本：刷新所有到期草稿（调用方需已持有批量导入锁） */
async function processDueDrafts(): Promise<FlushResult> {
  const result: FlushResult = { conflict: false, processedDrafts: 0, written: 0, requeued: 0 };
  const [drafts, thresholds] = await Promise.all([db.batchDrafts.toArray(), db.thresholds.toArray()]);
  const due = drafts.filter((d) => d.status === 'pending' && d.plannedDate.localeCompare(today()) <= 0);
  if (due.length === 0) return result;

  let remaining = Math.max(0, DAILY_BATCH_LIMIT - (await countEnvironmentsCreatedToday()));
  let written = 0;
  let requeued = 0;

  for (const draft of due) {
    if (draft.records.length <= remaining) {
      const rows = draft.records.map((r) => buildEnvironmentRow(r, thresholds));
      await db.environments.bulkPut(rows);
      await db.batchDrafts.update(draft.id, { status: 'processed', updatedAt: Date.now() } as never);
      written += rows.length;
      remaining -= rows.length;
      result.processedDrafts += 1;
    } else {
      const part = draft.records.slice(0, remaining);
      const rest = draft.records.slice(remaining);
      if (part.length > 0) {
        const rows = part.map((r) => buildEnvironmentRow(r, thresholds));
        await db.environments.bulkPut(rows);
        written += rows.length;
        remaining -= rows.length;
      }
      // 余下顺延到次日
      await db.batchDrafts.update(
        draft.id,
        { records: rest, plannedDate: tomorrow(), updatedAt: Date.now() } as never
      );
      requeued += rest.length;
    }
  }

  if (written > 0) {
    await recomputeReminders();
  }
  result.written = written;
  result.requeued = requeued;
  return result;
}

/**
 * 刷新所有到期（plannedDate <= 今天）的待处理草稿。
 * 写入时按每条记录当天生效的阈值评估越界；若再次超出当日额度，余下顺延到次日。
 */
export async function flushDueDrafts(): Promise<FlushResult> {
  const result: FlushResult = { conflict: false, processedDrafts: 0, written: 0, requeued: 0 };
  const outcome = await withBatchLock(async () => processDueDrafts());
  if (!outcome.acquired) {
    return { ...result, conflict: true };
  }
  return outcome.result ?? result;
}
