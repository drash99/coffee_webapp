import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppUser } from '../../auth/types';
import { getSupabaseClient } from '../../config/supabase';
import { FlavorWheelPicker } from '../components/FlavorWheelPicker';
import { StarRating } from '../components/StarRating';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { PhotoImportPanel } from '../components/PhotoImportPanel';
import { useGrinderSuggestions } from '../hooks/useGrinderSuggestions';
import { useBeanSuggestions } from '../hooks/useBeanSuggestions';
import { useRecipeSuggestions } from '../hooks/useRecipeSuggestions';
import { toNullableNumber, todayYMD, fToC, fmtDate } from '../utils/formatting';
import { unique } from '../utils/formatting';
import { beanDisplayLabel } from '../utils/beanLabel';
import { buildBeanImportPrompt, parseBeanImportJson } from '../utils/beanJsonImport';
import { fetchAllRows } from '../utils/pagination';
import { prepareGrinder, type PreparedGrinder } from '../utils/grinder';
import { getStorageErrorMessage } from '../utils/storageError';
import { saveCloudData, type BeanlogSaveData } from '../storage/cloudDb';
import { validateLocalData } from '../storage/localDataValidation';
import type { BeanInput, BeverageType, BrewInput, FlavorNote, GrinderInput } from '../types';
import { beverageTypeOf } from '../utils/beverage';
import { useI18n } from '../../i18n/I18nProvider';
import {
  localListBeans,
  localGetAllData,
  localSaveData,
  localSearchParticleSizes,
  localListGrinders,
  localListBrewsWithBeans,
} from '../storage';

type Props = {
  user: AppUser;
  isGuest?: boolean;
  initialBeanUid?: string;
  initialDuplicateBrewUid?: string;
  initialDoseG?: string;
};

type SavedBeanOption = {
  beverage_type?: BeverageType;
  uid: string;
  bean_name: string | null;
  roastery: string | null;
  producer: string | null;
  origin_location: string | null;
  origin_country: string | null;
  process: string | null;
  varietal: string | null;
  cup_notes: string | null;
  cup_flavor_notes: FlavorNote[] | null;
  roasted_on: string | null;
};

type BrewTemplateRow = {
  uid: string;
  bean_uid: string;
  brew_date: string;
  recipe: string | null;
  coffee_dose_g: number | null;
  coffee_yield_g: number | null;
  coffee_tds: number | null;
  water: string | null;
  water_temp_c: number | null;
  grind_median_um: number | null;
  rating: number | null;
  grinder_setting: string | null;
  extraction_note: string | null;
  taste_note: string | null;
  taste_flavor_notes: FlavorNote[] | null;
  beans: SavedBeanOption | null;
  grinders: {
    uid: string;
    maker: string | null;
    model: string | null;
  } | null;
};


const emptyBean: BeanInput = {
  bean_name: '',
  roastery: '',
  producer: '',
  origin_location: '',
  origin_country: '',
  process: '',
  varietal: '',
  cup_notes: '',
  cup_flavor_notes: [],
  roasted_on: ''
};

