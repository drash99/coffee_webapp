import { useState } from 'react';
import type { AppUser } from '../../auth/types';
import { login } from '../../auth/authService';

type Props = {
  onLoggedIn: (user: AppUser) => void;
};

export function LoginPage({ onLoggedIn }: Props) {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const user = await login({ id, password });
      onLoggedIn(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
      <h2 className="text-lg font-semibold">Log in</h2>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500">Id</label>
        <input
          className="w-full p-2 border rounded-lg"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="your-id"
          autoComplete="username"
          disabled={loading}
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500">Password</label>
        <input
          className="w-full p-2 border rounded-lg"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          type="password"
          autoComplete="current-password"
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
        {loading ? 'Logging in…' : 'Log in'}
      </button>
    </div>
  );
}


