import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SettingsPage } from '../src/logging/pages/SettingsPage';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('../src/config/supabase', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ auth: { signOut } }),
}));
vi.mock('../src/i18n/I18nProvider', () => ({
  useI18n: () => ({ t: (key: string) => key, lang: 'en-us' }),
}));
vi.mock('../src/platform', () => ({ getPlatform: () => 'web', canPrintBrotherLabels: () => false }));

beforeEach(() => { signOut.mockReset(); });

it('keeps the authenticated UI on failed signOut, blocks duplicate clicks, and permits retry', async () => {
  let finish!: (result: { error: { message: string } | null }) => void;
  signOut.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const onLogout = vi.fn();
  render(<SettingsPage user={{ uid: 'user', id: 'user@example.com' }} isGuest={false}
    onLogout={onLogout} onAuthSuccess={vi.fn()} onExitGuest={vi.fn()} onEnterGuest={vi.fn()}
    lang="en-us" setLang={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'logging.logout' }));
  const pending = screen.getByRole('button', { name: 'settings.logout.busy' }) as HTMLButtonElement;
  expect(pending.disabled).toBe(true);
  fireEvent.click(pending);
  expect(signOut).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ error: { message: 'Server unavailable' } }); });
  expect(onLogout).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe('settings.logout.failed');
  expect(screen.getByText('user@example.com')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'logging.logout' }) as HTMLButtonElement).disabled).toBe(false);

  signOut.mockResolvedValueOnce({ error: null });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'logging.logout' })); });
  expect(onLogout).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('handles thrown network failures without claiming sign-out succeeded', async () => {
  signOut.mockRejectedValueOnce(new Error('Offline'));
  const onLogout = vi.fn();
  render(<SettingsPage user={{ uid: 'user', id: 'user@example.com' }} isGuest={false}
    onLogout={onLogout} onAuthSuccess={vi.fn()} onExitGuest={vi.fn()} onEnterGuest={vi.fn()}
    lang="en-us" setLang={vi.fn()} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'logging.logout' })); });
  expect(onLogout).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe('settings.logout.failed');
});

it('shows localized invalid-backup errors without erasing existing guest records', async () => {
  const records = JSON.stringify([{ uid: '20000000-0000-4000-8000-000000000001', bean_name: 'Preserve me' }]);
  localStorage.setItem('beanlog.local.beans', records);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { container } = render(<SettingsPage user={null} isGuest
    onLogout={vi.fn()} onAuthSuccess={vi.fn()} onExitGuest={vi.fn()} onEnterGuest={vi.fn()}
    lang="en-us" setLang={vi.fn()} />);
  const file = new File(['null'], 'invalid.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => 'null' });
  await act(async () => {
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  });
  expect(screen.getByText('storage.error.invalidBackup')).toBeTruthy();
  expect(localStorage.getItem('beanlog.local.beans')).toBe(records);
  expect(screen.queryByText('settings.backup.restored')).toBeNull();
});

it.each(['{broken', '[null]'])('keeps Settings and restore accessible for corrupt storage %s', (raw) => {
  localStorage.setItem('beanlog.local.beans', raw);
  const onLogout = vi.fn();
  render(<SettingsPage user={{ uid: 'user', id: 'user@example.com' }} isGuest={false}
    onLogout={onLogout} onAuthSuccess={vi.fn()} onExitGuest={vi.fn()} onEnterGuest={vi.fn()}
    lang="en-us" setLang={vi.fn()} />);
  expect(screen.getByRole('alert').textContent).toBe('storage.error.invalidData');
  expect(screen.getByText('settings.account.title')).toBeTruthy();
  expect(screen.queryByText('settings.backup.summary')).toBeNull();
  const exportButton = screen.getByRole('button', { name: 'settings.backup.export' }) as HTMLButtonElement;
  const migrate = screen.getByRole('button', { name: 'guest.migrate.button' }) as HTMLButtonElement;
  expect(exportButton.disabled).toBe(true);
  expect(migrate.disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'settings.backup.import' }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole('button', { name: 'logging.logout' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(exportButton);
  fireEvent.click(migrate);
  expect(localStorage.getItem('beanlog.local.beans')).toBe(raw);
  expect(screen.queryByText('settings.backup.saved')).toBeNull();
  expect(screen.queryByText('guest.migrate.done')).toBeNull();
});

it('keeps corrupt guest data intact until a valid restore is explicitly confirmed', async () => {
  const raw = '{broken';
  localStorage.setItem('beanlog.local.beans', raw);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { container } = render(<SettingsPage user={null} isGuest
    onLogout={vi.fn()} onAuthSuccess={vi.fn()} onExitGuest={vi.fn()} onEnterGuest={vi.fn()}
    lang="en-us" setLang={vi.fn()} />);
  const recoveredBean = {
    uid: '20000000-0000-4000-8000-000000000001', user_uid: 'guest', bean_name: 'Recovered',
    roastery: null, producer: null, origin_location: null, origin_country: null,
    process: null, varietal: null, cup_notes: null, cup_flavor_notes: [], roasted_on: null,
  };
  const payload = {
    version: 1, exported_at: '2026-09-14T12:00:00Z',
    data: { beans: [recoveredBean], brews: [], grinders: [], particleSizes: [], beanLabels: [] },
  };
  const file = new File([JSON.stringify(payload)], 'recovery.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(payload) });
  const input = container.querySelector('input[type="file"]')!;
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
  expect(localStorage.getItem('beanlog.local.beans')).toBe(raw);
  expect(screen.getByRole('alert').textContent).toBe('storage.error.invalidData');
  confirm.mockReturnValue(true);
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
  expect(JSON.parse(localStorage.getItem('beanlog.local.beans')!)).toEqual([recoveredBean]);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('settings.backup.restored')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'settings.backup.export' }) as HTMLButtonElement).disabled).toBe(false);
});

it('shows a localized read error while preserving account and restore controls when storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  render(<SettingsPage user={{ uid: 'user', id: 'user@example.com' }} isGuest={false}
    onLogout={vi.fn()} onAuthSuccess={vi.fn()} onExitGuest={vi.fn()} onEnterGuest={vi.fn()}
    lang="en-us" setLang={vi.fn()} />);
  expect(screen.getByRole('alert').textContent).toBe('storage.error.readFailed');
  expect((screen.getByRole('button', { name: 'logging.logout' }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole('button', { name: 'settings.backup.import' }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole('button', { name: 'settings.backup.export' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'guest.migrate.button' }) as HTMLButtonElement).disabled).toBe(true);
});
