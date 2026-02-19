import { useState } from 'react';
import { Coffee, History, PlusCircle } from 'lucide-react';
import { isSupabaseConfigured } from '../config/supabase';
import type { AppUser } from '../auth/types';
import { TabButton } from './components/TabButton';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { NewBrewPage } from './pages/NewBrewPage';
import { HistoryPage } from './pages/HistoryPage';
import { BeanHistoryPage } from './pages/BeanHistoryPage';
import { useI18n } from '../i18n/I18nProvider';
import { isNative } from '../platform';

type AuthTab = 'login' | 'signup';
type LogTab = 'new' | 'history' | 'beans';

type Props = {
  user: AppUser | null;
  isGuest: boolean;
  onAuthSuccess: (u: AppUser) => void;
  onExitGuest: () => void;
  onEnterGuest: () => void;
};

export function LoggingApp({ user, isGuest, onAuthSuccess, onExitGuest, onEnterGuest }: Props) {
  const { t } = useI18n();
  const [authTab, setAuthTab] = useState<AuthTab>('login');
  const [logTab, setLogTab] = useState<LogTab>('new');
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem('beanlog.guest.bannerDismissed') === 'true';
    } catch {
      return false;
    }
  });

  function dismissBanner() {
    try {
      localStorage.setItem('beanlog.guest.bannerDismissed', 'true');
    } catch {}
    setBannerDismissed(true);
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
            onClick={onEnterGuest}
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
          <LoginPage onLoggedIn={onAuthSuccess} />
        ) : (
          <SignupPage onSignedUp={onAuthSuccess} />
        )}

        <div className="text-center">
          <button
            type="button"
            className="text-sm text-gray-500 hover:text-amber-700 underline underline-offset-2"
            onClick={onEnterGuest}
          >
            {t('guest.button')}
          </button>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Authenticated OR Guest — main app with New Brew | History | Beans
  // -----------------------------------------------------------------------

  const native = isNative();

  return (
    <div className={`max-w-4xl mx-auto space-y-4 ${native ? 'pb-[calc(4rem+env(safe-area-inset-bottom))]' : ''}`}>
      {/* Guest mode banner */}
      {isGuest && !bannerDismissed && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-amber-800">{t('guest.banner')}</div>
          <div className="flex items-center gap-2 flex-wrap">
            {isSupabaseConfigured() && (
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs hover:bg-amber-800 whitespace-nowrap"
                onClick={() => {
                  onExitGuest();
                  setAuthTab('signup');
                }}
              >
                {t('guest.banner.signup')}
              </button>
            )}
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-800 text-xs hover:bg-amber-100 whitespace-nowrap"
              onClick={onExitGuest}
            >
              {t('guest.exit')}
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 text-xs hover:bg-amber-100/50 whitespace-nowrap"
              onClick={dismissBanner}
            >
              {t('guest.banner.ignore')}
            </button>
          </div>
        </div>
      )}

      {/* Tabs: top on web, bottom on native */}
      {!native && (
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
      )}

      {logTab === 'new' && <NewBrewPage user={user} isGuest={isGuest} />}
      {logTab === 'history' && <HistoryPage user={user} isGuest={isGuest} />}
      {logTab === 'beans' && <BeanHistoryPage user={user} isGuest={isGuest} />}

      {native && (
        <nav
          className="fixed left-0 right-0 z-10 flex bg-white border-t border-gray-200 bottom-[calc(4rem+env(safe-area-inset-bottom))]"
          role="tablist"
          aria-label={t('logging.tabs.aria')}
        >
          <button
            type="button"
            role="tab"
            aria-selected={logTab === 'new'}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors ${
              logTab === 'new' ? 'text-amber-700' : 'text-gray-500'
            }`}
            onClick={() => setLogTab('new')}
          >
            <PlusCircle className="w-6 h-6" aria-hidden />
            <span className="text-xs font-medium">{t('logging.tab.newBrew')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={logTab === 'history'}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors ${
              logTab === 'history' ? 'text-amber-700' : 'text-gray-500'
            }`}
            onClick={() => setLogTab('history')}
          >
            <History className="w-6 h-6" aria-hidden />
            <span className="text-xs font-medium">{t('logging.tab.history')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={logTab === 'beans'}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors ${
              logTab === 'beans' ? 'text-amber-700' : 'text-gray-500'
            }`}
            onClick={() => setLogTab('beans')}
          >
            <Coffee className="w-6 h-6" aria-hidden />
            <span className="text-xs font-medium">{t('logging.tab.beans')}</span>
          </button>
        </nav>
      )}
    </div>
  );
}
