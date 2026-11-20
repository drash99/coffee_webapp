import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ClipboardCopy, Plus, Printer } from 'lucide-react';
import type { AppUser } from '../../auth/types';
import { getSupabaseClient } from '../../config/supabase';
import { useI18n } from '../../i18n/I18nProvider';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { FlavorWheelPicker } from '../components/FlavorWheelPicker';
import { NoteDotsList } from '../components/NoteDotsList';
import { BrotherPrinterStatusPanel } from '../components/BrotherPrinterStatusPanel';
import { BeverageTypeSelect } from '../components/BeverageTypeSelect';
import { BeverageDetailValues, BeverageItemFields, DetailValue } from '../components/BeverageFields';
import { PhotoImportPanel } from '../components/PhotoImportPanel';
import { beverageTypeOf } from '../utils/beverage';
import { buildBeverageImportPrompt, parseBeverageImportJson } from '../utils/beanJsonImport';
import { beverageItemFields, parseBeverageDetails, productDraft, productFields, textDetails, type ProductDraft } from '../utils/beverageFields';
import { useBeanSuggestions } from '../hooks/useBeanSuggestions';
import { fmtDate } from '../utils/formatting';
import { fetchAllRows } from '../utils/pagination';
import { saveCloudData } from '../storage/cloudDb';
import { getStorageErrorMessage } from '../utils/storageError';
import { validateLocalData } from '../storage/localDataValidation';
import { beanDisplayLabel } from '../utils/beanLabel';
import { BEAN_LABEL_DIMENSIONS, BeanLabelLayoutError, renderBeanLabelImages } from '../utils/beanLabelImage';
import type { BeanRow, BeverageType } from '../types';
import {
  localListBeans,
  localGetAllData,
  localSaveData,
  localDeleteBean,
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
  category?: BeverageType;
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
  | 'beverage_type'
  | 'beverage_details'
>;

export function BeanHistoryPage({ user, isGuest = false, category = 'coffee' }: Props) {
  const { t } = useI18n();
  const isCoffee = category === 'coffee';
  const [rows, setRows] = useState<BeanListRow[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [mode, setMode] = useState<'manage' | 'print'>('manage');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ProductDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const draftUid = useRef<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const hookBeanSugg = useBeanSuggestions(isGuest || !isCoffee ? undefined : user.uid);
  const importPrompt = useMemo(() => category === 'coffee' ? '' : buildBeverageImportPrompt(category, rows), [category, rows]);

  // Guest mode: derive suggestions from loaded rows
  const guestSugg = useMemo(() => {
    if (!isGuest || !isCoffee) return null;
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
  }, [isGuest, isCoffee, rows]);

  const roasteries = isGuest ? (guestSugg?.roasteries ?? []) : hookBeanSugg.roasteries;
  const countries = isGuest ? (guestSugg?.countries ?? []) : hookBeanSugg.countries;
  const varietals = isGuest ? (guestSugg?.varietals ?? []) : hookBeanSugg.varietals;
  const locationsForCountry = isGuest
    ? (c: string) => guestSugg?.locationsForCountry(c) ?? []
    : hookBeanSugg.locationsForCountry;
  const producersForLocation = isGuest
    ? (c: string, l: string) => guestSugg?.producersForLocation(c, l) ?? []
    : hookBeanSugg.producersForLocation;

  const selected = rows.find((r) => r.uid === selectedUid) ?? rows[0] ?? null;

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      if (isGuest) {
        validateLocalData(localGetAllData(), { allowOrphanLabels: true });
        const next = localListBeans().filter(row => beverageTypeOf(row) === category);
        setRows(next);
        if (next.length > 0 && !selectedUid) setSelectedUid(next[0].uid);
        if (next.length === 0) setSelectedUid(null);
      } else {
        const supabase = getSupabaseClient();
        const next = await fetchAllRows<BeanListRow>(() => {
          const query = supabase.from('beans').select('*');
          return (isCoffee ? query : query.eq('beverage_type', category))
            .order('created_at', { ascending: false }).order('uid', { ascending: false });
        }).then(beans => beans.filter(row => beverageTypeOf(row) === category));
        setRows(next);
        if (next.length > 0 && !selectedUid) setSelectedUid(next[0].uid);
        if (next.length === 0) setSelectedUid(null);
      }
    } catch (e) {
      setError(getStorageErrorMessage(e, t('common.loadFailed'), t));
    } finally {
      setLoading(false);
    }
  }

  // -----------------------------------------------------------------------
  // Save edit
  // -----------------------------------------------------------------------

  async function saveEdit() {
    if ((!creating && !selected) || !editDraft || editSaving) return;
    setEditError(null);
    setEditSaving(true);
    try {
      if (!isCoffee && !editDraft.bean_name.trim()) throw new Error(t('beverage.error.name'));
      const uid = creating ? (draftUid.current ??= crypto.randomUUID()) : selected!.uid;
      const patch = {
        uid,
        ...productFields(editDraft),
        ...(editDraft.beverage_type && (creating || editDraft.beverage_type !== category)
          ? { beverage_type: editDraft.beverage_type } : {}),
        ...(category !== 'coffee' ? { beverage_details: parseBeverageDetails(
          editDraft.details, beverageItemFields[category], t, creating ? undefined : selected?.beverage_details,
        ) } : {}),
      };

      if (isGuest) {
        localSaveData({ beans: [patch] });
      } else {
        await saveCloudData({ beans: [patch] });
      }

      await refresh();
      if (creating) {
        setSelectedUid(uid);
        setSaveMsg(t('beverage.saved'));
      }
      draftUid.current = null;
      setCreating(false);
      setIsEditing(false);
      setEditDraft(null);
    } catch (e) {
      setEditError(getStorageErrorMessage(e, t('newBrew.error.saveFailed'), t));
    } finally {
      setEditSaving(false);
    }
  }

  // -----------------------------------------------------------------------
  // Delete bean
  // -----------------------------------------------------------------------

  async function deleteSelectedBean() {
    if (!selected) return;
    if (!window.confirm(t(isCoffee ? 'beanHistory.delete.confirm' : 'beverage.deleteItem'))) return;
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
      setError(getStorageErrorMessage(e, t('beanHistory.delete.failed'), t));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function exportBeanHistoryJson() {
    setExportMsg(null);
    const payload = {
      type: 'beanlog.bean_history',
      version: 1,
      ...(isCoffee ? {} : { beverage_type: category }),
      exported_at: new Date().toISOString(),
      count: rows.length,
      beans: rows.map((row) => ({
        uid: row.uid,
        beverage_type: beverageTypeOf(row),
        ...(row.beverage_details ? { beverage_details: row.beverage_details } : {}),
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
  }, [user.uid, isGuest, category]);

  useEffect(() => {
    setSelectedUid(selected?.uid ?? null);
    if (!creating) {
      setIsEditing(false);
      setEditDraft(null);
      setEditError(null);
    }
  }, [selected?.uid]);

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
        <h2 className="text-lg font-semibold">{t(isCoffee ? 'beanHistory.title' : `beverage.library.${category}`)}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {isCoffee ? <button
            type="button"
            className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 whitespace-nowrap"
            onClick={() => setMode('print')}
            disabled={rows.length === 0}
          >
            {t('beanLabels.printMode')}
          </button> : <button type="button" disabled={creating || loading || editSaving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-2 text-sm text-white hover:bg-amber-800 disabled:opacity-50"
            onClick={() => {
              setCreating(true); setIsEditing(true); setEditError(null); setSaveMsg(null);
              draftUid.current = null;
              setEditDraft(productDraft(category));
            }}>
            <Plus size={16} aria-hidden="true" />{t(`beverage.newItem.${category}`)}
          </button>}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 disabled:bg-gray-100 whitespace-nowrap"
            onClick={() => void exportBeanHistoryJson()}
            disabled={loading || Boolean(error) || rows.length === 0}
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
      {saveMsg && <p role="status" className="text-sm text-green-700">{saveMsg}</p>}

      {rows.length === 0 && !creating && !loading && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-sm text-gray-600">
          {t(isCoffee ? 'beanHistory.empty' : 'beverage.emptyItems')}
        </div>
      )}

      {(rows.length > 0 || creating) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Bean list */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b bg-gray-50 text-sm font-medium text-gray-700">
              {t(isCoffee ? 'beanHistory.list.title' : 'beverage.itemList')}
            </div>
            <div className="divide-y overflow-y-auto max-h-64 lg:max-h-[560px]">
              {rows.map((r) => {
                const active = !creating && selected?.uid === r.uid;
                return (
                  <button
                    key={r.uid}
                    type="button"
                    aria-pressed={active}
                    disabled={editSaving}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                      active ? 'bg-amber-50 border-l-2 border-l-amber-600' : 'bg-white border-l-2 border-l-transparent'
                    }`}
                    onClick={() => {
                      if (creating) { setCreating(false); setEditDraft(null); setIsEditing(false); setEditError(null); }
                      setSaveMsg(null);
                      setSelectedUid(r.uid);
                    }}
                  >
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {beanDisplayLabel(r, t('history.bean.fallbackLabel'))}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">{isCoffee
                      ? fmtDate(r.roasted_on || r.created_at)
                      : r.producer || fmtDate(r.created_at)}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bean detail / edit */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 text-sm font-medium text-gray-700">
              {creating && category !== 'coffee' ? t(`beverage.newItem.${category}`) : isEditing
                ? t(isCoffee ? 'beanHistory.edit.title' : 'beverage.editItem') : t('beanHistory.detail.title')}
            </div>

            {!selected && !creating ? (
              <div className="p-4 text-sm text-gray-500">{t('beanHistory.selectPrompt')}</div>
            ) : !isEditing && selected ? (
              <div className="p-4 space-y-3 text-sm">
                <div className="flex items-center justify-end gap-2 flex-wrap">
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg bg-amber-700 text-white text-sm hover:bg-amber-800 whitespace-nowrap"
                    onClick={() => {
                      setIsEditing(true);
                      setSaveMsg(null);
                      setEditDraft(productDraft(category, selected));
                    }}
                  >
                    {t(isCoffee ? 'beanHistory.edit.start' : 'beverage.editItem')}
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50 disabled:bg-gray-100 whitespace-nowrap"
                    onClick={deleteSelectedBean}
                    disabled={deleteBusy}
                  >
                    {deleteBusy ? t('beanHistory.delete.deleting') : t(isCoffee ? 'beanHistory.delete.button' : 'beverage.deleteItemButton')}
                  </button>
                </div>

                {category === 'coffee' ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                </div> : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <DetailValue label={t('beverage.itemName')}>{selected.bean_name || t('common.none')}</DetailValue>
                  <DetailValue label={t('bean.field.producer')}>{selected.producer || t('common.none')}</DetailValue>
                  <DetailValue label={t('bean.field.originCountry')}>{selected.origin_country || t('common.none')}</DetailValue>
                  <DetailValue label={t('bean.field.originLocation')}>{selected.origin_location || t('common.none')}</DetailValue>
                  <DetailValue label={t(category === 'tea' ? 'beverage.cultivar' : 'beverage.grape')}>{selected.varietal || t('common.none')}</DetailValue>
                  {(category === 'tea' || selected.process) && <DetailValue label={t('bean.field.process')}>{selected.process || t('common.none')}</DetailValue>}
                  <BeverageDetailValues fields={beverageItemFields[category]} values={selected.beverage_details} />
                </div>}
                {!isCoffee && (selected.roastery || selected.roasted_on) && <details className="text-sm text-gray-600">
                  <summary>{t('beverage.legacy')}</summary>
                  <p>{[selected.roastery, fmtDate(selected.roasted_on)].filter(Boolean).join(' · ')}</p>
                </details>}

                <div>
                  <div className="text-xs text-gray-500">{t(isCoffee ? 'bean.field.notesFreeText' : 'beverage.itemNotes')}</div>
                  <div className="whitespace-pre-wrap break-words text-gray-900">{selected.cup_notes || t('common.none')}</div>
                </div>

                <div>
                  <div className="text-xs text-gray-500">{t(isCoffee ? 'bean.field.cupNotesSca' : 'beverage.flavorNotes')}</div>
                  <NoteDotsList beverageType={category} notes={selected.cup_flavor_notes} emptyLabel={t('common.none')} />
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
                      setCreating(false);
                      draftUid.current = null;
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
                    {editSaving ? t('beanHistory.edit.save.saving') : t(creating ? 'beverage.saveItem' : 'beanHistory.edit.save')}
                  </button>
                </div>

                {editError && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{editError}</div>}

                {category === 'coffee' ? <>
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
                  beverageType={editDraft.beverage_type}
                  label={t('bean.field.cupNotesSca')}
                  value={editDraft.cup_flavor_notes}
                  onChange={(next) => setEditDraft({ ...editDraft, cup_flavor_notes: next })}
                />
                </> : <>
                  {creating && <PhotoImportPanel prompt={importPrompt} onImport={raw => {
                    const { beverage_details, ...fields } = parseBeverageImportJson(raw, category);
                    setEditDraft({ ...productDraft(category), ...fields, details: textDetails(beverage_details) });
                    setEditError(null);
                  }} />}
                  <BeverageItemFields category={category} draft={editDraft} set={setEditDraft} />
                </>}
                {!creating && <BeverageTypeSelect value={editDraft.beverage_type ?? category}
                  onChange={beverage_type => setEditDraft({ ...editDraft, beverage_type })} />}
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
  beanName: string;
  printDataUrl: string;
  previewDataUrl: string;
  lengthDots: number;
};

async function createLabelPreview(bean: BeanListRow, grams: number | null, t: BeanLabelPrintViewProps['t']): Promise<LabelPreview> {
  const uid = crypto.randomUUID();
  const url = buildPublicBeanLabelUrl(uid);
  const qrDataUrl = await toQrDataUrl(url, 160, { errorCorrectionLevel: 'L', margin: 1 });
  const beanName = bean.bean_name || t('common.none');
  const images = await renderBeanLabelImages({
    roasteryText: bean.roastery?.trim() || null,
    beanName,
    details: [
      { label: t('beanLabels.line.origin'), value: compactLabelText([bean.origin_country, bean.origin_location]) ?? '' },
      { label: t('beanLabels.line.producer'), value: bean.producer?.trim() ?? '' },
      { label: t('beanLabels.line.process'), value: bean.process?.trim() ?? '' },
      { label: t('beanLabels.line.varietal'), value: bean.varietal?.trim() ?? '' },
    ],
    footerText: compactLabelText([
      `${t('beanLabels.roastDate')}: ${bean.roasted_on || t('common.none')}`,
      grams != null ? t('beanLabels.gramsInline', { grams: String(grams) }) : null,
    ]) ?? '',
    qrDataUrl,
    qrText: url,
  });
  return { uid, bean_uid: bean.uid, grams, beanName, ...images };
}

function LabelFigure({ label, t, forPrint = false }: { label: LabelPreview; t: BeanLabelPrintViewProps['t']; forPrint?: boolean }) {
  const lengthMm = label.lengthDots * 25.4 / BEAN_LABEL_DIMENSIONS.dpi;
  return (
    <figure className="m-0 space-y-1">
      <div className="label" style={{
        '--label-width': `${label.lengthDots}px`,
        '--label-print-width': `${lengthMm}mm`,
        aspectRatio: `${lengthMm} / ${BEAN_LABEL_DIMENSIONS.tapeWidthMm}`,
      } as CSSProperties}>
        <img src={label.previewDataUrl} alt={forPrint ? '' : t('beanLabels.previewAlt', { beanName: label.beanName })}
          width={label.lengthDots} height={BEAN_LABEL_DIMENSIONS.heightDots} className="label-image" />
      </div>
      {!forPrint && <figcaption className="text-center text-xs text-gray-500">
        {t('beanLabels.dimensions', { length: lengthMm.toFixed(1), width: String(BEAN_LABEL_DIMENSIONS.tapeWidthMm) })}
      </figcaption>}
    </figure>
  );
}

function BeanLabelPrintView({ t, isGuest, beans, initialBeanUid, onBack }: BeanLabelPrintViewProps) {
  const [beanUid, setBeanUid] = useState<string>(initialBeanUid ?? '');
  const [grams, setGrams] = useState<string>(() => getDefaultLabelGrams());
  const [count, setCount] = useState<string>(() => getDefaultLabelCount());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [labels, setLabels] = useState<LabelPreview[]>([]);
  const [previewGeneration, setPreviewGeneration] = useState(0);
  const [previewResult, setPreviewResult] = useState<{
    bean: BeanListRow; grams: number | null; generation: number; translate: typeof t;
    label?: LabelPreview; error?: string;
  } | null>(null);
  const printPending = useRef(false);
  const historyRequest = useRef(0);
  const [labelHistory, setLabelHistory] = useState<LabelHistoryBatch[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const supportsNativePrint = canPrintBrotherLabels();
  const printerName = getLabelPrinterName();

  const selected = useMemo(() => beans.find((b) => b.uid === beanUid) ?? null, [beans, beanUid]);
  const gramsNumber = grams.trim() ? Number(grams) : null;
  const gramsValid = gramsNumber === null || (Number.isFinite(gramsNumber) && gramsNumber >= 0);
  const countNumber = Number(count);
  const countValid = Number.isInteger(countNumber) && countNumber >= 1 && countNumber <= 200;
  const currentPreview = previewResult?.bean === selected && previewResult.grams === gramsNumber &&
    previewResult.generation === previewGeneration && previewResult.translate === t ? previewResult : null;
  const preview = currentPreview?.label;

  useEffect(() => {
    if (!selected || !gramsValid) return;
    let cancelled = false;
    const source = { bean: selected, grams: gramsNumber, generation: previewGeneration, translate: t };
    void createLabelPreview(selected, gramsNumber, t).then(label => {
      if (!cancelled) setPreviewResult({ ...source, label });
    }).catch(error => {
      if (!cancelled) setPreviewResult({ ...source, error: error instanceof BeanLabelLayoutError
        ? t('beanLabels.error.tooLong', { length: String(BEAN_LABEL_DIMENSIONS.maxLengthMm) })
        : getStorageErrorMessage(error, t('common.loadFailed'), t) });
    });
    return () => { cancelled = true; };
  }, [selected, gramsNumber, gramsValid, previewGeneration, t]);

  async function loadLabelHistory(beanUidValue: string) {
    const request = ++historyRequest.current;
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
        rows = await fetchAllRows<StoredLabelRow>(() => supabase
          .from('bean_labels')
          .select('uid,bean_uid,grams,created_at')
          .eq('bean_uid', beanUidValue)
          .order('created_at', { ascending: false })
          .order('uid', { ascending: false }));
      }
      if (request === historyRequest.current) setLabelHistory(groupLabelHistory(rows));
    } catch (e) {
      if (request === historyRequest.current) setMsg({ tone: 'error', text: getStorageErrorMessage(e, t('common.loadFailed'), t) });
    } finally {
      if (request === historyRequest.current) setHistoryLoading(false);
    }
  }

  useEffect(() => {
    void loadLabelHistory(beanUid);
    return () => { historyRequest.current++; };
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
    if (!selected || isGuest || printPending.current || (!options && !preview)) return;
    const n = options?.countValue ?? countNumber;
    const gramsNum = options && 'gramsValue' in options ? options.gramsValue ?? null : gramsNumber;
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      setMsg({ tone: 'error', text: t('beanLabels.error.count') });
      return;
    }
    if (gramsNum !== null && (!Number.isFinite(gramsNum) || gramsNum < 0)) {
      setMsg({ tone: 'error', text: t('beanLabels.error.grams') });
      return;
    }
    printPending.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const first = preview?.grams === gramsNum ? preview : await createLabelPreview(selected, gramsNum, t);
      const next: LabelPreview[] = [first];
      for (let i = 1; i < n; i++) {
        next.push(await createLabelPreview(selected, gramsNum, t));
      }

      {
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

      // This UUID now exists in storage. Reserve a new one for the next print.
      setPreviewGeneration(value => value + 1);
      setLabels(next);
      if (supportsNativePrint) {
        await printBrotherLabels({
          printerName: printerName.trim() || DEFAULT_BROTHER_PRINTER_NAME,
          labels: next.map((label) => ({ pngDataUrl: label.printDataUrl })),
        });
        setMsg({ tone: 'success', text: options?.successText ?? t('beanLabels.printedNative') });
      } else {
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
        await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.print-label-sheet img'))
          .map(image => image.decode?.()));
        window.print();
      }
      await loadLabelHistory(selected.uid);
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof BeanLabelLayoutError
        ? t('beanLabels.error.tooLong', { length: String(BEAN_LABEL_DIMENSIONS.maxLengthMm) })
        : getStorageErrorMessage(e, t('common.loadFailed'), t) });
    } finally {
      printPending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-label-sheet { display: block !important; }
          .label-sheet { padding: 0 !important; margin: 0 !important; }
          body { background: white !important; }
        }
        .label-sheet {
          width: 100%;
          max-width: 100%;
          overflow-x: auto;
          padding: 1px;
        }
        .label {
          width: var(--label-width);
          margin: 0 auto;
          background: white;
          outline: 1px solid #e5e7eb;
          display: flex;
          align-items: center;
          justify-content: center;
          page-break-inside: avoid;
        }
        .label-image {
          display: block;
          width: 100%;
          height: auto;
          image-rendering: pixelated;
        }
        @media print {
          .label-sheet { overflow: visible; }
          .label { width: var(--label-print-width); outline: none; }
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

      {supportsNativePrint && <BrotherPrinterStatusPanel printerName={printerName} printing={busy} />}

      <div className="no-print bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
        {isGuest && (
          <p role="note" className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">
            {t('beanLabels.guestQrUnavailable')}
          </p>
        )}
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
            <select className="w-full p-2 border rounded-lg" value={beanUid} disabled={busy} onChange={(e) => setBeanUid(e.target.value)}>
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
          {!supportsNativePrint && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            {t('beanLabels.defaultsSummary', { printerName: printerName.trim() || DEFAULT_BROTHER_PRINTER_NAME })}
          </div>}
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('beanLabels.field.grams')}</label>
              <input
                className="w-full p-2 border rounded-lg"
                inputMode="decimal"
                disabled={busy}
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
                disabled={busy}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                placeholder="4"
              />
            </div>
          </div>
          {!gramsValid && <p role="alert" className="text-xs text-red-700">{t('beanLabels.error.grams')}</p>}
          {!countValid && <p role="alert" className="text-xs text-red-700">{t('beanLabels.error.count')}</p>}
        </div>
      </div>

      {selected && <section className="no-print space-y-3 label-preview" aria-label={t('beanLabels.preview.title')}>
        <div className="flex items-center justify-between gap-3 text-sm">
          <h3 className="font-semibold">{t('beanLabels.preview.title')}</h3>
          {countValid && <span className="text-gray-500">{t('beanLabels.preview.count', { count: String(countNumber) })}</span>}
        </div>
        <div className="min-h-[196px]">
          {currentPreview?.error ? <p role="alert" className="text-sm text-red-700">{currentPreview.error}</p>
            : !gramsValid ? null : preview ? <div className="label-sheet"><LabelFigure label={preview} t={t} /></div>
              : <p role="status" className="text-sm text-gray-500">{t('beanLabels.preview.loading')}</p>}
        </div>
      </section>}

      <button type="button"
        className="no-print w-full inline-flex justify-center items-center gap-2 px-3 py-3 rounded-lg bg-amber-700 text-white text-sm hover:bg-amber-800 disabled:bg-gray-300"
        onClick={() => void generateAndPrint()}
        disabled={isGuest || !preview || !gramsValid || !countValid || busy}>
        <Printer size={18} aria-hidden="true" />
        {busy ? t('beanLabels.generatePrinting') : t('beanLabels.generateAndPrint')}
      </button>

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
                    disabled={isGuest || busy || !selected}
                  >
                    {t('beanLabels.history.reprint')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {labels.length > 0 && (
        <div className="print-label-sheet label-sheet space-y-2" style={{ display: 'none' }} aria-hidden="true">
          {labels.map(label => <LabelFigure key={label.uid} label={label} t={t} forPrint />)}
        </div>
      )}
    </div>
  );
}
