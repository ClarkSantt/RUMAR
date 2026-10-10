// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectCard } from '../src/features/projects/ProjectCard';
import { ProjectActionMenu } from '../src/features/projects/ProjectActionMenu';
import { ProjectDetailOverview } from '../src/features/projects/ProjectDetailOverview';
import { projectEmptyCopy, projectsForStatus } from '../src/features/projects/Projects';
import { ObjectiveCard } from '../src/features/objectives/ObjectiveCard';
import { ObjectiveDetailOverview } from '../src/features/objectives/ObjectiveDetailOverview';
import { objectivesForCategory } from '../src/features/objectives/Objectives';
import type { ProjectSummary } from '../src/features/projects/types';
import type { Objective } from '../src/features/objectives/repository';

afterEach(cleanup);

const project: ProjectSummary = {
  id: 'p1',
  name: 'Planejar o semestre',
  description: 'Preparar as próximas etapas.',
  status: 'active',
  start_date: '2026-01-01',
  target_date: '2026-12-01',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  completed_at: null,
  archived_at: null,
  sort_order: 0,
  task_count: 10,
  completed_count: 7,
  next_task: 'Revisar o plano',
  blocked: 0,
  deleted_at: null,
};
const objective: Objective & { link_count: number } = {
  id: 'o1',
  name: 'Aprender com consistência',
  description: 'Uma etapa de cada vez.',
  category: 'learning',
  status: 'active',
  start_date: '2026-01-01',
  target_date: '2026-12-01',
  progress_mode: 'manual',
  progress_ref: null,
  manual_current: 7,
  manual_target: 10,
  manual_unit: 'etapas',
  body_baseline: null,
  body_target: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  completed_at: null,
  archived_at: null,
  objective_kind: 'objective',
  horizon: 'year',
  horizon_label: '2026',
  lifecycle_status: 'active',
  progress_strategy: 'manual',
  progress_direction: 'increase',
  numeric_start: 0,
  numeric_current: 70,
  numeric_target: 100,
  numeric_unit: '%',
  next_step: 'Revisar o plano',
  deleted_at: null,
  link_count: 2,
};

it('preserva os filtros reais e distingue filtro vazio de ausência total de projetos', () => {
  expect(projectsForStatus([project], 'paused')).toEqual([]);
  expect(projectsForStatus([project], 'active')).toEqual([project]);
  expect(projectEmptyCopy('paused', true).title).toBe('Nenhum projeto pausado.');
  expect(projectEmptyCopy('paused', false).title).toBe('Nenhum projeto ainda.');
});

it('mostra progresso, próxima ação e prazo reais no projeto', async () => {
  const onOpen = vi.fn();
  render(<ProjectCard project={project} onOpen={onOpen} />);
  expect(screen.getByText('70%')).toBeTruthy();
  expect(screen.getByText('7 de 10 tarefas')).toBeTruthy();
  expect(screen.getByText('Revisar o plano')).toBeTruthy();
  expect(screen.getByLabelText('Progresso de Planejar o semestre').getAttribute('value')).toBe('7');
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Abrir projeto Planejar o semestre' }));
  expect(onOpen).toHaveBeenCalledOnce();
});

it('mantém edição e contexto de execução no detalhe do projeto', async () => {
  const onEdit = vi.fn();
  render(<ProjectDetailOverview project={project} onEdit={onEdit} />);
  expect(screen.getByRole('heading', { name: project.name })).toBeTruthy();
  expect(screen.getByText('7 de 10 tarefas concluídas')).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Editar projeto' }));
  expect(onEdit).toHaveBeenCalledOnce();
});

it('fecha o menu contextual com Escape e devolve o foco ao acionador', async () => {
  const user = userEvent.setup();
  render(
    <ProjectActionMenu label="Mais ações do projeto">
      <button>Arquivar</button>
    </ProjectActionMenu>,
  );
  const summary = screen.getByLabelText('Mais ações do projeto');
  await user.click(summary);
  expect((summary.parentElement as HTMLDetailsElement).open).toBe(true);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Arquivar' }));
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(summary);
  await user.keyboard('{Escape}');
  expect((summary.parentElement as HTMLDetailsElement).open).toBe(false);
  expect(document.activeElement).toBe(summary);
  await user.click(summary);
  await user.keyboard('{Enter}');
  expect((summary.parentElement as HTMLDetailsElement).open).toBe(false);
  await user.keyboard('{Enter}');
  expect((summary.parentElement as HTMLDetailsElement).open).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Arquivar' }));
  expect((summary.parentElement as HTMLDetailsElement).open).toBe(false);
});

it('filtra categorias reais e mostra indicador e vínculos sem expor valores ocultos', () => {
  expect(objectivesForCategory([objective], 'learning')).toEqual([objective]);
  expect(objectivesForCategory([objective], 'finance')).toEqual([]);
  const { rerender } = render(
    <ObjectiveCard
      objective={objective}
      category="Aprendizado"
      progress={{
        label: 'Progresso informado',
        current: 7,
        target: 10,
        unit: 'etapas',
        percent: 70,
      }}
      milestones={{ total: 4, completed: 2 }}
      onOpen={() => {}}
    />,
  );
  expect(screen.getByText('70%')).toBeTruthy();
  expect(screen.getByText('2 de 4 marcos')).toBeTruthy();
  expect(screen.getByText('2 vínculos')).toBeTruthy();
  rerender(
    <ObjectiveCard
      objective={objective}
      category="Aprendizado"
      progress={{
        label: 'Meta financeira',
        current: 0,
        target: null,
        unit: '',
        percent: null,
        hidden: true,
      }}
      onOpen={() => {}}
    />,
  );
  expect(screen.getByText('Valores ocultos')).toBeTruthy();
  expect(screen.queryByText('70%')).toBeNull();
});

it('mostra progresso textual no detalhe do objetivo e respeita privacidade', () => {
  const { rerender } = render(
    <ObjectiveDetailOverview
      objective={objective}
      category="Aprendizado"
      status="Ativo"
      progress={{
        label: 'Progresso informado',
        current: 7,
        target: 10,
        unit: 'etapas',
        percent: 70,
      }}
      focusSeconds={0}
      actions={<button>Editar</button>}
    />,
  );
  expect(screen.getByRole('heading', { name: objective.name })).toBeTruthy();
  expect(screen.getByText('70%')).toBeTruthy();
  expect(screen.getByLabelText('Progresso do indicador')).toBeTruthy();
  rerender(
    <ObjectiveDetailOverview
      objective={objective}
      category="Aprendizado"
      status="Ativo"
      progress={{
        label: 'Meta financeira',
        current: 0,
        target: null,
        unit: '',
        percent: null,
        hidden: true,
      }}
      focusSeconds={0}
      actions={<button>Editar</button>}
    />,
  );
  expect(screen.getByText('Valores ocultos')).toBeTruthy();
  expect(screen.queryByLabelText('Progresso do indicador')).toBeNull();
});
