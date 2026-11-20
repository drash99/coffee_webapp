import { expect, it, vi } from 'vitest';
import { saveCloudData } from '../src/logging/storage/cloudDb';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../src/config/supabase', () => ({ getSupabaseClient: () => ({ rpc }) }));

it('sends a single atomic write and propagates server failures', async () => {
  rpc.mockResolvedValueOnce({ error: { message: 'Transaction rolled back' } });
  const data = { grinders: [{ uid: '11111111-1111-4111-8111-111111111111', maker: 'Maker', model: 'Model' }] };
  await expect(saveCloudData(data)).rejects.toThrow('Transaction rolled back');
  expect(rpc).toHaveBeenCalledExactlyOnceWith('save_beanlog_data', { p_data: data });
});
