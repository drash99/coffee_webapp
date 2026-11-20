import { useEffect, useRef, useState } from 'react';
import type { BeverageType, FlavorNote } from '../types';
import { beverageFlavorLabel, beverageFlavorWheels } from '../beverageFlavorWheels';
import { useI18n } from '../../i18n/I18nProvider';

type Props = {
  label: string;
  value: FlavorNote[];
  onChange: (next: FlavorNote[]) => void;
  maxNotes?: number;
  beverageType?: BeverageType;
};

function noteKey(note: FlavorNote): string {
  return note.path.join(' > ');
}

export function FlavorWheelPicker({ label, value, onChange, maxNotes = 5, beverageType = 'coffee' }: Props) {
  return <CascadingPicker key={beverageType} {...{ label, value, onChange, maxNotes, beverageType }} />;
}

function CascadingPicker({ label, value, onChange, maxNotes, beverageType }: Required<Props>) {
  const { t } = useI18n();
  const topLevel = value;

  const canAddMore = topLevel.length < maxNotes;

  const [l1, setL1] = useState<string>('');
  const [l2, setL2] = useState<string>('');
  const [l3, setL3] = useState<string>('');

  const wheel = beverageFlavorWheels[beverageType];
  const level1Options = ['N/A', ...wheel.map(node => node.name)];
  const branch = wheel.find(node => node.name === l1);
  const level2Options = branch?.children?.map(node => node.name) ?? [];
  const level3Options = branch?.children?.find(node => node.name === l2)?.children?.map(node => node.name) ?? [];
  const colorOf = (name: string) => wheel.find(node => node.name === name)?.color ?? '#9ca3af';
  const display = (name: string) => beverageFlavorLabel(name, beverageType, t);

  function resetLower(level: 1 | 2) {
    if (level === 1) {
      setL2('');
      setL3('');
    } else {
      setL3('');
    }
  }

  function addCurrent() {
    if (!l1) return;
    const path = l1 === 'N/A' ? ['N/A'] : l3 ? [l1, l2, l3].filter(Boolean) : l2 ? [l1, l2] : [l1];
    const color = colorOf(path[0]);
    const nextNote: FlavorNote = { path, color };

    const existingKeys = new Set(value.map(noteKey));
    if (existingKeys.has(noteKey(nextNote))) return;

    onChange([...value, nextNote]);
  }

  function remove(note: FlavorNote) {
    const k = noteKey(note);
    onChange(value.filter((n) => noteKey(n) !== k));
  }

  type DotOption = { value: string; label: string; color: string };

  function DotDropdown({
    value,
    onChange,
    options,
    placeholder,
    disabled
  }: {
    value: string;
    onChange: (v: string) => void;
    options: DotOption[];
    placeholder: string;
    disabled?: boolean;
  }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);

    const selected = options.find((o) => o.value === value) ?? null;

    useEffect(() => {
      if (!open) return;
      function onDocMouseDown(e: MouseEvent) {
        const el = rootRef.current;
        if (!el) return;
        if (!el.contains(e.target as Node)) setOpen(false);
      }
      function onDocKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false);
      }
      document.addEventListener('mousedown', onDocMouseDown);
      document.addEventListener('keydown', onDocKeyDown);
      return () => {
        document.removeEventListener('mousedown', onDocMouseDown);
        document.removeEventListener('keydown', onDocKeyDown);
      };
    }, [open]);

    return (
      <div ref={rootRef} className="relative">
        <button
          type="button"
          className="w-full p-2 border rounded-lg bg-white text-left flex items-center justify-between disabled:bg-gray-50 disabled:text-gray-400"
          onClick={() => setOpen((o) => !o)}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="flex items-center gap-2 min-w-0">
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: selected?.color ?? '#d1d5db' }}
            />
            <span className="truncate">{selected?.label ?? placeholder}</span>
          </span>
          <span className="text-gray-400">▾</span>
        </button>

        {open && !disabled && (
          <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border bg-white shadow-lg">
            <div role="listbox" className="py-1">
              {options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={opt.value === value}
                  className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 ${
                    opt.value === value ? 'bg-amber-50' : 'bg-white'
                  }`}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: opt.color }} />
                  <span className="text-gray-900">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const level1DotOptions = level1Options.map(name => ({ value: name, label: display(name), color: colorOf(name) }));
  const detailOptions = (options: string[]) => options.map(name => ({ value: name, label: display(name), color: colorOf(l1) }));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-semibold text-gray-800">{label}</label>
        <div className="text-xs text-gray-500">
          {value.length}/{maxNotes}
        </div>
      </div>

      <div className={`grid gap-2 ${beverageType === 'coffee' ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}>
        <DotDropdown
          value={l1}
          onChange={(v) => {
            setL1(v);
            resetLower(1);
          }}
          options={level1DotOptions}
          placeholder={t('flavorPicker.placeholder.broad')}
          disabled={!canAddMore}
        />

        <DotDropdown
          value={l2}
          onChange={(v) => {
            setL2(v);
            resetLower(2);
          }}
          options={detailOptions(level2Options)}
          placeholder={l1 ? t('flavorPicker.placeholder.narrow') : t('flavorPicker.placeholder.none')}
          disabled={!canAddMore || !level2Options.length}
        />

        {beverageType === 'coffee' && <DotDropdown
          value={l3}
          onChange={(v) => setL3(v)}
          options={detailOptions(level3Options)}
          placeholder={l2 ? t('flavorPicker.placeholder.specific') : t('flavorPicker.placeholder.none')}
          disabled={!canAddMore || !level3Options.length}
        />}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          className="px-3 py-2 rounded-lg bg-amber-700 text-white text-sm disabled:bg-gray-300 whitespace-nowrap"
          onClick={addCurrent}
          disabled={!canAddMore || !l1}
        >
          {t('flavorPicker.addNote')}
        </button>
        {beverageType === 'coffee' && <div className="text-xs text-gray-500">
          {t('flavorPicker.tip')}
        </div>}
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((note) => (
            <button
              key={noteKey(note)}
              type="button"
              onClick={() => remove(note)}
              className="flex items-center gap-2 px-3 py-1 rounded-full border bg-white text-sm hover:bg-gray-50"
              title={t('flavorPicker.removeTitle')}
            >
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: note.color }} />
              <span className="text-gray-800 break-words">{note.path.map(display).join(' / ')}</span>
              <span className="text-gray-400">×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


