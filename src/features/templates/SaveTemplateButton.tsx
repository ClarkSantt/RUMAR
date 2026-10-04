import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { getDatabase } from '../../lib/database/connection';
import { TemplatesRepository, type TemplateKind } from './repository';

export function SaveTemplateButton({
  kind,
  sourceId,
  initialName,
}: {
  kind: TemplateKind;
  sourceId: string;
  initialName: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      await new TemplatesRepository(await getDatabase()).saveFrom(
        kind,
        sourceId,
        name,
        description,
      );
      setSaved(true);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o template.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="text-button"
        onClick={() => {
          setName(initialName);
          setOpen(true);
        }}
        title="Guardar estrutura para uso futuro"
      >
        Salvar como template
      </button>
      {saved && (
        <span className="sr-only" role="status">
          Template salvo.
        </span>
      )}
      {open && (
        <Dialog
          title="Salvar como template"
          onClose={() => setOpen(false)}
          busy={busy}
          error={error}
        >
          <form
            className="dialog-content"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label htmlFor="save-template-name">Nome do template</label>
            <input
              id="save-template-name"
              autoFocus
              required
              maxLength={500}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <label htmlFor="save-template-description">Descrição opcional</label>
            <textarea
              id="save-template-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
            <p>
              O template guarda uma cópia da estrutura atual. Registros existentes não mudam se o
              template for editado.
            </p>
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setOpen(false)}>
                Cancelar
              </button>
              <button className="primary-button" disabled={busy || !name.trim()}>
                Salvar
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
