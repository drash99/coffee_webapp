import { Star } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';

type Props = {
  value: number; // 0..5, step 0.5
  onChange: (next: number) => void;
  disabled?: boolean;
};

function clampRating(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(5, Math.round(v * 2) / 2));
}

export function StarRating({ value, onChange, disabled }: Props) {
  const { t } = useI18n();
  const v = clampRating(value);

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }, (_, idx) => {
        const starNum = idx + 1;
        const fillPct = Math.max(0, Math.min(1, v - idx)) * 100; // 0..100
        return (
          <div key={starNum} className="relative w-7 h-7">
            <Star className="w-7 h-7 text-gray-300" />
            <div className="absolute inset-0 overflow-hidden" style={{ width: `${fillPct}%` }}>
              <Star className="w-7 h-7 text-amber-500 fill-amber-500" />
            </div>

            {/* click halves for 0.5 granularity */}
            <button
              type="button"
              className="absolute inset-y-0 left-0 w-1/2"
              aria-label={t('brew.rating.aria.set', { value: starNum - 0.5 })}
              onClick={() => onChange(clampRating(starNum - 0.5))}
              disabled={disabled}
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 w-1/2"
              aria-label={t('brew.rating.aria.set', { value: starNum })}
              onClick={() => onChange(clampRating(starNum))}
              disabled={disabled}
            />
          </div>
        );
      })}

      <button
        type="button"
        className="ml-2 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50 disabled:bg-gray-100"
        onClick={() => onChange(0)}
        disabled={disabled || v === 0}
      >
        {t('brew.rating.clear')}
      </button>
    </div>
  );
}


