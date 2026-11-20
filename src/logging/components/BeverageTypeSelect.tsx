import { useI18n } from '../../i18n/I18nProvider';
import type { BeverageType } from '../types';
import { BEVERAGE_TYPES, isBeverageType } from '../utils/beverage';

export function BeverageTypeSelect({ value, onChange }: { value: BeverageType; onChange: (type: BeverageType) => void }) {
  const { t } = useI18n();
  return (
    <label className="block text-sm text-gray-700">
      {t('beverage.category')}
      <select className="mt-1 w-full rounded-lg border p-2 text-base" value={value} onChange={event => {
        const type = event.target.value;
        if (isBeverageType(type)) onChange(type);
      }}>
        {BEVERAGE_TYPES.map(type => <option value={type} key={type}>{t(`beverage.${type}`)}</option>)}
      </select>
      <span className="mt-1 block text-xs text-gray-500">{t('beverage.moveHint')}</span>
    </label>
  );
}
