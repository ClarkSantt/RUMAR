// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { database } from './database';
const mocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));
vi.mock('../src/lib/database/connection', () => ({ getDatabase: mocks.getDatabase }));
import { loadWindowsPreferences, saveWindowsPreference } from '../src/features/windows/preferences';

afterEach(() => mocks.getDatabase.mockReset());

it('mantém preferências de inicialização sem depender da antiga opção de fechar a janela', async () => {
  const db = database();
  try {
    mocks.getDatabase.mockResolvedValue(db.connection);
    db.sqlite.exec(
      "INSERT INTO settings(key,value,updated_at) VALUES('windows_close_behavior','exit','2026-10-04')",
    );
    const initial = await loadWindowsPreferences();
    expect(initial).not.toHaveProperty('closeBehavior');
    expect(initial).toMatchObject({
      startMinimized: false,
      globalShortcut: '',
    });
    await saveWindowsPreference('windows_start_minimized', '1');
    expect(await loadWindowsPreferences()).toMatchObject({
      startMinimized: true,
    });
  } finally {
    db.sqlite.close();
  }
});