export function NewBrewPage({
  user,
  isGuest = false,
  initialBeanUid,
  initialDuplicateBrewUid,
  initialDoseG,
}: Props) {
  const { t } = useI18n();
  const [bean, setBean] = useState<BeanInput>(emptyBean);
  const [savedBeans, setSavedBeans] = useState<SavedBeanOption[]>([]);
  const [selectedBeanUid, setSelectedBeanUid] = useState('');
  const [beanSaving, setBeanSaving] = useState(false);
  const [beanMsg, setBeanMsg] = useState<string | null>(null);

  const [grinder, setGrinder] = useState<GrinderInput>({
    maker: '',
    model: '',
    setting: ''
  });

  const [brew, setBrew] = useState<BrewInput>({
    brew_date: todayYMD(),
    recipe: '',
    coffee_dose_g: '',
    coffee_yield_g: '',
    coffee_tds: '',
    water: '',
    water_temp: '',
    grind_median_um: '',
    rating: 0,
    extraction_note: '',
    taste_note: '',
    taste_flavor_notes: []
  });

  const [waterTempUnit, setWaterTempUnit] = useState<'C' | 'F'>('C');

  const [mapMedianUm, setMapMedianUm] = useState('');
  const [mapSaving, setMapSaving] = useState(false);
  const [mapMsg, setMapMsg] = useState<string | null>(null);

  const [searchLoading, setSearchLoading] = useState(false);
  const [searchRows, setSearchRows] = useState<Array<{ grinder_setting: string; particle_median_um: number }>>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [presetMsg, setPresetMsg] = useState<string | null>(null);
  const [recentBeanBrew, setRecentBeanBrew] = useState<BrewTemplateRow | null>(null);
  const [recentBrewLoading, setRecentBrewLoading] = useState(false);
  const [recipeSuggestionsRefreshKey, setRecipeSuggestionsRefreshKey] = useState(0);
  const appliedInitialBeanUidRef = useRef<string | null>(null);
  const appliedInitialDoseRef = useRef<string | null>(null);
  const appliedDuplicateBrewUidRef = useRef<string | null>(null);
  const draftBeanUidRef = useRef<string | null>(null);
  const draftBrewUidRef = useRef<string | null>(null);
  const draftBrewGrinderRef = useRef<PreparedGrinder | null>(null);
  const draftParticleUidRef = useRef<string | null>(null);
  const draftParticleGrinderRef = useRef<PreparedGrinder | null>(null);
  const saveInFlightRef = useRef(false);

  // --- Suggestions: hooks for Supabase, inline derivation for guest ---
  const hookBeanSugg = useBeanSuggestions(isGuest ? undefined : user.uid, recipeSuggestionsRefreshKey);
  const hookGrinderSugg = useGrinderSuggestions(isGuest ? undefined : user.uid, recipeSuggestionsRefreshKey);
  const hookRecipeSugg = useRecipeSuggestions(isGuest ? undefined : user.uid, recipeSuggestionsRefreshKey);

  function applySavedBeanDetails(source: SavedBeanOption) {
    draftBeanUidRef.current = null;
    setSelectedBeanUid(source.uid);
    setBean({
      bean_name: source.bean_name ?? '',
      roastery: source.roastery ?? '',
      producer: source.producer ?? '',
      origin_location: source.origin_location ?? '',
      origin_country: source.origin_country ?? '',
      process: source.process ?? '',
      varietal: source.varietal ?? '',
      cup_notes: source.cup_notes ?? '',
      cup_flavor_notes: (source.cup_flavor_notes ?? []) as FlavorNote[],
      roasted_on: source.roasted_on ?? '',
    });
  }

  function grinderLabelForPreset(row: BrewTemplateRow): string {
    return `${row.grinders?.maker || t('common.none')}${row.grinders?.model ? ` ${row.grinders.model}` : ''}${row.grinder_setting ? ` · ${row.grinder_setting}` : ''}`;
  }

  function applyBrewTemplate(
    row: BrewTemplateRow,
    options: {
      message: string;
      overrideDoseG?: string | null;
    },
  ) {
    if (selectedBeanUid !== row.bean_uid) {
      const currentBean = savedBeans.find((saved) => saved.uid === row.bean_uid) ?? row.beans;
      if (currentBean) applySavedBeanDetails(currentBean);
      else setSelectedBeanUid(row.bean_uid);
    }
    setGrinder({
      maker: row.grinders?.maker ?? '',
      model: row.grinders?.model ?? '',
      setting: row.grinder_setting ?? '',
    });
    setWaterTempUnit('C');
    setBrew({
      brew_date: todayYMD(),
      recipe: row.recipe ?? '',
      coffee_dose_g: options.overrideDoseG ?? (row.coffee_dose_g == null ? '' : String(row.coffee_dose_g)),
      coffee_yield_g: row.coffee_yield_g == null ? '' : String(row.coffee_yield_g),
      coffee_tds: row.coffee_tds == null ? '' : String(row.coffee_tds),
      water: row.water ?? '',
      water_temp: row.water_temp_c == null ? '' : String(row.water_temp_c),
      grind_median_um: row.grind_median_um == null ? '' : String(row.grind_median_um),
      rating: row.rating == null ? 0 : Number(row.rating),
      extraction_note: row.extraction_note ?? '',
      taste_note: row.taste_note ?? '',
      taste_flavor_notes: (row.taste_flavor_notes ?? []) as FlavorNote[],
    });
    setPresetMsg(options.message);
  }

  // Guest mode: derive suggestions from locally loaded data
  const guestBeanSugg = useMemo(() => {
    if (!isGuest) return null;
    const beans = savedBeans;
    return {
      roasteries: unique(beans.map((b) => (b.roastery ?? '').trim())),
      countries: unique(beans.map((b) => (b.origin_country ?? '').trim())),
      varietals: unique(beans.map((b) => (b.varietal ?? '').trim())),
      locationsForCountry(country: string) {
        const lc = country.toLowerCase().trim();
        if (!lc) return unique(beans.map((b) => (b.origin_location ?? '').trim()));
        return unique(beans.filter((b) => (b.origin_country ?? '').toLowerCase().trim() === lc).map((b) => (b.origin_location ?? '').trim()));
      },
      producersForLocation(country: string, location: string) {
        const lcC = country.toLowerCase().trim();
        const lcL = location.toLowerCase().trim();
        let filtered = beans.map((b) => ({
          origin_country: (b.origin_country ?? '').trim(),
          origin_location: (b.origin_location ?? '').trim(),
          producer: (b.producer ?? '').trim(),
        }));
        if (lcC) filtered = filtered.filter((b) => b.origin_country.toLowerCase() === lcC);
        if (lcL) filtered = filtered.filter((b) => b.origin_location.toLowerCase() === lcL);
        return unique(filtered.map((b) => b.producer));
      },
    };
  }, [isGuest, savedBeans]);

  const guestSuggestions = useMemo(() => {
    try {
      if (isGuest) validateLocalData(localGetAllData(), { allowOrphanLabels: true });
      return {
        grinders: isGuest ? localListGrinders() : [],
        recipes: isGuest ? unique(localListBrewsWithBeans().filter(row => beverageTypeOf(row.beans) === 'coffee')
          .map((row) => (row.recipe ?? '').trim())) : [],
        error: null,
      };
    } catch (error) {
      return { grinders: [], recipes: [], error };
    }
  }, [isGuest, recipeSuggestionsRefreshKey]);

  const guestGrinderSugg = useMemo(() => {
    if (!isGuest) return null;
    const grinders = guestSuggestions.grinders;
    const makers = Array.from(new Map(grinders.map((g) => [(g.maker ?? '').toLowerCase(), g.maker ?? ''])).values())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return {
      makers,
      modelsForMaker(maker: string) {
        const lc = maker.toLowerCase().trim();
        const models = grinders
          .filter((g) => (g.maker ?? '').toLowerCase().trim() === lc)
          .map((g) => g.model ?? '');
        return Array.from(new Map(models.map((m) => [m.toLowerCase(), m])).values())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      },
    };
  }, [isGuest, guestSuggestions]);

  // Unified suggestion accessors
  const roasteries = isGuest ? (guestBeanSugg?.roasteries ?? []) : hookBeanSugg.roasteries;
  const countries = isGuest ? (guestBeanSugg?.countries ?? []) : hookBeanSugg.countries;
  const varietals = isGuest ? (guestBeanSugg?.varietals ?? []) : hookBeanSugg.varietals;
  const locationsForCountry = isGuest
    ? (c: string) => guestBeanSugg?.locationsForCountry(c) ?? []
    : hookBeanSugg.locationsForCountry;
  const producersForLocation = isGuest
    ? (c: string, l: string) => guestBeanSugg?.producersForLocation(c, l) ?? []
    : hookBeanSugg.producersForLocation;
  const makers = isGuest ? (guestGrinderSugg?.makers ?? []) : hookGrinderSugg.makers;
  const modelsForMaker = isGuest
    ? (m: string) => guestGrinderSugg?.modelsForMaker(m) ?? []
    : hookGrinderSugg.modelsForMaker;
  const recipeSuggestions = isGuest ? guestSuggestions.recipes : hookRecipeSugg.recipes;
  const beanImportPrompt = useMemo(() => buildBeanImportPrompt(savedBeans), [savedBeans]);

  const brewDateIso = useMemo(() => {
    try {
      return new Date(`${brew.brew_date}T00:00:00`).toISOString();
    } catch {
      return null;
    }
  }, [brew.brew_date]);

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  async function loadSavedBeans() {
    if (isGuest) {
      validateLocalData(localGetAllData(), { allowOrphanLabels: true });
      setSavedBeans(localListBeans().filter(row => beverageTypeOf(row) === 'coffee'));
      return;
    }
    const supabase = getSupabaseClient();
    const data = await fetchAllRows<SavedBeanOption>(() => supabase
      .from('beans')
      .select('*')
      .order('created_at', { ascending: false })
      .order('uid'));
    setSavedBeans(data.filter(row => beverageTypeOf(row) === 'coffee'));
  }

  async function loadRecentBrewForBean(beanUid: string): Promise<BrewTemplateRow | null> {
    if (!beanUid) return null;

    if (isGuest) {
      return (localListBrewsWithBeans().find((brew) => brew.bean_uid === beanUid) as BrewTemplateRow | undefined) ?? null;
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('brews')
      .select(
        `
        uid,
        bean_uid,
        brew_date,
        recipe,
        coffee_dose_g,
        coffee_yield_g,
        coffee_tds,
        water,
        water_temp_c,
        grind_median_um,
        rating,
        grinder_setting,
        extraction_note,
        taste_note,
        taste_flavor_notes,
        beans ( uid, bean_name, roastery, producer, origin_location, origin_country, process, varietal, cup_notes, cup_flavor_notes, roasted_on ),
        grinders ( uid, maker, model )
      `,
      )
      .eq('bean_uid', beanUid)
      .order('brew_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('uid', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as BrewTemplateRow | null) ?? null;
  }

  async function loadDuplicateBrew(uid: string): Promise<BrewTemplateRow | null> {
    if (!uid) return null;

    if (isGuest) {
      return (localListBrewsWithBeans().find(brew => brew.uid === uid && beverageTypeOf(brew.beans) === 'coffee') as BrewTemplateRow | undefined) ?? null;
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('brews')
      .select(
        `
        uid,
        bean_uid,
        brew_date,
        recipe,
        coffee_dose_g,
        coffee_yield_g,
        coffee_tds,
        water,
        water_temp_c,
        grind_median_um,
        rating,
        grinder_setting,
        extraction_note,
        taste_note,
        taste_flavor_notes,
        beans ( * ),
        grinders ( uid, maker, model )
      `,
      )
      .eq('uid', uid)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as BrewTemplateRow | null;
    return row && beverageTypeOf(row.beans) === 'coffee' ? row : null;
  }

  useEffect(() => {
    void loadSavedBeans().catch((e) => {
      setBeanMsg(getStorageErrorMessage(e, t('common.loadFailed'), t));
    });
  }, [user.uid, isGuest]);

  useEffect(() => {
    const uid = (initialBeanUid ?? '').trim();
    if (!uid || appliedInitialBeanUidRef.current === uid) return;
    const found = savedBeans.find((b) => b.uid === uid);
    if (!found) return;
    applySavedBeanDetails(found);
    appliedInitialBeanUidRef.current = uid;
  }, [initialBeanUid, savedBeans]);

  useEffect(() => {
    const duplicateUid = (initialDuplicateBrewUid ?? '').trim();
    if (!duplicateUid || appliedDuplicateBrewUidRef.current === duplicateUid) return;
    let active = true;

    void loadDuplicateBrew(duplicateUid)
      .then((row) => {
        if (!active || !row) return;
        applyBrewTemplate(row, { message: t('newBrew.preset.appliedFromHistory') });
        appliedDuplicateBrewUidRef.current = duplicateUid;
      })
      .catch((e) => {
        if (!active) return;
        setError(getStorageErrorMessage(e, t('common.loadFailed'), t));
      });

    return () => {
      active = false;
    };
  }, [initialDuplicateBrewUid, isGuest, t]);

  useEffect(() => {
    const dose = (initialDoseG ?? '').trim();
    if (!dose || appliedInitialDoseRef.current === dose) return;
    setBrew((prev) => ({ ...prev, coffee_dose_g: dose }));
    setPresetMsg(t('newBrew.preset.appliedDoseFromLabel', { grams: dose }));
    appliedInitialDoseRef.current = dose;
  }, [initialDoseG, t]);

  useEffect(() => {
    if (!selectedBeanUid) {
      setRecentBeanBrew(null);
      setRecentBrewLoading(false);
      return;
    }

    let active = true;
    setRecentBrewLoading(true);
    void loadRecentBrewForBean(selectedBeanUid)
      .then((row) => {
        if (!active) return;
        setRecentBeanBrew(row);
      })
      .catch((e) => {
        if (!active) return;
        setError(getStorageErrorMessage(e, t('common.loadFailed'), t));
      })
      .finally(() => {
        if (active) setRecentBrewLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedBeanUid, isGuest, t, recipeSuggestionsRefreshKey]);

  // -----------------------------------------------------------------------
  // Grinder helpers
  // -----------------------------------------------------------------------

  async function persist(data: BeanlogSaveData) {
    if (isGuest) localSaveData(data);
    else await saveCloudData(data);
  }

  // -----------------------------------------------------------------------
  // Particle size
  // -----------------------------------------------------------------------

  async function submitParticleSize() {
    if (saveInFlightRef.current) return;
    setMapMsg(null);
    if (!grinder.maker.trim() || !grinder.model.trim()) {
      setMapMsg(t('grindMap.error.missingGrinder'));
      return;
    }
    const setting = grinder.setting.trim();
    if (!setting) {
      setMapMsg(t('grindMap.error.missingSetting'));
      return;
    }
    const median = toNullableNumber(mapMedianUm);
    if (median == null) {
      setMapMsg(t('grindMap.error.missingMedian'));
      return;
    }

    saveInFlightRef.current = true;
    setMapSaving(true);
    try {
      draftParticleUidRef.current ??= crypto.randomUUID();
      const prepared = await prepareGrinder(grinder.maker, grinder.model, isGuest, draftParticleGrinderRef.current);
      draftParticleGrinderRef.current = prepared;
      await persist({
        grinders: [prepared],
        particleSizes: [{
          uid: draftParticleUidRef.current,
          grinder_uid: prepared.uid,
          grinder_setting: setting,
          particle_median_um: median,
        }],
      });
      draftParticleUidRef.current = null;
      draftParticleGrinderRef.current = null;
      setRecipeSuggestionsRefreshKey((key) => key + 1);
      setMapMsg(t('grindMap.saved'));
    } catch (e) {
      setMapMsg(getStorageErrorMessage(e, t('newBrew.error.saveFailed'), t));
    } finally {
      saveInFlightRef.current = false;
      setMapSaving(false);
    }
  }

  // -----------------------------------------------------------------------
  function beanPayload() {
    return {
      ...(isGuest ? { beverage_type: 'coffee' as const } : {}),
      bean_name: bean.bean_name || null,
      roastery: bean.roastery || null,
      producer: bean.producer || null,
      origin_location: bean.origin_location || null,
      origin_country: bean.origin_country || null,
      process: bean.process || null,
      varietal: bean.varietal || null,
      cup_notes: bean.cup_notes || null,
      cup_flavor_notes: (bean.cup_flavor_notes as FlavorNote[]) || [],
      roasted_on: bean.roasted_on || null
    };
  }

  function applyBeanImport(raw: string) {
    const nextBean = parseBeanImportJson(raw);
    draftBeanUidRef.current = null;
    setBean(nextBean);
    setSelectedBeanUid('');
    setPresetMsg(null);
    setBeanMsg(null);
  }

  // -----------------------------------------------------------------------
  // Resolve bean UID for brew save
  // -----------------------------------------------------------------------

  function resolveBeanUid(): string {
    if (selectedBeanUid) return selectedBeanUid;
    draftBeanUidRef.current ??= crypto.randomUUID();
    return draftBeanUidRef.current;
  }

  // -----------------------------------------------------------------------
  // Save bean only
  // -----------------------------------------------------------------------

  async function saveBeanOnly() {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setBeanMsg(null);
    setBeanSaving(true);
    try {
      const beanUid = resolveBeanUid();
      await persist({ beans: [{ uid: beanUid, ...beanPayload() }] });
      setSelectedBeanUid(beanUid);
      setBeanMsg(t('newBrew.bean.saved'));
      setRecipeSuggestionsRefreshKey((key) => key + 1);
      await loadSavedBeans().catch(() => setBeanMsg(t('newBrew.savedRefreshFailed')));
    } catch (e) {
      setBeanMsg(getStorageErrorMessage(e, t('newBrew.error.saveFailed'), t));
    } finally {
      saveInFlightRef.current = false;
      setBeanSaving(false);
    }
  }

  // -----------------------------------------------------------------------
  // Search particle sizes
  // -----------------------------------------------------------------------

  async function searchParticleSizes() {
    setMapMsg(null);
    setSearchRows([]);
    setSearchLoading(true);
    try {
      if (!grinder.maker.trim() || !grinder.model.trim()) throw new Error(t('grindMap.error.missingGrinder'));
      const { uid: grinder_uid } = await prepareGrinder(grinder.maker, grinder.model, isGuest);

      if (isGuest) {
        setSearchRows(localSearchParticleSizes(grinder_uid));
      } else {
        const supabase = getSupabaseClient();
        const { data, error: qErr } = await supabase
          .from('grinder_particle_sizes')
          .select('grinder_setting,particle_median_um')
          .eq('grinder_uid', grinder_uid);
        if (qErr) throw new Error(qErr.message);
        setSearchRows((data ?? []) as Array<{ grinder_setting: string; particle_median_um: number }>);
      }
    } catch (e) {
      setMapMsg(getStorageErrorMessage(e, t('common.loadFailed'), t));
    } finally {
      setSearchLoading(false);
    }
  }

  // -----------------------------------------------------------------------
  // Save full brew
  // -----------------------------------------------------------------------

  async function save() {
    if (saveInFlightRef.current) return;
    setError(null);
    setOk(null);
    if (!brewDateIso) {
      setError(t('newBrew.error.invalidBrewDate'));
      return;
    }

    saveInFlightRef.current = true;
    setSaving(true);
    try {
      const bean_uid = resolveBeanUid();
      // Keep IDs across failures, including a lost response after the server committed.
      draftBrewUidRef.current ??= crypto.randomUUID();
      const brew_uid = draftBrewUidRef.current;

      const prepared = grinder.maker.trim() && grinder.model.trim()
        ? await prepareGrinder(grinder.maker, grinder.model, isGuest, draftBrewGrinderRef.current)
        : null;
      draftBrewGrinderRef.current = prepared;

      const waterTempRaw = toNullableNumber(brew.water_temp);
      const water_temp_c =
        waterTempRaw == null ? null : waterTempUnit === 'F' ? Number(fToC(waterTempRaw).toFixed(2)) : waterTempRaw;

      const brewRow = {
        uid: brew_uid,
        brew_date: brewDateIso,
        bean_uid,
        grinder_uid: prepared?.uid ?? null,
        grinder_setting: grinder.setting || null,
        recipe: brew.recipe || null,
        coffee_dose_g: toNullableNumber(brew.coffee_dose_g),
        coffee_yield_g: toNullableNumber(brew.coffee_yield_g),
        coffee_tds: toNullableNumber(brew.coffee_tds),
        water: brew.water || null,
        water_temp_c,
        grind_median_um: toNullableNumber(brew.grind_median_um),
        rating: brew.rating > 0 ? brew.rating : null,
        extraction_note: brew.extraction_note || null,
        taste_note: brew.taste_note || null,
        taste_flavor_notes: (brew.taste_flavor_notes as FlavorNote[]) || []
      };

      await persist({
        beans: [{ uid: bean_uid, ...beanPayload() }],
        grinders: prepared ? [prepared] : [],
        brews: [brewRow],
      });

      draftBrewUidRef.current = null;
      draftBrewGrinderRef.current = null;
      draftBeanUidRef.current = null;
      setOk(t('newBrew.saved'));
      setRecipeSuggestionsRefreshKey((v) => v + 1);
      // Keep brew date and selected bean, clear brew-centric fields for convenience
      if (!selectedBeanUid) {
        setBean(emptyBean);
      }
      setGrinder({ maker: '', model: '', setting: '' });
      setBrew((prev) => ({
        ...prev,
        recipe: '',
        coffee_dose_g: '',
        coffee_yield_g: '',
        coffee_tds: '',
        water: '',
        water_temp: '',
        grind_median_um: '',
        rating: 0,
        extraction_note: '',
        taste_note: '',
        taste_flavor_notes: []
      }));
      setMapMedianUm('');
      setSearchRows([]);
      await loadSavedBeans().catch(() => setError(t('newBrew.savedRefreshFailed')));
    } catch (e) {
      setError(getStorageErrorMessage(e, t('newBrew.error.saveFailed'), t));
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }

  return (
    <fieldset className="space-y-6 min-w-0" disabled={saving || beanSaving || mapSaving}>
      {guestSuggestions.error != null && (
        <p role="alert" className="text-sm text-red-700 border border-red-200 rounded-lg p-3">
          {getStorageErrorMessage(guestSuggestions.error, t('common.loadFailed'), t)}
        </p>
      )}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <h2 className="text-lg font-semibold">{t('newBrew.bean.title')}</h2>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('newBrew.bean.savedList')}</label>
            <select
              className="w-full p-2 border rounded-lg bg-white"
              value={selectedBeanUid}
              onChange={(e) => {
                const nextUid = e.target.value;
                setSelectedBeanUid(nextUid);
                setBeanMsg(null);
                setPresetMsg(null);
                if (!nextUid) {
                  draftBeanUidRef.current = null;
                  setBean(emptyBean);
                  return;
                }
                const found = savedBeans.find((b) => b.uid === nextUid);
                if (!found) return;
                applySavedBeanDetails(found);
              }}
            >
              <option value="">{t('newBrew.bean.savedList.none')}</option>
              {savedBeans.map((b) => (
                <option key={b.uid} value={b.uid}>
                  {beanDisplayLabel(b, t('history.bean.fallbackLabel'))}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 disabled:bg-gray-100 whitespace-nowrap"
            onClick={saveBeanOnly}
            disabled={beanSaving}
          >
            {beanSaving ? t('newBrew.bean.save.saving') : t('newBrew.bean.save')}
          </button>
        </div>
        {beanMsg && <div className="text-xs text-gray-600">{beanMsg}</div>}
        {(presetMsg || recentBrewLoading || recentBeanBrew) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-amber-900">{t('newBrew.preset.sectionTitle')}</div>
            {presetMsg && <div className="text-xs text-amber-800">{presetMsg}</div>}
            {recentBrewLoading ? (
              <div className="text-xs text-amber-800">{t('newBrew.preset.loading')}</div>
            ) : recentBeanBrew ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-amber-900">{t('newBrew.preset.lastBrew')}</div>
                  <div className="text-xs text-amber-800">
                    {t('newBrew.preset.summary', {
                      date: fmtDate(recentBeanBrew.brew_date),
                      dose: recentBeanBrew.coffee_dose_g ?? t('common.none'),
                      yield: recentBeanBrew.coffee_yield_g ?? t('common.none'),
                      grinder: grinderLabelForPreset(recentBeanBrew),
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-xs text-amber-900 hover:bg-amber-100 whitespace-nowrap"
                  onClick={() =>
                    applyBrewTemplate(recentBeanBrew, {
                      message: t('newBrew.preset.appliedFromBean'),
                      overrideDoseG: (initialDoseG ?? '').trim() || undefined,
                    })
                  }
                >
                  {t('newBrew.preset.applyLastBrew')}
                </button>
              </div>
            ) : null}
          </div>
        )}

        <PhotoImportPanel coffee prompt={beanImportPrompt} onImport={applyBeanImport} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.name')}</label>
            <input
              className="w-full p-2 border rounded-lg"
              value={bean.bean_name}
              onChange={(e) => setBean({ ...bean, bean_name: e.target.value })}
              placeholder={t('bean.placeholder.name')}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.roastery')}</label>
            <AutocompleteInput
              value={bean.roastery}
              onChange={(v) => setBean({ ...bean, roastery: v })}
              suggestions={roasteries}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.originCountry')}</label>
            <AutocompleteInput
              value={bean.origin_country}
              onChange={(v) => setBean({ ...bean, origin_country: v })}
              suggestions={countries}
              placeholder={t('bean.placeholder.originCountry')}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.originLocation')}</label>
            <AutocompleteInput
              value={bean.origin_location}
              onChange={(v) => setBean({ ...bean, origin_location: v })}
              suggestions={locationsForCountry(bean.origin_country)}
              placeholder={t('bean.placeholder.originLocation')}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.producer')}</label>
            <AutocompleteInput
              value={bean.producer}
              onChange={(v) => setBean({ ...bean, producer: v })}
              suggestions={producersForLocation(bean.origin_country, bean.origin_location)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.process')}</label>
            <input className="w-full p-2 border rounded-lg" value={bean.process} onChange={(e) => setBean({ ...bean, process: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.varietal')}</label>
            <AutocompleteInput
              value={bean.varietal}
              onChange={(v) => setBean({ ...bean, varietal: v })}
              suggestions={varietals}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.roastedOn')}</label>
            <input
              className="w-full p-2 border rounded-lg"
              type="date"
              value={bean.roasted_on}
              onChange={(e) => setBean({ ...bean, roasted_on: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.notesFreeText')}</label>
          <textarea
            className="w-full p-2 border rounded-lg min-h-20"
            value={bean.cup_notes}
            onChange={(e) => setBean({ ...bean, cup_notes: e.target.value })}
            placeholder={t('bean.placeholder.notesFreeText')}
          />
        </div>

        <div className="grid grid-cols-1 gap-4">
          <FlavorWheelPicker
            label={t('bean.field.cupNotesSca')}
            value={bean.cup_flavor_notes}
            onChange={(next) => setBean({ ...bean, cup_flavor_notes: next })}
          />
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <h2 className="text-lg font-semibold">{t('newBrew.brew.title')}</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('brew.field.rating')}</label>
            <div className="flex items-center gap-3">
              <StarRating value={brew.rating} onChange={(next) => setBrew({ ...brew, rating: next })} disabled={saving} />
              <div className="text-sm text-gray-600 tabular-nums">{brew.rating.toFixed(1)}</div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('brew.field.logDate')}</label>
            <input
              className="w-full p-2 border rounded-lg"
              type="date"
              value={brew.brew_date}
              onChange={(e) => setBrew({ ...brew, brew_date: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('brew.field.water')}</label>
            <input
              className="w-full p-2 border rounded-lg"
              value={brew.water}
              onChange={(e) => setBrew({ ...brew, water: e.target.value })}
              placeholder={t('brew.placeholder.water')}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('grinder.field.maker')}</label>
            <AutocompleteInput
              value={grinder.maker}
              onChange={(v) => setGrinder({ ...grinder, maker: v })}
              suggestions={makers}
              placeholder={t('grinder.placeholder.maker')}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('grinder.field.model')}</label>
            <AutocompleteInput
              value={grinder.model}
              onChange={(v) => setGrinder({ ...grinder, model: v })}
              suggestions={modelsForMaker(grinder.maker)}
              placeholder={t('grinder.placeholder.model')}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('grinder.field.setting')}</label>
            <input
              className="w-full p-2 border rounded-lg"
              value={grinder.setting}
              onChange={(e) => setGrinder({ ...grinder, setting: e.target.value })}
              placeholder={t('grinder.placeholder.setting')}
            />
          </div>

          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('grindMap.field.particleMedianUm')}</label>
              <input
                className="w-full p-2 border rounded-lg"
                type="number"
                step="1"
                value={mapMedianUm}
                onChange={(e) => setMapMedianUm(e.target.value)}
                placeholder={t('grindMap.placeholder.particleMedianUm')}
              />
            </div>
            <div className="sm:col-span-2 flex items-end gap-2 flex-wrap">
              <button
                type="button"
                className="px-3 py-2 rounded-lg bg-amber-700 text-white text-sm hover:bg-amber-800 disabled:bg-gray-300 whitespace-nowrap"
                onClick={submitParticleSize}
                disabled={mapSaving}
              >
                {mapSaving ? t('grindMap.save.saving') : t('grindMap.save')}
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 disabled:bg-gray-100 whitespace-nowrap"
                onClick={searchParticleSizes}
                disabled={searchLoading}
              >
                {searchLoading ? t('history.refresh.loading') : t('brew.grind.search')}
              </button>
            </div>
          </div>

          {(mapMsg || searchRows.length > 0) && (
            <div className="sm:col-span-2 space-y-2">
              {mapMsg && <div className="text-xs text-gray-600">{mapMsg}</div>}
              {searchRows.length === 0 ? (
                <div className="text-xs text-gray-500">{t('brew.grind.search.none')}</div>
              ) : (
                <div className="rounded-lg border bg-white">
                  <div className="px-3 py-2 text-xs font-medium text-gray-700 bg-gray-50 border-b">
                    {t('brew.grind.search.results')}
                  </div>
                  <div className="divide-y">
                    {searchRows.map((r, idx) => (
                      <div key={`${r.grinder_setting}-${idx}`} className="px-3 py-2 text-sm text-gray-800">
                        <span className="font-medium">{r.grinder_setting}</span> — {r.particle_median_um}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('brew.field.dose')}</label>
            <input
              className="w-full p-2 border rounded-lg"
              type="number"
              step="0.1"
              value={brew.coffee_dose_g}
              onChange={(e) => setBrew({ ...brew, coffee_dose_g: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('brew.field.yield')}</label>
            <input
              className="w-full p-2 border rounded-lg"
              type="number"
              step="0.1"
              value={brew.coffee_yield_g}
              onChange={(e) => setBrew({ ...brew, coffee_yield_g: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('brew.field.tds')}</label>
            <input
              className="w-full p-2 border rounded-lg"
              type="number"
              step="0.01"
              value={brew.coffee_tds}
              onChange={(e) => setBrew({ ...brew, coffee_tds: e.target.value })}
              placeholder={t('brew.placeholder.naAllowed')}
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('brew.field.waterTemp', { unit: waterTempUnit })}
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 select-none">
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  checked={waterTempUnit === 'F'}
                  onChange={(e) => setWaterTempUnit(e.target.checked ? 'F' : 'C')}
                />
                {t('brew.unit.f')}
              </label>
            </div>
            <input
              className="w-full p-2 border rounded-lg"
              type="number"
              step="0.1"
              value={brew.water_temp}
              onChange={(e) => setBrew({ ...brew, water_temp: e.target.value })}
              placeholder={t('brew.placeholder.naAllowed')}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('brew.field.grindMedianUm')}</label>
            <input
              className="w-full p-2 border rounded-lg"
              type="number"
              step="1"
              value={brew.grind_median_um}
              onChange={(e) => setBrew({ ...brew, grind_median_um: e.target.value })}
              placeholder={t('brew.placeholder.naAllowed')}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('brew.field.recipe')}</label>
          <AutocompleteInput
            multiline
            rows={4}
            className="min-h-24"
            value={brew.recipe}
            onChange={(v) => setBrew({ ...brew, recipe: v })}
            suggestions={recipeSuggestions}
            placeholder={t('brew.placeholder.recipe')}
          />
        </div>

        <div className="grid grid-cols-1 gap-4">
          <FlavorWheelPicker
            label={t('brew.field.tasteNotesSca')}
            value={brew.taste_flavor_notes}
            onChange={(next) => setBrew({ ...brew, taste_flavor_notes: next })}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('brew.field.extractionNote')}</label>
            <textarea
              className="w-full p-2 border rounded-lg min-h-24"
              value={brew.extraction_note}
              onChange={(e) => setBrew({ ...brew, extraction_note: e.target.value })}
              placeholder={t('brew.placeholder.extractionNote')}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('brew.field.tasteNoteFreeText')}</label>
            <textarea
              className="w-full p-2 border rounded-lg min-h-24"
              value={brew.taste_note}
              onChange={(e) => setBrew({ ...brew, taste_note: e.target.value })}
              placeholder={t('brew.placeholder.tasteNoteFreeText')}
            />
          </div>
        </div>

        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{error}</div>}
        {ok && <div className="text-sm text-green-800 bg-green-50 border border-green-100 rounded-lg p-2">{ok}</div>}

        <button
          type="button"
          className="w-full px-3 py-2 rounded-lg bg-amber-700 text-white text-sm disabled:bg-gray-300"
          onClick={save}
          disabled={saving}
        >
          {saving ? t('newBrew.save.saving') : t('newBrew.save')}
        </button>
      </div>
    </fieldset>
  );
}
