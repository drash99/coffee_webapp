import { useI18n } from '../../i18n/I18nProvider';
import { beverageFlavorLabel } from '../beverageFlavorWheels';
import type { BeverageType, FlavorNote } from '../types';

type Props = {
  notes: FlavorNote[] | null | undefined;
  emptyLabel: string;
  beverageType?: BeverageType;
};

/** Renders a list of FlavorNote chips with colored dots. Shows emptyLabel when empty. */
export function NoteDotsList({ notes, emptyLabel, beverageType = 'coffee' }: Props) {
  const { t } = useI18n();
  if (!notes || notes.length === 0) return <div className="text-gray-900">{emptyLabel}</div>;
  return (
    <div className="flex flex-wrap gap-2">
      {notes.map((n) => (
        <div key={n.path.join('>')} className="flex max-w-full items-center gap-2 px-3 py-1 rounded-full border bg-white text-sm">
          <span className="inline-block w-2 h-2 shrink-0 rounded-full" style={{ backgroundColor: n.color }} />
          <span className="min-w-0 break-words text-gray-900">{n.path.map(name => beverageFlavorLabel(name, beverageType, t)).join(' / ')}</span>
        </div>
      ))}
    </div>
  );
}

