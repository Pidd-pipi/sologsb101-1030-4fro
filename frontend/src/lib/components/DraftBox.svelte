<script lang="ts">
  /** 草稿箱：展示未写入的批量导入记录，可丢弃或立即刷新到期草稿 */
  import { useIdbTable } from '$lib/hooks/useIdbTable';
  import { db, type BatchDraftRow } from '$lib/utils/db';
  import { discardDraft } from '$lib/stores/batchDraftStore';
  import { flushDueDrafts } from '$lib/utils/batchImport';
  import { DRAFT_REASON_LABELS, DRAFT_STATUS_LABELS } from '$lib/types/batchDraft';

  const drafts = useIdbTable<BatchDraftRow>(db.batchDrafts, (a, b) => b.updatedAt - a.updatedAt);

  let notice = $state<string | null>(null);
  let flushing = $state(false);

  const pending = $derived($drafts.filter((d) => d.status === 'pending'));

  async function discard(id: string): Promise<void> {
    await discardDraft(id);
  }

  async function flush(): Promise<void> {
    flushing = true;
    notice = null;
    try {
      const res = await flushDueDrafts();
      if (res.conflict) {
        notice = '另一标签页正在提交，请稍后再试';
        return;
      }
      notice = `已处理 ${res.processedDrafts} 批、写入 ${res.written} 条` + (res.requeued ? `，${res.requeued} 条顺延次日` : '');
    } catch {
      notice = '刷新失败，请稍后再试';
    } finally {
      flushing = false;
    }
  }
</script>

<div class="card">
  <div class="card-title mb-3">
    <span>草稿箱</span>
    <span class="muted">{pending.length} 批待处理</span>
  </div>
  {#if notice}
    <div class="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div>
  {/if}
  {#if pending.length === 0}
    <p class="muted">暂无待处理草稿。引用停用钢琴或超出每日额度的记录会留在这里，下次继续。</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="border-b border-stone-200 text-left text-xs text-stone-500">
          <tr>
            <th class="py-2">批次</th>
            <th class="py-2">原因</th>
            <th class="py-2">计划日期</th>
            <th class="py-2">条数</th>
            <th class="py-2">状态</th>
            <th class="py-2">说明</th>
            <th class="py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {#each pending as draft (draft.id)}
            <tr class="border-b border-stone-100">
              <td class="py-2 font-mono text-xs">{draft.batchId.slice(0, 16)}</td>
              <td class="py-2">
                <span class="rounded-full px-2 py-0.5 text-xs bg-amber-100 text-amber-700">
                  {DRAFT_REASON_LABELS[draft.reason]}
                </span>
              </td>
              <td class="py-2">{draft.plannedDate}</td>
              <td class="py-2 tabular-nums">{draft.records.length}</td>
              <td class="py-2 muted">{DRAFT_STATUS_LABELS[draft.status]}</td>
              <td class="py-2 muted">{draft.note ?? '—'}</td>
              <td class="py-2">
                <button type="button" class="btn-danger" onclick={() => discard(draft.id)}>丢弃</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  <div class="mt-3 flex justify-end">
    <button type="button" class="btn-primary" onclick={flush} disabled={flushing || pending.length === 0}>
      {flushing ? '处理中…' : '立即刷新到期草稿'}
    </button>
  </div>
</div>
