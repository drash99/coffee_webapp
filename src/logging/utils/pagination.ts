type RangeQuery = {
  range(from: number, to: number): PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>;
};

/** Query factories must apply a stable order ending in a unique column. */
export async function fetchAllRows<T>(queryFactory: () => RangeQuery, pageSize = 500): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError('pageSize must be a positive safe integer');
  }

  const rows: T[] = [];
  for (;;) {
    const { data, error } = await queryFactory().range(rows.length, rows.length + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) return rows;
    // A server cap can return fewer rows than requested without reaching the end.
    rows.push(...data as T[]);
  }
}
