<script lang="ts">
  /** /environments 琴房温湿度记录：按当天生效阈值判定越界，批量限额排队，联动调律提醒 */
  import { onMount } from 'svelte';
  import { push, router } from '$lib/router';
  import FilterBar from '$lib/components/common/FilterBar.svelte';
  import StatBadge from '$lib/components/common/StatBadge.svelte';
  import EmptyPanel from '$lib/components/common/EmptyPanel.svelte';
  import ThresholdPanel from '$lib/components/environments/ThresholdPanel.svelte';
  import BatchImportDialog from '$lib/components/environments/BatchImportDialog.svelte';
  import ImportQueuePanel from '$lib/components/environments/ImportQueuePanel.svelte';
  import { useIdbTable } from '$lib/hooks/useIdbTable';
  import { db, type EnvironmentRow, type EnvQueueRow, type PianoRow, type ThresholdRow } from '$lib/utils/db';
  import {
    abnormalHint,
    createEmptyEnvironment,
    ENV_DEVICES,
    isAbnormal,
    type EnvRanges,
    type Environment
  } from '$lib/types/environment';
  import { DEFAULT_RANGES } from '$lib/types/environment';
  import { effectiveThreshold, rangesOf } from '$lib/types/threshold';
  import {
    createEnvironment,
    deleteEnvironment,
    editEnvironment,
    ENVIRONMENT_FILTER_KEYS,
    environmentFilters,
    resetEnvironmentFilters,
    setEnvironmentFilters,
    releaseDueQueue
  } from '$lib/stores/environmentStore';
  import { clearEnvironmentDraft, loadEnvironmentDraft, saveEnvironmentDraft, type EnvironmentDraft } from '$lib/utils/envDraft';
  import type { FilterModel } from '$lib/types/filter';
  import { queryToFilters, toQueryString } from '$lib/utils/query';

  const pianos = useIdbTable<PianoRow>(db.pianos, (a, b) => a.brand.localeCompare(b.brand, 'zh-Hans-CN'));
  const environments = useIdbTable<EnvironmentRow>(db.environments, (a, b) => b.date.localeCompare(a.date));
  const thresholds = useIdbTable<ThresholdRow>(db.thresholds, (a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const queue = useIdbTable<EnvQueueRow>(db.envQueue, (a, b) => a.scheduledFor.localeCompare(b.scheduledFor));

  let dialogOpen = $state(false);
  let editingId = $state<string | null>(null);
  let form = $state<Omit<Environment, 'id'>>(createEmptyEnvironment());
  let formError = $state<string | null>(null);
  let draftNotice = $state<EnvironmentDraft | null>(null);
  let batchOpen = $state(false);
  let thresholdExpanded = $state(false);
  let queueMessage = $state<string | null>(null);

  function asArray(value: string | string[] | boolean | undefined): string[] {
    return Array.isArray(value) ? value : [];
  }

  function pianoById(pianoId: string): PianoRow | undefined {
    return $pianos.find((item) => item.id === pianoId);
  }

  function pianoLabel(pianoId: string): string {
    const piano = pianoById(pianoId);
    if (!piano) return '钢琴已删除';
    return `${piano.brand} ${piano.model}${piano.state === '停用' ? '（已停用）' : ''}`;
  }

  /** 某日期当天生效的阈值区间 */
  function rangesAt(date: string): EnvRanges {
    const current = effectiveThreshold($thresholds, date);
    return current ? rangesOf(current) : DEFAULT_RANGES;
  }

  /** 今天生效的阈值（页头说明用） */
  const currentThreshold = $derived(effectiveThreshold($thresholds, new Date().toISOString().slice(0, 10)));
  const currentRanges = $derived<EnvRanges>(currentThreshold ? rangesOf(currentThreshold) : DEFAULT_RANGES);

  const filtered = $derived(
    $environments.filter((row) => {
      const keyword = String($environmentFilters.keyword ?? '').trim().toLowerCase();
      const pianoIds = asArray($environmentFilters.pianoIds);
      const label = `${pianoLabel(row.pianoId)} ${row.device} ${row.date}`.toLowerCase();
      if (keyword && !label.includes(keyword)) return false;
      if (pianoIds.length > 0 && !pianoIds.includes(row.pianoId)) return false;
      if ($environmentFilters.switch && !row.abnormal) return false;
      return true;
    })
  );

  const totals = $derived.by(() => {
    const abnormal = $environments.filter((item) => item.abnormal).length;
    const avgTemp =
      $environments.length > 0
        ? $environments.reduce((sum, item) => sum + item.tempC, 0) / $environments.length
        : 0;
    const avgHumidity =
      $environments.length > 0
        ? $environments.reduce((sum, item) => sum + item.humidityPct, 0) / $environments.length
        : 0;
    return {
      total: $environments.length,
      abnormal,
      abnormalRatio: $environments.length > 0 ? Math.round((abnormal / $environments.length) * 100) : 0,
      avgTemp: Number(avgTemp.toFixed(1)),
      avgHumidity: Number(avgHumidity.toFixed(1)),
      pianoCovered: new Set($environments.map((item) => item.pianoId)).size
    };
  });

  const pendingQueueCount = $derived($queue.filter((item) => item.status === '待处理').length);

  function applyDraftToForm(draft: EnvironmentDraft): void {
    form = {
      pianoId: draft.pianoId,
      date: draft.date,
      tempC: draft.tempC,
      humidityPct: draft.humidityPct,
      device: draft.device,
      abnormal: draft.abnormal,
      thresholdVersion: draft.thresholdVersion,
      batchId: draft.batchId
    };
  }

  function openCreate(): void {
    editingId = null;
    formError = null;
    const draft = loadEnvironmentDraft();
    if (draft) {
      draftNotice = draft;
      applyDraftToForm(draft);
    } else {
      draftNotice = null;
      form = createEmptyEnvironment();
      const firstActive = $pianos.find((piano) => piano.state !== '停用');
      form.pianoId = firstActive?.id ?? $pianos[0]?.id ?? '';
      form.abnormal = isAbnormal(form.tempC, form.humidityPct, rangesAt(form.date));
    }
    dialogOpen = true;
  }

  function openEdit(row: EnvironmentRow): void {
    editingId = row.id;
    draftNotice = null;
    form = {
      pianoId: row.pianoId,
      date: row.date,
      tempC: row.tempC,
      humidityPct: row.humidityPct,
      device: row.device,
      abnormal: row.abnormal,
      thresholdVersion: row.thresholdVersion,
      batchId: row.batchId
    };
    formError = null;
    dialogOpen = true;
  }

  function discardDraft(): void {
    clearEnvironmentDraft();
    draftNotice = null;
    form = createEmptyEnvironment();
    const firstActive = $pianos.find((piano) => piano.state !== '停用');
    form.pianoId = firstActive?.id ?? '';
  }

  /** 录入即时按当天生效阈值判定是否越界 */
  function recalc(): void {
    form.abnormal = isAbnormal(form.tempC, form.humidityPct, rangesAt(form.date));
  }

  async function submit(): Promise<void> {
    if (!form.pianoId) {
      formError = '请选择钢琴';
      return;
    }
    if (form.tempC < -10 || form.tempC > 45 || form.humidityPct < 0 || form.humidityPct > 100) {
      formError = '温度应在 -10 ~ 45 ℃，湿度应在 0 ~ 100 %';
      return;
    }
    recalc();
    const payload = { ...form };

    if (editingId) {
      const outcome = await editEnvironment(editingId, payload);
      if (outcome.ok) {
        dialogOpen = false;
      } else if (outcome.reason === 'piano-inactive') {
        formError = '该钢琴已停用，修改未写入';
      } else if (outcome.reason === 'piano-missing') {
        formError = '所选钢琴不存在，请重新选择';
      } else {
        formError = '记录不存在或已被删除';
      }
      return;
    }

    const outcome = await createEnvironment(payload);
    if (outcome.ok) {
      clearEnvironmentDraft();
      draftNotice = null;
      dialogOpen = false;
      return;
    }
    if (outcome.reason === 'piano-inactive') {
      // 引用钢琴停用：不写入，草稿留着下次继续（弹窗保留全部输入）
      saveEnvironmentDraft(payload);
      draftNotice = loadEnvironmentDraft();
      formError = '该钢琴已停用，本条记录未写入；草稿已保留，下次可继续编辑。';
    } else if (outcome.reason === 'piano-missing') {
      formError = '所选钢琴不存在，请重新选择';
    }
  }

  async function remove(row: EnvironmentRow): Promise<void> {
    if (!window.confirm(`删除 ${row.date} 的环境记录？删除后该琴的调律提醒会同步重算。`)) return;
    await deleteEnvironment(row.id);
  }

  function applyFilters(next: FilterModel): void {
    setEnvironmentFilters(next);
    void push(`/environments${toQueryString(next)}`);
  }

  onMount(() => {
    const query: Record<string, string> = {};
    new URLSearchParams(router.querystring ?? '').forEach((value, key) => {
      query[key] = value;
    });
    setEnvironmentFilters(queryToFilters(query, ENVIRONMENT_FILTER_KEYS));
    // 启动时放行今天到期的排队条目（受当日 200 条上限约束）
    void releaseDueQueue().then((outcome) => {
      if (outcome.processed > 0) {
        queueMessage = `启动时自动从队列放行 ${outcome.processed} 条记录，队列剩余 ${outcome.remaining} 条。`;
      }
    });
  });
</script>

<div class="page space-y-4">
  <div class="page-head">
    <div>
      <h2 class="page-title">琴房温湿度记录</h2>
      <p class="page-subtitle">
        今日生效阈值（{currentThreshold ? currentThreshold.effectiveDate : '默认'}）：温度
        {currentRanges.temp[0]}–{currentRanges.temp[1]} ℃、湿度 {currentRanges.humidity[0]}–{currentRanges.humidity[1]}
        %；越界记录会联动重算该琴调律提醒。
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn" onclick={() => (batchOpen = true)} disabled={$pianos.length === 0}>
        记录仪批量导入{#if pendingQueueCount > 0}（排队 {pendingQueueCount}）{/if}
      </button>
      <button type="button" class="btn-primary" onclick={openCreate} disabled={$pianos.length === 0}>+ 新增环境记录</button>
    </div>
  </div>

  {#if queueMessage}
    <div class="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{queueMessage}</div>
  {/if}

  <div class="badge-row">
    <StatBadge label="环境记录" value={totals.total} suffix="条" tone="walnut" icon="🌡️" />
    <StatBadge label="越界天数" value={totals.abnormal} suffix="天" tone="rose" icon="!" />
    <StatBadge label="越界占比" value={totals.abnormalRatio} percent={totals.abnormalRatio} showPercent tone="amber" icon="%" />
    <StatBadge label="平均温度" value={totals.avgTemp} suffix="℃" tone="brass" icon="≈" />
    <StatBadge label="平均湿度" value={totals.avgHumidity} suffix="%" tone="slate" icon="💧" />
    <StatBadge label="覆盖钢琴" value={totals.pianoCovered} suffix="台" tone="green" icon="🎹" />
  </div>

  <ThresholdPanel bind:thresholds={$thresholds} bind:expanded={thresholdExpanded} />

  <ImportQueuePanel queue={$queue} pianos={$pianos} />

  <FilterBar
    filters={$environmentFilters}
    selects={[
      {
        key: 'pianoIds',
        label: '钢琴',
        options: $pianos.map((item) => ({ label: `${item.brand} ${item.model}`, value: item.id }))
      }
    ]}
    keywordPlaceholder="搜索钢琴 / 监测方式 / 日期…"
    switchLabel="仅看越界记录"
    onchange={applyFilters}
    onreset={() => {
      resetEnvironmentFilters();
      void push('/environments');
    }}
  />

  {#if filtered.length === 0}
    <EmptyPanel
      title="暂无环境记录"
      description="按日期录入琴房温度与相对湿度，系统按当天生效阈值判定，越界记录自动高亮并联动调律提醒。"
      showCreate={$pianos.length > 0}
      createText="新增环境记录"
      oncreate={openCreate}
    />
  {:else}
    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="border-b border-stone-200 text-left text-xs text-stone-500">
          <tr>
            <th class="py-2">钢琴</th>
            <th class="py-2">日期</th>
            <th class="py-2">温度 ℃</th>
            <th class="py-2">湿度 %</th>
            <th class="py-2">监测方式</th>
            <th class="py-2">判定</th>
            <th class="py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as row (row.id)}
            {@const ranges = rangesAt(row.date)}
            {@const tempOutOf = row.tempC < ranges.temp[0] || row.tempC > ranges.temp[1]}
            {@const humOutOf = row.humidityPct < ranges.humidity[0] || row.humidityPct > ranges.humidity[1]}
            <tr class="border-b border-stone-100 {row.abnormal ? 'bg-rose-50/70' : ''}">
              <td class="py-2">{pianoLabel(row.pianoId)}</td>
              <td class="py-2">{row.date}</td>
              <td class="py-2 tabular-nums {row.abnormal && tempOutOf ? 'font-semibold text-rose-700' : ''}">
                {row.tempC}
              </td>
              <td class="py-2 tabular-nums {row.abnormal && humOutOf ? 'font-semibold text-rose-700' : ''}">
                {row.humidityPct}
              </td>
              <td class="py-2">
                {row.device}
                {#if row.batchId}<span class="muted ml-1 text-[10px]">批量</span>{/if}
              </td>
              <td class="py-2">
                <span
                  class="rounded-full px-2 py-0.5 text-xs {row.abnormal
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-emerald-100 text-emerald-700'}">{row.abnormal ? '越界' : '正常'}</span
                >
                <div class="muted mt-0.5">{abnormalHint(row.tempC, row.humidityPct, ranges)}</div>
              </td>
              <td class="py-2">
                <button type="button" class="btn mr-2" onclick={() => openEdit(row)}>编辑</button>
                <button type="button" class="btn-danger" onclick={() => remove(row)}>删除</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if dialogOpen}
  <div class="modal-mask">
    <button
      type="button"
      class="absolute inset-0 cursor-default"
      aria-label="关闭弹窗"
      onclick={() => (dialogOpen = false)}
    ></button>
    <div class="modal-panel relative" role="dialog" aria-modal="true">
      <h3 class="mb-4 text-base font-semibold">{editingId ? '编辑环境记录' : '新增环境记录'}</h3>
      {#if draftNotice && !editingId}
        <div class="mb-3 flex items-start justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span>已恢复上次草稿（{draftNotice.savedAt.slice(0, 16).replace('T', ' ')} 因钢琴停用未写入），可继续编辑或改选钢琴。</span>
          <button type="button" class="shrink-0 underline" onclick={discardDraft}>放弃草稿</button>
        </div>
      {/if}
      {#if formError}
        <div class="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div>
      {/if}
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <span class="label">钢琴</span>
          <select class="field" bind:value={form.pianoId}>
            {#each $pianos as piano (piano.id)}
              <option value={piano.id}>
                {piano.brand} {piano.model}{piano.state === '停用' ? '（已停用，提交将被拒绝并存草稿）' : ''}
              </option>
            {/each}
          </select>
        </div>
        <div>
          <span class="label">日期</span>
          <input class="field" type="date" bind:value={form.date} onchange={recalc} />
        </div>
        <div>
          <span class="label">温度 ℃</span>
          <input class="field" type="number" step="0.1" bind:value={form.tempC} oninput={recalc} />
        </div>
        <div>
          <span class="label">相对湿度 %</span>
          <input class="field" type="number" step="1" bind:value={form.humidityPct} oninput={recalc} />
        </div>
        <div>
          <span class="label">监测方式</span>
          <select class="field" bind:value={form.device}>
            {#each ENV_DEVICES as item (item)}
              <option value={item}>{item}</option>
            {/each}
          </select>
        </div>
      </div>
      <div class="mt-4 rounded-lg px-3 py-2 text-xs {form.abnormal ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}">
        当天生效区间 {rangesAt(form.date).temp[0]}–{rangesAt(form.date).temp[1]} ℃ /
        {rangesAt(form.date).humidity[0]}–{rangesAt(form.date).humidity[1]} %：{form.abnormal ? '越界' : '处于区间内'} ·
        {abnormalHint(form.tempC, form.humidityPct, rangesAt(form.date))}
      </div>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="btn" onclick={() => (dialogOpen = false)}>取消</button>
        <button type="button" class="btn-primary" onclick={submit}>保存</button>
      </div>
    </div>
  </div>
{/if}

<BatchImportDialog bind:open={batchOpen} pianos={$pianos} />
