import { isSupabaseConfigured } from '../../config/supabase';
import type { AppUser } from '../../auth/types';
import { logout } from '../../auth/authService';
import { useI18n } from '../../i18n/I18nProvider';
import { localHasData, localGetAllData, migrateLocalToSupabase } from '../storage';
import { LoginPage } from './LoginPage';
import { SignupPage } from './SignupPage';
import { useState } from 'react';
import type { LanguageCode } from '../../i18n/i18n';

type AuthTab = 'login' | 'signup';

type Props = {
  user: AppUser | null;
  isGuest: boolean;
  onAuthSuccess: (u: AppUser) => void;
  onLogout: () => void;
  onExitGuest: () => void;
  onEnterGuest: () => void;
  lang: LanguageCode;
  setLang: (lang: LanguageCode) => void;
};

export function SettingsPage({
  user,
  isGuest,
  onAuthSuccess,
  onLogout,
  onExitGuest,
  onEnterGuest,
  lang,
  setLang,
}: Props) {
  const { t } = useI18n();
  const [authTab, setAuthTab] = useState<AuthTab>('login');
  const [migrating, setMigrating] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState<string | null>(null);

  async function handleMigrateData() {
    if (!localHasData()) return;
    const allData = localGetAllData();
    const msg = t('guest.migrate.confirm', {
      beans: allData.beans.length,
      brews: allData.brews.length,
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
        })
      );
    } finally {
      setMigrating(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* About */}
      <section className="p-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('settings.about.title')}</h2>
        <p className="text-sm text-gray-600">{t('settings.about.description')}</p>
        <p className="text-xs text-gray-400 mt-2">
          {t('settings.about.version')} 0.0.0 · {t('settings.about.build')}{' '}
          {new Date(__BUILD_TIME__).toLocaleDateString()}
        </p>
      </section>

      {/* Language */}
      <section className="p-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('settings.language.title')}</h2>
        <div className="flex gap-2">
          <button
            type="button"
            className={`px-3 py-2 rounded-lg text-sm border whitespace-nowrap ${
              lang === 'en-us' ? 'bg-amber-700 text-white border-amber-700' : 'bg-white border-gray-200 hover:bg-gray-50'
            }`}
            onClick={() => setLang('en-us')}
          >
            {t('app.lang.english')} (EN)
          </button>
          <button
            type="button"
            className={`px-3 py-2 rounded-lg text-sm border whitespace-nowrap ${
              lang === 'ko-kr' ? 'bg-amber-700 text-white border-amber-700' : 'bg-white border-gray-200 hover:bg-gray-50'
            }`}
            onClick={() => setLang('ko-kr')}
          >
            {t('app.lang.korean')} (KO)
          </button>
        </div>
      </section>

      {/* Account / Auth */}
      <section className="p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('settings.account.title')}</h2>

        {user && !isGuest && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">
              {t('logging.loggedInAs')} <span className="font-medium text-gray-900">{user.id}</span>
            </p>
            {localHasData() && (
              <button
                type="button"
                className="w-full px-3 py-2 rounded-lg bg-amber-700 text-white text-sm hover:bg-amber-800 disabled:bg-gray-300 whitespace-nowrap"
                onClick={handleMigrateData}
                disabled={migrating}
              >
                {migrating ? t('guest.migrate.migrating') : t('guest.migrate.button')}
              </button>
            )}
            {migrateMsg && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">{migrateMsg}</p>
            )}
            <button
              type="button"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50"
              onClick={async () => {
                try {
                  await logout();
                } catch {}
                onLogout();
              }}
            >
              {t('logging.logout')}
            </button>
          </div>
        )}

        {isGuest && (
          <div className="space-y-2">
            <p className="text-sm text-amber-800">{t('guest.banner')}</p>
            {isSupabaseConfigured() && (
              <button
                type="button"
                className="w-full px-3 py-2 rounded-lg bg-amber-700 text-white text-sm hover:bg-amber-800"
                onClick={() => {
                  onExitGuest();
                  setAuthTab('signup');
                }}
              >
                {t('guest.banner.signup')}
              </button>
            )}
            <button type="button" className="w-full px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50" onClick={onExitGuest}>
              {t('guest.exit')}
            </button>
          </div>
        )}

        {!user && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                className={`flex-1 px-3 py-2 rounded-lg text-sm border ${
                  authTab === 'login' ? 'bg-amber-700 text-white border-amber-700' : 'bg-white border-gray-200'
                }`}
                onClick={() => setAuthTab('login')}
              >
                {t('auth.tab.login')}
              </button>
              <button
                type="button"
                className={`flex-1 px-3 py-2 rounded-lg text-sm border ${
                  authTab === 'signup' ? 'bg-amber-700 text-white border-amber-700' : 'bg-white border-gray-200'
                }`}
                onClick={() => setAuthTab('signup')}
              >
                {t('auth.tab.signup')}
              </button>
            </div>
            {authTab === 'login' ? (
              <LoginPage onLoggedIn={onAuthSuccess} />
            ) : (
              <SignupPage onSignedUp={onAuthSuccess} />
            )}
            {isSupabaseConfigured() && (
              <button
                type="button"
                className="w-full text-sm text-gray-500 hover:text-amber-700 underline underline-offset-2"
                onClick={onEnterGuest}
              >
                {t('guest.button')}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
