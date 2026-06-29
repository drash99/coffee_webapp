import { useEffect, useMemo, useState } from 'react';
import type { AppUser } from '../../auth/types';
import { getSupabaseClient } from '../../config/supabase';
import type { BeanRow, BrewRow, FlavorNote, GrinderRow } from '../types';
import { useI18n } from '../../i18n/I18nProvider';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { FlavorWheelPicker } from '../components/FlavorWheelPicker';
import { NoteDotsList } from '../components/NoteDotsList';
import { StarRating } from '../components/StarRating';
import { useGrinderSuggestions } from '../hooks/useGrinderSuggestions';
import { toNullableNumber, fmtDate, isoToYmd, unique } from '../utils/formatting';
import { beanDisplayLabel } from '../utils/beanLabel';
import { downloadBrewAsPng } from '../utils/brewPng';
import { buildPublicBrewShareUrl } from '../utils/publicLinks';
import { getPlatform } from '../../platform';
import { getAiServerBaseUrl, getAiServerConfig, getAiModelId, getAiTempUnit } from '../ai/prefs';
import { buildAiGuidanceSignature, getCachedBrewGuidance, setCachedBrewGuidance } from '../ai/cache';
import { serializeBrewForAi, type AiBeanSummary, type AiBrewSummary } from '../ai/serialize';
import { requestBrewGuidance, type AiGuidance } from '../ai/customServerClient';
import {
  localListBrewsWithBeans,
  localListBeans,
  localGetOrCreateGrinder,
  localUpdateBrew,
  localDeleteBrew,
  localListGrinders,
} from '../storage';

