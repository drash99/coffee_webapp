import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import type { AppUser } from '../../auth/types';
import { getSupabaseClient } from '../../config/supabase';
import { useI18n } from '../../i18n/I18nProvider';
import { BeverageDetailsFields, BeverageField as Field, BeverageItemFields, beverageInputClass as inputClass } from '../components/BeverageFields';
import { FlavorWheelPicker } from '../components/FlavorWheelPicker';
import { PhotoImportPanel } from '../components/PhotoImportPanel';
import { StarRating } from '../components/StarRating';
import { localGetAllData, localSaveData } from '../storage';
import { saveCloudData, type BeanlogSaveData } from '../storage/cloudDb';
import { validateLocalData } from '../storage/localDataValidation';
import type { BeanRow, FlavorNote } from '../types';
import { beverageTypeOf, type NonCoffeeBeverage as Category } from '../utils/beverage';
import { buildBeverageImportPrompt, parseBeverageImportJson } from '../utils/beanJsonImport';
import { beverageItemFields, beverageTastingFields, beverageWaterTemperature, parseBeverageDetails,
  productDraft, productFields, textDetails, type DetailsDraft } from '../utils/beverageFields';
import { todayYMD } from '../utils/formatting';
import { fetchAllRows } from '../utils/pagination';
import { getStorageErrorMessage } from '../utils/storageError';

type Props = { user: AppUser; isGuest: boolean; category: Category; initialBeanUid?: string };
type RecordDraft = { date: string; notes: FlavorNote[]; text: string; rating: number; water: string; temp: string; method: string; details: DetailsDraft };

const primaryClass = 'rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50';
const commandClass = 'inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50';
const nullable = (text: string) => text.trim() || null;

function recordDraft(): RecordDraft {
  return { date: todayYMD(), notes: [], text: '', rating: 0, water: '', temp: '', method: '', details: {} };
}

export function BeverageJournalPage({ user, isGuest, category, initialBeanUid }: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState<BeanRow[]>([]);
  const [itemId, setItemId] = useState(initialBeanUid ?? '');
  const [item, setItem] = useState(() => productDraft(category));
  const [record, setRecord] = useState(() => recordDraft());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ error?: boolean; text: string } | null>(null);
  const loadVersion = useRef(0);
  const pending = useRef(false);
  const draftItemId = useRef('');
  const draftRecordId = useRef('');
  const selectedItem = items.find(row => row.uid === itemId);
  const importPrompt = useMemo(() => buildBeverageImportPrompt(category, items), [category, items]);

  async function refresh() {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      let beans: BeanRow[];
      if (isGuest) {
        const local = localGetAllData();
        validateLocalData(local, { allowOrphanLabels: true });
        beans = local.beans;
      } else {
        const client = getSupabaseClient();
        beans = await fetchAllRows<BeanRow>(() => client.from('beans').select('*')
          .eq('beverage_type', category).order('created_at', { ascending: false }).order('uid'));
      }
      if (version !== loadVersion.current) return;
      setItems(beans.filter(row => beverageTypeOf(row) === category)
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')));
    } catch (error) {
      if (version === loadVersion.current) setStatus({ error: true, text: getStorageErrorMessage(error, t('common.loadFailed'), t) });
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    return () => { loadVersion.current++; };
  }, [user.uid, isGuest, category, initialBeanUid]);

  function applyPhotoImport(raw: string) {
    const { beverage_details, ...fields } = parseBeverageImportJson(raw, category);
    draftItemId.current = '';
    setItem({ ...productDraft(category), ...fields, details: textDetails(beverage_details) });
    setStatus(null);
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
      const beanUid = selectedItem?.uid ?? (draftItemId.current ||= crypto.randomUUID());
      if (!selectedItem) {
        if (!item.bean_name.trim()) throw new Error(t('beverage.error.required'));
        data.beans = [{
          uid: beanUid, ...productFields(item), beverage_type: category,
          beverage_details: parseBeverageDetails(item.details, beverageItemFields[category], t),
        }];
      }
      if (!saveItemOnly) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !Number.isFinite(Date.parse(record.date))
          || new Date(record.date).toISOString().slice(0, 10) !== record.date) {
          throw new Error(t('beverage.error.required'));
        }
        data.brews = [{
          grinder_uid: null, grinder_setting: null, recipe: null, coffee_dose_g: null, coffee_yield_g: null,
          coffee_tds: null, water: null, water_temp_c: null, grind_median_um: null, extraction_note: null,
          uid: (draftRecordId.current ||= crypto.randomUUID()), bean_uid: beanUid,
          brew_date: new Date(record.date + 'T12:00:00').toISOString(),
          ...(category === 'tea' ? { water: nullable(record.water), water_temp_c: beverageWaterTemperature(record.temp, t), recipe: nullable(record.method) } : {}),
          taste_note: nullable(record.text), taste_flavor_notes: record.notes, rating: record.rating || null,
          beverage_details: parseBeverageDetails(record.details, beverageTastingFields[category], t),
        }];
      }
      if (isGuest) localSaveData(data);
      else await saveCloudData(data);
      draftItemId.current = '';
      draftRecordId.current = '';
      if (!saveItemOnly) setRecord(recordDraft());
      setItemId(beanUid);
    });
  }

  return <section className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{t(`beverage.new.${category}`)}</h2>
      <button type="button" className={commandClass} disabled={busy || loading} onClick={() => void refresh()}
        title={t('beanHistory.refresh')} aria-label={t('beanHistory.refresh')}><RefreshCw size={16} aria-hidden="true" /></button>
    </header>
    {loading && <p role="status" className="text-sm text-gray-500">{t('beanHistory.refresh.loading')}</p>}
    {status && <p role={status.error ? 'alert' : 'status'} className={status.error ? 'text-sm text-red-700' : 'text-sm text-green-700'}>{status.text}</p>}
    <form onSubmit={event => save(event, false)}>
      <fieldset disabled={busy || loading} className="min-w-0 space-y-4 border-t border-gray-200 py-4">
        <Field label={t('beverage.savedItem')}>
          <select className={inputClass} value={itemId} onChange={e => {
            draftItemId.current = '';
            setItemId(e.target.value); setItem(productDraft(category)); setStatus(null);
          }}>
            <option value="">{t(`beverage.newItem.${category}`)}</option>
            {items.map(row => <option key={row.uid} value={row.uid}>{row.bean_name || t('common.none')}</option>)}
          </select>
        </Field>
        {!selectedItem && <>
          <PhotoImportPanel prompt={importPrompt} onImport={applyPhotoImport} />
          <BeverageItemFields category={category} draft={item} set={setItem} />
        </>}
        <div className="space-y-3 border-t border-gray-200 pt-4">
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
          <BeverageDetailsFields fields={beverageTastingFields[category]} values={record.details} change={details => setRecord({ ...record, details })} />
          <Field label={t('beverage.notes')}><textarea rows={3} className={inputClass} value={record.text}
            onChange={e => setRecord({ ...record, text: e.target.value })} /></Field>
          <FlavorWheelPicker beverageType={category} label={t('beverage.notes')} value={record.notes}
            onChange={notes => setRecord({ ...record, notes })} />
          <div className="space-y-1 text-sm"><p>{t('brew.field.rating')}</p>
            <StarRating value={record.rating} onChange={rating => setRecord({ ...record, rating })} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!selectedItem && <button type="button" className={commandClass}
            onClick={event => save(event, true)}>
            {t('beverage.saveItem')}
          </button>}
          <button type="submit" className={primaryClass}>{t('beverage.record')}</button>
        </div>
      </fieldset>
    </form>
  </section>;
}
