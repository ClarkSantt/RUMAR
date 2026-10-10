import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Link2, Plus, X } from 'lucide-react';
import { getDatabase } from '../../lib/database/connection';
import { DependenciesRepository, type DependencyRow, type ProjectBlocker } from './repository';

export function DependenciesPanel({
  type,
  entityId,
  onChanged,
}: {
  type: 'task' | 'project';
  entityId: string;
  onChanged?: () => Promise<unknown> | unknown;
}) {
  const [dependencies, setDependencies] = useState<DependencyRow[]>([]);
  const [candidates, setCandidates] = useState<DependencyRow[]>([]);
  const [blockers, setBlockers] = useState<ProjectBlocker[]>([]);
  const [query, setQuery] = useState('');
  const [blocker, setBlocker] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const repo = new DependenciesRepository(await getDatabase());
    const [linked, available, manual] = await Promise.all([
      type === 'task' ? repo.taskDependencies(entityId) : repo.projectDependencies(entityId),
      type === 'task'
        ? repo.taskCandidates(entityId, query)
        : repo.projectCandidates(entityId, query),
      type === 'project' ? repo.blockers(entityId) : Promise.resolve([]),
    ]);
    setDependencies(linked);
    setCandidates(available);
    setBlockers(manual);
  }, [type, entityId, query]);
  useEffect(() => {
    const timer = setTimeout(
      () => void load().catch(() => setError('Não foi possível carregar dependências.')),
      120,
    );
    return () => clearTimeout(timer);
  }, [load]);
  async function act(action: (repo: DependenciesRepository) => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action(new DependenciesRepository(await getDatabase()));
      await onChanged?.();
      setQuery('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  const unresolved = dependencies.filter((row) => !row.completed);
  return (
    <section className="dependency-panel">
      <h3>Dependências</h3>
      {unresolved.length > 0 && (
        <p className="dependency-warning" role="status">
          <AlertTriangle size={16} /> Bloqueado por {unresolved.length}{' '}
          {unresolved.length === 1 ? 'item pendente' : 'itens pendentes'}.
        </p>
      )}
      {dependencies.map((row) => (
        <div className="objective-link" key={row.id}>
          <span>
            {row.completed ? <Check size={15} /> : <AlertTriangle size={15} />} {row.name}
          </span>
          <button
            className="icon-button"
            aria-label={`Remover dependência ${row.name}`}
            disabled={busy}
            onClick={() =>
              void act((repo) =>
                type === 'task'
                  ? repo.removeTaskDependency(entityId, row.id)
                  : repo.removeProjectDependency(entityId, row.id),
              )
            }
          >
            <X size={15} />
          </button>
        </div>
      ))}
      <label htmlFor={`${type}-dependency-search`}>Adicionar dependência</label>
      <input
        id={`${type}-dependency-search`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={type === 'task' ? 'Buscar tarefa anterior' : 'Buscar projeto anterior'}
      />
      {query &&
        candidates.slice(0, 6).map((row) => (
          <button
            className="review-line"
            key={row.id}
            disabled={busy}
            onClick={() =>
              void act((repo) =>
                type === 'task'
                  ? repo.addTaskDependency(entityId, row.id)
                  : repo.addProjectDependency(entityId, row.id),
              )
            }
          >
            <Link2 size={15} /> {row.name}
          </button>
        ))}
      {type === 'project' && (
        <div className="project-blockers">
          <h3>Bloqueios manuais</h3>
          {blockers.map((row) => (
            <div className="review-line" key={row.id}>
              <div>
                <strong>{row.content}</strong>
                <span>{row.resolved_at ? 'Resolvido' : 'Em aberto'}</span>
              </div>
              <div className="review-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void act((repo) => repo.resolveBlocker(row.id, !row.resolved_at))}
                >
                  {row.resolved_at ? 'Reabrir' : 'Resolver'}
                </button>
                <button
                  className="icon-button"
                  aria-label="Remover bloqueio"
                  disabled={busy}
                  onClick={() => void act((repo) => repo.removeBlocker(row.id))}
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          ))}
          <div className="name-field">
            <input
              value={blocker}
              onChange={(event) => setBlocker(event.target.value)}
              placeholder="O que está bloqueando este projeto?"
              maxLength={1000}
            />
            <button
              className="secondary-button"
              disabled={busy || !blocker.trim()}
              onClick={() =>
                void act(async (repo) => {
                  await repo.addBlocker(entityId, blocker);
                  setBlocker('');
                })
              }
            >
              <Plus size={15} /> Adicionar bloqueio
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="dialog-error">
          {error}
        </p>
      )}
    </section>
  );
}
