<script lang="ts">
  /** 导入队列面板：超额的记录仪记录排队于此，次日起每日最多放行 200 条 */
  import { releaseDueQueue } from '$lib/stores/environmentStore';
  import { DAILY_BATCH_LIMIT } from '$lib/types/importQueue';
  import type { EnvQueueRow, PianoRow } from '$lib/utils/db';

  let {
    queue,
    pianos,
    onprocessed
  }: {
    queue: EnvQueueRow[];
    pianos: PianoRow[];
    onprocessed?: () => void;
  } = $props();

  let processing = $state(false);
  let message = $state<string | null>(null);

  const pending = $derived(queue.filter((item) => item.status === '待处理'));
  const earliest = $derived(
    pending.length > 0 ? pending.map((item) => item.scheduledFor).sort()[0] : null
  );

  function pianoLabel(pianoId: string): string {
    const piano = pianos.find((item) => item.id === pianoId);
    return piano ? `${piano.brand} ${piano.model}` : '钢琴已删除';
  }

  async function releaseNow(): Promise<void> {
    processing = true;
    message = null;
    try {
      const outcome = await releaseDueQueue();
      message =
        `本次放行 ${outcome.processed} 条，顺延 ${outcome.rescheduled} 条，` +
        `队列剩余 ${outcome.remaining} 条（每日上限 ${DAILY_BATCH_LIMIT} 条）。`;
      onprocessed?.();
    } finally {
      processing = false;
    }
  }
</script>

{#if pending.length > 0 || message}
  <div class="card border-amber-200">
    <div class="card-title mb-2 flex items-center justify-between">
      <span>排队等待分批导入（{pending.length} 条）</span>
      <button type="button" class="btn" disabled={processing} onclick={releaseNow}>
        {processing ? '处理中…' : '立即处理今日到期'}
      </button>
    </div>
    <p class="muted mb-3 text-xs">
      每日批量入库上限 {DAILY_BATCH_LIMIT} 条；超出的请求已拒绝写入并排队，保留原始观测日期，最早 {earliest ?? '—'} 起放行。
    </p>
    {#if message}
      <div class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</div>
    {/if}
    <div class="max-h-56 overflow-auto">
      <table class="w-full text-xs">
        <thead class="sticky top-0 bg-white text-left text-stone-500">
          <tr>
            <th class="py-1.5">计划处理</th>
            <th class="py-1.5">钢琴</th>
            <th class="py-1.5">观测日期</th>
            <th class="py-1.5">温度</th>
            <th class="py-1.5">湿度</th>
            <th class="py-1.5">状态 / 备注</th>
          </tr>
        </thead>
        <tbody>
          {#each pending.slice(0, 50) as item (item.id)}
            <tr class="border-t border-stone-100">
              <td class="py-1.5 tabular-nums">{item.scheduledFor}</td>
              <td class="py-1.5">{pianoLabel(item.pianoId)}</td>
              <td class="py-1.5 tabular-nums">{item.date}</td>
              <td class="py-1.5 tabular-nums">{item.tempC}</td>
              <td class="py-1.5 tabular-nums">{item.humidityPct}</td>
              <td class="py-1.5">
                <span class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">{item.status}</span>
                {#if item.error}<span class="muted ml-1">{item.error}</span>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if pending.length > 50}
        <div class="muted mt-2 text-xs">仅显示前 50 条，共 {pending.length} 条排队中。</div>
      {/if}
    </div>
  </div>
{/if}
