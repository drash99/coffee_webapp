import { useEffect, useState } from 'react';
import { isSupabaseConfigured, getSupabaseClient } from '../../config/supabase';
import { unique } from '../utils/formatting';
import { fetchAllRows } from '../utils/pagination';
import type { BeverageType } from '../types';
import { beverageTypeOf } from '../utils/beverage';

/**
 * Fetches previously used brew recipes for autocomplete.
 * RLS scopes authenticated rows; guest mode derives recipes from local storage in the page.
 */
export function useRecipeSuggestions(userUid: string | undefined, refreshKey = 0) {
  const [recipes, setRecipes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRecipes([]);
    setLoading(false);
    if (!userUid || !isSupabaseConfigured()) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const supabase = getSupabaseClient();
        const data = await fetchAllRows<{ recipe: string | null; beans?: { beverage_type?: BeverageType } | null }>(() => supabase
          .from('brews')
          .select('recipe,beans(*)')
          .order('created_at', { ascending: false })
          .order('uid', { ascending: false }));
        if (cancelled) return;

        setRecipes(unique(data.filter(row => beverageTypeOf(row.beans) === 'coffee').map(row => (row.recipe ?? '').trim())));
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
