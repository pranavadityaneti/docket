/** Shared offset pagination for list endpoints. */

export type PageOpts = { limit?: number; offset?: number };

export type PageResult<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

/** Default 50, clamp 1–200. */
export function clampPage(opts: PageOpts = {}): { limit: number; offset: number } {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  return { limit, offset };
}

export function parsePageQuery(
  limitRaw?: string,
  offsetRaw?: string,
): PageOpts {
  const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
  const offset = offsetRaw !== undefined ? Number(offsetRaw) : undefined;
  return {
    limit: Number.isFinite(limit) ? limit : undefined,
    offset: Number.isFinite(offset) ? offset : undefined,
  };
}

/** Slice an in-memory list into a PageResult (conversations / follow-ups). */
export function paginateArray<T>(items: T[], opts: PageOpts = {}): PageResult<T> {
  const { limit, offset } = clampPage(opts);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}
