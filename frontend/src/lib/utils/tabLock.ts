/**
 * 跨标签页提交锁：两个标签页同时提交批量导入时，只允许一份获得锁执行，
 * 另一份立即得到冲突结果（不排队等待），由页面保留已选钢琴并提示冲突。
 *
 * 优先使用 Web Locks API（同源跨标签页互斥，标签页崩溃自动释放）；
 * 不支持时退回 localStorage 心跳锁（带过期时间，避免死锁）。
 */

export interface LockConflict {
  /** 持有锁的来源说明 */
  holder: string;
}

export type TryLockResult = { acquired: true; release: () => void } | { acquired: false; conflict: LockConflict };

const FALLBACK_TTL_MS = 15_000;
/** 锁名（同源应用内唯一） */
export const ENV_IMPORT_LOCK = 'gbpianotune-env-import';

interface HeldLock {
  resolve: () => void;
}

/** 各锁名当前持有的挂起点（同一标签页同一时间只做一次批量提交） */
const heldLocks = new Map<string, HeldLock>();

function fallbackTry(key: string): TryLockResult {
  const storeKey = `lock:${key}`;
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const raw = window.localStorage.getItem(storeKey);
  if (raw) {
    try {
      const payload = JSON.parse(raw) as { holder: string; at: number };
      if (Date.now() - payload.at < FALLBACK_TTL_MS) {
        return { acquired: false, conflict: { holder: payload.holder } };
      }
    } catch {
      // 锁记录损坏，视为过期并抢占
    }
  }
  window.localStorage.setItem(storeKey, JSON.stringify({ holder: tag, at: Date.now() }));

  const onUnload = (): void => {
    const current = window.localStorage.getItem(storeKey);
    if (!current) return;
    try {
      const payload = JSON.parse(current) as { holder: string };
      if (payload.holder === tag) window.localStorage.removeItem(storeKey);
    } catch {
      window.localStorage.removeItem(storeKey);
    }
  };
  window.addEventListener('beforeunload', onUnload, { once: true });

  return {
    acquired: true,
    release: () => {
      window.removeEventListener('beforeunload', onUnload);
      onUnload();
    }
  };
}

/**
 * 非阻塞尝试获取跨标签页锁：拿不到时立即返回冲突信息，不进入等待队列。
 * 必须在 finally 中调用 release()。
 */
export async function tryTabLockAsync(key: string): Promise<TryLockResult> {
  if (typeof navigator === 'undefined' || typeof navigator.locks?.request !== 'function') {
    return fallbackTry(key);
  }

  let granted = false;
  await navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
    granted = lock !== null;
    if (lock) {
      // 占住锁直到外部 release：挂起一个 promise，release 时再 resolve
      await new Promise<void>((resolve) => {
        heldLocks.set(key, { resolve });
      });
    }
  });

  if (!granted) {
    return { acquired: false, conflict: { holder: '另一个标签页正在提交' } };
  }

  return {
    acquired: true,
    release: () => {
      const held = heldLocks.get(key);
      if (held) {
        heldLocks.delete(key);
        held.resolve();
      }
    }
  };
}
