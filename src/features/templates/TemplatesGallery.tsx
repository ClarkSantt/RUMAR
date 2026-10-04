import { useEffect, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { localDate } from '../../lib/dates';
import { TemplatesRepository, type TemplateKind, type TemplateRow } from './repository';

const kinds: { id: TemplateKind; label: string; table: string; name: string; where: string }[] = [
  { id: 'task', label: 'Tarefa', table: 'tasks', name: 'title', where: 'archived_at IS NULL' },
  {
    id: 'project',
    label: 'Projeto',
    table: 'projects',
    name: 'name',
    where: 'archived_at IS NULL',
  },
  { id: 'routine', label: 'Rotina', table: 'routines', name: 'name', where: 'archived_at IS NULL' },
  {
    id: 'workout',
    label: 'Plano de treino',
    table: 'workout_plans',
    name: 'name',
    where: 'archived_at IS NULL',
  },
  { id: 'meal', label: 'Refeição', table: 'meals', name: 'name', where: 'archived_at IS NULL' },
];
export function TemplatesGallery() {
  const [kind, setKind] = useState<TemplateKind>('task');
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh(nextKind = kind) {
    const db = await getDatabase();
    const option = kinds.find((item) => item.id === nextKind)!;
    const [templates, available] = await Promise.all([
      new TemplatesRepository(db).list(nextKind),
      db.select<{ id: string; name: string }[]>(
        `SELECT id,${option.name} name FROM ${option.table} WHERE ${option.where} ORDER BY ${option.name} LIMIT 200`,
      ),
    ]);
    setRows(templates);
    setSources(available);
    setSourceId((current) =>
      available.some((item) => item.id === current) ? current : (available[0]?.id ?? ''),
    );
  }
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then(async (db) => {
        const option = kinds.find((item) => item.id === kind)!;
        const [templates, available] = await Promise.all([
          new TemplatesRepository(db).list(kind),
          db.select<{ id: string; name: string }[]>(
            `SELECT id,${option.name} name FROM ${option.table} WHERE ${option.where} ORDER BY ${option.name} LIMIT 200`,
          ),
        ]);
        if (active) {
          setRows(templates);
          setSources(available);
          setSourceId(available[0]?.id ?? '');
        }
      })
      .catch(() => {
        if (active) setMessage('Não foi possível carregar os templates.');
      });
    return () => {
      active = false;
    };
  }, [kind]);
  async function action(work: (repo: TemplatesRepository) => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work(new TemplatesRepository(await getDatabase()));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível concluir.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="templates-gallery">
      <p>Guarde estruturas que você usa de novo. Cada uso cria registros independentes.</p>
      <label htmlFor="template-kind">Tipo</label>
      <select
        id="template-kind"
        value={kind}
        onChange={(event) => {
          setKind(event.target.value as TemplateKind);
          setEditingId(null);
          setName('');
        }}
      >
        {kinds.map((option) => (
          <option value={option.id} key={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action(async (repo) => {
            await repo.saveFrom(kind, sourceId, name, description, editingId ?? undefined);
            setMessage(editingId ? 'Template atualizado para usos futuros.' : 'Template salvo.');
            setEditingId(null);
            setName('');
            setDescription('');
          });
        }}
      >
        <label htmlFor="template-source">Copiar estrutura de</label>
        <select
          id="template-source"
          value={sourceId}
          onChange={(event) => setSourceId(event.target.value)}
          required
        >
          {sources.map((source) => (
            <option value={source.id} key={source.id}>
              {source.name}
            </option>
          ))}
        </select>
        <label htmlFor="template-name">Nome do template</label>
        <input
          id="template-name"
          value={name}
          maxLength={500}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <label htmlFor="template-description">Descrição opcional</label>
        <input
          id="template-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <button className="secondary-button" disabled={busy || !sourceId || !name.trim()}>
          {editingId ? 'Atualizar estrutura para usos futuros' : 'Salvar como template'}
        </button>
        {editingId && (
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setEditingId(null);
              setName('');
              setDescription('');
            }}
          >
            Cancelar edição
          </button>
        )}
      </form>
      <h3>Meus templates</h3>
      {rows.length === 0 ? (
        <p>Nenhum template deste tipo ainda.</p>
      ) : (
        <ul className="templates-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{row.name}</strong>
                {row.description && <p>{row.description}</p>}
              </div>
              <div className="template-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async (repo) => {
                      await repo.apply(row.id);
                      setMessage('Novo registro criado a partir do template.');
                    })
                  }
                >
                  Criar novo
                </button>
                {row.kind === 'meal' && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void action(async (repo) => {
                        await repo.applyMealToDiary(row.id, localDate());
                        setMessage('Refeição adicionada ao diário de hoje.');
                      })
                    }
                  >
                    Adicionar ao diário
                  </button>
                )}
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setEditingId(row.id);
                    setName(row.name);
                    setDescription(row.description);
                  }}
                >
                  Editar
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Excluir o template ${row.name}? Os registros criados a partir dele serão preservados.`,
                      )
                    )
                      void action(async (repo) => {
                        await repo.remove(row.id);
                        setMessage('Template excluído.');
                      });
                  }}
                >
                  Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
