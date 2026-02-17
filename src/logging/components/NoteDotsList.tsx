import type { FlavorNote } from '../types';

type Props = {
  notes: FlavorNote[] | null | undefined;
  emptyLabel: string;
};

/** Renders a list of FlavorNote chips with colored dots. Shows emptyLabel when empty. */
export function NoteDotsList({ notes, emptyLabel }: Props) {
  if (!notes || notes.length === 0) return <div className="text-gray-900">{emptyLabel}</div>;
  return (
    <div className="flex flex-wrap gap-2">
      {notes.map((n) => (
        <div key={n.path.join('>')} className="flex items-center gap-2 px-3 py-1 rounded-full border bg-white text-sm">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: n.color }} />
          <span className="text-gray-900">{n.path.join(' / ')}</span>
        </div>
      ))}
    </div>
  );
}

