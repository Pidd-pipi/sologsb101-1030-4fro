/**
 * 温湿度阈值 store：维护阈值版本的增删动作。
 * 阈值变更后旧的越界标记失效，需调用 recomputeAll 重算全部记录并刷新提醒。
 */
import { writable, type Writable } from 'svelte/store';
import type { Threshold } from '$lib/types/threshold';
import { putThreshold, removeThreshold } from '$lib/utils/db';
import { buildRow } from '$lib/hooks/useIdbTable';
import { recomputeAll } from '$lib/utils/recompute';

/** 阈值列表筛选（预留，当前无额外筛选条件） */
export const thresholdFilters: Writable<Record<string, never>> = writable({});

export async function createThreshold(payload: Omit<Threshold, 'id'>): Promise<{ id: string; abnormalRefreshed: number; remindersRefreshed: number }> {
  const row = buildRow(payload, 'th');
  await putThreshold(row);
  const { abnormalRefreshed, remindersRefreshed } = await recomputeAll();
  return { id: row.id, abnormalRefreshed, remindersRefreshed };
}

export async function deleteThreshold(id: string): Promise<{ abnormalRefreshed: number; remindersRefreshed: number }> {
  await removeThreshold(id);
  const { abnormalRefreshed, remindersRefreshed } = await recomputeAll();
  return { abnormalRefreshed, remindersRefreshed };
}
