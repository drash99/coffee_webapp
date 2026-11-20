import { LocalDataError } from './localDataValidation';

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (cause) {
    throw new LocalDataError('STORAGE_READ_FAILED', key, cause);
  }
}

/** Synchronous exception atomicity, not a cross-tab lock or crash-recovery journal. */
export function writeStorageAtomically(changes: Record<string, string | null>): void {
  const entries = Object.entries(changes).map(([key, next]) => ({ key, next, previous: readStorage(key) }))
    .filter(({ next, previous }) => next !== previous);
  const applied: typeof entries = [];
  function write(key: string, value: string | null) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
  try {
    for (const entry of entries) {
      write(entry.key, entry.next);
      applied.push(entry);
    }
  } catch (cause) {
    // Reclaim growth before restoring values that shrank, so rollback also fits the old quota.
    const rollback = applied.reverse().sort((a, b) =>
      Number((b.next?.length ?? 0) >= (b.previous?.length ?? 0)) -
      Number((a.next?.length ?? 0) >= (a.previous?.length ?? 0)),
    );
    const failures: unknown[] = [];
    for (const entry of rollback) {
      try {
        write(entry.key, entry.previous);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new LocalDataError('STORAGE_ROLLBACK_FAILED', undefined, { cause, failures });
    throw new LocalDataError('STORAGE_WRITE_FAILED', undefined, cause);
  }
}
