/**
 * 跨标签页互斥锁。
 * 两标签页同时提交批量导入时，只允许其中一个拿到锁；
 * 另一个标签页立即拿到 null（不等待），由调用方提示冲突并保留选择。
 * 优先使用浏览器 Web Locks API，不支持时退回进程内互斥（同标签页仍安全）。
 */

const LOCK_NAME = 'gbpianotune:batch-import';

type NavigatorWithLocks = Navigator & { locks?: LockManager };

/** 进程内互斥兜底（Web Locks 不可用时） */
let inMemoryLocked = false;

export interface BatchLockResult<T> {
  /** 是否成功拿到锁 */
  acquired: boolean;
  /** 拿到锁时执行工作的返回值 */
  result?: T;
}

/**
 * 在批量导入锁保护下执行工作。
 * 拿到锁时 acquired=true 并返回 work 的结果；
 * 锁被其他标签页占用时 acquired=false（不等待），调用方应提示冲突并保留选择。
 */
export async function withBatchLock<T>(work: () => Promise<T>): Promise<BatchLockResult<T>> {
  if (typeof navigator === 'undefined') {
    return runInMemory(work);
  }
  const locks = (navigator as NavigatorWithLocks).locks;
  if (!locks) {
    return runInMemory(work);
  }
  const outcome = await locks.request(
    LOCK_NAME,
    { ifAvailable: true },
    async (lock): Promise<BatchLockResult<T>> => {
      if (!lock) {
        return { acquired: false };
      }
      const result = await work();
      return { acquired: true, result };
    }
  );
  return outcome;
}

async function runInMemory<T>(work: () => Promise<T>): Promise<BatchLockResult<T>> {
  if (inMemoryLocked) {
    return { acquired: false };
  }
  inMemoryLocked = true;
  try {
    const result = await work();
    return { acquired: true, result };
  } finally {
    inMemoryLocked = false;
  }
}
