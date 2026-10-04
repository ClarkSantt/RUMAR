import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { loadWindowsPreferences } from './preferences';
import { setWindowInTray } from './background';

let hotkeyError = '';
export function getGlobalHotkeyError() {
  return hotkeyError;
}

export async function startWindowsControls(handlers: {
  quick: (returnToTray: boolean) => void;
  focus: () => void;
  sync: () => void;
  exit: () => void;
}) {
  if (!isTauri()) return () => {};
  void getCurrentWindow()
    .isVisible()
    .then((visible) => setWindowInTray(!visible))
    .catch(() => {});
  let disposed = false;
  let shortcut = '';
  let sequence: Promise<void> = Promise.resolve();
  const openQuick = async () => {
    const win = getCurrentWindow();
    const wasVisible = await win.isVisible();
    await win.show();
    await win.setFocus();
    setWindowInTray(false);
    handlers.quick(!wasVisible);
  };
  const configureShortcut = () => {
    sequence = sequence.then(async () => {
      if (shortcut) {
        await unregister(shortcut).catch(() => {});
        shortcut = '';
      }
      if (disposed) return;
      const next = (await loadWindowsPreferences()).globalShortcut;
      if (!next) return;
      try {
        await register(next, (event) => {
          if (event.state !== 'Pressed') return;
          void openQuick().catch(() => {});
        });
        shortcut = next;
        hotkeyError = '';
        window.dispatchEvent(new CustomEvent('rumo-global-hotkey-status', { detail: '' }));
      } catch {
        hotkeyError = 'Não foi possível registrar este atalho. Escolha outro em Configurações.';
        window.dispatchEvent(
          new CustomEvent('rumo-global-hotkey-status', {
            detail: hotkeyError,
          }),
        );
      }
    });
  };
  const unlisten = await listen<string>('rumo-tray-command', (event) => {
    switch (event.payload) {
      case 'quick':
        void openQuick().catch(() => {});
        break;
      case 'focus':
        handlers.focus();
        break;
      case 'sync':
        handlers.sync();
        break;
      case 'quit':
        handlers.exit();
        break;
      case 'focus-pause':
      case 'focus-resume':
      case 'focus-finish':
        window.dispatchEvent(new CustomEvent('rumo-focus-tray-action', { detail: event.payload }));
        break;
    }
  });
  const unlistenOpen = await listen('rumo-tray-open', () => setWindowInTray(false));
  const unlistenHidden = await listen('rumo-tray-hidden', () => setWindowInTray(true));
  window.addEventListener('rumo-windows-settings-changed', configureShortcut);
  configureShortcut();
  return () => {
    disposed = true;
    unlisten();
    unlistenOpen();
    unlistenHidden();
    window.removeEventListener('rumo-windows-settings-changed', configureShortcut);
    void sequence.then(async () => {
      if (shortcut) await unregister(shortcut);
    });
  };
}
