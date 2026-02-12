import type { AppUser } from '../auth/types';
import { getSupabaseClient, isSupabaseConfigured } from '../config/supabase';

const KEY = 'beanlog.session.v1';

export function loadSession(): AppUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppUser;
    if (!parsed?.uid || !parsed?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(user: AppUser) {
  localStorage.setItem(KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

function toAppUser(user: { id: string; email?: string | null; user_metadata?: Record<string, any> }): AppUser {
  const explicit = typeof user.user_metadata?.login_id === 'string' ? user.user_metadata.login_id.trim() : '';
  const fromEmail = (user.email ?? '').split('@')[0] ?? '';
  const loginId = explicit || fromEmail || user.id;
  return { uid: user.id, id: loginId };
}

export function toSessionUser(user: { id: string; email?: string | null; user_metadata?: Record<string, any> }): AppUser {
  return toAppUser(user);
}

export async function loadSessionFromSupabase(): Promise<AppUser | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user) {
    const user = toAppUser(sessionData.session.user);
    saveSession(user);
    return user;
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const user = toAppUser(data.user);
  saveSession(user);
  return user;
}
