import { getSupabaseClient } from '../../config/supabase';
import { localListGrinders } from '../storage/localDb';
import type { GrinderRow } from '../types';

export type PreparedGrinder = Omit<GrinderRow, 'user_uid'>;

/** Resolve an existing grinder without writing before the enclosing save commits. */
export async function prepareGrinder(
  maker: string,
  model: string,
  isGuest: boolean,
  pending?: PreparedGrinder | null,
): Promise<PreparedGrinder> {
  maker = maker.trim();
  model = model.trim();
  if (pending && (pending.maker ?? '').toLowerCase() === maker.toLowerCase() &&
      (pending.model ?? '').toLowerCase() === model.toLowerCase()) return pending;
  if (isGuest) {
    const found = localListGrinders().find((grinder) =>
      (grinder.maker ?? '').toLowerCase() === maker.toLowerCase() &&
      (grinder.model ?? '').toLowerCase() === model.toLowerCase(),
    );
    if (found) return { uid: found.uid, maker: found.maker, model: found.model };
  } else {
    const literal = (value: string) => value.replace(/[\\%_]/g, '\\$&');
    const { data, error } = await getSupabaseClient().from('grinders')
      .select('uid,maker,model')
      .ilike('maker', literal(maker))
      .ilike('model', literal(model))
      .order('created_at', { ascending: false })
      .order('uid')
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as PreparedGrinder;
  }
  return { uid: crypto.randomUUID(), maker, model };
}
