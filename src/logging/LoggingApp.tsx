import { useEffect, useState, type ReactNode } from 'react';
import { isSupabaseConfigured } from '../config/supabase';
import type { AppUser } from '../auth/types';
import { clearSession, loadSession, saveSession } from './session';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { NewBrewPage } from './pages/NewBrewPage';
import { HistoryPage } from './pages/HistoryPage';

type AuthTab = 'login' | 'signup';
type LogTab = 'new' | 'history';

function TabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`px-3 py-2 rounded-lg text-sm border ${
        active ? 'bg-amber-700 text-white border-amber-700' : 'bg-white hover:bg-gray-50 border-gray-200'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function LoggingApp() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authTab, setAuthTab] = useState<AuthTab>('login');
  const [logTab, setLogTab] = useState<LogTab>('new');

  useEffect(() => {
    setUser(loadSession());
  }, []);

  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-2">
          <h2 className="text-lg font-semibold">Supabase not configured</h2>
          <p className="text-sm text-gray-600">
            Create <code className="px-1 py-0.5 bg-gray-100 rounded">.env.local</code> in the project root with:
          </p>
          <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-auto">
            VITE_SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
            {'\n'}
            VITE_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
          </pre>
          <p className="text-xs text-gray-500">
            This file is gitignored. After setting it, restart <code className="px-1 py-0.5 bg-gray-100 rounded">npm run dev</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <TabButton active={authTab === 'login'} onClick={() => setAuthTab('login')}>
            Log in
          </TabButton>
          <TabButton active={authTab === 'signup'} onClick={() => setAuthTab('signup')}>
            Sign up
          </TabButton>
        </div>

        {authTab === 'login' ? (
          <LoginPage
            onLoggedIn={(u) => {
              saveSession(u);
              setUser(u);
            }}
          />
        ) : (
          <SignupPage
            onSignedUp={(u) => {
              saveSession(u);
              setUser(u);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          Logged in as <span className="font-medium text-gray-900">{user.id}</span>
        </div>
        <button
          type="button"
          className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50"
          onClick={() => {
            clearSession();
            setUser(null);
          }}
        >
          Log out
        </button>
      </div>

      <div className="flex items-center gap-2">
        <TabButton active={logTab === 'new'} onClick={() => setLogTab('new')}>
          New brew
        </TabButton>
        <TabButton active={logTab === 'history'} onClick={() => setLogTab('history')}>
          History
        </TabButton>
      </div>

      {logTab === 'new' ? <NewBrewPage user={user} /> : <HistoryPage user={user} />}
    </div>
  );
}


