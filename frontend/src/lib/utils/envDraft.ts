/**
 * 环境录入草稿：单条记录引用的钢琴已停用时不写入，
 * 把本次表单内容保存在浏览器 localStorage，下次打开新建弹窗继续编辑。
 */
import type { Environment } from '$lib/types/environment';

const DRAFT_KEY = 'gbpianotune:environment-draft';

export type EnvironmentDraft = Omit<Environment, 'id'> & { savedAt: string };

/** 读取未完成的草稿（无则 null） */
export function loadEnvironmentDraft(): EnvironmentDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EnvironmentDraft>;
    if (
      typeof parsed.pianoId !== 'string' ||
      typeof parsed.date !== 'string' ||
      typeof parsed.tempC !== 'number' ||
      typeof parsed.humidityPct !== 'number'
    ) {
      return null;
    }
    return {
      pianoId: parsed.pianoId,
      date: parsed.date,
      tempC: parsed.tempC,
      humidityPct: parsed.humidityPct,
      device: parsed.device === '记录仪' ? '记录仪' : '温湿度计',
      abnormal: Boolean(parsed.abnormal),
      thresholdVersion: typeof parsed.thresholdVersion === 'string' ? parsed.thresholdVersion : undefined,
      batchId: typeof parsed.batchId === 'string' ? parsed.batchId : undefined,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString()
    };
  } catch {
    return null;
  }
}

/** 保存草稿（钢琴停用时拒写后调用） */
export function saveEnvironmentDraft(payload: Omit<Environment, 'id'>): void {
  const draft: EnvironmentDraft = { ...payload, savedAt: new Date().toISOString() };
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

/** 丢弃草稿 */
export function clearEnvironmentDraft(): void {
  window.localStorage.removeItem(DRAFT_KEY);
}
