import type { AppUser } from '../auth/types';

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


