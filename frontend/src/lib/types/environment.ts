/** 监测方式 */
export type EnvDevice = '温湿度计' | '记录仪';

/** 琴房环境记录 */
export interface Environment {
  id: string;
  /** 所属钢琴 */
  pianoId: string;
  /** 日期 */
  date: string;
  /** 温度 ℃ */
  tempC: number;
  /** 相对湿度 % */
  humidityPct: number;
  /** 监测方式 */
  device: EnvDevice;
  /** 是否越界（按记录当天生效的阈值版本判定后落库） */
  abnormal: boolean;
  /** 判定时生效的阈值版本 id */
  thresholdVersion?: string;
  /** 记录仪批量导入的批次 id */
  batchId?: string;
}

/** 默认建议温度区间 ℃（无阈值版本时兜底） */
export const TEMP_RANGE: [number, number] = [18, 26];
/** 默认建议湿度区间 %（无阈值版本时兜底） */
export const HUMIDITY_RANGE: [number, number] = [40, 60];

export const ENV_DEVICES: EnvDevice[] = ['温湿度计', '记录仪'];

export interface EnvRanges {
  temp: [number, number];
  humidity: [number, number];
}

/** 默认建议区间 */
export const DEFAULT_RANGES: EnvRanges = { temp: TEMP_RANGE, humidity: HUMIDITY_RANGE };

/** 温度和湿度是否超出给定区间（未传时用默认建议区间） */
export function isAbnormal(tempC: number, humidityPct: number, ranges: EnvRanges = DEFAULT_RANGES): boolean {
  return (
    tempC < ranges.temp[0] ||
    tempC > ranges.temp[1] ||
    humidityPct < ranges.humidity[0] ||
    humidityPct > ranges.humidity[1]
  );
}

/** 越界项的文字提示（按给定区间） */
export function abnormalHint(tempC: number, humidityPct: number, ranges: EnvRanges = DEFAULT_RANGES): string {
  const hints: string[] = [];
  if (tempC < ranges.temp[0]) hints.push('温度偏低，建议升温');
  if (tempC > ranges.temp[1]) hints.push('温度偏高，建议通风降温');
  if (humidityPct < ranges.humidity[0]) hints.push('湿度偏低，建议加湿');
  if (humidityPct > ranges.humidity[1]) hints.push('湿度偏高，建议除湿');
  return hints.join('；') || '处于建议区间';
}

export function createEmptyEnvironment(): Omit<Environment, 'id'> {
  return {
    pianoId: '',
    date: new Date().toISOString().slice(0, 10),
    tempC: 22,
    humidityPct: 50,
    device: '温湿度计',
    abnormal: false
  };
}
