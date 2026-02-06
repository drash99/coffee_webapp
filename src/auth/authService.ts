import { getSupabaseClient } from '../config/supabase';
import { generateSaltBase64, pbkdf2HashBase64 } from './crypto';
import type { AppUser, AppUserRow } from './types';

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
  if (!id) throw new Error('Please enter an id.');
  if (!input.password) throw new Error('Please enter a password.');
  if (input.password !== input.password2) throw new Error('Passwords do not match.');

  const { data: existing, error: existingErr } = await supabase
    .from('app_users')
    .select('uid')
    .eq('id', id)
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);
  if (existing) throw new Error('That id is already in use.');

  const uid = crypto.randomUUID();
  const salt = generateSaltBase64(16);
  const password_hash = await pbkdf2HashBase64(input.password, salt);

  const { error: insertErr } = await supabase.from('app_users').insert({
    uid,
    id,
    salt,
    password_hash
  } satisfies AppUserRow);
  if (insertErr) throw new Error(insertErr.message);

  return { uid, id };
}

export async function login(input: LoginInput): Promise<AppUser> {
  const supabase = getSupabaseClient();
  const id = input.id.trim();
  if (!id) throw new Error('Please enter an id.');
  if (!input.password) throw new Error('Please enter a password.');

  const { data: row, error } = await supabase
    .from('app_users')
    .select('uid,id,salt,password_hash')
    .eq('id', id)
    .maybeSingle<AppUserRow>();
  if (error) throw new Error(error.message);
  if (!row) throw new Error('Invalid id or password.');

  const computed = await pbkdf2HashBase64(input.password, row.salt);
  if (computed !== row.password_hash) throw new Error('Invalid id or password.');

  return { uid: row.uid, id: row.id };
}


