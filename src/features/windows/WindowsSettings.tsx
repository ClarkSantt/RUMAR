import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  getWindowsAutostart,
  loadWindowsPreferences,
  saveWindowsPreference,
  setWindowsAutostart,
  type WindowsPreferences,
} from './preferences';
import { getGlobalHotkeyError } from './runtime';

const shortcuts = [
  { value: '', label: 'Desativado' },
  { value: 'Control+Alt+Space', label: 'Ctrl + Alt + Espaço' },
  { value: 'Control+Alt+R', label: 'Ctrl + Alt + R' },
  { value: 'Control+Shift+Space', label: 'Ctrl + Shift + Espaço' },
];

export function WindowsSettings() {
  const [prefs, setPrefs] = useState<WindowsPreferences | null>(null);
  const [autostart, setAutostart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(getGlobalHotkeyError);
  useEffect(() => {
    let live = true;
    void Promise.all([loadWindowsPreferences(), getWindowsAutostart()])
      .then(([loaded, enabled]) => {
        if (live) {
          setPrefs(loaded);
          setAutostart(enabled);
        }
      })
      .catch(() => live && setError('Não foi possível carregar as opções do Windows.'));
    const hotkey = (event: Event) => setError((event as CustomEvent<string>).detail ?? '');
    window.addEventListener('rumo-global-hotkey-status', hotkey);
    return () => {
      live = false;
      window.removeEventListener('rumo-global-hotkey-status', hotkey);
    };
  }, []);
  async function change(key: Parameters<typeof saveWindowsPreference>[0], value: string) {
    setBusy(true);
    setError('');
    try {
      await saveWindowsPreference(key, value);
      setPrefs(await loadWindowsPreferences());
    } catch {
      setError('Não foi possível salvar a preferência.');
    } finally {
      setBusy(false);
    }
  }
  if (!prefs) return <p>{error || 'Carregando opções do Windows…'}</p>;
  return (
    <section className="settings-section" aria-labelledby="windows-settings-heading">
      <h2 id="windows-settings-heading">Windows</h2>
      <p>Fechar a janela mantém o RUMAR na bandeja. “Sair” encerra o processo e os lembretes.</p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={autostart}
          disabled={busy || !isTauri()}
          onChange={(event) => {
            setBusy(true);
            setError('');
            void setWindowsAutostart(event.target.checked)
              .then(setAutostart)
              .catch(() => setError('O Windows não permitiu alterar o início automático.'))
              .finally(() => setBusy(false));
          }}
        />
        Iniciar RUMAR com o Windows
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={prefs.startMinimized}
          disabled={busy || !autostart}
          onChange={(event) =>
            void change('windows_start_minimized', event.target.checked ? '1' : '0')
          }
        />
        Iniciar minimizado na bandeja
      </label>
      <label>
        Atalho global Quick Add
        <select
          value={prefs.globalShortcut}
          disabled={busy || !isTauri()}
          onChange={(event) => void change('windows_global_shortcut', event.target.value)}
        >
          {shortcuts.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={prefs.backgroundNotifications}
          disabled={busy || !isTauri()}
          onChange={(event) =>
            void change('windows_background_notifications', event.target.checked ? '1' : '0')
          }
        />
        Notificações enquanto o RUMAR está na bandeja
      </label>
      <p className="field-help">
        Ctrl + Espaço permanece dentro do RUMAR. O atalho global é opcional.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
