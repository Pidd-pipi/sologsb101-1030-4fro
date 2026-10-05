/**
 * 琴房环境 store：维护温湿度记录的筛选条件与增删改动作。
 * 入库编排（阈值判定 / 停用拒写 / 批量限额排队 / 提醒联动）统一走 environmentIntake。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Environment } from '$lib/types/environment';
import {
  submitSingleEnvironment,
  updateEnvironmentRecord,
  deleteEnvironmentRecord,
  importEnvironmentBatch,
  processDueQueue,
  applyThresholdChange,
  type SingleSubmitOutcome,
  type EnvEditOutcome,
  type BatchImportOutcome,
  type QueueProcessOutcome,
  type ThresholdChangeOutcome,
  type NewThreshold
} from '$lib/utils/environmentIntake';
import type { ParsedEnvRecord } from '$lib/utils/envBatch';

/** 参与 URL 同步的筛选键（switch 为「仅看超标记录」开关） */
export const ENVIRONMENT_FILTER_KEYS = ['pianoIds', 'switch'];

/** 环境记录筛选条件 */
export const environmentFilters: Writable<FilterModel> = writable({
  keyword: '',
  pianoIds: [],
  switch: false
});

export function setEnvironmentFilters(next: FilterModel): void {
  environmentFilters.set(next);
}

export function resetEnvironmentFilters(): void {
  environmentFilters.set({ keyword: '', pianoIds: [], switch: false });
}

/** 新建单条环境记录（停用琴拒写，草稿由页面保存） */
export async function createEnvironment(payload: Omit<Environment, 'id'>): Promise<SingleSubmitOutcome> {
  return submitSingleEnvironment(payload);
}

/** 编辑环境记录 */
export async function editEnvironment(
  id: string,
  patch: Partial<Environment>
): Promise<EnvEditOutcome> {
  return updateEnvironmentRecord(id, patch);
}

export async function deleteEnvironment(id: string): Promise<boolean> {
  return deleteEnvironmentRecord(id);
}

/** 记录仪批量导入（跨标签页互斥；超额排队次日分批） */
export async function importEnvironmentRecords(
  pianoId: string,
  records: ParsedEnvRecord[]
): Promise<BatchImportOutcome> {
  return importEnvironmentBatch({ pianoId, records });
}

/** 放行今日到期的队列条目 */
export async function releaseDueQueue(): Promise<QueueProcessOutcome> {
  return processDueQueue();
}

/** 阈值变更：保存新版本并重刷全部越界标记与提醒 */
export async function changeThreshold(
  threshold: NewThreshold
): Promise<{ id: string; stats: ThresholdChangeOutcome }> {
  return applyThresholdChange(threshold);
}
