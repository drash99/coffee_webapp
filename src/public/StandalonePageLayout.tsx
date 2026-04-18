import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

export function StandalonePageLayout({ children }: Props) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <main className="max-w-5xl mx-auto">{children}</main>
    </div>
  );
}
