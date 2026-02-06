import { useState } from 'react';
import type { AppUser } from '../../auth/types';
import { signup } from '../../auth/authService';

type Props = {
  onSignedUp: (user: AppUser) => void;
};

export function SignupPage({ onSignedUp }: Props) {
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
      setError(e instanceof Error ? e.message : 'Signup failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
      <h2 className="text-lg font-semibold">Sign up</h2>

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
          autoComplete="new-password"
          disabled={loading}
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500">Type again</label>
        <input
          className="w-full p-2 border rounded-lg"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          placeholder="password"
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
        {loading ? 'Creating account…' : 'Create account'}
      </button>
    </div>
  );
}


