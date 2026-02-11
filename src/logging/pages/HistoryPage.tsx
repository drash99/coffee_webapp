import { useEffect, useMemo, useState } from 'react';
import type { AppUser } from '../../auth/types';
import { getSupabaseClient } from '../../config/supabase';
import type { BeanRow, BrewRow, FlavorNote, GrinderRow } from '../types';
import { useI18n } from '../../i18n/I18nProvider';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { FlavorWheelPicker } from '../components/FlavorWheelPicker';

type Props = {
  user: AppUser;
};

type BrewWithBean = BrewRow & {
  beans: Pick<
    BeanRow,
    | 'uid'
    | 'bean_name'
    | 'roastery'
    | 'producer'
    | 'origin_location'
    | 'origin_country'
    | 'process'
    | 'varietal'
    | 'roasted_on'
    | 'cup_flavor_notes'
  > | null;
  grinders: Pick<GrinderRow, 'uid' | 'maker' | 'model'> | null;
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function NoteDotsList({ notes, emptyLabel }: { notes: FlavorNote[] | null | undefined; emptyLabel: string }) {
  if (!notes || notes.length === 0) return <div className="text-gray-900">{emptyLabel}</div>;
  return (
    <div className="flex flex-wrap gap-2">
      {notes.map((n) => (
        <div key={n.path.join('>')} className="flex items-center gap-2 px-3 py-1 rounded-full border bg-white text-sm">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: n.color }} />
          <span className="text-gray-900">{n.path.join(' / ')}</span>
        </div>
      ))}
    </div>
  );
}

interface Filters {
  roastery: string;
  country: string;
  location: string;
  producer: string;
  varietal: string;
  cupNotes: FlavorNote[];
  tasteNotes: FlavorNote[];
  grinderMaker: string;
  grinderModel: string;
}

const emptyFilters: Filters = {
  roastery: '',
  country: '',
  location: '',
  producer: '',
  varietal: '',
  cupNotes: [],
  tasteNotes: [],
  grinderMaker: '',
  grinderModel: '',
};

