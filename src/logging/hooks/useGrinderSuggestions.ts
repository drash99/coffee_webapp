import { useEffect, useState } from 'react';
import { isSupabaseConfigured, getSupabaseClient } from '../../config/supabase';

export interface GrinderSuggestion {
  maker: string;
  model: string;
}

/**
 * Fetches all distinct grinder maker/model pairs for the given user on mount.
 * Returns { makers, modelsForMaker, allGrinders, loading }.
 *   - makers: unique maker names (sorted)
 *   - modelsForMaker(maker): models that belong to the given maker (case-insensitive match)
 *   - allGrinders: raw list for custom filtering
 */
export function useGrinderSuggestions(userUid: string | undefined) {
  const [grinders, setGrinders] = useState<GrinderSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userUid || !isSupabaseConfigured()) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
          .from('grinders')
          .select('maker, model')
          .eq('user_uid', userUid)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('[useGrinderSuggestions]', error.message);
          return;
        }
        if (cancelled) return;

        // Deduplicate (case-insensitive) and keep the first (most recent) casing
        const seen = new Map<string, GrinderSuggestion>();
        for (const row of data ?? []) {
          const maker = (row.maker ?? '').trim();
          const model = (row.model ?? '').trim();
          if (!maker && !model) continue;
          const key = `${maker.toLowerCase()}|||${model.toLowerCase()}`;
          if (!seen.has(key)) {
            seen.set(key, { maker, model });
          }
        }
        setGrinders(Array.from(seen.values()));
      } catch (e) {
        console.error('[useGrinderSuggestions]', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userUid]);

  // Unique makers (sorted alphabetically, case-insensitive)
  const makers: string[] = Array.from(
    new Map(grinders.map(g => [g.maker.toLowerCase(), g.maker])).values()
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  // Models for a given maker (case-insensitive match)
  function modelsForMaker(maker: string): string[] {
    const lc = maker.toLowerCase().trim();
    const models = grinders
      .filter(g => g.maker.toLowerCase().trim() === lc)
      .map(g => g.model);
    // Deduplicate
    return Array.from(new Map(models.map(m => [m.toLowerCase(), m])).values())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  return { makers, modelsForMaker, allGrinders: grinders, loading };
}
