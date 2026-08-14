/** Shared API result shapes used by more than one feature. */

/** Per-id outcome: deleting fifty and hearing "one failed" helps nobody. */
export type BulkDeleteResult = {
  deleted: string[];
  refused: { id: string; reason: string }[];
};

/** Offset pagination envelope returned by list endpoints. */
export type PageResult<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};
