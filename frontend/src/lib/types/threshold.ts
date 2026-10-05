/**
 * 琴房温湿度阈值（按生效日期版本化）。
 * 记录仪导出的每一条记录，按「记录当天生效的阈值」判定是否越界，
 * 因此阈值变更只影响变更之后的判定，历史记录需重算才会刷新标记。
 */

/** 一条阈值版本 */
export interface Threshold {
  id: string;
  /** 生效日期（含当天），格式 YYYY-MM-DD */
  effectiveFrom: string;
  /** 温度下限 ℃ */
  tempMin: number;
  /** 温度上限 ℃ */
  tempMax: number;
  /** 湿度下限 % */
  humidityMin: number;
  /** 湿度上限 % */
  humidityMax: number;
  /** 备注 */
  note?: string;
}

/** 系统默认阈值（无任何版本时兜底，生效日期足够早） */
export const DEFAULT_THRESHOLD: Omit<Threshold, 'id'> = {
  effectiveFrom: '2000-01-01',
  tempMin: 18,
  tempMax: 26,
  humidityMin: 40,
  humidityMax: 60,
  note: '系统默认'
};

export function createEmptyThreshold(): Omit<Threshold, 'id'> {
  return { ...DEFAULT_THRESHOLD, effectiveFrom: new Date().toISOString().slice(0, 10), note: '' };
}

/** 校验阈值区间是否合法 */
export function validateThreshold(t: Omit<Threshold, 'id'>): string | null {
  if (!t.effectiveFrom) return '请选择生效日期';
  if (t.tempMin >= t.tempMax) return '温度下限必须小于上限';
  if (t.humidityMin >= t.humidityMax) return '湿度下限必须小于上限';
  if (t.tempMin < -30 || t.tempMax > 60) return '温度应在 -30 ~ 60 ℃ 之间';
  if (t.humidityMin < 0 || t.humidityMax > 100) return '湿度应在 0 ~ 100 % 之间';
  return null;
}

/** 取某条记录日期当天生效的阈值：effectiveFrom <= date 的最后一个版本 */
export function getThresholdForDate(date: string, thresholds: Threshold[]): Threshold {
  const fallback = { id: 'default', ...DEFAULT_THRESHOLD };
  if (!date) return fallback;
  const sorted = [...thresholds].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let effective: Threshold | null = null;
  for (const t of sorted) {
    if (t.effectiveFrom.localeCompare(date) <= 0) {
      effective = t;
    } else {
      break;
    }
  }
  return effective ?? fallback;
}

/** 按指定阈值判定温湿度是否越界 */
export function isAbnormalAt(tempC: number, humidityPct: number, t: Threshold): boolean {
  return (
    tempC < t.tempMin ||
    tempC > t.tempMax ||
    humidityPct < t.humidityMin ||
    humidityPct > t.humidityMax
  );
}

/** 按指定阈值给出越界项文字提示 */
export function abnormalHintAt(tempC: number, humidityPct: number, t: Threshold): string {
  const hints: string[] = [];
  if (tempC < t.tempMin) hints.push('温度偏低，建议升温');
  if (tempC > t.tempMax) hints.push('温度偏高，建议通风降温');
  if (humidityPct < t.humidityMin) hints.push('湿度偏低，建议加湿');
  if (humidityPct > t.humidityMax) hints.push('湿度偏高，建议除湿');
  return hints.join('；') || '处于建议区间';
}
