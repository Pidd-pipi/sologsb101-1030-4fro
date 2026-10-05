<script lang="ts">
  /** 阈值版本管理：新增生效版本后旧越界标记失效，全量重刷标记与调律提醒 */
  import {
    createEmptyThreshold,
    validateThreshold,
    DEFAULT_THRESHOLD_ID,
    type EnvThreshold
  } from '$lib/types/threshold';
  import { changeThreshold } from '$lib/stores/environmentStore';
  import type { ThresholdRow } from '$lib/utils/db';

  let { thresholds = $bindable(), expanded = $bindable(false) }: {
    thresholds: ThresholdRow[];
    expanded: boolean;
  } = $props();

  let form = $state<Omit<EnvThreshold, 'id'>>(createEmptyThreshold());
  let formError = $state<string | null>(null);
  let saving = $state(false);
  let lastStats = $state<string | null>(null);

  const ordered = $derived([...thresholds].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)));

  async function save(): Promise<void> {
    const error = validateThreshold(form);
    if (error) {
      formError = error;
      return;
    }
    saving = true;
    formError = null;
    try {
      const { stats } = await changeThreshold({ ...form });
      lastStats =
        `已按新阈值重刷 ${stats.environmentsUpdated} 条越界标记，` +
        `重算 ${stats.pianosRecalculated} 台琴的提醒，补建 ${stats.remindersCreated} 条、回收 ${stats.remindersDeleted} 条。`;
      form = { ...createEmptyThreshold() };
    } catch (err) {
      formError = err instanceof Error ? err.message : '阈值保存失败';
    } finally {
      saving = false;
    }
  }
</script>

<div class="card">
  <button
    type="button"
    class="card-title mb-3 flex w-full items-center justify-between text-left"
    onclick={() => (expanded = !expanded)}
  >
    <span>温湿度阈值版本（{thresholds.length}）</span>
    <span class="muted">{expanded ? '收起 ▲' : '管理 / 变更 ▼'}</span>
  </button>

  {#if lastStats}
    <div class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{lastStats}</div>
  {/if}

  {#if expanded}
    <div class="mb-4 rounded-lg border border-stone-200 p-3">
      <div class="muted mb-2 text-xs">
        新版本自生效日期（含当天）起适用；保存后历史记录按各自「当天生效」的阈值重新判定，越界标记与调律提醒同步刷新。
      </div>
      {#if formError}
        <div class="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div>
      {/if}
      <div class="grid gap-3 md:grid-cols-5">
        <div>
          <span class="label">生效日期</span>
          <input class="field" type="date" bind:value={form.effectiveDate} />
        </div>
        <div>
          <span class="label">温度下限 ℃</span>
          <input class="field" type="number" step="0.1" bind:value={form.tempMin} />
        </div>
        <div>
          <span class="label">温度上限 ℃</span>
          <input class="field" type="number" step="0.1" bind:value={form.tempMax} />
        </div>
        <div>
          <span class="label">湿度下限 %</span>
          <input class="field" type="number" step="1" bind:value={form.humidityMin} />
        </div>
        <div>
          <span class="label">湿度上限 %</span>
          <input class="field" type="number" step="1" bind:value={form.humidityMax} />
        </div>
      </div>
      <div class="mt-3">
        <span class="label">变更备注</span>
        <input class="field" type="text" placeholder="如：梅雨季收紧湿度上限" bind:value={form.note} />
      </div>
      <div class="mt-3 flex justify-end">
        <button type="button" class="btn-primary" disabled={saving} onclick={save}>
          {saving ? '重算中…' : '保存并全量重刷'}
        </button>
      </div>
    </div>
  {/if}

  <ul class="space-y-1.5 text-xs">
    {#each ordered as item (item.id)}
      <li class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-stone-50 px-3 py-2">
        <span class="font-semibold text-stone-700">{item.effectiveDate} 起生效</span>
        <span class="tabular-nums">
          温度 {item.tempMin}–{item.tempMax} ℃
        </span>
        <span class="tabular-nums">
          湿度 {item.humidityMin}–{item.humidityMax} %
        </span>
        {#if item.id === DEFAULT_THRESHOLD_ID}<span class="rounded bg-stone-200 px-1.5 py-0.5 text-[10px]">默认</span>{/if}
        {#if item.note}<span class="muted">{item.note}</span>{/if}
      </li>
    {/each}
  </ul>
</div>
