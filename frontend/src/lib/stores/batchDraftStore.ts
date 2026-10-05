/**
 * 批量导入草稿 store：维护未写入记录的查询与丢弃动作。
 * 草稿由 batchImport 在提交/排队时写入，页面只读展示并可丢弃。
 */
import type { BatchDraft } from '$lib/types/batchDraft';
import { removeBatchDraft, updateBatchDraft } from '$lib/utils/db';

export async function discardDraft(id: string): Promise<void> {
  await updateBatchDraft(id, { status: 'discarded' });
}

export async function deleteDraft(id: string): Promise<void> {
  await removeBatchDraft(id);
}

/** 统计待处理草稿条数 */
export function countPendingRecords(drafts: BatchDraft[]): number {
  return drafts.filter((d) => d.status === 'pending').reduce((sum, d) => sum + d.records.length, 0);
}
