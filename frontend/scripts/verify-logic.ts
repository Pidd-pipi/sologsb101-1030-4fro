/**
 * 核心逻辑验证：阈值生效判定、越界标记、额度分批。
 * 运行：npx tsx scripts/verify-logic.ts
 */
import { getThresholdForDate, isAbnormalAt, DEFAULT_THRESHOLD, type Threshold } from '../src/lib/types/threshold';
import { deriveReminderState } from '../src/lib/types/reminder';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}

// ---- 阈值生效判定 ----
const thresholds: Threshold[] = [
  { id: 't1', effectiveFrom: '2024-01-01', tempMin: 18, tempMax: 26, humidityMin: 40, humidityMax: 60 },
  { id: 't2', effectiveFrom: '2024-06-01', tempMin: 20, tempMax: 24, humidityMin: 45, humidityMax: 55 },
  { id: 't3', effectiveFrom: '2024-09-01', tempMin: 22, tempMax: 26, humidityMin: 50, humidityMax: 60 }
];

assert(getThresholdForDate('2024-03-15', thresholds).id === 't1', '3月用t1阈值');
assert(getThresholdForDate('2024-06-01', thresholds).id === 't2', '6月1日当天用t2阈值');
assert(getThresholdForDate('2024-08-31', thresholds).id === 't2', '8月底用t2阈值');
assert(getThresholdForDate('2024-09-01', thresholds).id === 't3', '9月用t3阈值');
assert(getThresholdForDate('2023-12-31', thresholds).id === 'default', '最早阈值之前用默认');
assert(getThresholdForDate('2024-03-15', []).tempMin === DEFAULT_THRESHOLD.tempMin, '空列表用默认');

// ---- 越界判定（按当天阈值） ----
const t1 = getThresholdForDate('2024-03-15', thresholds);
assert(isAbnormalAt(27, 50, t1) === true, '27℃超t1上限26→越界');
assert(isAbnormalAt(25, 50, t1) === false, '25℃在t1区间→正常');
assert(isAbnormalAt(25, 62, t1) === true, '湿度62超t1上限60→越界');

const t2 = getThresholdForDate('2024-06-15', thresholds);
assert(isAbnormalAt(25, 50, t2) === true, '25℃超t2上限24→越界（阈值变更后同值判定不同）');
assert(isAbnormalAt(23, 50, t2) === false, '23℃在t2区间→正常');

// ---- 提醒状态推导 ----
assert(deriveReminderState('2024-01-01', '2024-10-05') === '超期', '下次日期已过→超期');
assert(deriveReminderState('2024-10-20', '2024-10-05') === '临近', '30天内→临近');
assert(deriveReminderState('2024-12-01', '2024-10-05') === '正常', '远期→正常');

// ---- 额度分批逻辑（模拟） ----
const DAILY_BATCH_LIMIT = 200;
function splitBatch(total: number, alreadyToday: number): { today: number; tomorrow: number; rejected: boolean } {
  const remaining = Math.max(0, DAILY_BATCH_LIMIT - alreadyToday);
  if (total <= remaining) return { today: total, tomorrow: 0, rejected: false };
  return { today: remaining, tomorrow: total - remaining, rejected: true };
}

assert(splitBatch(150, 0).rejected === false, '150条未超额度→接受');
assert(splitBatch(250, 0).rejected === true, '250条超额度→拒绝');
assert(splitBatch(250, 0).today === 200, '250条中200条今日');
assert(splitBatch(250, 0).tomorrow === 50, '250条中50条明日');
assert(splitBatch(100, 150).today === 50, '已用150时100条中50条今日');
assert(splitBatch(100, 150).tomorrow === 50, '已用150时100条中50条明日');
assert(splitBatch(100, 200).today === 0, '已满额度时0条今日');
assert(splitBatch(100, 200).tomorrow === 100, '已满额度时100条明日');

console.log(`\n通过 ${passed} 条，失败 ${failed} 条`);
if (failed > 0) process.exit(1);
