/**
 * 温湿度阈值版本：按生效日期选择「当天生效」的一份区间。
 * 阈值变更后旧的越界标记失效，需要以新版本重刷全部环境记录与调律提醒。
 */
import type { EnvRanges } from './environment';
import { DEFAULT_RANGES } from './environment';

export interface EnvThreshold {
  id: string;
  /** 生效日期 YYYY-MM-DD（含当天） */
  effectiveDate: string;
  /** 温度下限 ℃ */
  tempMin: number;
  /** 温度上限 ℃ */
  tempMax: number;
  /** 湿度下限 % */
  humidityMin: number;
  /** 湿度上限 % */
  humidityMax: number;
  /** 备注（变更原因） */
  note: string;
}

/** 内置默认阈值版本 id（库初始化时写入，不可删除） */
export const DEFAULT_THRESHOLD_ID = 'th-default';

export function rangesOf(threshold: Pick<EnvThreshold, 'tempMin' | 'tempMax' | 'humidityMin' | 'humidityMax'>): EnvRanges {
  return {
    temp: [threshold.tempMin, threshold.tempMax],
    humidity: [threshold.humidityMin, threshold.humidityMax]
  };
}

/**
 * 选出指定日期当天生效的阈值版本：effectiveDate <= date 中最新的一份。
 * 同一生效日期有多份时，取最近更新（updatedAt / createdAt 最大）的一份；
 * 没有任何版本时返回 null（调用方用默认区间兜底）。
 */
export function effectiveThreshold(
  thresholds: Array<EnvThreshold & { updatedAt?: number; createdAt?: number }>,
  date: string
): EnvThreshold | null {
  const valid = thresholds.filter((item) => item.effectiveDate <= date);
  if (valid.length === 0) return null;
  return valid.reduce((latest, item) => {
    if (item.effectiveDate > latest.effectiveDate) return item;
    if (item.effectiveDate < latest.effectiveDate) return latest;
    const itemStamp = item.updatedAt ?? item.createdAt ?? 0;
    const latestStamp = latest.updatedAt ?? latest.createdAt ?? 0;
    return itemStamp > latestStamp ? item : latest;
  });
}

export function createEmptyThreshold(): Omit<EnvThreshold, 'id'> {
  const today = new Date().toISOString().slice(0, 10);
  return {
    effectiveDate: today,
    tempMin: DEFAULT_RANGES.temp[0],
    tempMax: DEFAULT_RANGES.temp[1],
    humidityMin: DEFAULT_RANGES.humidity[0],
    humidityMax: DEFAULT_RANGES.humidity[1],
    note: ''
  };
}

/** 阈值表单校验，返回错误信息（合法时为 null） */
export function validateThreshold(input: Omit<EnvThreshold, 'id'>): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) return '请填写生效日期';
  if (input.tempMin >= input.tempMax) return '温度下限必须小于上限';
  if (input.humidityMin >= input.humidityMax) return '湿度下限必须小于上限';
  if (input.tempMin < -40 || input.tempMax > 60) return '温度范围应在 -40 ~ 60 ℃ 之间';
  if (input.humidityMin < 0 || input.humidityMax > 100) return '湿度范围应在 0 ~ 100 % 之间';
  return null;
}
