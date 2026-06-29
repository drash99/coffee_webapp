import { useEffect, useState } from 'react';
import { Coffee, Microscope, NotebookPen, Settings } from 'lucide-react';
import { AnalysisApp } from './analysis/AnalysisApp';
import { LoggingApp } from './logging/LoggingApp';
import { TabButton } from './logging/components/TabButton';
import { useI18n } from './i18n/I18nProvider';
import { SharedBrewPage } from './logging/pages/SharedBrewPage';
import { SettingsPage } from './logging/pages/SettingsPage';
import { BeanLabelInfoPage } from './logging/pages/BeanLabelInfoPage';
import { addAppUrlOpenListener, getLaunchAppUrl, isNative } from './platform';
import { isSupabaseConfigured } from './config/supabase';
import type { AppUser } from './auth/types';
import { getSupabaseClient } from './config/supabase';
import { clearSession, loadSessionFromSupabase, saveSession, toSessionUser } from './logging/session';
import { isGuestActive, setGuestActive } from './logging/storage';

const GUEST_USER: AppUser = { uid: 'guest', id: 'Guest' };

type RouteLocation = Pick<Location, 'pathname' | 'search' | 'hash'>;

function parseSharedTokenFromLocation(loc: RouteLocation): string | null {
  const fromQuery = new URLSearchParams(loc.search).get('share')?.trim() ?? '';
  if (fromQuery) return fromQuery;

  const fromHash = new URLSearchParams(loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash).get('share')?.trim() ?? '';
  if (fromHash) return fromHash;

  const m = loc.pathname.match(/^\/share\/([^/]+)\/?$/);
  return m?.[1] ?? null;
}

function parseLabelUidFromLocation(loc: RouteLocation): string | null {
  const fromQuery = new URLSearchParams(loc.search).get('label')?.trim() ?? '';
  if (fromQuery) return fromQuery;

  const fromHash = new URLSearchParams(loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash).get('label')?.trim() ?? '';
  if (fromHash) return fromHash;

  const m = loc.pathname.match(/^\/(?:label|l)\/([^/]+)\/?$/);
  return m?.[1] ?? null;
}

function parseDeepLinkParams(loc: RouteLocation): {
  beanUid: string | null;
  historyBeanUid: string | null;
  duplicateBrewUid: string | null;
  doseG: string | null;
} {
  const q = new URLSearchParams(loc.search);
  const beanUid = (q.get('bean') ?? '').trim() || null;
  const historyBeanUid = (q.get('historyBean') ?? '').trim() || null;
  const duplicateBrewUid = (q.get('duplicateBrew') ?? '').trim() || null;
  const doseG = (q.get('doseG') ?? '').trim() || null;
  return { beanUid, historyBeanUid, duplicateBrewUid, doseG };
}

function parseRouteLocationFromUrl(urlString: string): RouteLocation | null {
  try {
    const url = new URL(urlString);
    const pathname =
      url.protocol === 'http:' || url.protocol === 'https:'
        ? url.pathname
        : `${url.host ? `/${url.host}` : ''}${url.pathname || ''}` || '/';
    return {
      pathname,
      search: url.search,
      hash: url.hash,
    };
  } catch {
    return null;
  }
}

