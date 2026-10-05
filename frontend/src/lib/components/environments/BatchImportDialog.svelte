<script lang="ts">
  /**
   * 记录仪批量导入弹窗：
   * - 两个标签页同时提交时只锁一份，另一页保留钢琴选择并提示冲突；
   * - 单日批量超过 200 条时前 200 条入库，余下排队，次日起分批放行。
   */
  import {
    importEnvironmentRecords
  } from '$lib/stores/environmentStore';
  import { parseEnvRecords } from '$lib/utils/envBatch';
  import { DAILY_BATCH_LIMIT } from '$lib/types/importQueue';
  import type { PianoRow } from '$lib/utils/db';

  let {
    open = $bindable(),
    pianos,
    defaultPianoId = ''
  }: {
    open: boolean;
    pianos: PianoRow[];
    defaultPianoId?: string;
  } = $props();

  let pianoId = $state('');
  let text = $state('');
  let formError = $state<string | null>(null);
  let conflict = $state<string | null>(null);
  let inactiveHint = $state<string | null>(null);
  let submitting = $state(false);
  let result = $state<{ accepted: number; queued: number; abnormal: number; earliest: string | null } | null>(null);

  // 每次打开时带出父组件当前选择（冲突 / 失败后该选择仍保留）
  let lastOpen = $state(false);
  $effect(() => {
    if (open && !lastOpen) {
      pianoId = defaultPianoId;
      conflict = null;
      inactiveHint = null;
    }
    lastOpen = open;
  });

  const previewCount = $derived(text.trim() ? parseEnvRecords(text).records.length : 0);

  function close(): void {
    open = false;
    result = null;
    formError = null;
    conflict = null;
    inactiveHint = null;
    text = '';
  }

  async function submit(): Promise<void> {
    formError = null;
    conflict = null;
    inactiveHint = null;
    result = null;

    if (!pianoId) {
      formError = '请选择钢琴（选择已保留，可改后重试）';
      return;
    }
    const parsed = parseEnvRecords(text);
    if (parsed.error) {
      formError = parsed.error;
      return;
    }
    if (parsed.records.length === 0) {
      formError = '没有可导入的记录';
      return;
    }

    submitting = true;
    try {
      const outcome = await importEnvironmentRecords(pianoId, parsed.records);
      if (outcome.ok) {
        result = {
          accepted: outcome.accepted,
          queued: outcome.queued,
          abnormal: outcome.abnormal,
          earliest: outcome.queueEarliestDate
        };
        if (outcome.queued === 0) {
          // 全部入库后短暂展示结果再关闭
          setTimeout(() => close(), 1200);
        }
        return;
      }
      // 失败时保留钢琴选择与已粘贴内容，方便直接重试
      if (outcome.reason === 'lock-conflict') {
        conflict = `提交冲突：${outcome.holder}，该标签页的提交未执行。钢琴选择已保留，请在那边完成后再试。`;
      } else if (outcome.reason === 'piano-inactive') {
        inactiveHint = '该钢琴已停用，批量记录未写入。请改选其他钢琴后重新提交。';
      } else if (outcome.reason === 'piano-missing') {
        formError = '所选钢琴不存在，请重新选择';
      }
    } catch (err) {
      formError = err instanceof Error ? err.message : '导入失败';
    } finally {
      submitting = false;
    }
  }
</script>

{#if open}
  <div class="modal-mask">
    <button
      type="button"
      class="absolute inset-0 cursor-default"
      aria-label="关闭弹窗"
      onclick={close}
    ></button>
    <div class="modal-panel relative" role="dialog" aria-modal="true">
      <h3 class="mb-1 text-base font-semibold">记录仪批量导入</h3>
      <p class="muted mb-4 text-xs">
        支持 JSON 数组或逐行「日期,温度,湿度」；每日最多入库 {DAILY_BATCH_LIMIT} 条，超额自动排队次日起分批处理（原始观测日期不变）。
      </p>

      {#if conflict}
        <div class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">⚠️ {conflict}</div>
      {/if}
      {#if inactiveHint}
        <div class="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{inactiveHint}</div>
      {/if}
      {#if formError}
        <div class="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div>
      {/if}
      {#if result}
        <div class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          本次入库 {result.accepted} 条（其中越界 {result.abnormal} 条），已联动重算调律提醒。
          {#if result.queued > 0}
            <div class="mt-1 font-semibold">
              超额 {result.queued} 条已排队，最早于 {result.earliest} 放行，余下按天顺延。
            </div>
          {/if}
        </div>
      {/if}

      <div class="mb-3">
        <span class="label">钢琴（冲突时选择保留）</span>
        <select class="field" bind:value={pianoId}>
          <option value="" disabled>请选择钢琴</option>
          {#each pianos as piano (piano.id)}
            <option value={piano.id}>
              {piano.brand} {piano.model}{piano.state === '停用' ? '（已停用）' : ''}
            </option>
          {/each}
        </select>
      </div>

      <div class="mb-2">
        <span class="label">记录内容（共 {previewCount} 条）</span>
        <textarea
          class="field h-48 font-mono text-xs"
          bind:value={text}
          placeholder={'JSON：\n[{"date":"2026-10-05","tempC":22.4,"humidityPct":55}]\n\n或逐行：\n2026-10-05,22.4,55\n2026-10-06,21.8,52'}
        ></textarea>
      </div>

      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="btn" onclick={close}>关闭</button>
        <button type="button" class="btn-primary" disabled={submitting || (result?.queued ?? 0) > 0} onclick={submit}>
          {submitting ? '提交中…' : '提交批量导入'}
        </button>
      </div>
    </div>
  </div>
{/if}
