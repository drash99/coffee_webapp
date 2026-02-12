import { getSupabaseClient } from '../config/supabase';
import type { AppUser } from './types';

export type AuthErrorCode =
  | 'ID_REQUIRED'
  | 'ID_INVALID'
  | 'PASSWORD_REQUIRED'
  | 'PASSWORD_MISMATCH'
  | 'ID_IN_USE'
  | 'INVALID_CREDENTIALS'
  | 'AUTH_NOT_CONFIRMED'
  | 'SUPABASE';

export class AuthError extends Error {
  code: AuthErrorCode;
  details?: string;
  constructor(code: AuthErrorCode, details?: string) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

export type SignupInput = {
  id: string;
  password: string;
  password2: string;
};

export type LoginInput = {
  id: string;
  password: string;
};

const ID_PATTERN = /^[a-z0-9._-]+$/i;
const EMAIL_DOMAIN = 'beanlog.local';

function normalizeId(raw: string): string {
  return raw.trim();
}

function idToEmail(id: string): string {
  return `${id.toLowerCase()}@${EMAIL_DOMAIN}`;
}

function userToAppUser(user: { id: string; email?: string | null; user_metadata?: Record<string, any> }): AppUser {
  const explicit = typeof user.user_metadata?.login_id === 'string' ? user.user_metadata.login_id.trim() : '';
  const fromEmail = (user.email ?? '').split('@')[0] ?? '';
  const loginId = explicit || fromEmail || user.id;
  return { uid: user.id, id: loginId };
}

async function withTimeout<T>(promise: Promise<T>, ms = 15000): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new AuthError('SUPABASE', 'Request timed out.')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer != null) window.clearTimeout(timer);
  }
}

export async function signup(input: SignupInput): Promise<AppUser> {
  const supabase = getSupabaseClient();
  const id = normalizeId(input.id);
  if (!id) throw new AuthError('ID_REQUIRED');
  if (!ID_PATTERN.test(id)) throw new AuthError('ID_INVALID');
  if (!input.password) throw new AuthError('PASSWORD_REQUIRED');
  if (input.password !== input.password2) throw new AuthError('PASSWORD_MISMATCH');

  const email = idToEmail(id);
  const { data: signUpData, error: signUpErr } = await withTimeout(
    supabase.auth.signUp({
      email,
      password: input.password,
      options: { data: { login_id: id } }
    })
  );
  if (signUpErr) {
    const msg = signUpErr.message.toLowerCase();
    if (msg.includes('already') || msg.includes('registered')) throw new AuthError('ID_IN_USE');
    throw new AuthError('SUPABASE', signUpErr.message);
  }

  // If session is missing, try explicit sign-in once.
  // Some projects may still return no session depending on auth settings.
  if (!signUpData.session) {
    const { data: loginData, error: loginErr } = await withTimeout(
      supabase.auth.signInWithPassword({ email, password: input.password })
    );
    if (loginErr) {
      const msg = loginErr.message.toLowerCase();
      if (msg.includes('email not confirmed')) throw new AuthError('AUTH_NOT_CONFIRMED');
      throw new AuthError('SUPABASE', loginErr.message);
    }
    if (!loginData.user) throw new AuthError('SUPABASE', 'Signup succeeded but no user returned.');
    return userToAppUser(loginData.user);
  }

  const user = signUpData.user ?? signUpData.session.user ?? null;
  if (!user) throw new AuthError('SUPABASE', 'Signup succeeded but no user returned.');
  return userToAppUser(user);
}

export async function login(input: LoginInput): Promise<AppUser> {
  const supabase = getSupabaseClient();
  const id = normalizeId(input.id);
  if (!id) throw new AuthError('ID_REQUIRED');
  if (!ID_PATTERN.test(id)) throw new AuthError('ID_INVALID');
  if (!input.password) throw new AuthError('PASSWORD_REQUIRED');

  const { data, error } = await withTimeout(
    supabase.auth.signInWithPassword({
      email: idToEmail(id),
      password: input.password
    })
  );
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('invalid login credentials')) throw new AuthError('INVALID_CREDENTIALS');
    if (msg.includes('email not confirmed')) throw new AuthError('AUTH_NOT_CONFIRMED');
    throw new AuthError('SUPABASE', error.message);
  }

  if (!data.user) throw new AuthError('SUPABASE', 'Login succeeded but no user returned.');
  return userToAppUser(data.user);
}

export async function logout(): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new AuthError('SUPABASE', error.message);
}
