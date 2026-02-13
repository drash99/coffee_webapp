import { useEffect, useRef, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../../config/supabase';
import type { FlavorNote } from '../types';
import { useI18n } from '../../i18n/I18nProvider';

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
  const captureRef = useRef<HTMLDivElement | null>(null);

  async function saveAsPng() {
    if (!captureRef.current) return;
    setSaveBusy(true);
    setSaveMsg(null);
    try {
      const source = captureRef.current;
      const rect = source.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));

      const clonedRoot = source.cloneNode(true) as HTMLElement;

      function copyStyles(a: Element, b: Element) {
        const aHtml = a as HTMLElement;
        const bHtml = b as HTMLElement;
        const cs = window.getComputedStyle(aHtml);
        for (let i = 0; i < cs.length; i += 1) {
          const prop = cs.item(i);
          bHtml.style.setProperty(prop, cs.getPropertyValue(prop), cs.getPropertyPriority(prop));
        }
        const aChildren = Array.from(a.children);
        const bChildren = Array.from(b.children);
        for (let i = 0; i < aChildren.length; i += 1) {
          const ac = aChildren[i];
          const bc = bChildren[i];
          if (ac && bc) copyStyles(ac, bc);
        }
      }

      copyStyles(source, clonedRoot);

      const wrapper = document.createElement('div');
      wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      wrapper.style.width = `${width}px`;
      wrapper.style.height = `${height}px`;
      wrapper.style.background = '#ffffff';
      wrapper.appendChild(clonedRoot);

      const serialized = new XMLSerializer().serializeToString(wrapper);
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
          <foreignObject width="100%" height="100%">${serialized}</foreignObject>
        </svg>
      `;
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.decoding = 'sync';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to render image'));
          img.src = url;
        });

        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas is not supported');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);

        const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
        if (!pngBlob) throw new Error('PNG encode failed');
        const pngUrl = URL.createObjectURL(pngBlob);
        try {
          const a = document.createElement('a');
          a.href = pngUrl;
          a.download = `shared-brew-${row ? new Date(row.brew_date).toISOString().slice(0, 10) : 'export'}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setSaveMsg(t('sharedBrew.savePng.saved'));
        } finally {
          URL.revokeObjectURL(pngUrl);
        }
      } finally {
        URL.revokeObjectURL(url);
      }
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
      <div className="bg-white rounded-xl shadow-sm border border-gray-100" ref={captureRef}>
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
