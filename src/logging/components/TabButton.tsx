import type { ReactNode } from 'react';

type Props = {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
};

/** Unified tab button used in both the app shell and the logging module. */
export function TabButton({ active, children, onClick }: Props) {
  return (
    <button
      type="button"
      className={`px-3 py-2 rounded-lg text-sm border whitespace-nowrap flex items-center gap-2 transition-colors ${
        active
          ? 'bg-amber-700 text-white border-amber-700'
          : 'bg-white hover:bg-gray-50 border-gray-200 text-gray-700'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

