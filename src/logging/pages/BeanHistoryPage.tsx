import { useEffect, useMemo, useState } from 'react';
import { ClipboardCopy } from 'lucide-react';
import type { AppUser } from '../../auth/types';
import { getSupabaseClient } from '../../config/supabase';
import { useI18n } from '../../i18n/I18nProvider';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { FlavorWheelPicker } from '../components/FlavorWheelPicker';
import { NoteDotsList } from '../components/NoteDotsList';
import { useBeanSuggestions } from '../hooks/useBeanSuggestions';
import { fmtDate } from '../utils/formatting';
import { beanDisplayLabel } from '../utils/beanLabel';
import { renderBeanLabelDataUrl } from '../utils/beanLabelImage';
import type { BeanInput, BeanRow, FlavorNote } from '../types';
import {
  localListBeans,
  localUpdateBean,
  localDeleteBean,
  localInsertBeanLabels,
  localListBeanLabelsForBean,
} from '../storage';
import { toQrDataUrl } from '../utils/qr';
import { canPrintBrotherLabels, printBrotherLabels } from '../../platform';
import {
  DEFAULT_BROTHER_PRINTER_NAME,
  getDefaultLabelCount,
  getDefaultLabelGrams,
  getLabelPrinterName,
} from '../labels/prefs';
import { buildPublicBeanLabelUrl } from '../utils/publicLinks';

function compactLabelText(parts: Array<string | null | undefined>): string | null {
  const values = parts.map((part) => part?.trim() ?? '').filter(Boolean);
  return values.length > 0 ? values.join(' · ') : null;
}

type StoredLabelRow = {
  uid: string;
  bean_uid: string;
  grams: number | null;
  created_at?: string | null;
};

type LabelHistoryBatch = {
  key: string;
  createdAt: string | null;
  grams: number | null;
  count: number;
  sampleLabelUid: string;
};

