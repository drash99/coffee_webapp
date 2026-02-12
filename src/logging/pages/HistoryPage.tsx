import { useEffect, useMemo, useState } from 'react';
import type { AppUser } from '../../auth/types';
import { getSupabaseClient } from '../../config/supabase';
import type { BeanRow, BrewRow, FlavorNote, GrinderRow } from '../types';
import { useI18n } from '../../i18n/I18nProvider';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { FlavorWheelPicker } from '../components/FlavorWheelPicker';
import { StarRating } from '../components/StarRating';
import { useGrinderSuggestions } from '../hooks/useGrinderSuggestions';

type Props = {
  user: AppUser;
};

type SavedBeanOption = Pick<
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
>;

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

type SortMode = 'date_desc' | 'date_asc' | 'rating_desc' | 'rating_asc';

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

type BrewEditDraft = {
  brew_date: string;
  bean_uid: string;
  grinder_maker: string;
  grinder_model: string;
  grinder_setting: string;
  recipe: string;
  coffee_dose_g: string;
  coffee_yield_g: string;
  coffee_tds: string;
  water: string;
  water_temp_c: string;
  grind_median_um: string;
  rating: number;
  extraction_note: string;
  taste_note: string;
  taste_flavor_notes: FlavorNote[];
};

function toNullableNumber(input: string): number | null {
  const v = input.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoToYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function beanDisplayLabel(bean: SavedBeanOption, fallback: string): string {
  const title = bean.bean_name || bean.roastery || bean.origin_location || bean.origin_country || fallback;
  const origin = [bean.origin_location, bean.origin_country].filter(Boolean).join(', ');
  if (bean.roastery && origin) return `${title} — ${bean.roastery} (${origin})`;
  if (bean.roastery) return `${title} — ${bean.roastery}`;
  if (origin) return `${title} (${origin})`;
  return title;
}

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
  const [savedBeans, setSavedBeans] = useState<SavedBeanOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('date_desc');
  const [isEditing, setIsEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<BrewEditDraft | null>(null);
  const { makers, modelsForMaker } = useGrinderSuggestions(user.uid);

  const selected = useMemo(() => rows.find((r) => r.uid === selectedUid) ?? null, [rows, selectedUid]);

  function draftFromBrew(brew: BrewWithBean): BrewEditDraft {
    return {
      brew_date: isoToYmd(brew.brew_date),
      bean_uid: brew.bean_uid,
      grinder_maker: brew.grinders?.maker ?? '',
      grinder_model: brew.grinders?.model ?? '',
      grinder_setting: brew.grinder_setting ?? '',
      recipe: brew.recipe ?? '',
      coffee_dose_g: brew.coffee_dose_g == null ? '' : String(brew.coffee_dose_g),
      coffee_yield_g: brew.coffee_yield_g == null ? '' : String(brew.coffee_yield_g),
      coffee_tds: brew.coffee_tds == null ? '' : String(brew.coffee_tds),
      water: brew.water ?? '',
      water_temp_c: brew.water_temp_c == null ? '' : String(brew.water_temp_c),
      grind_median_um: brew.grind_median_um == null ? '' : String(brew.grind_median_um),
      rating: brew.rating == null ? 0 : Number(brew.rating),
      extraction_note: brew.extraction_note ?? '',
      taste_note: brew.taste_note ?? '',
      taste_flavor_notes: (brew.taste_flavor_notes ?? []) as FlavorNote[]
    };
  }

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

  const sortedRows = useMemo(() => {
    const next = [...filteredRows];
    next.sort((a, b) => {
      const ta = new Date(a.brew_date).getTime();
      const tb = new Date(b.brew_date).getTime();
      if (sortMode === 'date_desc') return tb - ta;
      if (sortMode === 'date_asc') return ta - tb;
      if (sortMode === 'rating_desc') {
        const ra = a.rating == null ? -1 : Number(a.rating);
        const rb = b.rating == null ? -1 : Number(b.rating);
        if (rb !== ra) return rb - ra;
        return tb - ta;
      }
      const ra = a.rating == null ? Number.POSITIVE_INFINITY : Number(a.rating);
      const rb = b.rating == null ? Number.POSITIVE_INFINITY : Number(b.rating);
      if (ra !== rb) return ra - rb;
      return ta - tb;
    });
    return next;
  }, [filteredRows, sortMode]);

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

  async function refreshSavedBeans() {
    const supabase = getSupabaseClient();
    const { data, error: beanErr } = await supabase
      .from('beans')
      .select('uid,bean_name,roastery,producer,origin_location,origin_country,process,varietal,roasted_on,cup_flavor_notes')
      .eq('user_uid', user.uid)
      .order('created_at', { ascending: false });
    if (beanErr) throw new Error(beanErr.message);
    setSavedBeans((data ?? []) as SavedBeanOption[]);
  }

  async function getOrCreateGrinderUid(makerRaw: string, modelRaw: string): Promise<string> {
    const maker = makerRaw.trim();
    const model = modelRaw.trim();
    if (!maker || !model) {
      throw new Error(t('grindMap.error.missingGrinder'));
    }

    const supabase = getSupabaseClient();
    const { data: found, error: foundErr } = await supabase
      .from('grinders')
      .select('uid')
      .eq('user_uid', user.uid)
      .ilike('maker', maker)
      .ilike('model', model)
      .maybeSingle();
    if (foundErr) throw new Error(foundErr.message);
    if (found?.uid) return found.uid as string;

    const uid = crypto.randomUUID();
    const { error: insertErr } = await supabase.from('grinders').insert({
      uid,
      user_uid: user.uid,
      maker,
      model
    });
    if (insertErr) throw new Error(insertErr.message);
    return uid;
  }

  async function saveEditedBrew() {
    if (!selected || !editDraft) return;
    setEditError(null);
    let brewDateIso: string;
    try {
      brewDateIso = new Date(`${editDraft.brew_date}T00:00:00`).toISOString();
    } catch {
      setEditError(t('newBrew.error.invalidBrewDate'));
      return;
    }

    setEditSaving(true);
    try {
      const supabase = getSupabaseClient();
      const grinder_uid =
        editDraft.grinder_maker.trim() && editDraft.grinder_model.trim()
          ? await getOrCreateGrinderUid(editDraft.grinder_maker, editDraft.grinder_model)
          : null;

      const { error: updErr } = await supabase
        .from('brews')
        .update({
          brew_date: brewDateIso,
          bean_uid: editDraft.bean_uid,
          grinder_uid,
          grinder_setting: editDraft.grinder_setting.trim() || null,
          recipe: editDraft.recipe.trim() || null,
          coffee_dose_g: toNullableNumber(editDraft.coffee_dose_g),
          coffee_yield_g: toNullableNumber(editDraft.coffee_yield_g),
          coffee_tds: toNullableNumber(editDraft.coffee_tds),
          water: editDraft.water.trim() || null,
          water_temp_c: toNullableNumber(editDraft.water_temp_c),
          grind_median_um: toNullableNumber(editDraft.grind_median_um),
          rating: editDraft.rating > 0 ? editDraft.rating : null,
          extraction_note: editDraft.extraction_note.trim() || null,
          taste_note: editDraft.taste_note.trim() || null,
          taste_flavor_notes: (editDraft.taste_flavor_notes as FlavorNote[]) || []
        })
        .eq('uid', selected.uid);
      if (updErr) throw new Error(updErr.message);

      const { error: delErr } = await supabase.from('brew_flavor_notes').delete().eq('brew_uid', selected.uid);
      if (delErr) throw new Error(delErr.message);
      if (editDraft.taste_flavor_notes.length > 0) {
        const noteRows = editDraft.taste_flavor_notes.map((n) => ({
          brew_uid: selected.uid,
          l1: n.path[0] ?? '',
          l2: n.path[1] ?? null,
          l3: n.path[2] ?? null,
          color: n.color
        }));
        const { error: insErr } = await supabase.from('brew_flavor_notes').insert(noteRows);
        if (insErr) throw new Error(insErr.message);
      }

      await Promise.all([refresh(), refreshSavedBeans()]);
      setIsEditing(false);
      setEditDraft(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t('newBrew.error.saveFailed'));
    } finally {
      setEditSaving(false);
    }
  }

  useEffect(() => {
    void Promise.all([refresh(), refreshSavedBeans()]).catch((e) => {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid]);

  useEffect(() => {
    setIsEditing(false);
    setEditDraft(null);
    setEditError(null);
  }, [selectedUid]);

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
            Showing {sortedRows.length} of {rows.length} brews
          </div>
        </div>
      )}

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-gray-700">{t('history.list.title')}</div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">{t('history.sort.label')}</label>
              <select
                className="text-xs border rounded-md px-2 py-1 bg-white"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
              >
                <option value="date_desc">{t('history.sort.dateDesc')}</option>
                <option value="date_asc">{t('history.sort.dateAsc')}</option>
                <option value="rating_desc">{t('history.sort.ratingDesc')}</option>
                <option value="rating_asc">{t('history.sort.ratingAsc')}</option>
              </select>
            </div>
          </div>
          {sortedRows.length === 0 && !loading ? (
            <div className="p-4 text-sm text-gray-500">{t('history.empty')}</div>
          ) : (
            <div className="divide-y">
              {sortedRows.map((r) => {
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
                      {fmtDate(r.brew_date)} — {beanLabel} · ★
                      {r.rating == null ? t('common.none') : Number(r.rating).toFixed(1)}
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
              <div className="flex items-center justify-end gap-2">
                {!isEditing ? (
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50"
                    onClick={() => {
                      setEditDraft(draftFromBrew(selected));
                      setIsEditing(true);
                      setEditError(null);
                    }}
                  >
                    {t('history.edit.start')}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 disabled:bg-gray-100"
                      onClick={() => {
                        setIsEditing(false);
                        setEditDraft(null);
                        setEditError(null);
                      }}
                      disabled={editSaving}
                    >
                      {t('history.edit.cancel')}
                    </button>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg bg-amber-700 text-white text-sm disabled:bg-gray-300"
                      onClick={saveEditedBrew}
                      disabled={editSaving || !editDraft}
                    >
                      {editSaving ? t('history.edit.saving') : t('history.edit.save')}
                    </button>
                  </>
                )}
              </div>

              {isEditing && editDraft ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('history.detail.date')}</label>
                      <input
                        className="w-full p-2 border rounded-lg"
                        type="date"
                        value={editDraft.brew_date}
                        onChange={(e) => setEditDraft({ ...editDraft, brew_date: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('history.detail.bean')}</label>
                      <select
                        className="w-full p-2 border rounded-lg bg-white"
                        value={editDraft.bean_uid}
                        onChange={(e) => setEditDraft({ ...editDraft, bean_uid: e.target.value })}
                      >
                        {savedBeans.map((bean) => (
                          <option key={bean.uid} value={bean.uid}>
                            {beanDisplayLabel(bean, t('history.bean.fallbackLabel'))}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('grinder.field.maker')}</label>
                      <AutocompleteInput
                        value={editDraft.grinder_maker}
                        onChange={(v) => setEditDraft({ ...editDraft, grinder_maker: v })}
                        suggestions={makers}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('grinder.field.model')}</label>
                      <AutocompleteInput
                        value={editDraft.grinder_model}
                        onChange={(v) => setEditDraft({ ...editDraft, grinder_model: v })}
                        suggestions={modelsForMaker(editDraft.grinder_maker)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">{t('grinder.field.setting')}</label>
                      <input
                        className="w-full p-2 border rounded-lg"
                        value={editDraft.grinder_setting}
                        onChange={(e) => setEditDraft({ ...editDraft, grinder_setting: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">{t('brew.field.rating')}</label>
                      <div className="flex items-center gap-3">
                        <StarRating
                          value={editDraft.rating}
                          onChange={(next) => setEditDraft({ ...editDraft, rating: next })}
                          disabled={editSaving}
                        />
                        <div className="text-sm text-gray-600 tabular-nums">{editDraft.rating.toFixed(1)}</div>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('brew.field.dose')}</label>
                      <input
                        className="w-full p-2 border rounded-lg"
                        type="number"
                        step="0.1"
                        value={editDraft.coffee_dose_g}
                        onChange={(e) => setEditDraft({ ...editDraft, coffee_dose_g: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('brew.field.yield')}</label>
                      <input
                        className="w-full p-2 border rounded-lg"
                        type="number"
                        step="0.1"
                        value={editDraft.coffee_yield_g}
                        onChange={(e) => setEditDraft({ ...editDraft, coffee_yield_g: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('brew.field.tds')}</label>
                      <input
                        className="w-full p-2 border rounded-lg"
                        type="number"
                        step="0.01"
                        value={editDraft.coffee_tds}
                        onChange={(e) => setEditDraft({ ...editDraft, coffee_tds: e.target.value })}
                        placeholder={t('brew.placeholder.naAllowed')}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('brew.field.waterTemp', { unit: 'C' })}</label>
                      <input
                        className="w-full p-2 border rounded-lg"
                        type="number"
                        step="0.1"
                        value={editDraft.water_temp_c}
                        onChange={(e) => setEditDraft({ ...editDraft, water_temp_c: e.target.value })}
                        placeholder={t('brew.placeholder.naAllowed')}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">{t('brew.field.water')}</label>
                      <input
                        className="w-full p-2 border rounded-lg"
                        value={editDraft.water}
                        onChange={(e) => setEditDraft({ ...editDraft, water: e.target.value })}
                        placeholder={t('brew.placeholder.water')}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">{t('brew.field.grindMedianUm')}</label>
                      <input
                        className="w-full p-2 border rounded-lg"
                        type="number"
                        step="1"
                        value={editDraft.grind_median_um}
                        onChange={(e) => setEditDraft({ ...editDraft, grind_median_um: e.target.value })}
                        placeholder={t('brew.placeholder.naAllowed')}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">{t('brew.field.recipe')}</label>
                      <textarea
                        className="w-full p-2 border rounded-lg min-h-24"
                        value={editDraft.recipe}
                        onChange={(e) => setEditDraft({ ...editDraft, recipe: e.target.value })}
                      />
                    </div>
                  </div>

                  <FlavorWheelPicker
                    label={t('brew.field.tasteNotesSca')}
                    value={editDraft.taste_flavor_notes}
                    onChange={(next) => setEditDraft({ ...editDraft, taste_flavor_notes: next })}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('brew.field.extractionNote')}</label>
                      <textarea
                        className="w-full p-2 border rounded-lg min-h-24"
                        value={editDraft.extraction_note}
                        onChange={(e) => setEditDraft({ ...editDraft, extraction_note: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">{t('brew.field.tasteNoteFreeText')}</label>
                      <textarea
                        className="w-full p-2 border rounded-lg min-h-24"
                        value={editDraft.taste_note}
                        onChange={(e) => setEditDraft({ ...editDraft, taste_note: e.target.value })}
                      />
                    </div>
                  </div>
                  {editError && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{editError}</div>}
                </div>
              ) : (
                <>
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
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