/** Deduplicate strings (case-insensitive), keep first casing, sort alphabetically. */
function unique(values: string[]): string[] {
  const map = new Map<string, string>();
  for (const v of values) {
    if (!v) continue;
    const key = v.toLowerCase();
    if (!map.has(key)) map.set(key, v);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

function matchesFilter(value: string | null | undefined, filter: string): boolean {
  if (!filter.trim()) return true;
  return (value ?? '').toLowerCase().includes(filter.toLowerCase().trim());
}

/**
 * Hierarchical prefix matching for flavor notes.
 * If the filter note path is ["Sweet"], it matches any note starting with "Sweet":
 *   ["Sweet"], ["Sweet","Honey"], ["Sweet","Brown Sugar","Caramel"], etc.
 * If the filter is ["Sweet","Honey"], it matches ["Sweet","Honey"] exactly (2 levels).
 */
function noteMatchesFilter(brewNote: FlavorNote, filterNote: FlavorNote): boolean {
  const fp = filterNote.path;
  const bp = brewNote.path;
  if (fp.length > bp.length) return false;
  return fp.every((seg, i) => seg === bp[i]);
}

export function HistoryPage({ user }: Props) {
  const { t } = useI18n();
  const [rows, setRows] = useState<BrewWithBean[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);

  const selected = useMemo(() => rows.find((r) => r.uid === selectedUid) ?? null, [rows, selectedUid]);

  // --- Derive suggestion lists from ALL loaded rows ---
  const suggestions = useMemo(() => {
    const roasteries = unique(rows.map(r => (r.beans?.roastery ?? '').trim()));
    const countries = unique(rows.map(r => (r.beans?.origin_country ?? '').trim()));
    const locations = unique(rows.map(r => (r.beans?.origin_location ?? '').trim()));
    const producers = unique(rows.map(r => (r.beans?.producer ?? '').trim()));
    const varietals = unique(rows.map(r => (r.beans?.varietal ?? '').trim()));

    const grinderMakers = unique(rows.map(r => (r.grinders?.maker ?? '').trim()));
    const grinderModels = unique(rows.map(r => (r.grinders?.model ?? '').trim()));

    return { roasteries, countries, locations, producers, varietals, grinderMakers, grinderModels };
  }, [rows]);

  // --- Apply filters ---
  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (!matchesFilter(r.beans?.roastery, filters.roastery)) return false;
      if (!matchesFilter(r.beans?.origin_country, filters.country)) return false;
      if (!matchesFilter(r.beans?.origin_location, filters.location)) return false;
      if (!matchesFilter(r.beans?.producer, filters.producer)) return false;
      if (!matchesFilter(r.beans?.varietal, filters.varietal)) return false;
      if (!matchesFilter(r.grinders?.maker, filters.grinderMaker)) return false;
      if (!matchesFilter(r.grinders?.model, filters.grinderModel)) return false;

      // Cup notes: hierarchical prefix matching
      // Selecting "Sweet" matches "Sweet", "Sweet/Honey", "Sweet/Brown Sugar/Caramel", etc.
      if (filters.cupNotes.length > 0) {
        const beanNotes = (r.beans?.cup_flavor_notes ?? []) as FlavorNote[];
        const match = filters.cupNotes.some(fn =>
          beanNotes.some(bn => noteMatchesFilter(bn, fn))
        );
        if (!match) return false;
      }

      // Taste notes: same hierarchical prefix matching
      if (filters.tasteNotes.length > 0) {
        const brewTasteNotes = (r.taste_flavor_notes ?? []) as FlavorNote[];
        const match = filters.tasteNotes.some(fn =>
          brewTasteNotes.some(bn => noteMatchesFilter(bn, fn))
        );
        if (!match) return false;
      }

      return true;
    });
  }, [rows, filters]);

  const activeFilterCount =
    Object.entries(filters).reduce((count, [key, v]) => {
      if (key === 'cupNotes' || key === 'tasteNotes') return count + ((v as FlavorNote[]).length > 0 ? 1 : 0);
      return count + ((v as string).trim() ? 1 : 0);
    }, 0);

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { data, error: err } = await supabase
        .from('brews')
        .select(
          `
          uid,
          user_uid,
          brew_date,
          bean_uid,
          recipe,
          coffee_dose_g,
          coffee_yield_g,
          coffee_tds,
          water,
          water_temp_c,
          grind_median_um,
          rating,
          grinder_uid,
          grinder_setting,
          extraction_note,
          taste_note,
          taste_flavor_notes,
          created_at,
          beans ( uid, bean_name, roastery, producer, origin_location, origin_country, process, varietal, roasted_on, cup_flavor_notes ),
          grinders ( uid, maker, model )
        `
        )
        .eq('user_uid', user.uid)
        .order('brew_date', { ascending: false });
      if (err) throw new Error(err.message);
      setRows((data ?? []) as unknown as BrewWithBean[]);
      if ((data ?? []).length > 0 && !selectedUid) setSelectedUid((data ?? [])[0]?.uid ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('history.title')}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`px-3 py-2 rounded-lg border text-sm ${
              showFilters ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white hover:bg-gray-50'
            }`}
            onClick={() => setShowFilters(!showFilters)}
          >
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 disabled:bg-gray-100"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? t('history.refresh.loading') : t('history.refresh')}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-gray-700">Filters</div>
            {activeFilterCount > 0 && (
              <button
                type="button"
                className="text-xs text-gray-500 hover:text-gray-800"
                onClick={() => setFilters(emptyFilters)}
              >
                Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('bean.field.roastery')}</label>
              <AutocompleteInput
                value={filters.roastery}
                onChange={(v) => setFilters({ ...filters, roastery: v })}
                suggestions={suggestions.roasteries}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('bean.field.originCountry')}</label>
              <AutocompleteInput
                value={filters.country}
                onChange={(v) => setFilters({ ...filters, country: v })}
                suggestions={suggestions.countries}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('bean.field.originLocation')}</label>
              <AutocompleteInput
                value={filters.location}
                onChange={(v) => setFilters({ ...filters, location: v })}
                suggestions={suggestions.locations}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('bean.field.producer')}</label>
              <AutocompleteInput
                value={filters.producer}
                onChange={(v) => setFilters({ ...filters, producer: v })}
                suggestions={suggestions.producers}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('bean.field.varietal')}</label>
              <AutocompleteInput
                value={filters.varietal}
                onChange={(v) => setFilters({ ...filters, varietal: v })}
                suggestions={suggestions.varietals}
              />
            </div>
            <div className="col-span-2 sm:col-span-4">
              <FlavorWheelPicker
                label={t('bean.field.cupNotesSca')}
                value={filters.cupNotes}
                onChange={(notes) => setFilters({ ...filters, cupNotes: notes })}
                maxNotes={10}
              />
            </div>
            <div className="col-span-2 sm:col-span-4">
              <FlavorWheelPicker
                label={t('brew.field.tasteNotesSca')}
                value={filters.tasteNotes}
                onChange={(notes) => setFilters({ ...filters, tasteNotes: notes })}
                maxNotes={10}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('grinder.field.maker')}</label>
              <AutocompleteInput
                value={filters.grinderMaker}
                onChange={(v) => setFilters({ ...filters, grinderMaker: v })}
                suggestions={suggestions.grinderMakers}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('grinder.field.model')}</label>
              <AutocompleteInput
                value={filters.grinderModel}
                onChange={(v) => setFilters({ ...filters, grinderModel: v })}
                suggestions={suggestions.grinderModels}
              />
            </div>
          </div>
          <div className="text-xs text-gray-500">
            Showing {filteredRows.length} of {rows.length} brews
          </div>
        </div>
      )}

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 text-sm font-medium text-gray-700">{t('history.list.title')}</div>
          {filteredRows.length === 0 && !loading ? (
            <div className="p-4 text-sm text-gray-500">{t('history.empty')}</div>
          ) : (
            <div className="divide-y">
              {filteredRows.map((r) => {
                const beanLabel =
                  r.beans?.bean_name ||
                  r.beans?.roastery ||
                  r.beans?.origin_location ||
                  r.beans?.origin_country ||
                  t('history.bean.fallbackLabel');
                const active = r.uid === selectedUid;
                return (
                  <button
                    key={r.uid}
                    type="button"
                    onClick={() => setSelectedUid(r.uid)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${
                      active ? 'bg-amber-50' : 'bg-white'
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900">
                      {fmtDate(r.brew_date)} — {beanLabel}
                    </div>
                    <div className="text-xs text-gray-500">
                      {t('history.list.summary', {
                        dose: r.coffee_dose_g ?? t('common.none'),
                        yield: r.coffee_yield_g ?? t('common.none'),
                        tds: r.coffee_tds ?? t('common.na')
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-4 py-3 border-b bg-gray-50 text-sm font-medium text-gray-700">{t('history.detail.title')}</div>
          {!selected ? (
            <div className="p-4 text-sm text-gray-500">{t('history.selectPrompt')}</div>
          ) : (
            <div className="p-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-500">{t('history.detail.date')}</div>
                  <div className="font-medium text-gray-900">{fmtDate(selected.brew_date)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t('history.detail.bean')}</div>
                  <div className="font-medium text-gray-900">
                    {selected.beans?.bean_name || t('common.none')}{' '}
                    {selected.beans?.roastery ? `— ${selected.beans.roastery}` : ''}{' '}
                    {selected.beans?.origin_location || selected.beans?.origin_country
                      ? `(${[selected.beans?.origin_location, selected.beans?.origin_country].filter(Boolean).join(', ')})`
                      : ''}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t('history.detail.grinder')}</div>
                  <div className="font-medium text-gray-900">
                    {selected.grinders?.maker || t('common.none')}
                    {selected.grinders?.model ? ` ${selected.grinders.model}` : ''}
                    {selected.grinder_setting ? ` — ${selected.grinder_setting}` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t('history.detail.rating')}</div>
                  <div className="font-medium text-gray-900">{selected.rating == null ? t('common.none') : selected.rating.toFixed(1)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t('history.detail.doseYield')}</div>
                  <div className="font-medium text-gray-900">
                    {selected.coffee_dose_g ?? t('common.none')}g / {selected.coffee_yield_g ?? t('common.none')}g
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t('history.detail.tds')}</div>
                  <div className="font-medium text-gray-900">{selected.coffee_tds ?? t('common.na')}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t('history.detail.water')}</div>
                  <div className="font-medium text-gray-900">{selected.water ?? t('common.none')}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t('history.detail.waterTemp')}</div>
                  <div className="font-medium text-gray-900">
                    {selected.water_temp_c == null ? t('common.na') : `${selected.water_temp_c}°C`}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t('history.detail.grindMedianUm')}</div>
                  <div className="font-medium text-gray-900">
                    {selected.grind_median_um == null ? t('common.na') : `${selected.grind_median_um} μm`}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500">{t('history.detail.recipe')}</div>
                <div className="whitespace-pre-wrap text-gray-900">{selected.recipe || t('common.none')}</div>
              </div>

              <div>
                <div className="text-xs text-gray-500">{t('history.detail.cupNotesSca')}</div>
                <NoteDotsList
                  notes={selected.beans?.cup_flavor_notes ?? []}
                  emptyLabel={t('common.none')}
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('history.detail.tasteNotesSca')}</div>
                <NoteDotsList notes={selected.taste_flavor_notes} emptyLabel={t('common.none')} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-500">{t('history.detail.extractionNote')}</div>
                  <div className="whitespace-pre-wrap text-gray-900">{selected.extraction_note || t('common.none')}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t('history.detail.tasteNote')}</div>
                  <div className="whitespace-pre-wrap text-gray-900">{selected.taste_note || t('common.none')}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


