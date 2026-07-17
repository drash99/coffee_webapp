import { useEffect, useState } from 'react';
import { isSupabaseConfigured, getSupabaseClient } from '../../config/supabase';
import { unique } from '../utils/formatting';

/**
 * Fetches previously used brew recipes for autocomplete.
 * RLS scopes authenticated rows; guest mode derives recipes from local storage in the page.
 */
export function useRecipeSuggestions(userUid: string | undefined, refreshKey = 0) {
  const [recipes, setRecipes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userUid || !isSupabaseConfigured()) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
          .from('brews')
          .select('recipe')
          .order('created_at', { ascending: false });

        if (error) {
          console.error('[useRecipeSuggestions]', error.message);
          return;
        }
        if (cancelled) return;

        setRecipes(unique((data ?? []).map((row) => (row.recipe ?? '').trim())));
      } catch (e) {
        console.error('[useRecipeSuggestions]', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userUid, refreshKey]);

  return { recipes, loading };
}
