import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Coffee, Languages, Microscope, NotebookPen } from 'lucide-react';
import { AnalysisApp } from './analysis/AnalysisApp';
import { LoggingApp } from './logging/LoggingApp';
import { useI18n } from './i18n/I18nProvider';
import { SharedBrewPage } from './logging/pages/SharedBrewPage';

function parseSharedTokenFromLocation(loc: Location): string | null {
  const fromQuery = new URLSearchParams(loc.search).get('share')?.trim() ?? '';
  if (fromQuery) return fromQuery;

  const fromHash = new URLSearchParams(loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash).get('share')?.trim() ?? '';
  if (fromHash) return fromHash;

  const m = loc.pathname.match(/^\/share\/([^/]+)\/?$/);
  return m?.[1] ?? null;
}

function App() {
  const [tab, setTab] = useState<'analysis' | 'logging'>('logging');
  const { lang, setLang, t } = useI18n();
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement | null>(null);
  const [sharedToken, setSharedToken] = useState<string | null>(() => parseSharedTokenFromLocation(window.location));

  useEffect(() => {
    if (!langOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const el = langRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setLangOpen(false);
    }
    function onDocKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setLangOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [langOpen]);

  useEffect(() => {
    function onPopState() {
      setSharedToken(parseSharedTokenFromLocation(window.location));
    }
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  function TabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
    return (
      <button
        type="button"
        className={`px-3 py-2 rounded-lg text-sm border flex items-center gap-2 ${
          active ? 'bg-amber-700 text-white border-amber-700' : 'bg-white hover:bg-gray-50 border-gray-200'
        }`}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans p-4">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Coffee className="w-8 h-8 text-amber-700" />
          {sharedToken ? t('sharedBrew.title') : t('app.title')}
        </h1>
        {!sharedToken && (
          <div className="flex items-center gap-2">
            <TabButton active={tab === 'analysis'} onClick={() => setTab('analysis')}>
              <Microscope className="w-4 h-4" />
              {t('app.tab.analysis')}
            </TabButton>
            <TabButton active={tab === 'logging'} onClick={() => setTab('logging')}>
              <NotebookPen className="w-4 h-4" />
              {t('app.tab.logging')}
            </TabButton>

            <div ref={langRef} className="relative">
              <button
                type="button"
                className="p-2 rounded-lg border bg-white hover:bg-gray-50"
                aria-label={t('app.langSelector.aria')}
                onClick={() => setLangOpen((v) => !v)}
              >
                <Languages className="w-4 h-4" />
              </button>
              {langOpen && (
                <div className="absolute right-0 mt-2 w-40 rounded-lg border bg-white shadow-lg overflow-hidden z-30">
                  <button
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                      lang === 'en-us' ? 'bg-amber-50' : 'bg-white'
                    }`}
                    onClick={() => {
                      setLang('en-us');
                      setLangOpen(false);
                    }}
                  >
                    {t('app.lang.english')} (EN)
                  </button>
                  <button
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                      lang === 'ko-kr' ? 'bg-amber-50' : 'bg-white'
                    }`}
                    onClick={() => {
                      setLang('ko-kr');
                      setLangOpen(false);
                    }}
                  >
                    {t('app.lang.korean')} (KO)
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto">
        {sharedToken ? <SharedBrewPage token={sharedToken} /> : tab === 'analysis' ? <AnalysisApp /> : <LoggingApp />}
      </main>

      <footer className="max-w-5xl mx-auto mt-8 pb-4 text-center text-xs text-gray-400">
        Built {new Date(__BUILD_TIME__).toLocaleString()}
      </footer>
    </div>
  );
}

export default App
