const pathLocks = new Map<string, Promise<unknown>>();

export async function withPathLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const previous = pathLocks.get(lockKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => current);
  pathLocks.set(lockKey, chain);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (pathLocks.get(lockKey) === chain) pathLocks.delete(lockKey);
  }
}
