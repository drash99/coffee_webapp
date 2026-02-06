import { useMemo, useState } from 'react';
import type { AppUser } from '../../auth/types';
import { getSupabaseClient } from '../../config/supabase';
import { FlavorWheelPicker } from '../components/FlavorWheelPicker';
import type { BeanInput, BrewInput, FlavorNote, GrinderInput } from '../types';

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
  const [bean, setBean] = useState<BeanInput>({
    bean_name: '',
    roastery: '',
    producer: '',
    origin: '',
    process: '',
    varietal: '',
    cup_notes: '',
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
    extraction_note: '',
    taste_note: '',
    cup_flavor_notes: [],
    taste_flavor_notes: []
  });

  const [waterTempUnit, setWaterTempUnit] = useState<'C' | 'F'>('C');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const brewDateIso = useMemo(() => {
    try {
      return new Date(`${brew.brew_date}T00:00:00`).toISOString();
    } catch {
      return null;
    }
  }, [brew.brew_date]);

  async function save() {
    setError(null);
    setOk(null);
    if (!brewDateIso) {
      setError('Please enter a valid brew date.');
      return;
    }

    setSaving(true);
    try {
      const supabase = getSupabaseClient();

      const bean_uid = crypto.randomUUID();
      const grinder_uid = crypto.randomUUID();
      const brew_uid = crypto.randomUUID();

      const { error: beanErr } = await supabase.from('beans').insert({
        uid: bean_uid,
        user_uid: user.uid,
        bean_name: bean.bean_name || null,
        roastery: bean.roastery || null,
        producer: bean.producer || null,
        origin: bean.origin || null,
        process: bean.process || null,
        varietal: bean.varietal || null,
        cup_notes: bean.cup_notes || null,
        roasted_on: bean.roasted_on || null
      });
      if (beanErr) throw new Error(beanErr.message);

      const { error: grinderErr } = await supabase.from('grinders').insert({
        uid: grinder_uid,
        user_uid: user.uid,
        maker: grinder.maker || null,
        model: grinder.model || null,
        setting: grinder.setting || null
      });
      if (grinderErr) throw new Error(grinderErr.message);

      const waterTempRaw = toNullableNumber(brew.water_temp);
      const water_temp_c =
        waterTempRaw == null ? null : waterTempUnit === 'F' ? Number(fToC(waterTempRaw).toFixed(2)) : waterTempRaw;

      const { error: brewErr } = await supabase.from('brews').insert({
        uid: brew_uid,
        user_uid: user.uid,
        brew_date: brewDateIso,
        bean_uid,
        grinder_uid,
        recipe: brew.recipe || null,
        coffee_dose_g: toNullableNumber(brew.coffee_dose_g),
        coffee_yield_g: toNullableNumber(brew.coffee_yield_g),
        coffee_tds: toNullableNumber(brew.coffee_tds),
        water: brew.water || null,
        water_temp_c,
        extraction_note: brew.extraction_note || null,
        taste_note: brew.taste_note || null,
        cup_flavor_notes: (brew.cup_flavor_notes as FlavorNote[]) || [],
        taste_flavor_notes: (brew.taste_flavor_notes as FlavorNote[]) || []
      });
      if (brewErr) throw new Error(brewErr.message);

      setOk('Saved!');
      // Keep brew date, clear the rest for convenience
      setBean({ bean_name: '', roastery: '', producer: '', origin: '', process: '', varietal: '', cup_notes: '', roasted_on: '' });
      setGrinder({ maker: '', model: '', setting: '' });
      setBrew((prev) => ({
        ...prev,
        recipe: '',
        coffee_dose_g: '',
        coffee_yield_g: '',
        coffee_tds: '',
        water: '',
        water_temp: '',
        extraction_note: '',
        taste_note: '',
        cup_flavor_notes: [],
        taste_flavor_notes: []
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <h2 className="text-lg font-semibold">Bean</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Bean name</label>
            <input
              className="w-full p-2 border rounded-lg"
              value={bean.bean_name}
              onChange={(e) => setBean({ ...bean, bean_name: e.target.value })}
              placeholder="e.g. Ethiopia Gedeb"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Roastery</label>
            <input className="w-full p-2 border rounded-lg" value={bean.roastery} onChange={(e) => setBean({ ...bean, roastery: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Producer</label>
            <input className="w-full p-2 border rounded-lg" value={bean.producer} onChange={(e) => setBean({ ...bean, producer: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Origin</label>
            <input className="w-full p-2 border rounded-lg" value={bean.origin} onChange={(e) => setBean({ ...bean, origin: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Process</label>
            <input className="w-full p-2 border rounded-lg" value={bean.process} onChange={(e) => setBean({ ...bean, process: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Varietal</label>
            <input className="w-full p-2 border rounded-lg" value={bean.varietal} onChange={(e) => setBean({ ...bean, varietal: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Roasted on</label>
            <input
              className="w-full p-2 border rounded-lg"
              type="date"
              value={bean.roasted_on}
              onChange={(e) => setBean({ ...bean, roasted_on: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Cup notes (free text)</label>
          <textarea
            className="w-full p-2 border rounded-lg min-h-20"
            value={bean.cup_notes}
            onChange={(e) => setBean({ ...bean, cup_notes: e.target.value })}
            placeholder="Anything you want to note about this bean"
          />
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <h2 className="text-lg font-semibold">Brew</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Log date</label>
            <input
              className="w-full p-2 border rounded-lg"
              type="date"
              value={brew.brew_date}
              onChange={(e) => setBrew({ ...brew, brew_date: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Water</label>
            <input className="w-full p-2 border rounded-lg" value={brew.water} onChange={(e) => setBrew({ ...brew, water: e.target.value })} placeholder="e.g. tap, filtered, TWW" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Grinder maker</label>
            <input
              className="w-full p-2 border rounded-lg"
              value={grinder.maker}
              onChange={(e) => setGrinder({ ...grinder, maker: e.target.value })}
              placeholder="e.g. Comandante"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Grinder model</label>
            <input
              className="w-full p-2 border rounded-lg"
              value={grinder.model}
              onChange={(e) => setGrinder({ ...grinder, model: e.target.value })}
              placeholder="e.g. C40 Mk4"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Grinder setting</label>
            <input
              className="w-full p-2 border rounded-lg"
              value={grinder.setting}
              onChange={(e) => setGrinder({ ...grinder, setting: e.target.value })}
              placeholder="e.g. 24 clicks"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Coffee dose (g)</label>
            <input
              className="w-full p-2 border rounded-lg"
              type="number"
              step="0.1"
              value={brew.coffee_dose_g}
              onChange={(e) => setBrew({ ...brew, coffee_dose_g: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Coffee yield (g)</label>
            <input
              className="w-full p-2 border rounded-lg"
              type="number"
              step="0.1"
              value={brew.coffee_yield_g}
              onChange={(e) => setBrew({ ...brew, coffee_yield_g: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Coffee TDS (%) (N/A allowed)</label>
            <input
              className="w-full p-2 border rounded-lg"
              type="number"
              step="0.01"
              value={brew.coffee_tds}
              onChange={(e) => setBrew({ ...brew, coffee_tds: e.target.value })}
              placeholder="leave empty if N/A"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Water temp (°{waterTempUnit}) (N/A allowed)
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 select-none">
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  checked={waterTempUnit === 'F'}
                  onChange={(e) => setWaterTempUnit(e.target.checked ? 'F' : 'C')}
                />
                °F
              </label>
            </div>
            <input
              className="w-full p-2 border rounded-lg"
              type="number"
              step="0.1"
              value={brew.water_temp}
              onChange={(e) => setBrew({ ...brew, water_temp: e.target.value })}
              placeholder="leave empty if N/A"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Recipe (plain text)</label>
          <textarea
            className="w-full p-2 border rounded-lg min-h-24"
            value={brew.recipe}
            onChange={(e) => setBrew({ ...brew, recipe: e.target.value })}
            placeholder="e.g. V60: 15g coffee, 250g water, 30s bloom, 2 pours…"
          />
        </div>

        <div className="grid grid-cols-1 gap-4">
          <FlavorWheelPicker
            label="Cup notes (SCA flavor wheel)"
            value={brew.cup_flavor_notes}
            onChange={(next) => setBrew({ ...brew, cup_flavor_notes: next })}
          />
          <FlavorWheelPicker
            label="Taste notes (SCA flavor wheel)"
            value={brew.taste_flavor_notes}
            onChange={(next) => setBrew({ ...brew, taste_flavor_notes: next })}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Extraction note</label>
            <textarea
              className="w-full p-2 border rounded-lg min-h-24"
              value={brew.extraction_note}
              onChange={(e) => setBrew({ ...brew, extraction_note: e.target.value })}
              placeholder="channeling? fast? slow? grind changes?"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Taste note (free text)</label>
            <textarea
              className="w-full p-2 border rounded-lg min-h-24"
              value={brew.taste_note}
              onChange={(e) => setBrew({ ...brew, taste_note: e.target.value })}
              placeholder="overall impression, aftertaste, sweetness, acidity…"
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
          {saving ? 'Saving…' : 'Save brew'}
        </button>
      </div>
    </div>
  );
}


