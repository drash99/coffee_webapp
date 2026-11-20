import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BeanLabelInfoPage } from '../src/logging/pages/BeanLabelInfoPage';
import { BeanHistoryPage } from '../src/logging/pages/BeanHistoryPage';
import { PublicBeanLabelApp } from '../src/public/PublicBeanLabelApp';

const mocks = vi.hoisted(() => ({
  configured: true, rpc: vi.fn(), t: (key: string) => key,
}));
vi.mock('../src/config/supabase', () => ({
  isSupabaseConfigured: () => mocks.configured,
  getSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('../src/i18n/I18nProvider', () => ({ useI18n: () => ({ t: mocks.t, lang: 'en-us' }) }));
vi.mock('../src/platform', () => ({ canPrintBrotherLabels: () => false }));
vi.mock('../src/logging/utils/beanLabelImage', async importOriginal => ({
  ...await importOriginal<typeof import('../src/logging/utils/beanLabelImage')>(),
  renderBeanLabelImages: async () => ({
    previewDataUrl: 'data:image/png;base64,cHJldmlldw==', printDataUrl: 'data:image/png;base64,cHJpbnQ=', lengthDots: 300,
  }),
}));

const beanUid = '20000000-0000-4000-8000-000000000001';
const labelUid = '40000000-0000-4000-8000-000000000001';
const user = { uid: '10000000-0000-4000-8000-000000000001', id: 'test@example.com' };
const bean = {
  uid: beanUid, user_uid: 'guest', bean_name: 'Local coffee', roastery: 'Local roaster', producer: null,
  origin_location: null, origin_country: null, process: null, varietal: null,
  cup_notes: null, cup_flavor_notes: [], roasted_on: '2026-09-14', created_at: '2026-09-14T12:00:00Z',
};

beforeEach(() => {
  mocks.configured = true;
  mocks.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  localStorage.setItem('beanlog.local.beans', JSON.stringify([bean]));
  localStorage.setItem('beanlog.local.bean_labels', JSON.stringify([{
    uid: labelUid, bean_uid: beanUid, grams: 15, created_at: '2026-09-14T13:00:00Z',
  }]));
});

afterEach(() => { window.history.replaceState({}, '', '/'); });

it('looks up an existing local label without Supabase and allows guest owner actions', async () => {
  mocks.configured = false;
  render(<BeanLabelInfoPage labelUid={labelUid} viewerUser={null} isGuest />);
  expect(await screen.findByText('Local coffee')).toBeTruthy();
  expect(screen.getByRole('note').textContent).toContain('beanLabelInfo.localOnly');
  expect(mocks.rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'beanLabelInfo.actions.logThisBeanWithDose' }));
  expect(new URLSearchParams(window.location.search).get('bean')).toBe(beanUid);
  expect(new URLSearchParams(window.location.search).get('doseG')).toBe('15');
});

it('resolves local labels on the standalone page even without an active guest session', async () => {
  mocks.configured = false;
  window.history.replaceState({}, '', `/label.html?label=${labelUid}`);
  render(<PublicBeanLabelApp />);
  expect(await screen.findByText('Local coffee')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'beanLabelInfo.backToApp' }).getAttribute('href')).toBe('./');
  expect(screen.queryByRole('button', { name: 'beanLabelInfo.actions.viewHistory' })).toBeNull();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('does not show local owner actions to an unrelated signed-in user', async () => {
  render(<BeanLabelInfoPage labelUid={labelUid} viewerUser={user} isGuest={false} />);
  await screen.findByText('Local coffee');
  expect(screen.queryByRole('button', { name: /beanLabelInfo.actions/ })).toBeNull();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('falls back to the public RPC when a label is absent locally', async () => {
  localStorage.clear();
  mocks.rpc.mockResolvedValueOnce({ data: [{
    ...bean, bean_name: 'Cloud coffee', bean_uid: beanUid, bean_user_uid: user.uid,
    label_uid: labelUid, grams: null,
  }], error: null });
  render(<BeanLabelInfoPage labelUid={labelUid} viewerUser={user} isGuest={false} />);
  expect(await screen.findByText('Cloud coffee')).toBeTruthy();
  expect(mocks.rpc).toHaveBeenCalledWith('get_public_bean_by_label_uid', { p_label_uid: labelUid });
  expect(screen.getByRole('button', { name: 'beanLabelInfo.actions.viewHistory' })).toBeTruthy();
  expect(screen.queryByRole('note')).toBeNull();
});

it('ignores an old cloud response after navigating to a local label', async () => {
  let finish!: (value: unknown) => void;
  mocks.rpc.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(<BeanLabelInfoPage labelUid="40000000-0000-4000-8000-000000000002" viewerUser={null} isGuest />);
  rerender(<BeanLabelInfoPage labelUid={labelUid} viewerUser={null} isGuest />);
  await act(async () => { finish({ data: [{ ...bean, bean_name: 'Stale cloud coffee' }], error: null }); });
  expect(screen.getByText('Local coffee')).toBeTruthy();
  expect(screen.queryByText('Stale cloud coffee')).toBeNull();
});

it('rejects invalid labels and local labels whose beans no longer exist', async () => {
  const { rerender } = render(<BeanLabelInfoPage labelUid="invalid" viewerUser={null} isGuest />);
  expect(await screen.findByText('beanLabelInfo.notFound')).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
  localStorage.setItem('beanlog.local.beans', '[]');
  rerender(<BeanLabelInfoPage labelUid={labelUid} viewerUser={null} isGuest />);
  expect(await screen.findByText('beanLabelInfo.notFound')).toBeTruthy();
  expect(screen.queryByText('Local coffee')).toBeNull();
});

it('gates both new and repeat guest QR printing with an explicit migration notice', async () => {
  render(<BeanHistoryPage user={user} isGuest />);
  fireEvent.click(await screen.findByRole('button', { name: 'beanLabels.printMode' }));
  expect(screen.getByRole('note').textContent).toBe('beanLabels.guestQrUnavailable');
  const generate = screen.getByRole('button', { name: 'beanLabels.generateAndPrint' }) as HTMLButtonElement;
  const reprint = await screen.findByRole('button', { name: 'beanLabels.history.reprint' }) as HTMLButtonElement;
  expect(generate.disabled).toBe(true);
  expect(reprint.disabled).toBe(true);
  const before = localStorage.getItem('beanlog.local.bean_labels');
  fireEvent.click(generate);
  fireEvent.click(reprint);
  expect(localStorage.getItem('beanlog.local.bean_labels')).toBe(before);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
