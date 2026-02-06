import { getSupabaseClient } from '../config/supabase';
import { generateSaltBase64, pbkdf2HashBase64 } from './crypto';
import type { AppUser, AppUserRow } from './types';

export type AuthErrorCode =
  | 'ID_REQUIRED'
  | 'PASSWORD_REQUIRED'
  | 'PASSWORD_MISMATCH'
  | 'ID_IN_USE'
  | 'INVALID_CREDENTIALS'
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

export async function signup(input: SignupInput): Promise<AppUser> {
  const supabase = getSupabaseClient();
  const id = input.id.trim();
  if (!id) throw new AuthError('ID_REQUIRED');
  if (!input.password) throw new AuthError('PASSWORD_REQUIRED');
  if (input.password !== input.password2) throw new AuthError('PASSWORD_MISMATCH');

  const { data: existing, error: existingErr } = await supabase
    .from('app_users')
    .select('uid')
    .eq('id', id)
    .maybeSingle();
  if (existingErr) throw new AuthError('SUPABASE', existingErr.message);
  if (existing) throw new AuthError('ID_IN_USE');

  const uid = crypto.randomUUID();
  const salt = generateSaltBase64(16);
  const password_hash = await pbkdf2HashBase64(input.password, salt);

  const { error: insertErr } = await supabase.from('app_users').insert({
    uid,
    id,
    salt,
    password_hash
  } satisfies AppUserRow);
  if (insertErr) throw new AuthError('SUPABASE', insertErr.message);

  return { uid, id };
}

export async function login(input: LoginInput): Promise<AppUser> {
  const supabase = getSupabaseClient();
  const id = input.id.trim();
  if (!id) throw new AuthError('ID_REQUIRED');
  if (!input.password) throw new AuthError('PASSWORD_REQUIRED');

  const { data: row, error } = await supabase
    .from('app_users')
    .select('uid,id,salt,password_hash')
    .eq('id', id)
    .maybeSingle<AppUserRow>();
  if (error) throw new AuthError('SUPABASE', error.message);
  if (!row) throw new AuthError('INVALID_CREDENTIALS');

  const computed = await pbkdf2HashBase64(input.password, row.salt);
  if (computed !== row.password_hash) throw new AuthError('INVALID_CREDENTIALS');

  return { uid: row.uid, id: row.id };
}


