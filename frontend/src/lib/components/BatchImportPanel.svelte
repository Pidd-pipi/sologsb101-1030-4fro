<script lang="ts">
  /** 批量导入面板：粘贴记录仪导出的温湿度 JSON，按当天生效阈值入库 */
  import { createEventDispatcher } from 'svelte';
  import { submitBatch, type BatchImportResult } from '$lib/utils/batchImport';
  import { ENV_DEVICES, type Environment } from '$lib/types/environment';
  import type { DraftRecord } from '$lib/types/batchDraft';

  const dispatch = createEventDispatcher<{ imported: BatchImportResult }>();

  let text = $state('');
  let error = $state<string | null>(null);
  let result = $state<BatchImportResult | null>(null);
  let submitting = $state(false);

  const example = `[
  {"pianoId":"pn-001","date":"2024-04-08","tempC":22.4,"humidityPct":52,"device":"记录仪"},
  {"pianoId":"pn-002","date":"2024-04-09","tempC":27.8,"humidityPct":68,"device":"记录仪"}
]`;

  function parseRecords(raw: string): DraftRecord[] {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error('请粘贴 JSON 记录');
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('JSON 格式无效，请检查');
    }
    const arr = Array.isArray(parsed) ? parsed : (parsed as { records?: unknown }).records;
    if (!Array.isArray(arr)) throw new Error('应为记录数组（或包含 records 数组的对象）');
    return arr.map((item, idx) => {
      if (typeof item !== 'object' || item === null) throw new Error(`第 ${idx + 1} 条不是对象`);
      const r = item as Record<string, unknown>;
      const record: DraftRecord = {
        pianoId: String(r.pianoId ?? ''),
        date: String(r.date ?? ''),
        tempC: Number(r.tempC),
        humidityPct: Number(r.humidityPct),
        device: (ENV_DEVICES.includes(r.device as Environment['device']) ? r.device : '记录仪') as Environment['device']
      };
      return record;
    });
  }

  async function submit(): Promise<void> {
    error = null;
    result = null;
    let records: DraftRecord[];
    try {
      records = parseRecords(text);
    } catch (e) {
      error = e instanceof Error ? e.message : '解析失败';
      return;
    }
    if (records.length === 0) {
      error = '没有可导入的记录';
      return;
    }
    submitting = true;
    try {
      const res = await submitBatch(records);
      result = res;
      if (res.conflict) {
        // 冲突：保留选择，不清空文本
        return;
      }
      if (res.accepted || res.rejected) {
        text = '';
      }
      dispatch('imported', res);
    } catch (e) {
      error = e instanceof Error ? e.message : '提交失败';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="card">
  <div class="card-title mb-3">
    <span>批量导入记录仪数据</span>
    <span class="muted">按当天生效阈值判定越界</span>
  </div>
  <p class="muted mb-2">
    粘贴记录仪导出的 JSON 数组（字段：pianoId / date / tempC / humidityPct / device）。
    引用钢琴停用的记录留作草稿；每日超过 200 条拒绝并排队，余下排到次日。
  </p>
  <textarea
    class="field h-40 font-mono text-xs"
    bind:value={text}
    placeholder={example}
    disabled={submitting}
  ></textarea>
  {#if error}
    <div class="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
  {/if}
  {#if result}
    <div
      class="mt-2 rounded-lg px-3 py-2 text-xs {result.conflict
        ? 'bg-rose-50 text-rose-700'
        : result.accepted
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-amber-50 text-amber-700'}"
    >
      {result.message}
      {#if result.written > 0}<span class="ml-1">已写入 {result.written} 条。</span>{/if}
    </div>
  {/if}
  <div class="mt-3 flex justify-end gap-2">
    <button type="button" class="btn" onclick={() => (text = example)} disabled={submitting}>填入示例</button>
    <button type="button" class="btn-primary" onclick={submit} disabled={submitting}>
      {submitting ? '提交中…' : '提交批量导入'}
    </button>
  </div>
</div>
