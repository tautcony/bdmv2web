/**
 * Run `task` over `items` with at most `limit` calls in flight and return the
 * results in input order. The first failure stops new work from starting and is
 * rethrown after the running tasks settle, so one broken item cannot leave
 * unhandled rejections behind.
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workers = Math.min(Math.max(1, limit), items.length);
  let next = 0;
  let failure: { error: unknown } | undefined;
  const run = async (): Promise<void> => {
    while (failure === undefined && next < items.length) {
      const index = next;
      next += 1;
      try { results[index] = await task(items[index]!, index); }
      catch (error) { failure = { error }; }
    }
  };
  await Promise.all(Array.from({ length: workers }, run));
  if (failure !== undefined) throw failure.error;
  return results;
}
