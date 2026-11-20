import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { I18nKey } from '../../i18n/i18n';
import type { BeverageDetails } from '../types';
import type { NonCoffeeBeverage } from '../utils/beverage';
import { beverageItemFields, detailKey, detailOptionKey, type DetailField, type DetailsDraft, type ProductDraft } from '../utils/beverageFields';
import { FlavorWheelPicker } from './FlavorWheelPicker';

export const beverageInputClass = 'w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900';

export function BeverageField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1 text-sm font-medium text-gray-700"><span>{label}</span>{children}</label>;
}

export function BeverageDetailsFields({ fields, values, change }: {
  fields: DetailField[]; values: DetailsDraft; change: (value: DetailsDraft) => void;
}) {
  const { t } = useI18n();
  return <div className="grid gap-3 sm:grid-cols-2">
    {fields.map(field => {
      const key = detailKey(field);
      const value = values[key] ?? '';
      const set = (next: string) => change({ ...values, [key]: next });
      return <BeverageField key={key} label={t(field.key)}>
        {field.options ? <select className={beverageInputClass} value={value} onChange={e => set(e.target.value)}>
          <option value="">{t('common.none')}</option>
          {value && !field.options.includes(value) && <option value={value}>{value}</option>}
          {field.options.map(option => <option key={option} value={option}>{t(detailOptionKey(option))}</option>)}
        </select> : <input className={beverageInputClass} value={value} onChange={e => set(e.target.value)}
          type={field.numeric ? 'number' : 'text'} min={field.numeric?.[0]} max={field.numeric?.[1]}
          step={field.numeric?.[2] === 1 ? 1 : 'any'} inputMode={field.numeric ? 'decimal' : undefined} />}
      </BeverageField>;
    })}
  </div>;
}

export function DetailValue({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0">
    <div className="text-xs text-gray-500">{label}</div>
    <div className="break-words font-medium text-gray-900">{children}</div>
  </div>;
}

export function BeverageDetailValues({ fields, values }: { fields: DetailField[]; values?: BeverageDetails }) {
  const { t } = useI18n();
  return <>{fields.map(field => {
    const value = values?.[detailKey(field)];
    const label = typeof value === 'string' && field.options?.includes(value) ? t(detailOptionKey(value)) : value;
    return <DetailValue key={detailKey(field)} label={t(field.key)}>{label ?? t('common.none')}</DetailValue>;
  })}</>;
}

export function BeverageItemFields({ category, draft, set }: {
  category: NonCoffeeBeverage; draft: ProductDraft; set: (draft: ProductDraft) => void;
}) {
  const { t } = useI18n();
  const fields = [
    ['bean_name', 'beverage.itemName'], ['producer', 'bean.field.producer'],
    ['origin_country', 'bean.field.originCountry'], ['origin_location', 'bean.field.originLocation'],
    ['varietal', category === 'tea' ? 'beverage.cultivar' : 'beverage.grape'], ['process', 'bean.field.process'],
  ] as const satisfies readonly (readonly [keyof ProductDraft, I18nKey])[];
  return <>
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.filter(([key]) => key !== 'process' || category === 'tea').map(([key, label]) => (
        <BeverageField key={key} label={t(label)}><input required={key === 'bean_name'} className={beverageInputClass}
          value={draft[key]} onChange={e => set({ ...draft, [key]: e.target.value })} /></BeverageField>
      ))}
    </div>
    <BeverageDetailsFields fields={beverageItemFields[category]} values={draft.details} change={details => set({ ...draft, details })} />
    <BeverageField label={t('beverage.itemNotes')}><textarea className={beverageInputClass} rows={2} value={draft.cup_notes}
      onChange={e => set({ ...draft, cup_notes: e.target.value })} /></BeverageField>
    <FlavorWheelPicker beverageType={category} label={t('beverage.itemNotes')} value={draft.cup_flavor_notes}
      onChange={cup_flavor_notes => set({ ...draft, cup_flavor_notes })} />
  </>;
}