function App() {
  const [tab, setTab] = useState<'analysis' | 'logging' | 'settings'>('logging');
  const { lang, setLang, t } = useI18n();
  const [user, setUser] = useState<AppUser | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [sharedToken, setSharedToken] = useState<string | null>(() => parseSharedTokenFromLocation(window.location));
  const [labelUid, setLabelUid] = useState<string | null>(() => parseLabelUidFromLocation(window.location));
  const [
    {
      beanUid: deepBeanUid,
      historyBeanUid: deepHistoryBeanUid,
      duplicateBrewUid: deepDuplicateBrewUid,
      doseG: deepDoseG,
    },
    setDeepLink,
  ] = useState(() =>
    parseDeepLinkParams(window.location),
  );

  // Auth bootstrap
  useEffect(() => {
    if (isGuestActive()) {
      setIsGuest(true);
      setUser(GUEST_USER);
    }

    if (!isSupabaseConfigured()) return;

    let active = true;
    void loadSessionFromSupabase().then((next) => {
      if (!active) return;
      if (next) {
        setGuestActive(false);
        setIsGuest(false);
        setUser(next);
      } else if (!isGuestActive()) {
        clearSession();
        setUser(null);
      }
    });

    let unsubscribe: (() => void) | null = null;
    const supabase = getSupabaseClient();
    const { data: authSub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active) return;
      if (!session?.user) {
        if (!isGuestActive()) {
          clearSession();
          setUser(null);
          setIsGuest(false);
        }
        return;
      }
      const next = toSessionUser(session.user);
      saveSession(next);
      setGuestActive(false);
      setIsGuest(false);
      setUser(next);
    });
    unsubscribe = () => authSub.subscription.unsubscribe();

    return () => {
      active = false;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    function onPopState() {
      setSharedToken(parseSharedTokenFromLocation(window.location));
      setLabelUid(parseLabelUidFromLocation(window.location));
      setDeepLink(parseDeepLinkParams(window.location));
    }
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let cleanup = () => {};

    function applyIncomingUrl(urlString: string) {
      const loc = parseRouteLocationFromUrl(urlString);
      if (!loc) return;
      setSharedToken(parseSharedTokenFromLocation(loc));
      setLabelUid(parseLabelUidFromLocation(loc));
      setDeepLink(parseDeepLinkParams(loc));
    }

    void getLaunchAppUrl().then((url) => {
      if (!active || !url) return;
      applyIncomingUrl(url);
    });

    void addAppUrlOpenListener((url) => {
      applyIncomingUrl(url);
    }).then((remove) => {
      if (!active) {
        remove();
        return;
      }
      cleanup = remove;
    });

    return () => {
      active = false;
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (deepBeanUid || deepHistoryBeanUid || deepDuplicateBrewUid || deepDoseG) {
      setTab('logging');
    }
  }, [deepBeanUid, deepHistoryBeanUid, deepDuplicateBrewUid, deepDoseG]);

  function enterGuestMode() {
    setGuestActive(true);
    setIsGuest(true);
    setUser(GUEST_USER);
  }

  function exitGuestMode() {
    setGuestActive(false);
    setIsGuest(false);
    setUser(null);
  }

  function handleAuthSuccess(u: AppUser) {
    saveSession(u);
    setGuestActive(false);
    setIsGuest(false);
    setUser(u);
  }

  const native = isNative();
  const showTabs = !sharedToken && !labelUid;

  return (
    <div
      className={`min-h-screen bg-gray-50 text-gray-900 font-sans p-4 pt-[max(1rem,env(safe-area-inset-top))] ${
        native && showTabs ? 'pb-0' : 'pb-[max(1rem,env(safe-area-inset-bottom))]'
      }`}
    >
      {/* Fixed bar covering iOS notch area - prevents scroll overlap */}
      <div className="safe-area-top" aria-hidden />

      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2 whitespace-nowrap">
          <Coffee className="w-8 h-8 text-amber-700" />
          {sharedToken ? t('sharedBrew.title') : labelUid ? t('beanLabelInfo.title') : t('app.title')}
        </h1>
        {showTabs && !native && (
          <div className="flex items-center gap-2 flex-wrap">
            <TabButton active={tab === 'analysis'} onClick={() => setTab('analysis')}>
              <Microscope className="w-4 h-4" />
              {t('app.tab.analysis')}
            </TabButton>
            <TabButton active={tab === 'logging'} onClick={() => setTab('logging')}>
              <NotebookPen className="w-4 h-4" />
              {t('app.tab.logging')}
            </TabButton>
            <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
              <Settings className="w-4 h-4" />
              {t('app.tab.settings')}
            </TabButton>
          </div>
        )}
      </header>

      <main
        className={`max-w-5xl mx-auto ${
          native && showTabs
            ? tab === 'logging' && user
              ? 'pb-[calc(7.5rem+env(safe-area-inset-bottom))]'
              : 'pb-[calc(3.5rem+env(safe-area-inset-bottom))]'
            : ''
        }`}
      >
        {sharedToken ? (
          <SharedBrewPage token={sharedToken} />
        ) : labelUid ? (
          <BeanLabelInfoPage labelUid={labelUid} viewerUser={user} isGuest={isGuest} />
        ) : tab === 'analysis' ? (
          <AnalysisApp />
        ) : tab === 'settings' ? (
          <SettingsPage
            user={user}
            isGuest={isGuest}
            onAuthSuccess={handleAuthSuccess}
            onLogout={() => {
              clearSession();
              setUser(null);
            }}
            onExitGuest={exitGuestMode}
            onEnterGuest={enterGuestMode}
            lang={lang}
            setLang={setLang}
          />
        ) : (
          <LoggingApp
            user={user}
            isGuest={isGuest}
            onAuthSuccess={handleAuthSuccess}
            onExitGuest={exitGuestMode}
            onEnterGuest={enterGuestMode}
            initialLogTab={deepHistoryBeanUid ? 'history' : deepBeanUid || deepDuplicateBrewUid || deepDoseG ? 'new' : undefined}
            initialBeanUid={deepBeanUid ?? undefined}
            initialHistoryBeanUid={deepHistoryBeanUid ?? undefined}
            initialDuplicateBrewUid={deepDuplicateBrewUid ?? undefined}
            initialDoseG={deepDoseG ?? undefined}
          />
        )}
      </main>

      <footer className="max-w-5xl mx-auto mt-8 pb-4 text-center text-xs text-gray-400">
        Built {new Date(__BUILD_TIME__).toLocaleString()}
      </footer>

      {native && showTabs && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-20 flex bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]"
          role="tablist"
          aria-label={t('app.tabs.aria')}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'analysis'}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors ${
              tab === 'analysis' ? 'text-amber-700' : 'text-gray-500'
            }`}
            onClick={() => setTab('analysis')}
          >
            <Microscope className="w-6 h-6" aria-hidden />
            <span className="text-xs font-medium">{t('app.tab.analysis')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'logging'}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors ${
              tab === 'logging' ? 'text-amber-700' : 'text-gray-500'
            }`}
            onClick={() => setTab('logging')}
          >
            <NotebookPen className="w-6 h-6" aria-hidden />
            <span className="text-xs font-medium">{t('app.tab.logging')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'settings'}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors ${
              tab === 'settings' ? 'text-amber-700' : 'text-gray-500'
            }`}
            onClick={() => setTab('settings')}
          >
            <Settings className="w-6 h-6" aria-hidden />
            <span className="text-xs font-medium">{t('app.tab.settings')}</span>
          </button>
        </nav>
      )}
    </div>
  );
}

export default App;
