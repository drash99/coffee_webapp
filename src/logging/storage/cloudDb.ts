import { getSupabaseClient } from '../../config/supabase';
import type { BeanLabelRow, BeanRow, BrewRow, GrinderParticleSizeRow, GrinderRow } from '../types';

export type BeanlogSaveData = {
  beans?: Omit<BeanRow, 'user_uid'>[];
  brews?: Omit<BrewRow, 'user_uid'>[];
  grinders?: Omit<GrinderRow, 'user_uid'>[];
  particleSizes?: Omit<GrinderParticleSizeRow, 'user_uid'>[];
  beanLabels?: BeanLabelRow[];
};

export async function saveCloudData(data: BeanlogSaveData): Promise<void> {
  const { error } = await getSupabaseClient().rpc('save_beanlog_data', { p_data: data });
  if (error) throw new Error(error.message);
}
