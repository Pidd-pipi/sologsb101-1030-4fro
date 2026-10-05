/**
 * 记录仪批量导入队列：单日批量超过 200 条时，请求被拒绝（当批只处理前 200 条），
 * 余下条目保留原始观测日期排入本队列，并按天顺延：次日起每天最多放行 200 条。
 */
import { today } from '../utils/uuid';

/** 队列条目状态 */
export type QueueStatus = '待处理' | '已处理';

/** 队列中的一条待导入环境记录 */
export interface EnvQueueItem {
  id: string;
  /** 原始观测日期 YYYY-MM-DD（不随排队日期改变） */
  date: string;
  /** 目标钢琴 */
  pianoId: string;
  tempC: number;
  humidityPct: number;
  device: '温湿度计' | '记录仪';
  /** 计划放行处理日期 YYYY-MM-DD */
  scheduledFor: string;
  status: QueueStatus;
  /** 失败原因（如钢琴已停用） */
  error?: string;
  /** 原始批次 id（溯源用） */
  batchId: string;
}

/** 每日批量导入条数上限 */
export const DAILY_BATCH_LIMIT = 200;

export function createEmptyQueueItem(): Omit<EnvQueueItem, 'id'> {
  return {
    date: today(),
    pianoId: '',
    tempC: 0,
    humidityPct: 0,
    device: '记录仪',
    scheduledFor: today(),
    status: '待处理',
    batchId: ''
  };
}
