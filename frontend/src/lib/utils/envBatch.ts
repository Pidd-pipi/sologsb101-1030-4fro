/**
 * 记录仪批量文本解析：支持 JSON 数组与「日期,温度,湿度」逐行两种格式。
 */

export interface ParsedEnvRecord {
  date: string;
  tempC: number;
  humidityPct: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ParseOutcome {
  records: ParsedEnvRecord[];
  error: string | null;
}

/** 校验单条记录，返回错误信息（合法为 null） */
export function validateEnvRecord(record: ParsedEnvRecord): string | null {
  if (!DATE_RE.test(record.date)) return `日期 ${record.date} 格式应为 YYYY-MM-DD`;
  if (Number.isNaN(record.tempC) || record.tempC < -10 || record.tempC > 45) {
    return `${record.date} 的温度 ${record.tempC} 超出 -10 ~ 45 ℃`;
  }
  if (Number.isNaN(record.humidityPct) || record.humidityPct < 0 || record.humidityPct > 100) {
    return `${record.date} 的湿度 ${record.humidityPct} 超出 0 ~ 100 %`;
  }
  return null;
}

/**
 * 解析批量导入文本：
 * - JSON：[{"date":"2026-10-05","tempC":22.4,"humidityPct":55}, ...]
 * - 逐行：2026-10-05,22.4,55
 */
export function parseEnvRecords(text: string): ParseOutcome {
  const trimmed = text.trim();
  if (!trimmed) return { records: [], error: '内容为空' };

  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { records: [], error: 'JSON 解析失败，请检查格式' };
    }
    if (!Array.isArray(parsed)) return { records: [], error: 'JSON 顶层必须是数组' };
    const records: ParsedEnvRecord[] = [];
    for (let i = 0; i < parsed.length; i += 1) {
      const item = parsed[i] as Partial<ParsedEnvRecord> | null;
      if (!item || typeof item !== 'object') return { records: [], error: `第 ${i + 1} 条不是对象` };
      const record: ParsedEnvRecord = {
        date: String(item.date ?? ''),
        tempC: Number(item.tempC),
        humidityPct: Number(item.humidityPct)
      };
      const error = validateEnvRecord(record);
      if (error) return { records: [], error: `第 ${i + 1} 条：${error}` };
      records.push(record);
    }
    return { records, error: null };
  }

  const records: ParsedEnvRecord[] = [];
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    const parts = lines[i].split(/[,\t]/).map((part) => part.trim());
    if (parts.length !== 3) {
      return { records: [], error: `第 ${i + 1} 行应为「日期,温度,湿度」` };
    }
    const record: ParsedEnvRecord = { date: parts[0], tempC: Number(parts[1]), humidityPct: Number(parts[2]) };
    const error = validateEnvRecord(record);
    if (error) return { records: [], error: `第 ${i + 1} 行：${error}` };
    records.push(record);
  }
  return { records, error: null };
}
