import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ClipboardCopy, RefreshCw, Trash2 } from 'lucide-react';
import type { AppUser } from '../../auth/types';
import { getSupabaseClient } from '../../config/supabase';
import { useI18n } from '../../i18n/I18nProvider';
import type { I18nKey } from '../../i18n/i18n';
import { BeverageTypeSelect } from '../components/BeverageTypeSelect';
import { FlavorWheelPicker } from '../components/FlavorWheelPicker';
import { PhotoImportPanel } from '../components/PhotoImportPanel';
import { StarRating } from '../components/StarRating';
import { localDeleteBean, localDeleteBrew, localGetAllData, localSaveData } from '../storage';
import { saveCloudData, type BeanlogSaveData } from '../storage/cloudDb';
import { validateLocalData } from '../storage/localDataValidation';
import type { BeanRow, BeverageDetails, BeverageType, BrewRow, FlavorNote } from '../types';
import { beverageTypeOf, type NonCoffeeBeverage as Category } from '../utils/beverage';
import { buildBeverageImportPrompt, parseBeverageImportJson } from '../utils/beanJsonImport';
import { beverageItemFields, detailKey, type DetailField } from '../utils/beverageFields';
import { fmtDate, todayYMD } from '../utils/formatting';
import { fetchAllRows } from '../utils/pagination';
import { getStorageErrorMessage } from '../utils/storageError';

type Props = { user: AppUser; isGuest: boolean; category: Category; mode: 'new' | 'history' | 'beans'; initialBeanUid?: string };
type RecordWithCategory = BrewRow & { beans?: { beverage_type: BeverageType } };
type TextFields = Record<string, string>;
type ItemField = 'bean_name' | 'producer' | 'origin_country' | 'origin_location' | 'varietal' | 'process' | 'cup_notes';
type ItemDraft = Record<ItemField, string> & { type: BeverageType; notes: FlavorNote[]; details: TextFields };
type RecordDraft = { date: string; notes: FlavorNote[]; text: string; rating: number; water: string; temp: string; method: string; details: TextFields };

const recordFields = {
  tea: [
    { key: 'beverage.leafGrams', numeric: [0, 10000, 0.1] },
    { key: 'beverage.waterMl', numeric: [0, 100000, 1] },
    { key: 'beverage.steepSeconds', numeric: [0, 86400, 1] },
    { key: 'beverage.infusions', numeric: [1, 100, 1] },
  ],
  wine: [
    { key: 'beverage.serveTemp', numeric: [-10, 50, 0.1] },
    { key: 'beverage.decantMinutes', numeric: [0, 1440, 1] },
    { key: 'beverage.dryness', options: ['dry', 'offDry', 'sweet'] },
    { key: 'beverage.tannins', options: ['low', 'medium', 'high'] },
    { key: 'beverage.pairing' },
  ],
} satisfies Record<Category, DetailField[]>;
const fields: ItemField[] = ['bean_name', 'producer', 'origin_country', 'origin_location', 'varietal', 'process', 'cup_notes'];
const inputClass = 'w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900';
const primaryClass = 'rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50';
const commandClass = 'inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50';
const optionKey = (value: string) => `beverage.option.${value}` as I18nKey;
const textDetails = (source: BeverageDetails = {}) => Object.fromEntries(Object.entries(source).map(([key, value]) => [key, String(value)]));
const nullable = (text: string) => text.trim() || null;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1 text-sm font-medium text-gray-700"><span>{label}</span>{children}</label>;
}

function DetailsFields({ fields, values, change }: { fields: DetailField[]; values: TextFields; change: (value: TextFields) => void }) {
  const { t } = useI18n();
  return <div className="grid gap-3 sm:grid-cols-2">
    {fields.map(field => {
      const key = detailKey(field);
      const value = values[key] ?? '';
      const set = (next: string) => change({ ...values, [key]: next });
      return <Field key={key} label={t(field.key)}>
        {field.options ? <select className={inputClass} value={value} onChange={e => set(e.target.value)}>
          <option value="">{t('common.none')}</option>
          {value && !field.options.includes(value) && <option value={value}>{value}</option>}
          {field.options.map(option => <option key={option} value={option}>{t(optionKey(option))}</option>)}
        </select> : <input className={inputClass} value={value} onChange={e => set(e.target.value)}
          type={field.numeric ? 'number' : 'text'} min={field.numeric?.[0]} max={field.numeric?.[1]}
          step={field.numeric?.[2] === 1 ? 1 : 'any'} inputMode={field.numeric ? 'decimal' : undefined} />}
      </Field>;
    })}
  </div>;
}

