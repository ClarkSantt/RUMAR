// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getDatabase } from '../src/lib/database/connection';
import { Settings } from '../src/features/settings/Settings';
import type { RumoStore } from '../src/hooks/useRumo';

vi.mock('../src/lib/database/connection', () => ({
  getDatabase: vi.fn(),
  closeDatabase: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('../src/features/energy/GeneralProfile', () => ({ GeneralProfile: () => null }));
vi.mock('../src/features/data/DataCenter', () => ({ DataCenter: () => null }));
vi.mock('../src/features/templates/TemplatesGallery', () => ({ TemplatesGallery: () => null }));
vi.mock('../src/features/notifications/NotificationSettings', () => ({
  NotificationSettings: () => null,
}));
vi.mock('../src/features/calendar/PlannerSettings', () => ({ PlannerSettings: () => null }));
vi.mock('../src/features/automations/AutomationsSettings', () => ({
  AutomationsSettings: () => null,
}));
vi.mock('../src/features/integrations/google-calendar/GoogleCalendarSettings', () => ({
  GoogleCalendarSettings: () => null,
}));
vi.mock('../src/features/windows/WindowsSettings', () => ({ WindowsSettings: () => null }));
vi.mock('../src/features/thoughts/autosave', () => ({ flushThoughts: vi.fn() }));
vi.mock('../src/features/workouts/persistence', () => ({ flushWorkouts: vi.fn() }));
vi.mock('../src/features/calendar/focus', () => ({ pauseOpenFocus: vi.fn() }));
vi.mock('../src/features/automations/runtime', () => ({
  suspendAutomations: vi.fn(async () => () => {}),
}));
vi.mock('../src/features/notifications/scheduler', () => ({
  suspendLocalNotifications: vi.fn(async () => () => {}),
}));
vi.mock('../src/features/integrations/google-calendar/runtime', () => ({
  suspendGoogleCalendar: vi.fn(async () => () => {}),
}));

const store = {
  data: { settings: { name: 'TESTE RUMAR', theme: 'light' } },
  busy: false,
  run: vi.fn(),
  retry: vi.fn(),
} as unknown as RumoStore;

beforeEach(() => {
  vi.mocked(getDatabase).mockResolvedValue({
    select: vi.fn(async (query: string) => {
      if (query.includes('backup_preferences'))
        return [
          {
            frequency: 'daily',
            daily_keep: 7,
            weekly_keep: 4,
            monthly_keep: 6,
            last_auto_at: '1791504000',
          },
        ];
      if (query.includes('finance_preferences')) return [{ hide_values: 0 }];
      if (query.includes('timeline_preferences')) return [{ private_mode: 0 }];
      return [];
    }) as never,
    execute: vi.fn(),
  });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'data_info')
      return {
        databasePath: 'C:\\Users\\TESTE\\rumo.db',
        automaticDirectory: 'C:\\Users\\TESTE\\backups',
        appVersion: '1.8.0',
      };
    if (command === 'health_check')
      return {
        sqlite: 'ok',
        foreignKeys: 'ok',
        schemaVersion: 32,
        expectedSchema: 32,
        attachmentCount: 3,
        attachmentMissing: 1,
        attachmentMismatched: 0,
        orphanFiles: 0,
        backupDirectory: 'C:\\Users\\TESTE\\backups',
        backupCount: 2,
        latestBackupAt: '1791504000',
        lastBackupError: '',
      };
    if (command === 'inspect_backup')
      return {
        backupVersion: 2,
        appVersion: '1.8.0',
        schemaVersion: 32,
        createdAt: '1791504000',
        databaseSize: 2_097_152,
        attachmentCount: 3,
        kind: 'manual',
        sha256: 'a'.repeat(64),
      };
    return null;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('keeps backup schedule, retention, health and recovery actions accessible', async () => {
  render(<Settings store={store} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Backup e dados' }));
  expect(await screen.findByText('C:\\Users\\TESTE\\backups')).toBeTruthy();
  expect((screen.getByLabelText('Backup automático') as HTMLSelectElement).value).toBe('daily');
  expect((screen.getByLabelText('Diários') as HTMLInputElement).value).toBe('7');
  expect((screen.getByLabelText('Semanais') as HTMLInputElement).value).toBe('4');
  expect((screen.getByLabelText('Mensais') as HTMLInputElement).value).toBe('6');
  expect(screen.getByText(/Próximo backup:/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Verificar integridade' }));
  expect(
    await screen.findByText(/SQLite: ok.*Chaves estrangeiras: ok.*Schema 32\/32/),
  ).toBeTruthy();
  expect(screen.getByText(/2\/3 íntegros/)).toBeTruthy();
});

it('validates restore before enabling its explicit destructive confirmation', async () => {
  vi.mocked(open).mockResolvedValue('C:\\TESTE\\RUMAR-backup.zip');
  render(<Settings store={store} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Backup e dados' }));
  await user.click(screen.getByRole('button', { name: 'Restaurar backup' }));
  expect(await screen.findByText(/checksums e integridade validados/)).toBeTruthy();
  expect(screen.getByText(/Banco: 2 MB · anexos: 3/)).toBeTruthy();
  const confirmation = screen.getByRole('checkbox', {
    name: 'Entendo que os dados atuais serão substituídos',
  });
  const restore = screen.getByRole('button', { name: 'Confirmar restauração' });
  expect(restore.hasAttribute('disabled')).toBe(true);
  await user.click(confirmation);
  expect(restore.hasAttribute('disabled')).toBe(false);
});

it('surfaces an inaccessible backup directory without losing the settings screen', async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'data_info')
      return {
        databasePath: 'C:\\Users\\TESTE\\rumo.db',
        automaticDirectory: 'Z:\\indisponivel',
        appVersion: '1.8.0',
      };
    if (command === 'open_backup_directory') throw new Error('Diretório indisponível');
    return null;
  });
  render(<Settings store={store} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Backup e dados' }));
  await user.click(screen.getByRole('button', { name: 'Abrir pasta' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Diretório indisponível'),
  );
  expect(screen.getByRole('heading', { name: 'Dados' })).toBeTruthy();
});
