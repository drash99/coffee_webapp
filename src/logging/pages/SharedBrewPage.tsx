import { useEffect, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../../config/supabase';
import type { FlavorNote } from '../types';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadBrewAsPng } from '../utils/brewPng';

type Props = {
  token: string;
};

type SharedBrewRow = {
  brew_uid: string;
  brew_date: string;
  bean_name: string | null;
  roastery: string | null;
  producer: string | null;
  origin_location: string | null;
  origin_country: string | null;
  process: string | null;
  varietal: string | null;
  roasted_on: string | null;
  cup_flavor_notes: FlavorNote[] | null;
  grinder_maker: string | null;
  grinder_model: string | null;
  grinder_setting: string | null;
  recipe: string | null;
  coffee_dose_g: number | null;
  coffee_yield_g: number | null;
  coffee_tds: number | null;
  water: string | null;
  water_temp_c: number | null;
  grind_median_um: number | null;
  rating: number | null;
  extraction_note: string | null;
  taste_note: string | null;
  taste_flavor_notes: FlavorNote[] | null;
  shared_at: string;
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

export function SharedBrewPage({ token }: Props) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<SharedBrewRow | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  async function saveAsPng() {
    if (!row) return;
    setSaveBusy(true);
    setSaveMsg(null);
    try {
      await downloadBrewAsPng(
        {
          title: t('sharedBrew.title'),
          sharedAtLabel: t('sharedBrew.sharedAt', { date: fmtDate(row.shared_at) }),
          sections: [
            {
              rows: [
                { label: t('history.detail.date'), value: fmtDate(row.brew_date) },
                { label: t('history.detail.bean'), value: row.bean_name || t('common.none') },
                { label: t('bean.field.roastery'), value: row.roastery || t('common.none') },
                { label: t('bean.field.producer'), value: row.producer || t('common.none') },
                { label: t('bean.field.originLocation'), value: row.origin_location || t('common.none') },
                { label: t('bean.field.originCountry'), value: row.origin_country || t('common.none') },
                { label: t('bean.field.process'), value: row.process || t('common.none') },
                { label: t('bean.field.varietal'), value: row.varietal || t('common.none') },
                { label: t('bean.field.roastedOn'), value: row.roasted_on ? fmtDate(row.roasted_on) : t('common.none') },
                {
                  label: t('history.detail.grinder'),
                  value: `${row.grinder_maker || t('common.none')}${row.grinder_model ? ` ${row.grinder_model}` : ''}${row.grinder_setting ? ` — ${row.grinder_setting}` : ''}`
                },
                { label: t('history.detail.rating'), value: row.rating == null ? t('common.none') : Number(row.rating).toFixed(1) },
                {
                  label: t('history.detail.doseYield'),
                  value: `${row.coffee_dose_g ?? t('common.none')}g / ${row.coffee_yield_g ?? t('common.none')}g`
                },
                { label: t('history.detail.tds'), value: String(row.coffee_tds ?? t('common.na')) },
                { label: t('history.detail.water'), value: row.water ?? t('common.none') },
                { label: t('history.detail.waterTemp'), value: row.water_temp_c == null ? t('common.na') : `${row.water_temp_c}°C` },
                { label: t('history.detail.grindMedianUm'), value: row.grind_median_um == null ? t('common.na') : `${row.grind_median_um} μm` },
                { label: t('history.detail.recipe'), value: row.recipe || t('common.none') },
                { label: t('history.detail.extractionNote'), value: row.extraction_note || t('common.none') },
                { label: t('history.detail.tasteNote'), value: row.taste_note || t('common.none') }
              ]
            }
          ],
          notes: [
            { label: t('history.detail.cupNotesSca'), value: row.cup_flavor_notes ?? [], empty: t('common.none') },
            { label: t('history.detail.tasteNotesSca'), value: row.taste_flavor_notes, empty: t('common.none') }
          ]
        },
        `shared-brew-${new Date(row.brew_date).toISOString().slice(0, 10)}.png`
      );
      setSaveMsg(t('sharedBrew.savePng.saved'));
    } catch (e) {
      setSaveMsg(e instanceof Error ? `${t('sharedBrew.savePng.failed')}: ${e.message}` : t('sharedBrew.savePng.failed'));
    } finally {
      setSaveBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function load() {
      setError(null);
      setLoading(true);
      try {
        if (!isSupabaseConfigured()) {
          throw new Error(t('analysis.grindMap.supabaseNotConfigured'));
        }
        const supabase = getSupabaseClient();
        const { data, error: rpcErr } = await supabase.rpc('get_public_brew_by_token', { p_share_token: token });
        if (rpcErr) throw new Error(rpcErr.message);
        const first = Array.isArray(data) ? ((data[0] as SharedBrewRow | undefined) ?? null) : null;
        if (!active) return;
        setRow(first);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : t('common.loadFailed'));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [t, token]);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b bg-gray-50 text-sm font-medium text-gray-700 flex items-center justify-between gap-3">
          <span>{t('sharedBrew.title')}</span>
          {row && (
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border bg-white text-xs hover:bg-gray-50 disabled:bg-gray-100"
              onClick={saveAsPng}
              disabled={saveBusy}
            >
              {saveBusy ? t('sharedBrew.savePng.saving') : t('sharedBrew.savePng.button')}
            </button>
          )}
        </div>
        {loading ? (
          <div className="p-4 text-sm text-gray-500">{t('sharedBrew.loading')}</div>
        ) : error ? (
          <div className="p-4 text-sm text-red-700 bg-red-50 border-t border-red-100">{error}</div>
        ) : !row ? (
          <div className="p-4 text-sm text-gray-500">{t('sharedBrew.notFound')}</div>
        ) : (
          <div className="p-4 space-y-3 text-sm">
            {saveMsg && <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2">{saveMsg}</div>}
            <div className="text-xs text-gray-500">{t('sharedBrew.sharedAt', { date: fmtDate(row.shared_at) })}</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500">{t('history.detail.date')}</div>
                <div className="font-medium text-gray-900">{fmtDate(row.brew_date)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('history.detail.bean')}</div>
                <div className="font-medium text-gray-900">{row.bean_name || t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.roastery')}</div>
                <div className="font-medium text-gray-900">{row.roastery || t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.producer')}</div>
                <div className="font-medium text-gray-900">{row.producer || t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.originLocation')}</div>
                <div className="font-medium text-gray-900">{row.origin_location || t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.originCountry')}</div>
                <div className="font-medium text-gray-900">{row.origin_country || t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.process')}</div>
                <div className="font-medium text-gray-900">{row.process || t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.varietal')}</div>
                <div className="font-medium text-gray-900">{row.varietal || t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('bean.field.roastedOn')}</div>
                <div className="font-medium text-gray-900">{row.roasted_on ? fmtDate(row.roasted_on) : t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('history.detail.grinder')}</div>
                <div className="font-medium text-gray-900">
                  {row.grinder_maker || t('common.none')}
                  {row.grinder_model ? ` ${row.grinder_model}` : ''}
                  {row.grinder_setting ? ` — ${row.grinder_setting}` : ''}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('history.detail.rating')}</div>
                <div className="font-medium text-gray-900">{row.rating == null ? t('common.none') : Number(row.rating).toFixed(1)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('history.detail.doseYield')}</div>
                <div className="font-medium text-gray-900">
                  {row.coffee_dose_g ?? t('common.none')}g / {row.coffee_yield_g ?? t('common.none')}g
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('history.detail.tds')}</div>
                <div className="font-medium text-gray-900">{row.coffee_tds ?? t('common.na')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('history.detail.water')}</div>
                <div className="font-medium text-gray-900">{row.water ?? t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('history.detail.waterTemp')}</div>
                <div className="font-medium text-gray-900">{row.water_temp_c == null ? t('common.na') : `${row.water_temp_c}°C`}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('history.detail.grindMedianUm')}</div>
                <div className="font-medium text-gray-900">
                  {row.grind_median_um == null ? t('common.na') : `${row.grind_median_um} μm`}
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs text-gray-500">{t('history.detail.recipe')}</div>
              <div className="whitespace-pre-wrap text-gray-900">{row.recipe || t('common.none')}</div>
            </div>

            <div>
              <div className="text-xs text-gray-500">{t('history.detail.cupNotesSca')}</div>
              <NoteDotsList notes={row.cup_flavor_notes ?? []} emptyLabel={t('common.none')} />
            </div>
            <div>
              <div className="text-xs text-gray-500">{t('history.detail.tasteNotesSca')}</div>
              <NoteDotsList notes={row.taste_flavor_notes} emptyLabel={t('common.none')} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500">{t('history.detail.extractionNote')}</div>
                <div className="whitespace-pre-wrap text-gray-900">{row.extraction_note || t('common.none')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('history.detail.tasteNote')}</div>
                <div className="whitespace-pre-wrap text-gray-900">{row.taste_note || t('common.none')}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