function groupLabelHistory(rows: StoredLabelRow[]): LabelHistoryBatch[] {
  const grouped = new Map<string, LabelHistoryBatch>();

  for (const row of rows) {
    const createdAt = row.created_at ?? null;
    const key = `${createdAt ?? 'unknown'}|${row.grams == null ? 'na' : row.grams}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(key, {
      key,
      createdAt,
      grams: row.grams,
      count: 1,
      sampleLabelUid: row.uid,
    });
  }

  return Array.from(grouped.values()).sort(
    (a, b) => new Date(b.createdAt ?? '').getTime() - new Date(a.createdAt ?? '').getTime(),
  );
}

type Props = {
  user: AppUser;
  isGuest?: boolean;
};

type BeanListRow = Pick<
  BeanRow,
  | 'uid'
  | 'bean_name'
  | 'roastery'
  | 'producer'
  | 'origin_location'
  | 'origin_country'
  | 'process'
  | 'varietal'
  | 'cup_notes'
  | 'cup_flavor_notes'
  | 'roasted_on'
  | 'created_at'
>;

function draftFromBean(bean: BeanListRow): BeanInput {
  return {
    bean_name: bean.bean_name ?? '',
    roastery: bean.roastery ?? '',
    producer: bean.producer ?? '',
    origin_location: bean.origin_location ?? '',
    origin_country: bean.origin_country ?? '',
    process: bean.process ?? '',
    varietal: bean.varietal ?? '',
    cup_notes: bean.cup_notes ?? '',
    cup_flavor_notes: (bean.cup_flavor_notes ?? []) as FlavorNote[],
    roasted_on: bean.roasted_on ?? ''
  };
}

export function BeanHistoryPage({ user, isGuest = false }: Props) {
  const { t } = useI18n();
  const [rows, setRows] = useState<BeanListRow[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [mode, setMode] = useState<'manage' | 'print'>('manage');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<BeanInput | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const hookBeanSugg = useBeanSuggestions(isGuest ? undefined : user.uid);

  // Guest mode: derive suggestions from loaded rows
  const guestSugg = useMemo(() => {
    if (!isGuest) return null;
    const unique = (arr: string[]) => Array.from(new Set(arr.filter(Boolean).map(s => s.trim()))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return {
      roasteries: unique(rows.map(b => b.roastery ?? '')),
      countries: unique(rows.map(b => b.origin_country ?? '')),
      varietals: unique(rows.map(b => b.varietal ?? '')),
      locationsForCountry(country: string) {
        const lc = country.toLowerCase().trim();
        if (!lc) return unique(rows.map(b => b.origin_location ?? ''));
        return unique(rows.filter(b => (b.origin_country ?? '').toLowerCase().trim() === lc).map(b => b.origin_location ?? ''));
      },
      producersForLocation(country: string, location: string) {
        const lcC = country.toLowerCase().trim();
        const lcL = location.toLowerCase().trim();
        let filtered = rows;
        if (lcC) filtered = filtered.filter(b => (b.origin_country ?? '').toLowerCase().trim() === lcC);
        if (lcL) filtered = filtered.filter(b => (b.origin_location ?? '').toLowerCase().trim() === lcL);
        return unique(filtered.map(b => b.producer ?? ''));
      },
    };
  }, [isGuest, rows]);

  const roasteries = isGuest ? (guestSugg?.roasteries ?? []) : hookBeanSugg.roasteries;
  const countries = isGuest ? (guestSugg?.countries ?? []) : hookBeanSugg.countries;
  const varietals = isGuest ? (guestSugg?.varietals ?? []) : hookBeanSugg.varietals;
  const locationsForCountry = isGuest
    ? (c: string) => guestSugg?.locationsForCountry(c) ?? []
    : hookBeanSugg.locationsForCountry;
  const producersForLocation = isGuest
    ? (c: string, l: string) => guestSugg?.producersForLocation(c, l) ?? []
    : hookBeanSugg.producersForLocation;

  const selected = useMemo(() => rows.find((r) => r.uid === selectedUid) ?? null, [rows, selectedUid]);

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      if (isGuest) {
        const next = localListBeans() as BeanListRow[];
        setRows(next);
        if (next.length > 0 && !selectedUid) setSelectedUid(next[0].uid);
        if (next.length === 0) setSelectedUid(null);
      } else {
        const supabase = getSupabaseClient();
        const { data, error: qErr } = await supabase
          .from('beans')
          .select(
            'uid,bean_name,roastery,producer,origin_location,origin_country,process,varietal,cup_notes,cup_flavor_notes,roasted_on,created_at'
          )
          .order('created_at', { ascending: false });
        if (qErr) throw new Error(qErr.message);
        const next = (data ?? []) as BeanListRow[];
        setRows(next);
        if (next.length > 0 && !selectedUid) setSelectedUid(next[0].uid);
        if (next.length === 0) setSelectedUid(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  // -----------------------------------------------------------------------
  // Flavor notes sync (Supabase-only — local stores inline)
  // -----------------------------------------------------------------------

  async function syncBeanFlavorNotes(beanUid: string, notes: FlavorNote[]) {
    if (isGuest) return;
    const supabase = getSupabaseClient();
    const { error: delErr } = await supabase.from('bean_flavor_notes').delete().eq('bean_uid', beanUid);
    if (delErr) throw new Error(delErr.message);
    if (notes.length === 0) return;
    const rows = notes.map((n) => ({
      bean_uid: beanUid,
      l1: n.path[0] ?? '',
      l2: n.path[1] ?? null,
      l3: n.path[2] ?? null,
      color: n.color
    }));
    const { error: insErr } = await supabase.from('bean_flavor_notes').insert(rows);
    if (insErr) throw new Error(insErr.message);
  }

  // -----------------------------------------------------------------------
  // Save edit
  // -----------------------------------------------------------------------

  async function saveEdit() {
    if (!selected || !editDraft) return;
    setEditError(null);
    setEditSaving(true);
    try {
      const patch = {
        bean_name: editDraft.bean_name.trim() || null,
        roastery: editDraft.roastery.trim() || null,
        producer: editDraft.producer.trim() || null,
        origin_location: editDraft.origin_location.trim() || null,
        origin_country: editDraft.origin_country.trim() || null,
        process: editDraft.process.trim() || null,
        varietal: editDraft.varietal.trim() || null,
        cup_notes: editDraft.cup_notes.trim() || null,
        cup_flavor_notes: (editDraft.cup_flavor_notes as FlavorNote[]) || [],
        roasted_on: editDraft.roasted_on || null
      };

      if (isGuest) {
        localUpdateBean(selected.uid, patch);
      } else {
        const supabase = getSupabaseClient();
        const { error: updErr } = await supabase
          .from('beans')
          .update(patch)
          .eq('uid', selected.uid);
        if (updErr) throw new Error(updErr.message);
        await syncBeanFlavorNotes(selected.uid, editDraft.cup_flavor_notes);
      }

      await refresh();
      setIsEditing(false);
      setEditDraft(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t('newBrew.error.saveFailed'));
    } finally {
      setEditSaving(false);
    }
  }

  // -----------------------------------------------------------------------
  // Delete bean
  // -----------------------------------------------------------------------

  async function deleteSelectedBean() {
    if (!selected) return;
    if (!window.confirm(t('beanHistory.delete.confirm'))) return;
    setDeleteBusy(true);
    try {
      if (isGuest) {
        localDeleteBean(selected.uid);
      } else {
        const supabase = getSupabaseClient();
        const { error: delErr } = await supabase.from('beans').delete().eq('uid', selected.uid);
        if (delErr) throw new Error(delErr.message);
      }
      setSelectedUid(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('beanHistory.delete.failed'));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function exportBeanHistoryJson() {
    setExportMsg(null);
    const payload = {
      type: 'beanlog.bean_history',
      version: 1,
      exported_at: new Date().toISOString(),
      count: rows.length,
      beans: rows.map((row) => ({
        uid: row.uid,
        bean_name: row.bean_name,
        roastery: row.roastery,
        producer: row.producer,
        origin_location: row.origin_location,
        origin_country: row.origin_country,
        process: row.process,
        varietal: row.varietal,
        cup_notes: row.cup_notes,
        cup_flavor_notes: row.cup_flavor_notes ?? [],
        roasted_on: row.roasted_on,
        created_at: row.created_at ?? null,
      })),
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setExportMsg(t('beanHistory.exportJson.copied', { count: String(rows.length) }));
    } catch {
      setExportMsg(t('beanHistory.exportJson.failed'));
    }
  }

  // -----------------------------------------------------------------------
  // Effects
  // -----------------------------------------------------------------------

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid, isGuest]);

  useEffect(() => {
    setIsEditing(false);
    setEditDraft(null);
    setEditError(null);
  }, [selectedUid]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (mode === 'print') {
    return (
      <BeanLabelPrintView
        t={t}
        isGuest={isGuest}
        beans={rows}
        initialBeanUid={selectedUid ?? (rows[0]?.uid ?? null)}
        onBack={() => setMode('manage')}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">{t('beanHistory.title')}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 whitespace-nowrap"
            onClick={() => setMode('print')}
            disabled={rows.length === 0}
          >
            {t('beanLabels.printMode')}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 disabled:bg-gray-100 whitespace-nowrap"
            onClick={() => void exportBeanHistoryJson()}
            disabled={rows.length === 0}
          >
            <ClipboardCopy className="w-4 h-4" aria-hidden="true" />
            {t('beanHistory.exportJson')}
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 whitespace-nowrap"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? t('beanHistory.refresh.loading') : t('beanHistory.refresh')}
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{error}</div>}
      {exportMsg && <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2">{exportMsg}</div>}

      {rows.length === 0 && !loading && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-sm text-gray-600">
          {t('beanHistory.empty')}
        </div>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Bean list */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b bg-gray-50 text-sm font-medium text-gray-700">
              {t('beanHistory.list.title')}
            </div>
            <div className="divide-y overflow-y-auto max-h-[560px]">
              {rows.map((r) => {
                const active = selectedUid === r.uid;
                return (
                  <button
                    key={r.uid}
                    type="button"
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                      active ? 'bg-amber-50 border-l-2 border-l-amber-600' : 'bg-white border-l-2 border-l-transparent'
                    }`}
                    onClick={() => setSelectedUid(r.uid)}
                  >
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {beanDisplayLabel(r, t('history.bean.fallbackLabel'))}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{fmtDate(r.roasted_on || r.created_at)}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bean detail / edit */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 text-sm font-medium text-gray-700">
              {isEditing ? t('beanHistory.edit.title') : t('beanHistory.detail.title')}
            </div>

            {!selected ? (
              <div className="p-4 text-sm text-gray-500">{t('beanHistory.selectPrompt')}</div>
            ) : !isEditing ? (
              <div className="p-4 space-y-3 text-sm">
                <div className="flex items-center justify-end gap-2 flex-wrap">
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg bg-amber-700 text-white text-sm hover:bg-amber-800 whitespace-nowrap"
                    onClick={() => {
                      setIsEditing(true);
                      setEditDraft(draftFromBean(selected));
                    }}
                  >
                    {t('beanHistory.edit.start')}
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50 disabled:bg-gray-100 whitespace-nowrap"
                    onClick={deleteSelectedBean}
                    disabled={deleteBusy}
                  >
                    {deleteBusy ? t('beanHistory.delete.deleting') : t('beanHistory.delete.button')}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-gray-500">{t('bean.field.name')}</div>
                    <div className="font-medium text-gray-900">{selected.bean_name || t('common.none')}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{t('bean.field.roastery')}</div>
                    <div className="font-medium text-gray-900">{selected.roastery || t('common.none')}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{t('bean.field.originCountry')}</div>
                    <div className="font-medium text-gray-900">{selected.origin_country || t('common.none')}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{t('bean.field.originLocation')}</div>
                    <div className="font-medium text-gray-900">{selected.origin_location || t('common.none')}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{t('bean.field.producer')}</div>
                    <div className="font-medium text-gray-900">{selected.producer || t('common.none')}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{t('bean.field.process')}</div>
                    <div className="font-medium text-gray-900">{selected.process || t('common.none')}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{t('bean.field.varietal')}</div>
                    <div className="font-medium text-gray-900">{selected.varietal || t('common.none')}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{t('bean.field.roastedOn')}</div>
                    <div className="font-medium text-gray-900">{fmtDate(selected.roasted_on) || t('common.none')}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-gray-500">{t('bean.field.notesFreeText')}</div>
                  <div className="whitespace-pre-wrap text-gray-900">{selected.cup_notes || t('common.none')}</div>
                </div>

                <div>
                  <div className="text-xs text-gray-500">{t('bean.field.cupNotesSca')}</div>
                  <NoteDotsList notes={selected.cup_flavor_notes as FlavorNote[] | null} emptyLabel={t('common.none')} />
                </div>
              </div>
            ) : editDraft ? (
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-end gap-2 flex-wrap">
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 whitespace-nowrap"
                    onClick={() => {
                      setIsEditing(false);
                      setEditDraft(null);
                      setEditError(null);
                    }}
                    disabled={editSaving}
                  >
                    {t('beanHistory.edit.cancel')}
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg bg-amber-700 text-white text-sm disabled:bg-gray-300 whitespace-nowrap"
                    onClick={() => void saveEdit()}
                    disabled={editSaving}
                  >
                    {editSaving ? t('beanHistory.edit.save.saving') : t('beanHistory.edit.save')}
                  </button>
                </div>

                {editError && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{editError}</div>}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.name')}</label>
                    <input
                      className="w-full p-2 border rounded-lg"
                      value={editDraft.bean_name}
                      onChange={(e) => setEditDraft({ ...editDraft, bean_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.roastery')}</label>
                    <AutocompleteInput
                      value={editDraft.roastery}
                      onChange={(v) => setEditDraft({ ...editDraft, roastery: v })}
                      suggestions={roasteries}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.originCountry')}</label>
                    <AutocompleteInput
                      value={editDraft.origin_country}
                      onChange={(v) => setEditDraft({ ...editDraft, origin_country: v })}
                      suggestions={countries}
                      placeholder={t('bean.placeholder.originCountry')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.originLocation')}</label>
                    <AutocompleteInput
                      value={editDraft.origin_location}
                      onChange={(v) => setEditDraft({ ...editDraft, origin_location: v })}
                      suggestions={locationsForCountry(editDraft.origin_country)}
                      placeholder={t('bean.placeholder.originLocation')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.producer')}</label>
                    <AutocompleteInput
                      value={editDraft.producer}
                      onChange={(v) => setEditDraft({ ...editDraft, producer: v })}
                      suggestions={producersForLocation(editDraft.origin_country, editDraft.origin_location)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.process')}</label>
                    <input
                      className="w-full p-2 border rounded-lg"
                      value={editDraft.process}
                      onChange={(e) => setEditDraft({ ...editDraft, process: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.varietal')}</label>
                    <AutocompleteInput
                      value={editDraft.varietal}
                      onChange={(v) => setEditDraft({ ...editDraft, varietal: v })}
                      suggestions={varietals}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.roastedOn')}</label>
                    <input
                      className="w-full p-2 border rounded-lg"
                      type="date"
                      value={editDraft.roasted_on}
                      onChange={(e) => setEditDraft({ ...editDraft, roasted_on: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('bean.field.notesFreeText')}</label>
                  <textarea
                    className="w-full p-2 border rounded-lg min-h-20"
                    value={editDraft.cup_notes}
                    onChange={(e) => setEditDraft({ ...editDraft, cup_notes: e.target.value })}
                  />
                </div>

                <FlavorWheelPicker
                  label={t('bean.field.cupNotesSca')}
                  value={editDraft.cup_flavor_notes}
                  onChange={(next) => setEditDraft({ ...editDraft, cup_flavor_notes: next })}
                />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

type BeanLabelPrintViewProps = {
  t: (k: Parameters<ReturnType<typeof useI18n>['t']>[0], vars?: Record<string, string>) => string;
  isGuest: boolean;
  beans: BeanListRow[];
  initialBeanUid: string | null;
  onBack: () => void;
};

type LabelPreview = {
  uid: string;
  bean_uid: string;
  grams: number | null;
  qrDataUrl: string;
  printDataUrl: string;
  roasteryText: string | null;
  originText: string | null;
  producerProcessText: string | null;
  varietalText: string | null;
  footerText: string;
};

function BeanLabelPrintView({ t, isGuest, beans, initialBeanUid, onBack }: BeanLabelPrintViewProps) {
  const [beanUid, setBeanUid] = useState<string>(initialBeanUid ?? '');
  const [grams, setGrams] = useState<string>(() => getDefaultLabelGrams());
  const [count, setCount] = useState<string>(() => getDefaultLabelCount());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [labels, setLabels] = useState<LabelPreview[]>([]);
  const [labelHistory, setLabelHistory] = useState<LabelHistoryBatch[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const supportsNativePrint = canPrintBrotherLabels();
  const printerName = getLabelPrinterName();

  const selected = useMemo(() => beans.find((b) => b.uid === beanUid) ?? null, [beans, beanUid]);

  function buildLabelText(bean: BeanListRow, gramsValue: number | null) {
    const roasteryText = bean.roastery?.trim() || null;
    const originText = compactLabelText([bean.origin_location, bean.origin_country]);
    const producerProcessText = compactLabelText([bean.producer, bean.process]);
    const varietalText = bean.varietal?.trim() || null;
    const footerText =
      compactLabelText([
        `${t('beanLabels.roastDate')}: ${bean.roasted_on ? fmtDate(bean.roasted_on) : t('common.none')}`,
        gramsValue != null ? t('beanLabels.gramsInline', { grams: String(gramsValue) }) : null,
      ]) ?? `${t('beanLabels.roastDate')}: ${bean.roasted_on ? fmtDate(bean.roasted_on) : t('common.none')}`;

    return { roasteryText, originText, producerProcessText, varietalText, footerText };
  }

  async function loadLabelHistory(beanUidValue: string) {
    if (!beanUidValue) {
      setLabelHistory([]);
      return;
    }

    setHistoryLoading(true);
    try {
      let rows: StoredLabelRow[] = [];
      if (isGuest) {
        rows = localListBeanLabelsForBean(beanUidValue);
      } else {
        const { getSupabaseClient } = await import('../../config/supabase');
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
          .from('bean_labels')
          .select('uid,bean_uid,grams,created_at')
          .eq('bean_uid', beanUidValue)
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw new Error(error.message);
        rows = (data ?? []) as StoredLabelRow[];
      }
      setLabelHistory(groupLabelHistory(rows));
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : t('common.loadFailed') });
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    void loadLabelHistory(beanUid);
  }, [beanUid, isGuest]);

  useEffect(() => {
    setLabels([]);
    setMsg(null);
  }, [beanUid]);

  async function generateAndPrint(options?: {
    countValue?: number;
    gramsValue?: number | null;
    successText?: string;
  }) {
    if (!selected) return;
    const n = options?.countValue ?? Math.max(1, Math.min(200, Number(count) || 0));
    const g =
      options && 'gramsValue' in options
        ? options.gramsValue
        : grams.trim()
          ? Number(grams)
          : NaN;
    const gramsNum = g == null ? null : Number.isFinite(g) ? g : null;

    setBusy(true);
    setMsg(null);
    try {
      const next: LabelPreview[] = [];
      for (let i = 0; i < n; i++) {
        const uid = crypto.randomUUID();
        const url = buildPublicBeanLabelUrl(uid);
        const qrDataUrl = await toQrDataUrl(url, 160, {
          errorCorrectionLevel: 'L',
          margin: 1,
        });
        const { roasteryText, originText, producerProcessText, varietalText, footerText } = buildLabelText(selected, gramsNum);
        const printDataUrl = await renderBeanLabelDataUrl({
          roasteryText,
          beanName: selected.bean_name || t('common.none'),
          originText,
          producerProcessText,
          varietalText,
          footerText,
          qrDataUrl,
          qrText: url,
        });
        next.push({
          uid,
          bean_uid: selected.uid,
          grams: gramsNum,
          qrDataUrl,
          printDataUrl,
          roasteryText,
          originText,
          producerProcessText,
          varietalText,
          footerText,
        });
      }

      if (isGuest) {
        localInsertBeanLabels(next.map((l) => ({ uid: l.uid, bean_uid: l.bean_uid, grams: l.grams })));
      } else {
        const { getSupabaseClient } = await import('../../config/supabase');
        const supabase = getSupabaseClient();
        const { error } = await supabase.from('bean_labels').insert(
          next.map((l) => ({
            uid: l.uid,
            bean_uid: l.bean_uid,
            grams: l.grams,
          })),
        );
        if (error) throw new Error(error.message);
      }

      setLabels(next);
      if (supportsNativePrint) {
        await printBrotherLabels({
          printerName: printerName.trim() || DEFAULT_BROTHER_PRINTER_NAME,
          labels: next.map((label) => ({ pngDataUrl: label.printDataUrl })),
        });
        setMsg({ tone: 'success', text: options?.successText ?? t('beanLabels.printedNative') });
      } else {
        setTimeout(() => window.print(), 50);
      }
      await loadLabelHistory(selected.uid);
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : t('common.loadFailed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .label-sheet { padding: 0 !important; margin: 0 !important; }
          body { background: white !important; }
        }
        .label-sheet {
          max-width: 50mm;
          margin: 0 auto;
        }
        .label {
          /* Brother TZe 24mm tape: 24mm tall with a shorter ~37mm label length to save tape */
          width: 37mm;
          height: 24mm;
          border: 1px solid #e5e7eb;
          border-radius: 4px;
          padding: 1.8mm 1.8mm;
          display: flex;
          gap: 1.6mm;
          align-items: center;
          page-break-inside: avoid;
        }
      `}</style>

      <div className="no-print flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">{t('beanLabels.title')}</h2>
        <button
          type="button"
          className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 whitespace-nowrap"
          onClick={onBack}
          disabled={busy}
        >
          {t('beanLabels.back')}
        </button>
      </div>

      <div className="no-print bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
        {msg && (
          <div
            className={`text-sm rounded-lg border p-2 ${
              msg.tone === 'error'
                ? 'text-red-700 bg-red-50 border-red-100 whitespace-pre-line'
                : 'text-amber-800 bg-amber-50 border-amber-200 whitespace-pre-line'
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('beanLabels.field.bean')}</label>
            <select className="w-full p-2 border rounded-lg" value={beanUid} onChange={(e) => setBeanUid(e.target.value)}>
              <option value="" disabled>
                {t('beanLabels.field.bean.placeholder')}
              </option>
              {beans.map((b) => (
                <option key={b.uid} value={b.uid}>
                  {beanDisplayLabel(b, t('history.bean.fallbackLabel'))}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            {t('beanLabels.defaultsSummary', { printerName: printerName.trim() || DEFAULT_BROTHER_PRINTER_NAME })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_auto] gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('beanLabels.field.grams')}</label>
              <input
                className="w-full p-2 border rounded-lg"
                inputMode="decimal"
                value={grams}
                onChange={(e) => setGrams(e.target.value)}
                placeholder="15"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('beanLabels.field.count')}</label>
              <input
                className="w-full p-2 border rounded-lg"
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                placeholder="4"
              />
            </div>
            <div className="flex">
              <button
                type="button"
                className="w-full px-3 py-2 rounded-lg bg-amber-700 text-white text-sm hover:bg-amber-800 disabled:bg-gray-300 whitespace-nowrap"
                onClick={() => void generateAndPrint()}
                disabled={!selected || busy}
              >
                {busy ? t('beanLabels.generatePrinting') : t('beanLabels.generateAndPrint')}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-gray-500">
            {supportsNativePrint ? t('beanLabels.printerName.help.native') : t('beanLabels.printerName.help.web')}
          </p>
        </div>
      </div>

      <div className="no-print bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-700">{t('beanLabels.history.title')}</h3>
        </div>
        {historyLoading ? (
          <div className="text-xs text-gray-500">{t('beanLabels.history.loading')}</div>
        ) : labelHistory.length === 0 ? (
          <div className="text-xs text-gray-500">{t('beanLabels.history.empty')}</div>
        ) : (
          <div className="space-y-2">
            {labelHistory.slice(0, 8).map((batch) => {
              const gramsPart =
                batch.grams != null ? t('beanLabels.history.gramsPart', { grams: String(batch.grams) }) : '';
              return (
                <div
                  key={batch.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                >
                  <div className="min-w-0 text-xs text-gray-700">
                    {t('beanLabels.history.meta', {
                      date: fmtDate(batch.createdAt ?? ''),
                      count: String(batch.count),
                      gramsPart,
                    })}
                  </div>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg border bg-white text-xs hover:bg-gray-50 whitespace-nowrap disabled:bg-gray-100"
                    onClick={() => {
                      setGrams(batch.grams == null ? '' : String(batch.grams));
                      setCount(String(batch.count));
                      void generateAndPrint({
                        countValue: batch.count,
                        gramsValue: batch.grams,
                        successText: t('beanLabels.reprintedBatch'),
                      });
                    }}
                    disabled={busy || !selected}
                  >
                    {t('beanLabels.history.reprint')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {labels.length > 0 && selected && (
        <div className="label-sheet space-y-2">
          {labels.map((l) => (
            <div key={l.uid} className="label bg-white">
              <div className="min-w-0 flex-1 overflow-hidden">
                {l.roasteryText && (
                  <div className="text-[6.5pt] font-semibold uppercase tracking-[0.08em] text-amber-800 truncate">
                    {l.roasteryText}
                  </div>
                )}
                <div className="text-[8.8pt] font-semibold leading-tight truncate">
                  {selected.bean_name || t('common.none')}
                </div>
                {l.originText && (
                  <div className="text-[6.4pt] text-gray-700 leading-tight truncate">
                    {l.originText}
                  </div>
                )}
                {l.producerProcessText && (
                  <div className="text-[6.2pt] text-gray-600 leading-tight truncate">
                    {l.producerProcessText}
                  </div>
                )}
                {l.varietalText && (
                  <div className="text-[6.1pt] text-gray-500 leading-tight truncate">
                    {l.varietalText}
                  </div>
                )}
                <div className="text-[6.2pt] text-gray-500 leading-tight">{l.footerText}</div>
              </div>
              <img src={l.qrDataUrl} alt={t('beanLabels.qrAlt')} className="w-[18mm] h-[18mm]" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
