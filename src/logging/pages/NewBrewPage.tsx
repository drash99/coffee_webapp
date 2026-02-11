import { useMemo, useState } from 'react';
import type { AppUser } from '../../auth/types';
import { getSupabaseClient } from '../../config/supabase';
import { FlavorWheelPicker } from '../components/FlavorWheelPicker';
import { StarRating } from '../components/StarRating';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { useGrinderSuggestions } from '../hooks/useGrinderSuggestions';
import { useBeanSuggestions } from '../hooks/useBeanSuggestions';
import type { BeanInput, BrewInput, FlavorNote, GrinderInput } from '../types';
import { useI18n } from '../../i18n/I18nProvider';

type Props = {
  user: AppUser;
};

function toNullableNumber(input: string): number | null {
  const v = input.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function todayYMD(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function fToC(f: number): number {
  return ((f - 32) * 5) / 9;
}

export function NewBrewPage({ user }: Props) {
  const { t } = useI18n();
  const [bean, setBean] = useState<BeanInput>({
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
  });

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

  const { makers, modelsForMaker } = useGrinderSuggestions(user.uid);
  const { roasteries, countries, locationsForCountry, producersForLocation, varietals } = useBeanSuggestions(user.uid);

  const brewDateIso = useMemo(() => {
    try {
      return new Date(`${brew.brew_date}T00:00:00`).toISOString();
    } catch {
      return null;
    }
  }, [brew.brew_date]);

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

  async function submitParticleSize() {
    setMapMsg(null);
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

    setMapSaving(true);
    try {
      const supabase = getSupabaseClient();
      const grinder_uid = await getOrCreateGrinderUid(grinder.maker, grinder.model);
      const { error: insErr } = await supabase.from('grinder_particle_sizes').insert({
        uid: crypto.randomUUID(),
        user_uid: user.uid,
        grinder_uid,
        grinder_setting: setting,
        particle_median_um: median
      });
      if (insErr) throw new Error(insErr.message);
      setMapMsg(t('grindMap.saved'));
    } catch (e) {
      setMapMsg(e instanceof Error ? e.message : t('newBrew.error.saveFailed'));
    } finally {
      setMapSaving(false);
    }
  }

  async function searchParticleSizes() {
    setMapMsg(null);
    setSearchRows([]);
    setSearchLoading(true);
    try {
      const supabase = getSupabaseClient();
      const grinder_uid = await getOrCreateGrinderUid(grinder.maker, grinder.model);
      const { data, error: qErr } = await supabase
        .from('grinder_particle_sizes')
        .select('grinder_setting,particle_median_um')
        .eq('user_uid', user.uid)
        .eq('grinder_uid', grinder_uid);
      if (qErr) throw new Error(qErr.message);
      setSearchRows((data ?? []) as Array<{ grinder_setting: string; particle_median_um: number }>);
    } catch (e) {
      setMapMsg(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setSearchLoading(false);
    }
  }

  async function save() {
    setError(null);
    setOk(null);
    if (!brewDateIso) {
      setError(t('newBrew.error.invalidBrewDate'));
      return;
    }

    setSaving(true);
    try {
      const supabase = getSupabaseClient();

      const bean_uid = crypto.randomUUID();
      const brew_uid = crypto.randomUUID();

      const { error: beanErr } = await supabase.from('beans').insert({
        uid: bean_uid,
        user_uid: user.uid,
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
      });
      if (beanErr) throw new Error(beanErr.message);

      // Insert normalized bean flavor notes for efficient hierarchical filtering
      if (bean.cup_flavor_notes.length > 0) {
        const beanNoteRows = bean.cup_flavor_notes.map((n) => ({
          bean_uid,
          l1: n.path[0] ?? '',
          l2: n.path[1] ?? null,
          l3: n.path[2] ?? null,
          color: n.color
        }));
        const { error: bfnErr } = await supabase.from('bean_flavor_notes').insert(beanNoteRows);
        if (bfnErr) throw new Error(bfnErr.message);
      }

      const grinder_uid =
        grinder.maker.trim() && grinder.model.trim() ? await getOrCreateGrinderUid(grinder.maker, grinder.model) : null;

      const waterTempRaw = toNullableNumber(brew.water_temp);
      const water_temp_c =
        waterTempRaw == null ? null : waterTempUnit === 'F' ? Number(fToC(waterTempRaw).toFixed(2)) : waterTempRaw;

      const { error: brewErr } = await supabase.from('brews').insert({
        uid: brew_uid,
        user_uid: user.uid,
        brew_date: brewDateIso,
        bean_uid,
        grinder_uid,
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
      });
      if (brewErr) throw new Error(brewErr.message);

      // Insert normalized brew flavor notes for efficient hierarchical filtering
      if (brew.taste_flavor_notes.length > 0) {
        const brewNoteRows = brew.taste_flavor_notes.map((n) => ({
          brew_uid,
          l1: n.path[0] ?? '',
          l2: n.path[1] ?? null,
          l3: n.path[2] ?? null,
          color: n.color
        }));
        const { error: bfnErr } = await supabase.from('brew_flavor_notes').insert(brewNoteRows);
        if (bfnErr) throw new Error(bfnErr.message);
      }

      setOk(t('newBrew.saved'));
      // Keep brew date, clear the rest for convenience
      setBean({
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
      });
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
    } catch (e) {
      setError(e instanceof Error ? e.message : t('newBrew.error.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <h2 className="text-lg font-semibold">{t('newBrew.bean.title')}</h2>

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
            <div className="sm:col-span-2 flex items-end gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm disabled:bg-gray-300"
                onClick={submitParticleSize}
                disabled={mapSaving}
              >
                {mapSaving ? t('grindMap.save.saving') : t('grindMap.save')}
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 disabled:bg-gray-100"
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
          <textarea
            className="w-full p-2 border rounded-lg min-h-24"
            value={brew.recipe}
            onChange={(e) => setBrew({ ...brew, recipe: e.target.value })}
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
    </div>
  );
}


