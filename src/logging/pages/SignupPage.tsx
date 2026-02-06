import { useState } from 'react';
import type { AppUser } from '../../auth/types';
import { AuthError, signup } from '../../auth/authService';
import { useI18n } from '../../i18n/I18nProvider';

type Props = {
  onSignedUp: (user: AppUser) => void;
};

export function SignupPage({ onSignedUp }: Props) {
  const { t } = useI18n();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const user = await signup({ id, password, password2 });
      onSignedUp(user);
    } catch (e) {
      if (e instanceof AuthError) {
        if (e.code === 'ID_REQUIRED') setError(t('auth.error.idRequired'));
        else if (e.code === 'PASSWORD_REQUIRED') setError(t('auth.error.passwordRequired'));
        else if (e.code === 'PASSWORD_MISMATCH') setError(t('auth.error.passwordMismatch'));
        else if (e.code === 'ID_IN_USE') setError(t('auth.error.idInUse'));
        else if (e.code === 'SUPABASE') setError(t('auth.error.supabase', { message: e.details ?? '' }));
        else setError(t('auth.error.signupFailed'));
      } else {
        setError(e instanceof Error ? e.message : t('auth.error.signupFailed'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
      <h2 className="text-lg font-semibold">{t('auth.signup.title')}</h2>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500">{t('auth.field.id')}</label>
        <input
          className="w-full p-2 border rounded-lg"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={t('auth.placeholder.id')}
          autoComplete="username"
          disabled={loading}
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500">{t('auth.field.password')}</label>
        <input
          className="w-full p-2 border rounded-lg"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('auth.placeholder.password')}
          type="password"
          autoComplete="new-password"
          disabled={loading}
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500">{t('auth.field.password2')}</label>
        <input
          className="w-full p-2 border rounded-lg"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          placeholder={t('auth.placeholder.password')}
          type="password"
          autoComplete="new-password"
          disabled={loading}
        />
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{error}</div>}

      <button
        type="button"
        className="w-full px-3 py-2 rounded-lg bg-amber-700 text-white text-sm disabled:bg-gray-300"
        onClick={submit}
        disabled={loading}
      >
        {loading ? t('auth.signup.button.loading') : t('auth.signup.button')}
      </button>
    </div>
  );
}


