import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../config/supabase';
import type { AppUser } from '../auth/types';
import { getSupabaseClient } from '../config/supabase';
import { logout } from '../auth/authService';
import { clearSession, loadSessionFromSupabase, saveSession, toSessionUser } from './session';
import { TabButton } from './components/TabButton';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { NewBrewPage } from './pages/NewBrewPage';
import { HistoryPage } from './pages/HistoryPage';
import { BeanHistoryPage } from './pages/BeanHistoryPage';
import { useI18n } from '../i18n/I18nProvider';
import {
  isGuestActive,
  setGuestActive,
  localHasData,
  localGetAllData,
  migrateLocalToSupabase,
} from './storage';

type AuthTab = 'login' | 'signup';
type LogTab = 'new' | 'history' | 'beans';

const GUEST_USER: AppUser = { uid: 'guest', id: 'Guest' };

export function LoggingApp() {
  const { t } = useI18n();
  const [user, setUser] = useState<AppUser | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [authTab, setAuthTab] = useState<AuthTab>('login');
  const [logTab, setLogTab] = useState<LogTab>('new');
  const [migrateMsg, setMigrateMsg] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);

  // --- Session bootstrap ---
  useEffect(() => {
    // Check guest mode first (works even without Supabase)
    if (isGuestActive()) {
      setIsGuest(true);
      setUser(GUEST_USER);
      // Don't return — still try to restore Supabase session in case
      // user signed up in another tab, but only if configured
    }

    if (!isSupabaseConfigured()) return;

    let active = true;
    void loadSessionFromSupabase().then((next) => {
      if (!active) return;
      if (next) {
        // Real session beats guest mode
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

  // --- Handlers ---

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

  async function handleMigrateData() {
    if (!localHasData()) return;
    const data = localGetAllData();
    const msg = t('guest.migrate.confirm', {
      beans: data.beans.length,
      brews: data.brews.length,
    });
    if (!window.confirm(msg)) return;

    setMigrating(true);
    setMigrateMsg(null);
    try {
      await migrateLocalToSupabase();
      setMigrateMsg(t('guest.migrate.done'));
    } catch (e) {
      setMigrateMsg(
        t('guest.migrate.failed', {
          message: e instanceof Error ? e.message : 'Unknown error',
        }),
      );
    } finally {
      setMigrating(false);
    }
  }

  function handleAuthSuccess(u: AppUser) {
    saveSession(u);
    setGuestActive(false);
    setIsGuest(false);
    setUser(u);
  }

  // -----------------------------------------------------------------------
  // Render: Supabase not configured — offer guest mode
  // -----------------------------------------------------------------------

  if (!isSupabaseConfigured() && !isGuest) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
          <h2 className="text-lg font-semibold">{t('logging.supabaseNotConfigured.title')}</h2>
          <p className="text-sm text-gray-600">{t('guest.noSupabase')}</p>
          <button
            type="button"
            className="w-full px-3 py-2 rounded-lg bg-amber-700 text-white text-sm hover:bg-amber-800"
            onClick={enterGuestMode}
          >
            {t('guest.button')}
          </button>
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-700">
              {t('logging.supabaseNotConfigured.body.1')}{' '}
              <code className="px-1 py-0.5 bg-gray-100 rounded">{t('logging.supabaseNotConfigured.body.2')}</code>{' '}
              {t('logging.supabaseNotConfigured.body.3')}
            </summary>
            <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-auto mt-2">
              VITE_SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
              {'\n'}
              VITE_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
            </pre>
            <p className="mt-1">
              {t('logging.supabaseNotConfigured.body.4')}{' '}
              <code className="px-1 py-0.5 bg-gray-100 rounded">npm run dev</code>.
            </p>
          </details>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Not authenticated and not guest — login / signup / guest
  // -----------------------------------------------------------------------

  if (!user) {
    return (
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <TabButton active={authTab === 'login'} onClick={() => setAuthTab('login')}>
            {t('auth.tab.login')}
          </TabButton>
          <TabButton active={authTab === 'signup'} onClick={() => setAuthTab('signup')}>
            {t('auth.tab.signup')}
          </TabButton>
        </div>

        {authTab === 'login' ? (
          <LoginPage onLoggedIn={handleAuthSuccess} />
        ) : (
          <SignupPage onSignedUp={handleAuthSuccess} />
        )}

        <div className="text-center">
          <button
            type="button"
            className="text-sm text-gray-500 hover:text-amber-700 underline underline-offset-2"
            onClick={enterGuestMode}
          >
            {t('guest.button')}
          </button>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Authenticated OR Guest — main app
  // -----------------------------------------------------------------------

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Guest mode banner */}
      {isGuest && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-amber-800">{t('guest.banner')}</div>
          <div className="flex items-center gap-2 flex-wrap">
            {isSupabaseConfigured() && (
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs hover:bg-amber-800 whitespace-nowrap"
                onClick={() => {
                  exitGuestMode();
                  setAuthTab('signup');
                }}
              >
                {t('guest.banner.signup')}
              </button>
            )}
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-800 text-xs hover:bg-amber-100 whitespace-nowrap"
              onClick={exitGuestMode}
            >
              {t('guest.exit')}
            </button>
          </div>
        </div>
      )}

      {/* Authenticated user header */}
      {!isGuest && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-gray-600 truncate min-w-0">
            {t('logging.loggedInAs')} <span className="font-medium text-gray-900">{user.id}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Migration button: shown when logged in AND local data exists */}
            {localHasData() && (
              <button
                type="button"
                className="px-3 py-2 rounded-lg bg-amber-700 text-white text-sm hover:bg-amber-800 disabled:bg-gray-300 whitespace-nowrap"
                onClick={handleMigrateData}
                disabled={migrating}
              >
                {migrating ? t('guest.migrate.migrating') : t('guest.migrate.button')}
              </button>
            )}
            <button
              type="button"
              className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 whitespace-nowrap"
              onClick={async () => {
                try {
                  await logout();
                } catch {}
                clearSession();
                setUser(null);
              }}
            >
              {t('logging.logout')}
            </button>
          </div>
        </div>
      )}

      {migrateMsg && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">{migrateMsg}</div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <TabButton active={logTab === 'new'} onClick={() => setLogTab('new')}>
          {t('logging.tab.newBrew')}
        </TabButton>
        <TabButton active={logTab === 'history'} onClick={() => setLogTab('history')}>
          {t('logging.tab.history')}
        </TabButton>
        <TabButton active={logTab === 'beans'} onClick={() => setLogTab('beans')}>
          {t('logging.tab.beans')}
        </TabButton>
      </div>

      {logTab === 'new' && <NewBrewPage user={user} isGuest={isGuest} />}
      {logTab === 'history' && <HistoryPage user={user} isGuest={isGuest} />}
      {logTab === 'beans' && <BeanHistoryPage user={user} isGuest={isGuest} />}
    </div>
  );
}
