<script lang="ts">
  /** 阈值管理：按生效日期维护温湿度阈值版本，变更后重算越界标记与提醒 */
  import { useIdbTable } from '$lib/hooks/useIdbTable';
  import { db, type ThresholdRow } from '$lib/utils/db';
  import { createThreshold, deleteThreshold } from '$lib/stores/thresholdStore';
  import { createEmptyThreshold, validateThreshold, type Threshold } from '$lib/types/threshold';

  const thresholds = useIdbTable<ThresholdRow>(db.thresholds, (a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));

  let form = $state<Omit<Threshold, 'id'>>(createEmptyThreshold());
  let formError = $state<string | null>(null);
  let notice = $state<string | null>(null);

  async function add(): Promise<void> {
    formError = null;
    const err = validateThreshold(form);
    if (err) {
      formError = err;
      return;
    }
    const res = await createThreshold({ ...form });
    notice = `已生效，刷新越界标记 ${res.abnormalRefreshed} 条、提醒 ${res.remindersRefreshed} 条`;
    form = createEmptyThreshold();
  }

  async function remove(row: ThresholdRow): Promise<void> {
    if (!window.confirm(`删除 ${row.effectiveFrom} 起生效的阈值？将重算全部记录。`)) return;
    const res = await deleteThreshold(row.id);
    notice = `已删除，刷新越界标记 ${res.abnormalRefreshed} 条、提醒 ${res.remindersRefreshed} 条`;
  }
</script>

<div class="card">
  <div class="card-title mb-3">
    <span>温湿度阈值（按生效日期）</span>
    <span class="muted">变更后旧标记失效并重算</span>
  </div>

  <div class="mb-3 grid gap-2 md:grid-cols-6">
    <div>
      <span class="label">生效日期</span>
      <input class="field" type="date" bind:value={form.effectiveFrom} />
    </div>
    <div>
      <span class="label">温度下限 ℃</span>
      <input class="field" type="number" step="0.5" bind:value={form.tempMin} />
    </div>
    <div>
      <span class="label">温度上限 ℃</span>
      <input class="field" type="number" step="0.5" bind:value={form.tempMax} />
    </div>
    <div>
      <span class="label">湿度下限 %</span>
      <input class="field" type="number" step="1" bind:value={form.humidityMin} />
    </div>
    <div>
      <span class="label">湿度上限 %</span>
      <input class="field" type="number" step="1" bind:value={form.humidityMax} />
    </div>
    <div class="flex items-end">
      <button type="button" class="btn-primary w-full" onclick={add}>新增阈值</button>
    </div>
  </div>
  {#if formError}
    <div class="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div>
  {/if}
  {#if notice}
    <div class="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div>
  {/if}

  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="border-b border-stone-200 text-left text-xs text-stone-500">
        <tr>
          <th class="py-2">生效日期</th>
          <th class="py-2">温度 ℃</th>
          <th class="py-2">湿度 %</th>
          <th class="py-2">备注</th>
          <th class="py-2">操作</th>
        </tr>
      </thead>
      <tbody>
        {#each $thresholds as row (row.id)}
          <tr class="border-b border-stone-100">
            <td class="py-2">{row.effectiveFrom}</td>
            <td class="py-2 tabular-nums">{row.tempMin} ~ {row.tempMax}</td>
            <td class="py-2 tabular-nums">{row.humidityMin} ~ {row.humidityMax}</td>
            <td class="py-2 muted">{row.note ?? '—'}</td>
            <td class="py-2">
              <button type="button" class="btn-danger" onclick={() => remove(row)}>删除</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
