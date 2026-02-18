import { useEffect, useMemo, useState } from 'react';
import type { AppUser } from '../../auth/types';
import { getSupabaseClient } from '../../config/supabase';
import { useI18n } from '../../i18n/I18nProvider';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { FlavorWheelPicker } from '../components/FlavorWheelPicker';
import { NoteDotsList } from '../components/NoteDotsList';
import { useBeanSuggestions } from '../hooks/useBeanSuggestions';
import { fmtDate } from '../utils/formatting';
import { beanDisplayLabel } from '../utils/beanLabel';
import type { BeanInput, BeanRow, FlavorNote } from '../types';
import {
  localListBeans,
  localUpdateBean,
  localDeleteBean,
} from '../storage';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<BeanInput | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('beanHistory.title')}</h2>
        <button
          type="button"
          className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? t('beanHistory.refresh.loading') : t('beanHistory.refresh')}
        </button>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{error}</div>}

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

                <div className="grid grid-cols-2 gap-3">
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
