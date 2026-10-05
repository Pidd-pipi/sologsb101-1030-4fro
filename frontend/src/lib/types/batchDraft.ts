/**
 * 批量导入草稿：单次提交中未能写入的记录暂存于此，留待下次继续。
 * - deactivated：引用的钢琴已停用（或已删除），不写入
 * - quota-overflow：超出每日批量额度，排队分批，余下排到次日
 * - invalid：记录本身缺字段或数值越界
 */
import type { Environment } from './environment';

/** 草稿未写入原因 */
export type DraftReason = 'deactivated' | 'quota-overflow' | 'invalid';

/** 草稿处理状态 */
export type DraftStatus = 'pending' | 'processed' | 'discarded';

/** 草稿中的一条待写入记录（abnormal 在真正写入时按当天生效阈值重算） */
export type DraftRecord = Omit<Environment, 'id' | 'abnormal'>;

/** 批量导入草稿 */
export interface BatchDraft {
  id: string;
  /** 来源批次标识 */
  batchId: string;
  /** 未写入原因 */
  reason: DraftReason;
  /** 计划处理日期（quota-overflow 的余下部分排到次日） */
  plannedDate: string;
  /** 处理状态 */
  status: DraftStatus;
  /** 待写入记录 */
  records: DraftRecord[];
  /** 备注提示 */
  note?: string;
}

export const DRAFT_REASON_LABELS: Record<DraftReason, string> = {
  deactivated: '钢琴停用',
  'quota-overflow': '额度溢出',
  invalid: '记录无效'
};

export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  pending: '待处理',
  processed: '已写入',
  discarded: '已丢弃'
};