function itemDraft(category: Category, item?: BeanRow): ItemDraft {
  return {
    bean_name: item?.bean_name ?? '', producer: item?.producer ?? '', origin_country: item?.origin_country ?? '',
    origin_location: item?.origin_location ?? '', varietal: item?.varietal ?? '', process: item?.process ?? '',
    cup_notes: item?.cup_notes ?? '', type: item ? beverageTypeOf(item) : category,
    notes: item?.cup_flavor_notes ?? [], details: textDetails(item?.beverage_details),
  };
}

function recordDraft(record?: BrewRow): RecordDraft {
  return {
    date: record?.brew_date.slice(0, 10) ?? todayYMD(), notes: record?.taste_flavor_notes ?? [],
    text: record?.taste_note ?? '', rating: record?.rating ?? 0, water: record?.water ?? '',
    temp: record?.water_temp_c == null ? '' : String(record.water_temp_c), method: record?.recipe ?? '',
    details: textDetails(record?.beverage_details),
  };
}

function ItemFields({ category, draft, set }: { category: Category; draft: ItemDraft; set: (draft: ItemDraft) => void }) {
  const { t } = useI18n();
  const labels: Record<ItemField, I18nKey> = {
    bean_name: 'beverage.itemName', producer: 'bean.field.producer', origin_country: 'bean.field.originCountry',
    origin_location: 'bean.field.originLocation', varietal: category === 'tea' ? 'beverage.cultivar' : 'beverage.grape',
    process: 'bean.field.process', cup_notes: 'beverage.itemNotes',
  };
  return <>
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.filter(key => key !== 'cup_notes' && (key !== 'process' || category === 'tea')).map(key => (
        <Field key={key} label={t(labels[key])}><input required={key === 'bean_name'} className={inputClass}
          value={draft[key]} onChange={e => set({ ...draft, [key]: e.target.value })} /></Field>
      ))}
    </div>
    <DetailsFields fields={beverageItemFields[category]} values={draft.details} change={details => set({ ...draft, details })} />
    <Field label={t('beverage.itemNotes')}><textarea className={inputClass} rows={2} value={draft.cup_notes}
      onChange={e => set({ ...draft, cup_notes: e.target.value })} /></Field>
    <FlavorWheelPicker beverageType={category} label={t('beverage.itemNotes')} value={draft.notes}
      onChange={notes => set({ ...draft, notes })} />
  </>;
}