type Props = {
  user: AppUser;
  isGuest?: boolean;
  beanUidFilter?: string;
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

function navigate(url: string) {
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function HistoryPage({ user, isGuest = false, beanUidFilter }: Props) {
  const { t, lang } = useI18n();
  const aiEnabled = getPlatform() === 'ios';
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
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [savePngBusy, setSavePngBusy] = useState(false);
  const [savePngMsg, setSavePngMsg] = useState<string | null>(null);
  const [aiGuidance, setAiGuidance] = useState<AiGuidance | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiCopiedMsg, setAiCopiedMsg] = useState<string | null>(null);
  const [aiIsCached, setAiIsCached] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // --- Suggestions ---
  const hookGrinderSugg = useGrinderSuggestions(isGuest ? undefined : user.uid);

  const guestGrinderSugg = useMemo(() => {
    if (!isGuest) return null;
    const grinders = localListGrinders();
    const makers = Array.from(new Map(grinders.map((g) => [(g.maker ?? '').toLowerCase(), g.maker ?? ''])).values())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return {
      makers,
      modelsForMaker(maker: string) {
        const lc = maker.toLowerCase().trim();
        const models = grinders.filter((g) => (g.maker ?? '').toLowerCase().trim() === lc).map((g) => g.model ?? '');
        return Array.from(new Map(models.map((m) => [m.toLowerCase(), m])).values())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      },
    };
  }, [isGuest]);

  const makers = isGuest ? (guestGrinderSugg?.makers ?? []) : hookGrinderSugg.makers;
  const modelsForMaker = isGuest
    ? (m: string) => guestGrinderSugg?.modelsForMaker(m) ?? []
    : hookGrinderSugg.modelsForMaker;

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
      const uidFilter = (beanUidFilter ?? '').trim();
      if (uidFilter && r.bean_uid !== uidFilter) return false;
      if (!matchesFilter(r.beans?.roastery, filters.roastery)) return false;
      if (!matchesFilter(r.beans?.origin_country, filters.country)) return false;
      if (!matchesFilter(r.beans?.origin_location, filters.location)) return false;
      if (!matchesFilter(r.beans?.producer, filters.producer)) return false;
      if (!matchesFilter(r.beans?.varietal, filters.varietal)) return false;
      if (!matchesFilter(r.grinders?.maker, filters.grinderMaker)) return false;
      if (!matchesFilter(r.grinders?.model, filters.grinderModel)) return false;

      // Cup notes: hierarchical prefix matching
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
  }, [rows, filters, beanUidFilter]);

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

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      if (isGuest) {
        const data = localListBrewsWithBeans();
        setRows(data as BrewWithBean[]);
        if (data.length > 0 && !selectedUid) setSelectedUid(data[0]?.uid ?? null);
      } else {
        const supabase = getSupabaseClient();
        const { data, error: err } = await supabase
          .from('brews')
          .select(
            `
            uid,
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
          .order('brew_date', { ascending: false });
        if (err) throw new Error(err.message);
        setRows((data ?? []) as unknown as BrewWithBean[]);
        if ((data ?? []).length > 0 && !selectedUid) setSelectedUid((data ?? [])[0]?.uid ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }

  async function refreshSavedBeans() {
    if (isGuest) {
      setSavedBeans(localListBeans() as SavedBeanOption[]);
      return;
    }
    const supabase = getSupabaseClient();
    const { data, error: beanErr } = await supabase
      .from('beans')
      .select('uid,bean_name,roastery,producer,origin_location,origin_country,process,varietal,roasted_on,cup_flavor_notes')
      .order('created_at', { ascending: false });
    if (beanErr) throw new Error(beanErr.message);
    setSavedBeans((data ?? []) as SavedBeanOption[]);
  }

  function toAiBeanSummary(bean: BrewWithBean['beans'] | null): AiBeanSummary | null {
    if (!bean) return null;
    return {
      uid: bean.uid,
      bean_name: bean.bean_name,
      roastery: bean.roastery,
      producer: bean.producer,
      origin_location: bean.origin_location,
      origin_country: bean.origin_country,
      process: bean.process,
      varietal: bean.varietal,
      roasted_on: bean.roasted_on,
      cup_flavor_notes: (bean.cup_flavor_notes ?? []) as FlavorNote[] | null,
    };
  }

  function toAiBrewSummary(row: BrewWithBean): AiBrewSummary & { bean: AiBeanSummary | null } {
    return {
      uid: row.uid,
      brew_date: row.brew_date,
      bean_uid: row.bean_uid,
      grinder: {
        maker: row.grinders?.maker ?? null,
        model: row.grinders?.model ?? null,
        setting: row.grinder_setting ?? null,
      },
      recipe: row.recipe,
      coffee_dose_g: row.coffee_dose_g,
      coffee_yield_g: row.coffee_yield_g,
      coffee_tds: row.coffee_tds,
      water: row.water,
      water_temp_c: row.water_temp_c,
      grind_median_um: row.grind_median_um,
      rating: row.rating,
      extraction_note: row.extraction_note,
      taste_note: row.taste_note,
      taste_flavor_notes: (row.taste_flavor_notes ?? []) as FlavorNote[] | null,
      bean: toAiBeanSummary(row.beans),
    };
  }

  function buildAiRequestContext(row: BrewWithBean) {
    const current = toAiBrewSummary(row);
    const sameBean = rows
      .filter((r) => r.bean_uid === row.bean_uid && r.uid !== row.uid)
      .sort((a, b) => new Date(b.brew_date).getTime() - new Date(a.brew_date).getTime())
      .slice(0, 8)
      .map(toAiBrewSummary);
    const prefs = {
      language: lang,
      tempUnit: getAiTempUnit(),
    };
    const payload = serializeBrewForAi(current, sameBean, prefs);
    const modelId = getAiModelId();
    let serverBaseUrl = 'invalid://ai-server';
    try {
      serverBaseUrl = getAiServerBaseUrl();
    } catch {
      // Keep cache lookup deterministic even if the saved server config is invalid.
    }
    const signature = buildAiGuidanceSignature(serverBaseUrl, modelId, payload);
    return { modelId, payload, signature };
  }

  async function requestAiForSelected() {
    if (!selected) return;
    if (!aiEnabled) return;
    setAiError(null);
    setAiGuidance(null);
    setAiCopiedMsg(null);
    setAiIsCached(false);
    setAiLoading(true);
    try {
      const { payload, signature } = buildAiRequestContext(selected);
      const guidance = await requestBrewGuidance(getAiServerConfig(), payload);
      setCachedBrewGuidance(selected.uid, signature, guidance);
      setAiGuidance(guidance);
      setAiIsCached(false);
    } catch (e) {
      setAiError(
        t('history.ai.error', {
          message: e instanceof Error ? e.message : 'Unknown error',
        }),
      );
    } finally {
      setAiLoading(false);
    }
  }

  async function getOrCreateGrinderUid(makerRaw: string, modelRaw: string): Promise<string> {
    const maker = makerRaw.trim();
    const model = modelRaw.trim();
    if (!maker || !model) {
      throw new Error(t('grindMap.error.missingGrinder'));
    }

    if (isGuest) {
      return localGetOrCreateGrinder(maker, model);
    }

    const supabase = getSupabaseClient();
    const { data: found, error: foundErr } = await supabase
      .from('grinders')
      .select('uid')
      .ilike('maker', maker)
      .ilike('model', model)
      .maybeSingle();
    if (foundErr) throw new Error(foundErr.message);
    if (found?.uid) return found.uid as string;

    const uid = crypto.randomUUID();
    const { error: insertErr } = await supabase.from('grinders').insert({
      uid,
      maker,
      model
    });
    if (insertErr) throw new Error(insertErr.message);
    return uid;
  }

  // -----------------------------------------------------------------------
  // Edit brew
  // -----------------------------------------------------------------------

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
      const grinder_uid =
        editDraft.grinder_maker.trim() && editDraft.grinder_model.trim()
          ? await getOrCreateGrinderUid(editDraft.grinder_maker, editDraft.grinder_model)
          : null;

      const patch = {
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
      };

      if (isGuest) {
        localUpdateBrew(selected.uid, patch);
      } else {
        const supabase = getSupabaseClient();
        const { error: updErr } = await supabase
          .from('brews')
          .update(patch)
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

  // -----------------------------------------------------------------------
  // Share brew (Supabase-only)
  // -----------------------------------------------------------------------

  async function shareSelectedBrew() {
    if (!selected || isGuest) return;
    setShareMsg(null);
    setShareBusy(true);
    try {
      const supabase = getSupabaseClient();
      const { data: existing, error: existingErr } = await supabase
        .from('brew_shares')
        .select('share_token,revoked_at')
        .eq('brew_uid', selected.uid)
        .maybeSingle();
      if (existingErr) throw new Error(existingErr.message);

      const current = existing as { share_token: string | null; revoked_at: string | null } | null;
      let token = current?.share_token?.trim() ?? '';
      if (!token || current?.revoked_at) {
        token = crypto.randomUUID().replace(/-/g, '');
        const { error: upsertErr } = await supabase
          .from('brew_shares')
          .upsert(
            {
              brew_uid: selected.uid,
              share_token: token,
              revoked_at: null
            },
            { onConflict: 'brew_uid' }
          );
        if (upsertErr) throw new Error(upsertErr.message);
      }

      const url = buildPublicBrewShareUrl(token);
      setShareUrl(url);

      try {
        await navigator.clipboard.writeText(url);
        setShareMsg(t('history.share.copied'));
      } catch {
        setShareMsg(t('history.share.created'));
      }
    } catch (e) {
      setShareMsg(e instanceof Error ? e.message : t('history.share.failed'));
    } finally {
      setShareBusy(false);
    }
  }

  // -----------------------------------------------------------------------
  // Save as PNG
  // -----------------------------------------------------------------------

  async function saveSelectedAsPng() {
    if (!selected) return;
    setSavePngBusy(true);
    setSavePngMsg(null);
    try {
      await downloadBrewAsPng(
        {
          title: t('history.detail.title'),
          sections: [
            {
              rows: [
                { label: t('history.detail.date'), value: fmtDate(selected.brew_date) },
                { label: t('history.detail.bean'), value: selected.beans?.bean_name || t('common.none') },
                { label: t('bean.field.roastery'), value: selected.beans?.roastery || t('common.none') },
                { label: t('bean.field.producer'), value: selected.beans?.producer || t('common.none') },
                { label: t('bean.field.originLocation'), value: selected.beans?.origin_location || t('common.none') },
                { label: t('bean.field.originCountry'), value: selected.beans?.origin_country || t('common.none') },
                { label: t('bean.field.process'), value: selected.beans?.process || t('common.none') },
                { label: t('bean.field.varietal'), value: selected.beans?.varietal || t('common.none') },
                {
                  label: t('bean.field.roastedOn'),
                  value: selected.beans?.roasted_on ? fmtDate(selected.beans.roasted_on) : t('common.none')
                },
                {
                  label: t('history.detail.grinder'),
                  value: `${selected.grinders?.maker || t('common.none')}${selected.grinders?.model ? ` ${selected.grinders.model}` : ''}${selected.grinder_setting ? ` — ${selected.grinder_setting}` : ''}`
                },
                { label: t('history.detail.rating'), value: selected.rating == null ? t('common.none') : selected.rating.toFixed(1) },
                {
                  label: t('history.detail.doseYield'),
                  value: `${selected.coffee_dose_g ?? t('common.none')}g / ${selected.coffee_yield_g ?? t('common.none')}g`
                },
                { label: t('history.detail.tds'), value: String(selected.coffee_tds ?? t('common.na')) },
                { label: t('history.detail.water'), value: selected.water ?? t('common.none') },
                {
                  label: t('history.detail.waterTemp'),
                  value: selected.water_temp_c == null ? t('common.na') : `${selected.water_temp_c}°C`
                },
                {
                  label: t('history.detail.grindMedianUm'),
                  value: selected.grind_median_um == null ? t('common.na') : `${selected.grind_median_um} μm`
                },
                { label: t('history.detail.recipe'), value: selected.recipe || t('common.none') },
                { label: t('history.detail.extractionNote'), value: selected.extraction_note || t('common.none') },
                { label: t('history.detail.tasteNote'), value: selected.taste_note || t('common.none') }
              ]
            }
          ],
          notes: [
            { label: t('history.detail.cupNotesSca'), value: selected.beans?.cup_flavor_notes ?? [], empty: t('common.none') },
            { label: t('history.detail.tasteNotesSca'), value: selected.taste_flavor_notes, empty: t('common.none') }
          ]
        },
        `brew-${new Date(selected.brew_date).toISOString().slice(0, 10)}.png`
      );
      setSavePngMsg(t('history.savePng.saved'));
    } catch (e) {
      setSavePngMsg(e instanceof Error ? `${t('history.savePng.failed')}: ${e.message}` : t('history.savePng.failed'));
    } finally {
      setSavePngBusy(false);
    }
  }

  // -----------------------------------------------------------------------
  // Delete brew
  // -----------------------------------------------------------------------

  async function deleteSelectedBrew() {
    if (!selected) return;
    if (!window.confirm(t('history.delete.confirm'))) return;
    setDeleteBusy(true);
    try {
      if (isGuest) {
        localDeleteBrew(selected.uid);
      } else {
        const supabase = getSupabaseClient();
        const { error: delErr } = await supabase.from('brews').delete().eq('uid', selected.uid);
        if (delErr) throw new Error(delErr.message);
      }
      setSelectedUid(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('history.delete.failed'));
    } finally {
      setDeleteBusy(false);
    }
  }

  // -----------------------------------------------------------------------
  // Effects
  // -----------------------------------------------------------------------

  useEffect(() => {
    void Promise.all([refresh(), refreshSavedBeans()]).catch((e) => {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid, isGuest]);

  useEffect(() => {
    setIsEditing(false);
    setEditDraft(null);
    setEditError(null);
    setShareMsg(null);
    setShareUrl(null);
    setSavePngMsg(null);
    setAiError(null);
    setAiGuidance(null);
    setAiCopiedMsg(null);
    setAiIsCached(false);
  }, [selectedUid]);

  useEffect(() => {
    if (!selected || !aiEnabled) {
      setAiGuidance(null);
      setAiIsCached(false);
      return;
    }
    const { signature } = buildAiRequestContext(selected);
    const cached = getCachedBrewGuidance(selected.uid, signature);
    setAiGuidance(cached);
    setAiIsCached(Boolean(cached));
  }, [selected, rows, lang, aiEnabled]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

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
            {t('history.filter.button')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
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
            <div className="text-sm font-medium text-gray-700">{t('history.filter.title')}</div>
            {activeFilterCount > 0 && (
              <button
                type="button"
                className="text-xs text-gray-500 hover:text-gray-800"
                onClick={() => setFilters(emptyFilters)}
              >
                {t('history.filter.clearAll')}
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
            {t('history.filter.showing', { shown: sortedRows.length, total: rows.length })}
          </div>
        </div>
      )}

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-gray-700 whitespace-nowrap">{t('history.list.title')}</div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 whitespace-nowrap">{t('history.sort.label')}</label>
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
            <div className="divide-y overflow-y-auto max-h-[560px]">
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
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                      active ? 'bg-amber-50 border-l-2 border-l-amber-600' : 'bg-white border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {fmtDate(r.brew_date)} — {beanLabel}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <div className="text-xs text-gray-500 truncate">
                        {t('history.list.summary', {
                          dose: r.coffee_dose_g ?? t('common.none'),
                          yield: r.coffee_yield_g ?? t('common.none'),
                          tds: r.coffee_tds ?? t('common.na')
                        })}
                      </div>
                      <div className="text-xs text-amber-700 font-medium whitespace-nowrap">
                        ★ {r.rating == null ? t('common.none') : Number(r.rating).toFixed(1)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 text-sm font-medium text-gray-700 flex items-center justify-between gap-3">
            <span>{t('history.detail.title')}</span>
            {selected && !isEditing && aiEnabled && (
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border bg-white text-xs hover:bg-gray-50 disabled:bg-gray-100 whitespace-nowrap"
                onClick={() => void requestAiForSelected()}
                disabled={aiLoading}
              >
                {aiLoading ? t('history.ai.loading') : t('history.ai.button')}
              </button>
            )}
          </div>
          {!selected ? (
            <div className="p-4 text-sm text-gray-500">{t('history.selectPrompt')}</div>
          ) : (
            <div className="p-4 space-y-3 text-sm">
              <div className="flex items-center justify-end gap-2 flex-wrap">
                {!isEditing ? (
                  <>
                    {/* Share brew — Supabase only */}
                    {!isGuest && (
                      <button
                        type="button"
                        className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 disabled:bg-gray-100 whitespace-nowrap"
                        onClick={shareSelectedBrew}
                        disabled={shareBusy}
                      >
                        {shareBusy ? t('history.share.creating') : t('history.share.button')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 disabled:bg-gray-100 whitespace-nowrap"
                      onClick={saveSelectedAsPng}
                      disabled={savePngBusy}
                    >
                      {savePngBusy ? t('history.savePng.saving') : t('history.savePng.button')}
                    </button>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 whitespace-nowrap"
                      onClick={() =>
                        navigate(
                          `/?bean=${encodeURIComponent(selected.bean_uid)}&duplicateBrew=${encodeURIComponent(selected.uid)}`,
                        )
                      }
                    >
                      {t('history.duplicate.button')}
                    </button>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg bg-amber-700 text-white text-sm hover:bg-amber-800 whitespace-nowrap"
                      onClick={() => {
                        setEditDraft(draftFromBrew(selected));
                        setIsEditing(true);
                        setEditError(null);
                      }}
                    >
                      {t('history.edit.start')}
                    </button>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50 disabled:bg-gray-100 whitespace-nowrap"
                      onClick={deleteSelectedBrew}
                      disabled={deleteBusy}
                    >
                      {deleteBusy ? t('history.delete.deleting') : t('history.delete.button')}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 disabled:bg-gray-100 whitespace-nowrap"
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
                      className="px-3 py-2 rounded-lg bg-amber-700 text-white text-sm disabled:bg-gray-300 whitespace-nowrap"
                      onClick={saveEditedBrew}
                      disabled={editSaving || !editDraft}
                    >
                      {editSaving ? t('history.edit.saving') : t('history.edit.save')}
                    </button>
                  </>
                )}
              </div>
              {shareMsg && !isEditing && (
                <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2">{shareMsg}</div>
              )}
              {savePngMsg && !isEditing && (
                <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2">{savePngMsg}</div>
              )}
              {shareUrl && !isEditing && (
                <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-2 break-all">
                  {t('history.share.linkLabel')}: {shareUrl}
                </div>
              )}

              {!isEditing && (aiError || aiGuidance) && (
                <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                  {aiError && (
                    <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{aiError}</div>
                  )}
                  {aiGuidance && (
                    <div className="space-y-2">
                      {aiIsCached && (
                        <div className="text-[11px] text-gray-500">
                          {t('history.ai.cached')}
                        </div>
                      )}
                      {aiGuidance.summary && (
                        <div>
                          <div className="text-xs font-semibold text-gray-700">{t('history.ai.summary')}</div>
                          <div className="text-xs text-gray-800 whitespace-pre-wrap">{aiGuidance.summary}</div>
                        </div>
                      )}
                      {aiGuidance.diagnosis && (
                        <div>
                          <div className="text-xs font-semibold text-gray-700">{t('history.ai.diagnosis')}</div>
                          <div className="text-xs text-gray-800 whitespace-pre-wrap">{aiGuidance.diagnosis}</div>
                        </div>
                      )}
                      {aiGuidance.suggestions.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-gray-700">{t('history.ai.suggestions')}</div>
                          <ul className="list-disc pl-4 space-y-1">
                            {aiGuidance.suggestions.map((s, idx) => (
                              <li key={`${s.title}-${idx}`} className="text-xs text-gray-800">
                                <span className="font-semibold">{s.title}</span>
                                {s.details && <span className="ml-1">{s.details}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {aiGuidance.targets && (aiGuidance.targets.ratio || aiGuidance.targets.water_temp || aiGuidance.targets.brew_time) && (
                        <div>
                          <div className="text-xs font-semibold text-gray-700">{t('history.ai.targets')}</div>
                          <div className="text-xs text-gray-800 space-y-0.5">
                            {aiGuidance.targets.ratio && (
                              <div>
                                {t('history.ai.targets.ratio')}: {aiGuidance.targets.ratio}
                              </div>
                            )}
                            {aiGuidance.targets.water_temp && (
                              <div>
                                {t('history.ai.targets.waterTemp')}: {aiGuidance.targets.water_temp}
                              </div>
                            )}
                            {aiGuidance.targets.brew_time && (
                              <div>
                                {t('history.ai.targets.brewTime')}: {aiGuidance.targets.brew_time}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg border bg-white text-xs hover:bg-gray-50 whitespace-nowrap"
                          onClick={async () => {
                            if (!aiGuidance) return;
                            const parts: string[] = [];
                            if (aiGuidance.summary) parts.push(`${t('history.ai.summary')}: ${aiGuidance.summary}`);
                            if (aiGuidance.diagnosis) parts.push(`${t('history.ai.diagnosis')}: ${aiGuidance.diagnosis}`);
                            if (aiGuidance.suggestions.length > 0) {
                              parts.push(
                                `${t('history.ai.suggestions')}:\n` +
                                  aiGuidance.suggestions
                                    .map((s, idx) => `${idx + 1}. ${s.title}${s.details ? ` — ${s.details}` : ''}`)
                                    .join('\n'),
                              );
                            }
                            if (aiGuidance.targets && (aiGuidance.targets.ratio || aiGuidance.targets.water_temp || aiGuidance.targets.brew_time)) {
                              const tLines: string[] = [];
                              if (aiGuidance.targets.ratio) {
                                tLines.push(`${t('history.ai.targets.ratio')}: ${aiGuidance.targets.ratio}`);
                              }
                              if (aiGuidance.targets.water_temp) {
                                tLines.push(`${t('history.ai.targets.waterTemp')}: ${aiGuidance.targets.water_temp}`);
                              }
                              if (aiGuidance.targets.brew_time) {
                                tLines.push(`${t('history.ai.targets.brewTime')}: ${aiGuidance.targets.brew_time}`);
                              }
                              parts.push(`${t('history.ai.targets')}:\n${tLines.join('\n')}`);
                            }
                            try {
                              await navigator.clipboard.writeText(parts.join('\n\n'));
                              setAiCopiedMsg(t('history.ai.copied'));
                            } catch {
                              // ignore
                            }
                          }}
                        >
                          {t('history.ai.copy')}
                        </button>
                        {aiCopiedMsg && <span className="text-[11px] text-gray-500">{aiCopiedMsg}</span>}
                      </div>
                    </div>
                  )}
                </div>
              )}

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
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-gray-500">{t('history.detail.date')}</div>
                      <div className="font-medium text-gray-900">{fmtDate(selected.brew_date)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">{t('history.detail.bean')}</div>
                      <div className="font-medium text-gray-900">{selected.beans?.bean_name || t('common.none')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">{t('bean.field.roastery')}</div>
                      <div className="font-medium text-gray-900">{selected.beans?.roastery || t('common.none')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">{t('bean.field.producer')}</div>
                      <div className="font-medium text-gray-900">{selected.beans?.producer || t('common.none')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">{t('bean.field.originLocation')}</div>
                      <div className="font-medium text-gray-900">{selected.beans?.origin_location || t('common.none')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">{t('bean.field.originCountry')}</div>
                      <div className="font-medium text-gray-900">{selected.beans?.origin_country || t('common.none')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">{t('bean.field.process')}</div>
                      <div className="font-medium text-gray-900">{selected.beans?.process || t('common.none')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">{t('bean.field.varietal')}</div>
                      <div className="font-medium text-gray-900">{selected.beans?.varietal || t('common.none')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">{t('bean.field.roastedOn')}</div>
                      <div className="font-medium text-gray-900">
                        {selected.beans?.roasted_on ? fmtDate(selected.beans.roasted_on) : t('common.none')}
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
          )}
        </div>
      </div>
    </div>
  );
}
