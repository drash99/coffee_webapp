import { useEffect, useMemo, useState } from 'react';
import type { AppUser } from '../../auth/types';
import { getSupabaseClient } from '../../config/supabase';
import { useI18n } from '../../i18n/I18nProvider';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { FlavorWheelPicker } from '../components/FlavorWheelPicker';
import { useBeanSuggestions } from '../hooks/useBeanSuggestions';
import type { BeanInput, BeanRow, FlavorNote } from '../types';

type Props = {
  user: AppUser;
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

function beanDisplayLabel(bean: BeanListRow, fallback: string): string {
  const title =
    bean.bean_name?.trim() ||
    bean.roastery?.trim() ||
    bean.origin_location?.trim() ||
    bean.origin_country?.trim() ||
    fallback;
  const origin = [bean.origin_location, bean.origin_country].filter(Boolean).join(', ');
  const roastery = bean.roastery?.trim();
  if (roastery && origin) return `${title} — ${roastery} (${origin})`;
  if (roastery) return `${title} — ${roastery}`;
  if (origin) return `${title} (${origin})`;
  return title;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

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

function notesText(notes: FlavorNote[] | null | undefined, fallback: string): string {
  if (!notes || notes.length === 0) return fallback;
  return notes.map((n) => n.path.join(' / ')).join(', ');
}

export function BeanHistoryPage({ user }: Props) {
  const { t } = useI18n();
  const [rows, setRows] = useState<BeanListRow[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<BeanInput | null>(null);

  const { roasteries, countries, locationsForCountry, producersForLocation, varietals } = useBeanSuggestions(user.uid);

  const selected = useMemo(() => rows.find((r) => r.uid === selectedUid) ?? null, [rows, selectedUid]);

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function syncBeanFlavorNotes(beanUid: string, notes: FlavorNote[]) {
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

  async function saveEdit() {
    if (!selected || !editDraft) return;
    setEditError(null);
    setEditSaving(true);
    try {
      const supabase = getSupabaseClient();
      const { error: updErr } = await supabase
        .from('beans')
        .update({
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
        })
        .eq('uid', selected.uid);
      if (updErr) throw new Error(updErr.message);

      await syncBeanFlavorNotes(selected.uid, editDraft.cup_flavor_notes);
      await refresh();
      setIsEditing(false);
      setEditDraft(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t('newBrew.error.saveFailed'));
    } finally {
      setEditSaving(false);
    }
  }

  useEffect(() => {
    void refresh();
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 space-y-2">
            <div className="text-xs font-medium text-gray-500">{t('beanHistory.list.title')}</div>
            <div className="max-h-[480px] overflow-auto space-y-1">
              {rows.map((r) => (
                <button
                  key={r.uid}
                  type="button"
                  className={`w-full text-left p-2 rounded-lg border ${
                    selectedUid === r.uid ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200 hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedUid(r.uid)}
                >
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {beanDisplayLabel(r, t('history.bean.fallbackLabel'))}
                  </div>
                  <div className="text-xs text-gray-500">{fmtDate(r.roasted_on || r.created_at)}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-4">
            {!selected && <div className="text-sm text-gray-600">{t('beanHistory.selectPrompt')}</div>}

            {selected && !isEditing && (
              <>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-900">{t('beanHistory.detail.title')}</div>
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50"
                    onClick={() => {
                      setIsEditing(true);
                      setEditDraft(draftFromBean(selected));
                    }}
                  >
                    {t('beanHistory.edit.start')}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div><span className="text-gray-500">{t('bean.field.name')}:</span> {selected.bean_name || t('common.none')}</div>
                  <div><span className="text-gray-500">{t('bean.field.roastery')}:</span> {selected.roastery || t('common.none')}</div>
                  <div><span className="text-gray-500">{t('bean.field.originCountry')}:</span> {selected.origin_country || t('common.none')}</div>
                  <div><span className="text-gray-500">{t('bean.field.originLocation')}:</span> {selected.origin_location || t('common.none')}</div>
                  <div><span className="text-gray-500">{t('bean.field.producer')}:</span> {selected.producer || t('common.none')}</div>
                  <div><span className="text-gray-500">{t('bean.field.process')}:</span> {selected.process || t('common.none')}</div>
                  <div><span className="text-gray-500">{t('bean.field.varietal')}:</span> {selected.varietal || t('common.none')}</div>
                  <div><span className="text-gray-500">{t('bean.field.roastedOn')}:</span> {selected.roasted_on || t('common.none')}</div>
                </div>
                <div className="text-sm">
                  <span className="text-gray-500">{t('bean.field.notesFreeText')}:</span> {selected.cup_notes || t('common.none')}
                </div>
                <div className="text-sm">
                  <span className="text-gray-500">{t('bean.field.cupNotesSca')}:</span>{' '}
                  {notesText(selected.cup_flavor_notes as FlavorNote[] | null, t('common.none'))}
                </div>
              </>
            )}

            {selected && isEditing && editDraft && (
              <>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-900">{t('beanHistory.edit.title')}</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50"
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
                      className="px-3 py-2 rounded-lg bg-amber-700 text-white text-sm disabled:bg-gray-300"
                      onClick={() => void saveEdit()}
                      disabled={editSaving}
                    >
                      {editSaving ? t('beanHistory.edit.save.saving') : t('beanHistory.edit.save')}
                    </button>
                  </div>
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