export function BeverageJournalPage({ user, isGuest, category, mode, initialBeanUid }: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState<BeanRow[]>([]);
  const [records, setRecords] = useState<BrewRow[]>([]);
  const [itemId, setItemId] = useState(initialBeanUid ?? '');
  const [recordId, setRecordId] = useState('');
  const [item, setItem] = useState(() => itemDraft(category));
  const [record, setRecord] = useState(() => recordDraft());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ error?: boolean; text: string } | null>(null);
  const loadVersion = useRef(0);
  const pending = useRef(false);
  const draftItemId = useRef('');
  const draftRecordId = useRef('');
  const selectedItem = items.find(row => row.uid === itemId);
  const selectedRecord = records.find(row => row.uid === recordId);
  const importPrompt = useMemo(() => buildBeverageImportPrompt(category, items), [category, items]);

  async function refresh() {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      let beans: BeanRow[];
      let brews: BrewRow[] = [];
      if (isGuest) {
        const local = localGetAllData();
        validateLocalData(local, { allowOrphanLabels: true });
        beans = local.beans;
        if (mode === 'history') brews = local.brews;
      } else {
        const client = getSupabaseClient();
        beans = await fetchAllRows<BeanRow>(() => client.from('beans').select('*')
          .eq('beverage_type', category).order('created_at', { ascending: false }).order('uid'));
        if (mode === 'history' && beans.length) {
          const joined = await fetchAllRows<RecordWithCategory>(() => client.from('brews').select('*,beans!inner(beverage_type)')
            .eq('beans.beverage_type', category).order('brew_date', { ascending: false }).order('uid'));
          brews = joined.map(({ beans: _parent, ...row }) => row);
        }
      }
      if (version !== loadVersion.current) return;
      const matching = beans.filter(row => beverageTypeOf(row) === category)
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
      const ids = new Set(matching.map(row => row.uid));
      setItems(matching);
      setRecords(brews.filter(row => ids.has(row.bean_uid) && (!initialBeanUid || row.bean_uid === initialBeanUid))
        .sort((a, b) => b.brew_date.localeCompare(a.brew_date)));
    } catch (error) {
      if (version === loadVersion.current) setStatus({ error: true, text: getStorageErrorMessage(error, t('common.loadFailed'), t) });
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    return () => { loadVersion.current++; };
  }, [user.uid, isGuest, category, mode, initialBeanUid]);

  function applyPhotoImport(raw: string) {
    const { beverage_details, cup_flavor_notes, ...fields } = parseBeverageImportJson(raw, category);
    draftItemId.current = '';
    setItem({ ...fields, type: category, details: textDetails(beverage_details), notes: cup_flavor_notes });
    setStatus(null);
  }

  function parseDetails(prior: BeverageDetails, values: TextFields, fields: DetailField[]): BeverageDetails {
    const result = { ...prior };
    for (const field of fields) {
      const key = detailKey(field);
      const raw = nullable(values[key] ?? '');
      if (raw === null) { delete result[key]; continue; }
      if (field.numeric) {
        const [min, max, step] = field.numeric;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < min || value > max || (step === 1 && !Number.isInteger(value))) {
          throw new Error(t('beverage.invalidNumber', { field: t(field.key) }));
        }
        result[key] = value;
      } else result[key] = raw;
    }
    return result;
  }

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setStatus(null);
    try {
      await action();
      setStatus({ text: t('beverage.saved') });
      await refresh();
    } catch (error) {
      setStatus({ error: true, text: getStorageErrorMessage(error, t('newBrew.error.saveFailed'), t) });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function save(event: FormEvent, saveItemOnly: boolean) {
    event.preventDefault();
    void run(async () => {
      const data: BeanlogSaveData = {};
      const previous = saveItemOnly ? selectedItem : undefined;
      const tasting = mode === 'history' ? selectedRecord : undefined;
      const needsItem = saveItemOnly || (!selectedItem && !tasting);
      const beanUid = tasting?.bean_uid ?? selectedItem?.uid ?? (draftItemId.current ||= crypto.randomUUID());
      if (needsItem) {
        if (!item.bean_name.trim()) throw new Error(t('beverage.error.required'));
        data.beans = [{
          uid: beanUid, roastery: previous?.roastery ?? null, roasted_on: previous?.roasted_on ?? null,
          bean_name: nullable(item.bean_name), producer: nullable(item.producer),
          origin_country: nullable(item.origin_country), origin_location: nullable(item.origin_location),
          process: nullable(item.process), varietal: nullable(item.varietal), cup_notes: nullable(item.cup_notes),
          cup_flavor_notes: item.notes, beverage_type: item.type,
          beverage_details: parseDetails(previous?.beverage_details ?? {}, item.details, beverageItemFields[category]),
        }];
      }
      if (!saveItemOnly) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !Number.isFinite(Date.parse(record.date))
          || new Date(record.date).toISOString().slice(0, 10) !== record.date) {
          throw new Error(t('beverage.error.required'));
        }
        const { user_uid: _owner, ...prior } = tasting ?? {};
        const temp = nullable(record.temp);
        if (category === 'tea' && temp !== null && (!Number.isFinite(Number(temp)) || Number(temp) < 0 || Number(temp) > 100)) {
          throw new Error(t('beverage.invalidNumber', { field: t('brew.field.waterTemp', { unit: 'C' }) }));
        }
        data.brews = [{
          grinder_uid: null, grinder_setting: null, recipe: null, coffee_dose_g: null, coffee_yield_g: null,
          coffee_tds: null, water: null, water_temp_c: null, grind_median_um: null, extraction_note: null,
          ...prior, uid: tasting?.uid ?? (draftRecordId.current ||= crypto.randomUUID()), bean_uid: beanUid,
          brew_date: tasting?.brew_date.slice(0, 10) === record.date ? tasting.brew_date : new Date(record.date + 'T12:00:00').toISOString(),
          ...(category === 'tea' ? { water: nullable(record.water), water_temp_c: temp === null ? null : Number(temp), recipe: nullable(record.method) } : {}),
          taste_note: nullable(record.text), taste_flavor_notes: record.notes, rating: record.rating || null,
          beverage_details: parseDetails(tasting?.beverage_details ?? {}, record.details, recordFields[category]),
        }];
      }
      if (isGuest) localSaveData(data);
      else await saveCloudData(data);
      draftItemId.current = '';
      draftRecordId.current = '';
      if (!tasting) setRecord(recordDraft());
      if (!saveItemOnly || item.type === category) setItemId(beanUid);
      else { setItemId(''); setItem(itemDraft(category)); }
    });
  }

  function remove() {
    const row = mode === 'history' ? selectedRecord : selectedItem;
    if (!row || !window.confirm(t(mode === 'history' ? 'beverage.deleteTasting' : 'beverage.deleteItem'))) return;
    void run(async () => {
      if (isGuest) {
        if (mode === 'history') localDeleteBrew(row.uid);
        else localDeleteBean(row.uid);
      } else {
        const { error } = await getSupabaseClient().from(mode === 'history' ? 'brews' : 'beans').delete().eq('uid', row.uid);
        if (error) throw new Error(error.message);
      }
      setItemId(''); setRecordId(''); setItem(itemDraft(category)); setRecord(recordDraft());
    });
  }

  async function exportJson() {
    try {
      const rows = mode === 'history' ? records : items;
      const publicItems = items.map(({ user_uid: _owner, ...row }) => row);
      const byId = new Map(publicItems.map(row => [row.uid, row]));
      await navigator.clipboard.writeText(JSON.stringify({
        type: mode === 'history' ? 'beanlog.brew_history' : 'beanlog.bean_history',
        version: 1, beverage_type: category, exported_at: new Date().toISOString(), count: rows.length,
        ...(mode === 'history'
          ? { brews: records.map(({ user_uid: _owner, ...row }) => ({ ...row, bean: byId.get(row.bean_uid) ?? null })) }
          : { beans: publicItems }),
      }, null, 2));
      setStatus({ text: t('beverage.exported', { count: rows.length }) });
    } catch {
      setStatus({ error: true, text: t('history.exportJson.failed') });
    }
  }

  const showItemEditor = mode === 'beans' || (mode === 'new' && !selectedItem);
  const showRecordEditor = mode === 'new' || Boolean(selectedRecord);
  return <section className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{t(mode === 'history' ? 'logging.tab.history' :
        mode === 'new' ? `beverage.new.${category}` : `beverage.library.${category}`)}</h2>
      <div className="flex flex-wrap gap-2">
        {mode !== 'new' && <button type="button" className={commandClass} disabled={busy || loading || (mode === 'history' ? !records.length : !items.length)} onClick={() => void exportJson()}>
          <ClipboardCopy size={16} aria-hidden="true" />{t('beanHistory.exportJson')}
        </button>}
        <button type="button" className={commandClass} disabled={busy || loading} onClick={() => void refresh()}
          title={t('beanHistory.refresh')} aria-label={t('beanHistory.refresh')}><RefreshCw size={16} aria-hidden="true" /></button>
      </div>
    </header>
    {loading && <p role="status" className="text-sm text-gray-500">{t('beanHistory.refresh.loading')}</p>}
    {status && <p role={status.error ? 'alert' : 'status'} className={status.error ? 'text-sm text-red-700' : 'text-sm text-green-700'}>{status.text}</p>}
    {mode === 'history' && !loading && !records.length && <p className="text-sm text-gray-500">{t('beverage.emptyTastings')}</p>}
    <form onSubmit={event => save(event, mode === 'beans')}>
      <fieldset disabled={busy || loading} className="min-w-0 space-y-4 border-t border-gray-200 py-4">
        {mode === 'history' ? records.length > 0 && <Field label={t('logging.tab.history')}>
          <select className={inputClass} value={recordId} onChange={e => {
            const next = records.find(row => row.uid === e.target.value);
            setRecordId(e.target.value); setRecord(recordDraft(next)); setStatus(null);
          }}>
            <option value="">{t('common.none')}</option>
            {records.map(row => <option key={row.uid} value={row.uid}>
              {fmtDate(row.brew_date)} · {items.find(bean => bean.uid === row.bean_uid)?.bean_name ?? t('common.none')}
            </option>)}
          </select>
        </Field> : <Field label={t('beverage.savedItem')}>
          <select className={inputClass} value={itemId} onChange={e => {
            draftItemId.current = '';
            setItemId(e.target.value); setItem(itemDraft(category, items.find(row => row.uid === e.target.value))); setStatus(null);
          }}>
            <option value="">{t(`beverage.newItem.${category}`)}</option>
            {items.map(row => <option key={row.uid} value={row.uid}>{row.bean_name || t('common.none')}</option>)}
          </select>
        </Field>}
        {showItemEditor && <>
          {!selectedItem && <PhotoImportPanel prompt={importPrompt} onImport={applyPhotoImport} />}
          <ItemFields category={category} draft={item} set={setItem} />
          {mode === 'beans' && selectedItem && <BeverageTypeSelect value={item.type} onChange={type => setItem({ ...item, type })} />}
          {(selectedItem?.roastery || selectedItem?.roasted_on) && <details className="text-sm text-gray-600">
            <summary>{t('beverage.legacy')}</summary>
            <p>{[selectedItem.roastery, selectedItem.roasted_on].filter(Boolean).join(' · ')}</p>
          </details>}
        </>}
        {showRecordEditor && <div className="space-y-3 border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-gray-800">{t(category === 'tea' ? 'beverage.steeping' : 'beverage.tasting')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('beverage.date')}><input className={inputClass} type="date" required value={record.date}
              onChange={e => setRecord({ ...record, date: e.target.value })} /></Field>
            {category === 'tea' && <>
              <Field label={t('brew.field.recipe')}><input className={inputClass} value={record.method} onChange={e => setRecord({ ...record, method: e.target.value })} /></Field>
              <Field label={t('brew.field.water')}><input className={inputClass} value={record.water} onChange={e => setRecord({ ...record, water: e.target.value })} /></Field>
              <Field label={t('brew.field.waterTemp', { unit: 'C' })}><input className={inputClass} type="number" step="any" min="0" max="100"
                value={record.temp} onChange={e => setRecord({ ...record, temp: e.target.value })} /></Field>
            </>}
          </div>
          <DetailsFields fields={recordFields[category]} values={record.details} change={details => setRecord({ ...record, details })} />
          {selectedRecord && (selectedRecord.coffee_dose_g != null || selectedRecord.coffee_yield_g != null || selectedRecord.extraction_note) &&
            <details className="text-sm text-gray-600"><summary>{t('beverage.legacy')}</summary>
              {selectedRecord.coffee_dose_g != null && <p>{t('brew.field.dose')}: {selectedRecord.coffee_dose_g} g</p>}
              {selectedRecord.coffee_yield_g != null && <p>{t('brew.field.yield')}: {selectedRecord.coffee_yield_g} g</p>}
              {selectedRecord.extraction_note && <p className="whitespace-pre-wrap">{selectedRecord.extraction_note}</p>}
            </details>}
          <Field label={t('beverage.notes')}><textarea rows={3} className={inputClass} value={record.text}
            onChange={e => setRecord({ ...record, text: e.target.value })} /></Field>
          <FlavorWheelPicker beverageType={category} label={t('beverage.notes')} value={record.notes}
            onChange={notes => setRecord({ ...record, notes })} />
          <div className="space-y-1 text-sm"><p>{t('brew.field.rating')}</p>
            <StarRating value={record.rating} onChange={rating => setRecord({ ...record, rating })} /></div>
        </div>}
        {(showItemEditor || showRecordEditor) && <div className="flex flex-wrap gap-2">
          {mode === 'new' && !selectedItem && <button type="button" className={commandClass}
            onClick={event => save(event, true)}>
            {t('beverage.saveItem')}
          </button>}
          <button type="submit" className={primaryClass}>{t(mode === 'beans' ? 'beverage.saveItem' : 'beverage.record')}</button>
          {(mode === 'history' ? selectedRecord : mode === 'beans' && selectedItem) &&
            <button type="button" className={commandClass} title={t(mode === 'history' ? 'beverage.deleteTasting' : 'beverage.deleteItem')}
              aria-label={t(mode === 'history' ? 'beverage.deleteTasting' : 'beverage.deleteItem')} onClick={remove}><Trash2 size={16} aria-hidden="true" /></button>}
        </div>}
      </fieldset>
    </form>
  </section>;
}
