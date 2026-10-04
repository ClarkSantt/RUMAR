import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase } from '../lib/database/connection';
import { Repository } from '../services/repository';
import type { Snapshot } from '../types/models';

export interface Notice {
  message: string;
  error?: boolean;
  undo?: () => Promise<boolean>;
}
export function useRumo() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [startupError, setStartupError] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const repository = useRef<Repository | null>(null);
  const locked = useRef(false);
  const load = useCallback(async () => {
    try {
      repository.current = new Repository(await getDatabase());
      setData(await repository.current.snapshot());
    } catch (error) {
      console.error('RUMO: falha ao abrir SQLite', error instanceof Error ? error.name : 'erro');
      setStartupError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const run = useCallback(
    async (action: (repo: Repository) => Promise<unknown>, message?: string): Promise<boolean> => {
      if (!repository.current || locked.current) return false;
      locked.current = true;
      setBusy(true);
      setNotice((current) => (current?.error ? null : current));
      let persisted = false;
      try {
        await action(repository.current);
        persisted = true;
        setData(await repository.current.snapshot());
        if (message) setNotice({ message });
        return true;
      } catch (error) {
        console.error('RUMO: operação falhou', error instanceof Error ? error.name : 'erro');
        setNotice({
          error: true,
          message: persisted
            ? 'A alteração foi salva, mas a lista não atualizou. Reabra o RUMO para recarregar os dados.'
            : error instanceof Error
              ? `Não foi possível salvar. ${error.message}`
              : 'Não foi possível salvar no banco local. Tente novamente.',
        });
        return false;
      } finally {
        locked.current = false;
        setBusy(false);
      }
    },
    [],
  );
  return {
    data,
    busy,
    run,
    notice,
    setNotice,
    startupError,
    retry: async () => {
      setStartupError(false);
      await load();
    },
  };
}
export type RumoStore = ReturnType<typeof useRumo>;
