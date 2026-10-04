import { useEffect, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { projectOptions } from '../projects/options';
import type { TaskInput } from '../../types/models';

export function ProjectFields({
  draft,
  onChange,
}: {
  draft: TaskInput;
  onChange: (value: TaskInput) => void;
}) {
  const [options, setOptions] = useState<Awaited<ReturnType<typeof projectOptions>> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then(projectOptions)
      .then((value) => {
        if (active) setOptions(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="form-grid">
      <div>
        <label htmlFor="task-project">Projeto</label>
        <select
          id="task-project"
          disabled={!options}
          value={draft.project_id ?? ''}
          onChange={(e) =>
            onChange({ ...draft, project_id: e.target.value || null, project_section_id: null })
          }
        >
          <option value="">Nenhum</option>
          {options?.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {error && <p role="alert">Não foi possível carregar projetos. Reabra o editor.</p>}
      </div>
      <div>
        <label htmlFor="task-section">Seção</label>
        <select
          id="task-section"
          disabled={!draft.project_id || !options}
          value={draft.project_section_id ?? ''}
          onChange={(e) => onChange({ ...draft, project_section_id: e.target.value || null })}
        >
          <option value="">Nenhuma</option>
          {options?.sections
            .filter((s) => s.project_id === draft.project_id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}
