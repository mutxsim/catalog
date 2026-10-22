/**
 * Supabase returns at most 1,000 rows per request. These helpers page through
 * larger tables and keep `.in()` filters short enough to fit in a URL.
 */

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Fetch every row by requesting consecutive ranges of `size` rows. */
export async function fetchAll<T>(query: (from: number, to: number) => Page<T>, size = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await query(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

/** Run `query` for chunks of ids (default 100 per request) and merge the rows. */
export async function inChunks<T>(ids: string[], query: (chunk: string[]) => Page<T>, size = 100): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const { data, error } = await query(ids.slice(i, i + size));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}
