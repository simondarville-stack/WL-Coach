/**
 * queryPaging — helpers for reads that can exceed PostgREST's per-request
 * row cap (1000 rows on Supabase defaults) or whose `.in()` id lists would
 * blow past URL-length limits.
 *
 * fetchAllRows pages a single query with .range() until a short page
 * arrives. fetchByIds additionally chunks a long id list and fetches the
 * chunks in parallel, paging each chunk.
 *
 * Callers MUST give the query a stable total order (order by a unique
 * column, or add a unique tiebreaker) — otherwise pages can overlap or
 * skip rows. Errors follow the codebase's read convention (treat as an
 * empty result) rather than throwing: a failed page ends the read with
 * what was collected so far.
 */

interface PageResult<T> {
  data: T[] | null;
  error: unknown;
}

const PAGE_SIZE = 1000;
const ID_CHUNK_SIZE = 150;

export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error || !data) return rows;
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

export async function fetchByIds<T>(
  ids: string[],
  build: (idChunk: string[], from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + ID_CHUNK_SIZE));
  }
  const results = await Promise.all(
    chunks.map(chunk => fetchAllRows<T>((from, to) => build(chunk, from, to))),
  );
  return results.flat();
}
