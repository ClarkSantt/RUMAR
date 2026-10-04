import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, Archive, Search } from 'lucide-react';
import { getDatabase } from '../../lib/database/connection';
import { addDays, formatDate, localDate } from '../../lib/dates';
import type { RumoStore } from '../../hooks/useRumo';
import { ThoughtsRepository, type Thought } from './repository';
import { ThoughtAutosave, flushThoughts, type SaveStatus } from './autosave';
import { Attachments } from '../attachments/Attachments';
import './thoughts.css';

function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
    .map((part, index) =>
      part.startsWith('**') ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : part.startsWith('*') ? (
        <em key={index}>{part.slice(1, -1)}</em>
      ) : (
        part
      ),
    );
}
function Markdown({ content }: { content: string }) {
  return (
    <div className="thought-preview">
      {content.split('\n').map((line, index) => {
        if (/^### /.test(line)) return <h4 key={index}>{inline(line.slice(4))}</h4>;
        if (/^## /.test(line)) return <h3 key={index}>{inline(line.slice(3))}</h3>;
        if (/^# /.test(line)) return <h2 key={index}>{inline(line.slice(2))}</h2>;
        if (/^[-*] /.test(line))
          return (
            <ul key={index}>
              <li>{inline(line.slice(2))}</li>
            </ul>
          );
        if (/^\d+\. /.test(line))
          return (
            <ol key={index} start={Number(line.split('.')[0])}>
              <li>{inline(line.replace(/^\d+\. /, ''))}</li>
            </ol>
          );
        return <p key={index}>{line ? inline(line) : <br />}</p>;
      })}
    </div>
  );
}
function Editor({
  thought,
  repo,
  onChange,
  onSaved,
  store,
}: {
  thought: Thought;
  repo: ThoughtsRepository;
  onChange: () => Promise<void>;
  onSaved: () => Promise<void>;
  store?: RumoStore;
}) {
  const [draft, setDraft] = useState({ title: thought.title, content: thought.content });
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const writer = useRef<ThoughtAutosave | null>(null);
  useEffect(() => {
    const controller = new ThoughtAutosave((value) => repo.save(thought.id, value), setStatus);
    writer.current = controller;
    return () => {
      void controller.dispose().catch(() => {});
    };
  }, [repo, thought.id]);
  function edit(field: 'title' | 'content', value: string) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    writer.current?.edit(next);
  }
  async function convert(target: 'task' | 'project' | 'inbox') {
    setBusy(true);
    setMessage('');
    try {
      await flushThoughts();
      await repo.convert(thought.id, target);
      if (store) await store.run(async () => {});
      setMessage(
        `Disponível em ${target === 'task' ? 'Tarefas' : target === 'project' ? 'Projetos' : 'Inbox'}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível transformar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="thought-editor"
      aria-label="Editor de pensamento"
      onBlur={() => {
        void flushThoughts()
          .then(onSaved)
          .catch(() => {});
      }}
    >
      <div className="thought-toolbar">
        <span role="status">
          {status === 'saved' ? 'Salvo' : status === 'saving' ? 'Salvando…' : 'Erro ao salvar'}
        </span>
        {status === 'error' && (
          <button
            className="text-button"
            onClick={() => void writer.current?.flush().catch(() => {})}
          >
            Tentar novamente
          </button>
        )}
        <button className="text-button" aria-pressed={preview} onClick={() => setPreview(!preview)}>
          {preview ? 'Editar' : 'Visualizar Markdown'}
        </button>
      </div>
      <label htmlFor="thought-title">Título (opcional)</label>
      <input
        id="thought-title"
        value={draft.title}
        onChange={(event) => edit('title', event.target.value)}
        placeholder="Sem título"
        disabled={busy}
      />
      <label htmlFor="thought-content">Pensamento</label>
      {preview ? (
        <Markdown content={draft.content} />
      ) : (
        <textarea
          id="thought-content"
          className="thought-content-editor"
          value={draft.content}
          onChange={(event) => edit('content', event.target.value)}
          placeholder="Deixe suas ideias aqui…"
          disabled={busy}
        />
      )}
      <p className="thought-help">
        Markdown: # título, - lista, **negrito** e *itálico*. Salvo automaticamente neste
        dispositivo.
      </p>
      <Attachments entityType="thought" entityId={thought.id} />
      <div className="thought-actions">
        <span>Transformar em</span>
        {(['task', 'project', 'inbox'] as const).map((target) => (
          <button
            key={target}
            className="secondary-button"
            disabled={busy || (!draft.title.trim() && !draft.content.trim())}
            onClick={() => void convert(target)}
          >
            {target === 'task' ? 'Tarefa' : target === 'project' ? 'Projeto' : 'Inbox'}
          </button>
        ))}
        <button
          className="icon-button"
          aria-label="Arquivar pensamento"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await flushThoughts();
              await repo.archive(thought.id);
              await onChange();
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Não foi possível arquivar.');
              setBusy(false);
            }
          }}
        >
          <Archive size={17} />
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
export function Thoughts({
  store,
  initialThoughtId,
}: {
  store?: RumoStore;
  initialThoughtId?: string;
}) {
  const [repo, setRepo] = useState<ThoughtsRepository | null>(null);
  const [items, setItems] = useState<Thought[]>([]);
  const [selected, setSelected] = useState<Thought | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    void getDatabase()
      .then((db) => {
        if (mounted) setRepo(new ThoughtsRepository(db));
      })
      .catch(() => setError('Não foi possível abrir pensamentos.'));
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    if (repo)
      void repo
        .list(search)
        .then((rows) => {
          if (current) setItems(rows);
        })
        .catch(() => {
          if (current) setError('Não foi possível buscar pensamentos.');
        });
    return () => {
      current = false;
    };
  }, [repo, search]);
  useEffect(() => {
    if (!repo || !initialThoughtId) return;
    let active = true;
    void repo
      .get(initialThoughtId)
      .then((thought) => {
        if (active) setSelected(thought);
      })
      .catch(() => {
        if (active) setError('Não foi possível abrir pensamento.');
      });
    return () => {
      active = false;
    };
  }, [repo, initialThoughtId]);
  async function choose(id?: string) {
    if (!repo || busy) return;
    setBusy(true);
    setError('');
    try {
      await flushThoughts();
      setSelected(id ? await repo.get(id) : await repo.create());
      setItems(await repo.list(search));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível abrir pensamento.');
    } finally {
      setBusy(false);
    }
  }
  const today = localDate();
  return (
    <div className="thoughts-page">
      <header className="page-header header-with-action">
        <div>
          <h1>Pensamentos</h1>
          <p>Espaço para pensar, sem precisar organizar agora.</p>
        </div>
        <button className="primary-button" disabled={!repo || busy} onClick={() => void choose()}>
          <Plus size={17} />
          Novo pensamento
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="thought-layout">
        <aside className="thought-list" aria-label="Pensamentos salvos">
          <div className="thought-search">
            <Search size={16} />
            <input
              aria-label="Buscar pensamentos"
              placeholder="Buscar pensamentos"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {items.map((item, index) => {
            const day = localDate(new Date(item.updated_at)),
              group =
                day === today ? 'Hoje' : day === addDays(today, -1) ? 'Ontem' : formatDate(day);
            const heading = index === 0 || localDate(new Date(items[index - 1].updated_at)) !== day;
            return (
              <div key={item.id}>
                {heading && <h2 className="thought-group">{group}</h2>}
                <button
                  className={`thought-list-item ${selected?.id === item.id ? 'selected' : ''}`}
                  onClick={() => void choose(item.id)}
                  disabled={busy}
                  aria-current={selected?.id === item.id ? 'true' : undefined}
                >
                  <strong>{item.title || 'Sem título'}</strong>
                  <span>{item.content || 'Pensamento vazio'}</span>
                </button>
              </div>
            );
          })}
          {!items.length && (
            <p className="thought-empty">
              {search ? 'Nenhum pensamento encontrado.' : 'Suas ideias começam aqui.'}
            </p>
          )}
          {items.length === 100 && (
            <p>Mostrando os 100 mais recentes. Use a busca para encontrar anteriores.</p>
          )}
        </aside>
        {selected && repo ? (
          <Editor
            key={selected.id}
            thought={selected}
            repo={repo}
            store={store}
            onSaved={async () => {
              setItems(await repo.list(search));
            }}
            onChange={async () => {
              setSelected(null);
              setItems(await repo.list(search));
            }}
          />
        ) : (
          <div className="thought-empty">
            <h2>Comece escrevendo qualquer coisa.</h2>
            <p>Crie um pensamento ou escolha um da lista.</p>
          </div>
        )}
      </div>
    </div>
  );
}
