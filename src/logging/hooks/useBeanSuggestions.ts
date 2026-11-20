import { useEffect, useState } from 'react';
import { isSupabaseConfigured, getSupabaseClient } from '../../config/supabase';
import { unique } from '../utils/formatting';
import { fetchAllRows } from '../utils/pagination';
import type { BeverageType } from '../types';
import { beverageTypeOf } from '../utils/beverage';

interface BeanRecord {
  beverage_type?: BeverageType;
  roastery: string;
  origin_country: string;
  origin_location: string;
  producer: string;
  varietal: string;
}

/**
 * Fetches all distinct bean field values for the given user on mount.
 * Provides hierarchical narrowing:
 *   - roasteries: all unique roastery names
 *   - countries: all unique origin countries
 *   - locationsForCountry(country): origin locations filtered by country
 *   - producersForLocation(country, location): producers filtered by country + location
 *   - varietals: all unique varietals
 */
export function useBeanSuggestions(userUid: string | undefined, refreshKey = 0) {
  const [beans, setBeans] = useState<BeanRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setBeans([]);
    setLoading(false);
    if (!userUid || !isSupabaseConfigured()) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const supabase = getSupabaseClient();
        const data = await fetchAllRows<Partial<BeanRecord>>(() => supabase
          .from('beans')
          .select('*')
          .order('created_at', { ascending: false })
          .order('uid', { ascending: false }));
        if (cancelled) return;

        const records: BeanRecord[] = data.filter(row => beverageTypeOf(row) === 'coffee').map((row) => ({
          roastery: (row.roastery ?? '').trim(),
          origin_country: (row.origin_country ?? '').trim(),
          origin_location: (row.origin_location ?? '').trim(),
          producer: (row.producer ?? '').trim(),
          varietal: (row.varietal ?? '').trim(),
        }));

        setBeans(records);
      } catch (e) {
        console.error('[useBeanSuggestions]', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userUid, refreshKey]);

  // --- Independent fields ---

  const roasteries = unique(beans.map(b => b.roastery));
  const varietals = unique(beans.map(b => b.varietal));

  // --- Hierarchical: country → location → producer ---

  const countries = unique(beans.map(b => b.origin_country));

  function locationsForCountry(country: string): string[] {
    const lc = country.toLowerCase().trim();
    if (!lc) {
      // If no country selected, show all locations
      return unique(beans.map(b => b.origin_location));
    }
    return unique(
      beans.filter(b => b.origin_country.toLowerCase() === lc).map(b => b.origin_location)
    );
  }

  function producersForLocation(country: string, location: string): string[] {
    const lcCountry = country.toLowerCase().trim();
    const lcLocation = location.toLowerCase().trim();

    let filtered = beans;
    if (lcCountry) {
      filtered = filtered.filter(b => b.origin_country.toLowerCase() === lcCountry);
    }
    if (lcLocation) {
      filtered = filtered.filter(b => b.origin_location.toLowerCase() === lcLocation);
    }
    // If neither is set, return all producers
    return unique(filtered.map(b => b.producer));
  }

  return {
    roasteries,
    countries,
    locationsForCountry,
    producersForLocation,
    varietals,
    loading,
  };
}
