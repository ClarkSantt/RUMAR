import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import type { Project, ProjectInput } from './types';

export function ProjectEditor({
  project,
  busy,
  onSave,
  onClose,
}: {
  project?: Project;
  busy: boolean;
  onSave: (input: ProjectInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ProjectInput>({
    name: project?.name ?? '',
    description: project?.description ?? '',
    start_date: project?.start_date ?? null,
    target_date: project?.target_date ?? null,
  });
  const [error, setError] = useState('');
  return (
    <Dialog
      title={project ? 'Editar projeto' : 'Novo projeto'}
      busy={busy}
      onClose={onClose}
      error={error}
    >
      <form
        className="project-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(draft).then((ok) => {
            if (ok) onClose();
            else
              setError('Não foi possível salvar o projeto. Confira os campos e tente novamente.');
          });
        }}
      >
        <div className="dialog-content">
          <label htmlFor="project-name">Nome</label>
          <input
            id="project-name"
            autoFocus
            required
            maxLength={500}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <label htmlFor="project-description">
            Descrição <span>opcional</span>
          </label>
          <textarea
            id="project-description"
            rows={5}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <div className="form-grid">
            <div>
              <label htmlFor="project-start">Início</label>
              <input
                id="project-start"
                type="date"
                value={draft.start_date ?? ''}
                onChange={(e) => setDraft({ ...draft, start_date: e.target.value || null })}
              />
            </div>
            <div>
              <label htmlFor="project-target">Prazo</label>
              <input
                id="project-target"
                type="date"
                min={draft.start_date ?? undefined}
                value={draft.target_date ?? ''}
                onChange={(e) => setDraft({ ...draft, target_date: e.target.value || null })}
              />
            </div>
          </div>
        </div>
        <footer className="drawer-footer">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            Salvar projeto
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
