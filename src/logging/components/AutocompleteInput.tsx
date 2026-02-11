import { useEffect, useRef, useState } from 'react';

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Text input with a filterable dropdown of suggestions.
 * Selecting a suggestion fills the input. User can also type freely.
 */
export function AutocompleteInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className = '',
  disabled = false,
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Filter suggestions based on current input (case-insensitive, fuzzy prefix)
  const filtered = suggestions.filter((s) =>
    s.toLowerCase().includes(value.toLowerCase().trim())
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIdx(-1);
  }, [value]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIdx >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIdx] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIdx]);

  function select(item: string) {
    onChange(item);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || filtered.length === 0) {
      if (e.key === 'ArrowDown' && filtered.length > 0) {
        setOpen(true);
        setHighlightIdx(0);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx((prev) => (prev + 1) % filtered.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx((prev) => (prev <= 0 ? filtered.length - 1 : prev - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIdx >= 0 && highlightIdx < filtered.length) {
          select(filtered[highlightIdx]);
        }
        break;
      case 'Escape':
        setOpen(false);
        break;
    }
  }

  const showDropdown = open && filtered.length > 0;

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        className={`w-full p-2 border rounded-lg ${className}`}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (filtered.length > 0) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {showDropdown && (
        <ul
          ref={listRef}
          className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg"
        >
          {filtered.map((item, idx) => (
            <li
              key={item}
              className={`px-3 py-2 text-sm cursor-pointer ${
                idx === highlightIdx
                  ? 'bg-amber-100 text-amber-900'
                  : 'hover:bg-gray-50 text-gray-800'
              }`}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent blur before click
                select(item);
              }}
              onMouseEnter={() => setHighlightIdx(idx)}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
