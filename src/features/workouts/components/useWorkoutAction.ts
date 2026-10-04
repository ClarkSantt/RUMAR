import { useRef, useState } from 'react';

export function useWorkoutAction(onSaved?: () => void) {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<unknown>) {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      onSaved?.();
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Não foi possível salvar. Tente novamente.',
      );
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
