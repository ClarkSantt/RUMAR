import { useState } from 'react';
import { ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { QuickEntry } from '../../components/QuickEntry';
import type { RumoStore } from '../../hooks/useRumo';
import type { InboxItem } from '../../types/models';
import { getDatabase } from '../../lib/database/connection';
import { convertInboxTo } from './conversions';
function InboxRow({ item, store }: { item: InboxItem; store: RumoStore }) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(item.content);
  async function remove() {
    if (await store.run((repo) => repo.archiveInbox(item.id)))
      store.setNotice({
        message: 'Item excluído.',
        undo: () => store.run((repo) => repo.archiveInbox(item.id, false), 'Item restaurado.'),
      });
  }
  return (
    <article className="inbox-row">
      <div className="inbox-content">{item.content}</div>
      <div className="inbox-actions">
        {(['project', 'thought'] as const).map((target) => (
          <button
            key={target}
            className="text-button"
            disabled={store.busy}
            onClick={() =>
              void store.run(
                async () => convertInboxTo(await getDatabase(), item.id, target),
                target === 'project' ? 'Transformado em projeto.' : 'Transformado em pensamento.',
              )
            }
          >
            Transformar em {target === 'project' ? 'projeto' : 'pensamento'}
          </button>
        ))}
        <button
          className="text-button convert-button"
          disabled={store.busy}
          onClick={() =>
            void store.run(
              (repo) => repo.convertInbox(item.id),
              'Transformado em tarefa. Disponível em Tarefas → Todas.',
            )
          }
        >
          <span>Transformar em tarefa</span>
          <ArrowRight size={16} />
        </button>
        <button
          className="icon-button"
          disabled={store.busy}
          onClick={() => {
            setDraft(item.content);
            setEditing(true);
          }}
          aria-label={`Editar ${item.content}`}
        >
          <Pencil size={15} />
        </button>
        <button
          className="icon-button"
          disabled={store.busy}
          onClick={() => void remove()}
          aria-label={`Excluir ${item.content}`}
        >
          <Trash2 size={15} />
        </button>
      </div>
      {editing && (
        <Dialog
          title="Editar captura"
          onClose={() => setEditing(false)}
          busy={store.busy}
          error={store.notice?.error ? store.notice.message : undefined}
        >
          <form
            className="dialog-content"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await store.run((repo) => repo.editInbox(item.id, draft), 'Captura salva.'))
                setEditing(false);
            }}
          >
            <label htmlFor="inbox-edit">Conteúdo</label>
            <textarea
              id="inbox-edit"
              autoFocus
              required
              rows={5}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={store.busy}
            />
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={store.busy}
                onClick={() => setEditing(false)}
              >
                Cancelar
              </button>
              <button className="primary-button" disabled={store.busy || !draft.trim()}>
                Salvar
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </article>
  );
}
export function InboxPage({ store }: { store: RumoStore }) {
  const items = store.data!.inbox;
  return (
    <>
      <header className="page-header">
        <p className="eyebrow">TIRE DA CABEÇA. GUARDE AQUI.</p>
        <h1>
          Inbox <span className="heading-count">{items.length}</span>
        </h1>
        <p>Capture agora. Organize quando fizer sentido.</p>
      </header>
      <QuickEntry
        placeholder="Capturar alguma coisa…"
        multiline
        busy={store.busy}
        onSave={(content) => store.run((repo) => repo.createInbox(content), 'Guardado no Inbox.')}
      />
      <p className="input-hint">
        Enter para salvar <span>·</span> Shift + Enter para nova linha
      </p>
      <div className="inbox-list">
        {items.length ? (
          items.map((item) => <InboxRow key={item.id} item={item} store={store} />)
        ) : (
          <EmptyState
            title="Inbox vazia."
            description="Um espaço livre para suas próximas ideias."
          />
        )}
      </div>
    </>
  );
}
export function Capture({ store, onClose }: { store: RumoStore; onClose: () => void }) {
  return (
    <Dialog
      title="Capturar"
      onClose={onClose}
      busy={store.busy}
      error={store.notice?.error ? store.notice.message : undefined}
    >
      <div className="dialog-content">
        <p>Guarde no Inbox e siga com o seu dia.</p>
        <QuickEntry
          placeholder="O que você quer guardar?"
          autoFocus
          multiline
          busy={store.busy}
          onSave={async (content) => {
            const ok = await store.run((repo) => repo.createInbox(content), 'Guardado no Inbox.');
            if (ok) onClose();
            return ok;
          }}
        />
        <p className="input-hint">
          Enter para salvar <span>·</span> Esc para fechar
        </p>
      </div>
    </Dialog>
  );
}
