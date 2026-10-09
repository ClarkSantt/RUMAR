import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppSidebar } from '../../src/components/AppSidebar';
import { Dialog } from '../../src/components/Dialog';
import { EmptyState } from '../../src/components/EmptyState';
import { Home } from '../../src/features/home/Home';
import type { HomeDayData } from '../../src/features/home/repository';
import { InboxPage } from '../../src/features/inbox/Inbox';
import { GlobalSearch } from '../../src/features/search/GlobalSearch';
import { Tasks } from '../../src/features/tasks/Tasks';
import { ProjectCard } from '../../src/features/projects/ProjectCard';
import { ProjectDetailOverview } from '../../src/features/projects/ProjectDetailOverview';
import { ObjectiveCard } from '../../src/features/objectives/ObjectiveCard';
import { ObjectiveDetailOverview } from '../../src/features/objectives/ObjectiveDetailOverview';
import { HabitCard } from '../../src/features/habits/HabitCard';
import { RoutineSequenceCard } from '../../src/features/routines/RoutineSequenceCard';
import {
  habitEligible,
  habitProgress,
  habitReached,
  type Habit,
  type HabitEntry,
} from '../../src/features/habits/domain';
import type {
  Routine,
  RoutineItem,
  RoutineOccurrence,
  RoutineCompletion,
} from '../../src/features/routines/domain';
import type { ProjectSummary } from '../../src/features/projects/types';
import type { Objective, ObjectiveProgress } from '../../src/features/objectives/repository';
import { FolderKanban, ListChecks, Plus, Repeat2, Target } from 'lucide-react';
import type { RumoStore } from '../../src/hooks/useRumo';
import type { Snapshot, Task } from '../../src/types/models';
import '../../src/styles/global.css';
import '../../src/styles/visual-foundation.css';
import '../../src/styles/tasks-inbox.css';
import '../../src/styles/projects-objectives.css';
import '../../src/styles/habits-routines.css';
import '../../src/features/calendar/calendar.css';
import '../../src/features/calendar/planner.css';
import '../../src/features/workouts/workouts.css';
import '../../src/features/workouts/execution.css';
import '../../src/features/workouts/components/evolution.css';
import '../../src/features/body-progress/body-progress.css';
import '../../src/styles/calendar-workouts-body.css';
import { TemporalFitnessPreview } from './temporal-fitness';
import { NutritionFinancePreview } from './nutrition-finance';
import '../../src/styles/nutrition-finance-connections.css';
import { LegacyExperiencePreview } from './legacy-experience';
import { PlanningFoundationPreview } from './planning-foundation';
import '../../src/features/planning/planning.css';
import { addDays, localDate } from '../../src/lib/dates';

const today = '2026-10-04';
const homeToday = localDate();
const emptyLabels: Record<string, string> = {
  tasks: 'Nenhuma tarefa ainda',
  projects: 'Nenhum projeto ainda',
  habits: 'Nenhum hábito ainda',
  routines: 'Nenhuma rotina ainda',
  workouts: 'Nenhum treino ainda',
  nutrition: 'Nenhuma refeição ainda',
  finance: 'Nenhuma transação ainda',
  thoughts: 'Nenhum pensamento ainda',
  timeline: 'Nenhum evento ainda',
};
function task(
  id: string,
  title: string,
  date: string,
  completed = false,
  priority: Task['priority'] = 'normal',
  dueTime: string | null = null,
): Task {
  return {
    id,
    title,
    description: '',
    priority,
    due_date: date,
    due_time: dueTime,
    status: completed ? 'completed' : 'pending',
    recurrence: null,
    created_at: date,
    updated_at: date,
    completed_at: completed ? date : null,
    archived_at: null,
    sort_order: 0,
    source_inbox_id: null,
  };
}
const data: Snapshot = {
  tasks: [
    task('1', 'Revisar prioridades da semana', today, true),
    task('2', 'Separar documentos para o projeto', today, false, 'high', '09:30'),
    task('3', 'Caminhar por 30 minutos', today, false, 'normal', '18:00'),
    task('4', 'Responder mensagem importante', today, false, 'normal', '14:00'),
    task('5', 'Organizar notas', '2026-10-03'),
  ],
  subtasks: [],
  completions: [],
  subtaskCompletions: [],
  inbox: [
    {
      id: 'i1',
      content: 'Entrevista amanhã 14h',
      notes: 'Confirmar o endereço antes de converter.',
      capture_type: 'unclassified',
      status: 'pending',
      created_at: today,
      updated_at: today,
      processed_at: null,
    },
    {
      id: 'i2',
      content: 'Revisar documentos antes da próxima reunião.',
      notes: '',
      capture_type: 'unclassified',
      status: 'pending',
      created_at: today,
      updated_at: today,
      processed_at: null,
    },
  ],
  settings: { name: 'Ana', theme: 'light' },
};
const store = { data, busy: false, run: async () => true } as unknown as RumoStore;
const homeDayPreview: HomeDayData = {
  planning: {
    now: {
      id: 'now',
      block_date: homeToday,
      start_time: '09:30',
      end_time: '11:00',
      schedule_kind: 'fixed',
      day_period: null,
      status: 'planned',
      source_type: 'project',
      source_id: 'project-1',
      title: 'Avançar o RUMAR',
    },
    next: [
      {
        id: 'next-1',
        block_date: homeToday,
        start_time: '13:30',
        end_time: '14:00',
        schedule_kind: 'fixed',
        day_period: null,
        status: 'planned',
        source_type: 'habit',
        source_id: 'habit-1',
        title: 'Leitura',
      },
      {
        id: 'next-2',
        block_date: addDays(homeToday, 1),
        start_time: '09:00',
        end_time: '10:00',
        schedule_kind: 'fixed',
        day_period: null,
        status: 'planned',
        source_type: 'task',
        source_id: 'task-1',
        title: 'Revisar prioridades',
      },
    ],
    total: 7,
    completed: 3,
    pending: 3,
    skipped: 1,
  },
  overdue: {
    count: 2,
    rows: [
      {
        id: 'late-1',
        title: 'Responder mensagem importante',
        due_date: addDays(homeToday, -1),
      },
      {
        id: 'late-2',
        title: 'Organizar referências',
        due_date: addDays(homeToday, -2),
      },
    ],
  },
  habits: [
    {
      id: 'water',
      name: 'Água',
      value: 3.8,
      target: 5,
      unit: 'L',
      tracking_type: 'quantity',
      reached: 0,
    },
    {
      id: 'read',
      name: 'Leitura',
      value: 12,
      target: 20,
      unit: 'páginas',
      tracking_type: 'quantity',
      reached: 0,
    },
    {
      id: 'gym',
      name: 'Academia',
      value: 1,
      target: 1,
      unit: '',
      tracking_type: 'check',
      reached: 1,
    },
  ],
  workout: { id: 'workout', name: 'Push', finished_at: `${homeToday}T08:42:00` },
  nutrition: { calories: 1640, protein: 98, calorieGoal: 2200 },
  finance: { hidden: false, expense: 6890 },
  projects: [],
};
const loadHomeDayPreview = async () => homeDayPreview;
const loadEmptySearch = async () => [];
const projectFixtures: ProjectSummary[] = [
  {
    id: 'p1',
    name: 'Organizar o espaço de trabalho',
    description: 'Criar uma rotina mais clara para projetos e materiais.',
    status: 'active',
    start_date: '2026-08-10',
    target_date: '2026-11-30',
    created_at: today,
    updated_at: today,
    completed_at: null,
    archived_at: null,
    sort_order: 0,
    task_count: 12,
    completed_count: 8,
    next_task: 'Revisar o planejamento da semana',
  },
  {
    id: 'p2',
    name: 'Preparar uma viagem',
    description: 'Definir roteiro, reservas e documentos com calma.',
    status: 'active',
    start_date: '2026-09-01',
    target_date: '2026-12-12',
    created_at: today,
    updated_at: today,
    completed_at: null,
    archived_at: null,
    sort_order: 1,
    task_count: 9,
    completed_count: 3,
    next_task: 'Conferir os documentos',
  },
  {
    id: 'p3',
    name: 'Estudar um novo idioma',
    description: 'Construir consistência nas aulas e na prática diária.',
    status: 'active',
    start_date: '2026-07-01',
    target_date: null,
    created_at: today,
    updated_at: today,
    completed_at: null,
    archived_at: null,
    sort_order: 2,
    task_count: 16,
    completed_count: 10,
    next_task: 'Praticar conversação',
  },
  {
    id: 'p4',
    name: 'Renovar o escritório',
    description: 'Melhorar ergonomia e deixar o ambiente confortável.',
    status: 'active',
    start_date: '2026-08-01',
    target_date: '2026-10-25',
    created_at: today,
    updated_at: today,
    completed_at: null,
    archived_at: null,
    sort_order: 3,
    task_count: 7,
    completed_count: 5,
    next_task: 'Finalizar a iluminação',
  },
];
const objectiveFixtures: (Objective & { link_count: number })[] = [
  {
    id: 'o1',
    name: 'Ter mais energia no cotidiano',
    description: 'Cuidar da saúde com consistência e criar espaço para o que importa.',
    category: 'health',
    status: 'active',
    start_date: '2026-04-01',
    target_date: '2027-04-01',
    progress_mode: 'manual',
    progress_ref: null,
    manual_current: 7,
    manual_target: 10,
    manual_unit: 'pontos',
    body_baseline: null,
    body_target: null,
    created_at: today,
    updated_at: today,
    completed_at: null,
    archived_at: null,
    link_count: 3,
  },
  {
    id: 'o2',
    name: 'Aprender uma nova língua',
    description: 'Ser capaz de conversar com segurança em situações reais.',
    category: 'learning',
    status: 'active',
    start_date: '2026-07-01',
    target_date: '2027-06-30',
    progress_mode: 'manual',
    progress_ref: null,
    manual_current: 4,
    manual_target: 10,
    manual_unit: 'etapas',
    body_baseline: null,
    body_target: null,
    created_at: today,
    updated_at: today,
    completed_at: null,
    archived_at: null,
    link_count: 2,
  },
  {
    id: 'o3',
    name: 'Construir uma reserva de emergência',
    description: 'Criar uma base financeira estável ao longo do ano.',
    category: 'finance',
    status: 'active',
    start_date: '2026-01-01',
    target_date: '2027-01-01',
    progress_mode: 'none',
    progress_ref: null,
    manual_current: null,
    manual_target: null,
    manual_unit: '',
    body_baseline: null,
    body_target: null,
    created_at: today,
    updated_at: today,
    completed_at: null,
    archived_at: null,
    link_count: 1,
  },
];
const objectiveProgress: ObjectiveProgress[] = [
  { label: 'Progresso informado', current: 7, target: 10, unit: 'pontos', percent: 70 },
  { label: 'Progresso informado', current: 4, target: 10, unit: 'etapas', percent: 40 },
];
const habitFixtures: Habit[] = [
  {
    id: 'h1',
    name: 'Beber água',
    description: 'Acompanhar o consumo ao longo do dia.',
    frequency: 'daily',
    weekdays: [],
    weekly_target: 7,
    kind: 'quantity',
    target_value: 2.5,
    unit: 'L',
    start_date: '2026-08-01',
    end_date: null,
    project_id: null,
    active: 1,
    archived_at: null,
    sort_order: 0,
    created_at: today,
    updated_at: today,
  },
  {
    id: 'h2',
    name: 'Ler por 20 minutos',
    description: 'Uma pausa diária para aprender.',
    frequency: 'daily',
    weekdays: [],
    weekly_target: 7,
    kind: 'boolean',
    target_value: 1,
    unit: '',
    start_date: '2026-08-01',
    end_date: null,
    project_id: null,
    active: 1,
    archived_at: null,
    sort_order: 1,
    created_at: today,
    updated_at: today,
  },
  {
    id: 'h3',
    name: 'Caminhar',
    description: 'Movimento leve em dias alternados.',
    frequency: 'weekdays',
    weekdays: [1, 3, 5],
    weekly_target: 3,
    kind: 'boolean',
    target_value: 1,
    unit: '',
    start_date: '2026-08-01',
    end_date: null,
    project_id: null,
    active: 1,
    archived_at: null,
    sort_order: 2,
    created_at: today,
    updated_at: today,
  },
  {
    id: 'h4',
    name: 'Praticar um idioma',
    description: 'Três sessões de estudo por semana.',
    frequency: 'weekly_target',
    weekdays: [],
    weekly_target: 3,
    kind: 'quantity',
    target_value: 30,
    unit: 'min',
    start_date: '2026-08-01',
    end_date: null,
    project_id: null,
    active: 1,
    archived_at: null,
    sort_order: 3,
    created_at: today,
    updated_at: today,
  },
];
const habitEntries: HabitEntry[] = [
  ...['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-02', '2026-10-03'].map((entry_date) => ({
    habit_id: 'h1',
    entry_date,
    value: 2.5,
    updated_at: today,
  })),
  { habit_id: 'h1', entry_date: today, value: 1.7, updated_at: today },
  ...['2026-09-28', '2026-09-30', '2026-10-01', '2026-10-03', today].map((entry_date) => ({
    habit_id: 'h2',
    entry_date,
    value: 1,
    updated_at: today,
  })),
  ...['2026-09-28', '2026-09-30'].map((entry_date) => ({
    habit_id: 'h3',
    entry_date,
    value: 1,
    updated_at: today,
  })),
  ...['2026-09-30', '2026-10-02'].map((entry_date) => ({
    habit_id: 'h4',
    entry_date,
    value: 30,
    updated_at: today,
  })),
];
const routineFixtures: Routine[] = [
  {
    id: 'r1',
    name: 'Rotina da noite',
    description: 'Desacelerar e preparar o dia seguinte.',
    frequency: 'daily',
    weekdays: [],
    time_of_day: '21:00',
    active: 1,
    archived_at: null,
    sort_order: 0,
    created_at: today,
    updated_at: today,
  },
  {
    id: 'r2',
    name: 'Organizar a manhã',
    description: 'Começar o dia com clareza.',
    frequency: 'daily',
    weekdays: [],
    time_of_day: '07:30',
    active: 1,
    archived_at: null,
    sort_order: 1,
    created_at: today,
    updated_at: today,
  },
  {
    id: 'r3',
    name: 'Planejamento da semana',
    description: 'Revisar compromissos e prioridades.',
    frequency: 'weekdays',
    weekdays: [0],
    time_of_day: null,
    active: 1,
    archived_at: null,
    sort_order: 2,
    created_at: today,
    updated_at: today,
  },
];
const routineItems: RoutineItem[][] = [
  [
    'Revisar o dia',
    'Ler por 20 minutos',
    'Separar prioridades de amanhã',
    'Preparar o ambiente para dormir',
  ].map((title, sort_order) => ({
    id: `r1-${sort_order}`,
    routine_id: 'r1',
    title,
    sort_order,
    created_at: today,
    updated_at: today,
  })),
  ['Planejar as tarefas', 'Preparar o café', 'Começar a primeira tarefa'].map(
    (title, sort_order) => ({
      id: `r2-${sort_order}`,
      routine_id: 'r2',
      title,
      sort_order,
      created_at: today,
      updated_at: today,
    }),
  ),
  ['Revisar calendário', 'Definir prioridades', 'Organizar materiais'].map((title, sort_order) => ({
    id: `r3-${sort_order}`,
    routine_id: 'r3',
    title,
    sort_order,
    created_at: today,
    updated_at: today,
  })),
];
const routineOccurrence: RoutineOccurrence = {
  id: 'o1',
  routine_id: 'r1',
  occurrence_date: today,
  started_at: today,
  completed_at: null,
};
const routineCompletions: RoutineCompletion[] = [0, 1].map((index) => ({
  occurrence_id: 'o1',
  item_id: `r1-${index}`,
  completed_at: today,
}));
const previewToday = habitFixtures.filter((habit) => habitEligible(habit, today));
const previewCompleted = previewToday.filter((habit) =>
  habitReached(
    habit,
    habitEntries.find((entry) => entry.habit_id === habit.id && entry.entry_date === today)
      ?.value ?? 0,
  ),
).length;
const previewProgress = habitFixtures.map((habit) => habitProgress(habit, habitEntries, today));
const previewWeekDone = previewProgress.reduce(
  (total, progress) => total + Math.min(progress.weekDone, progress.weekTarget),
  0,
);
const previewWeekTarget = previewProgress.reduce(
  (total, progress) => total + progress.weekTarget,
  0,
);
const previewMonthDone = previewProgress.reduce((total, progress) => total + progress.done, 0);
const previewMonthExpected = previewProgress.reduce(
  (total, progress) => total + progress.expected,
  0,
);
function Preview() {
  const screen = new URLSearchParams(window.location.search).get('screen') ?? 'home';
  return (
    <div className="app-shell">
      <AppSidebar
        activePage={
          screen === 'project-detail'
            ? 'projects'
            : screen === 'objective-detail'
              ? 'objectives'
              : screen === 'routine-execution'
                ? 'routines'
                : screen === 'planner' || screen === 'planner-week'
                  ? 'calendar'
                  : screen === 'body-progress' || screen.startsWith('workout-')
                    ? 'workouts'
                    : screen.startsWith('nutrition-')
                      ? 'nutrition'
                      : screen.startsWith('finance-')
                        ? 'finance'
                        : screen === 'focus-phase3'
                          ? 'planning'
                          : screen === 'timeline-filters'
                            ? 'timeline'
                            : screen === 'reviews' || screen === 'reviews-monthly'
                              ? 'review'
                              : screen === 'settings-data'
                                ? 'settings'
                                : screen
        }
        inboxCount={2}
        ready
        onNavigate={() => {}}
        onAdd={() => {}}
        onSearch={() => {}}
      />
      <main id="main" tabIndex={-1}>
        <div className="content">
          {screen.startsWith('empty-') && (
            <section className="projects-page">
              <header className="page-header">
                <h1>Estado vazio</h1>
              </header>
              <EmptyState
                title={emptyLabels[screen.slice(6)] ?? 'Nenhum registro ainda'}
                description="Os primeiros registros aparecerão aqui quando você começar."
                illustration={
                  screen === 'empty-reviews'
                    ? undefined
                    : `/assets/rumar/empty-states/empty-${screen.slice(6)}.png`
                }
                action={{ label: 'Começar', onClick: () => {} }}
              />
            </section>
          )}
          {screen === 'global-search' && (
            <GlobalSearch
              onClose={() => {}}
              onNavigate={() => {}}
              onCommand={() => {}}
              loadResults={loadEmptySearch}
            />
          )}
          {screen === 'focus-phase3' && (
            <>
              <header className="page-header">
                <h1>Planejamento</h1>
                <p>Uma sessão vinculada preserva a decisão de conclusão.</p>
              </header>
              <Dialog title="Modo Focus" onClose={() => {}}>
                <div className="focus-content">
                  <h3>Projeto RUMAR</h3>
                  <output className="focus-timer" aria-label="Tempo de foco registrado">
                    42:18
                  </output>
                  <p>Tempo realmente dedicado</p>
                  <div className="form-actions">
                    <button className="secondary-button">Pausar</button>
                    <button className="primary-button">Finalizar foco</button>
                    <button className="secondary-button">Concluir item planejado</button>
                  </div>
                  <p className="field-help">
                    Finalizar preserva Task, Project e Planejamento. A conclusão é sempre explícita.
                  </p>
                </div>
              </Dialog>
            </>
          )}
          {screen === 'quick-add' && (
            <Dialog title="Adicionar ao RUMAR" onClose={() => {}}>
              <div className="form-grid">
                <label>
                  O que você quer registrar?
                  <input defaultValue="Revisar o projeto amanhã" />
                </label>
                <label>
                  Tipo
                  <select defaultValue="task">
                    <option value="task">Tarefa</option>
                  </select>
                </label>
                <button className="primary-button">Adicionar</button>
              </div>
            </Dialog>
          )}
          {screen === 'drawer' && (
            <Dialog title="Detalhes da tarefa" onClose={() => {}} drawer>
              <div className="drawer-body">
                <p>Revisar as prioridades da semana.</p>
                <label>
                  Notas
                  <textarea defaultValue="Próximos passos e contexto." />
                </label>
                <button className="primary-button">Salvar</button>
              </div>
            </Dialog>
          )}
          {[
            'thoughts',
            'timeline',
            'timeline-filters',
            'reviews',
            'reviews-monthly',
            'settings',
            'settings-data',
          ].includes(screen) && <LegacyExperiencePreview screen={screen} />}
          {(screen.startsWith('nutrition-') || screen.startsWith('finance-')) && (
            <NutritionFinancePreview screen={screen} />
          )}
          {screen.startsWith('planning-') && <PlanningFoundationPreview screen={screen} />}
          {screen === 'tasks' && (
            <Tasks store={store} day={today} onOpen={() => {}} onCreate={() => {}} />
          )}
          {screen === 'inbox' && <InboxPage store={store} />}
          {[
            'calendar',
            'planner',
            'planner-week',
            'workouts',
            'workout-session',
            'workout-history',
            'body-progress',
          ].includes(screen) && <TemporalFitnessPreview screen={screen} />}
          {screen === 'habits' && (
            <section className="habit-section habits-page" aria-label="Hábitos">
              <header className="page-header header-with-action module-header">
                <div className="module-heading">
                  <span className="module-heading-icon">
                    <Repeat2 size={22} />
                  </span>
                  <div>
                    <h1>Hábitos</h1>
                    <p>Pequenas ações, grandes resultados.</p>
                  </div>
                </div>
                <button className="primary-button">
                  <Plus size={17} /> Novo hábito
                </button>
              </header>
              <div className="habit-day-summary">
                <div>
                  <strong>
                    {previewCompleted} de {previewToday.length}
                  </strong>
                  <span>hábitos previstos hoje</span>
                </div>
                <div>
                  <strong>
                    {previewWeekDone} de {previewWeekTarget}
                  </strong>
                  <span>registros desta semana</span>
                </div>
                <div>
                  <strong>{Math.round((previewMonthDone / previewMonthExpected) * 100)}%</strong>
                  <span>consistência em 30 dias</span>
                </div>
              </div>
              <div className="habit-card-grid">
                {habitFixtures.map((habit) => (
                  <HabitCard
                    key={habit.id}
                    habit={habit}
                    entries={habitEntries}
                    day={today}
                    busy={false}
                    onRecord={() => {}}
                    onEdit={() => {}}
                  />
                ))}
              </div>
            </section>
          )}
          {(screen === 'routines' || screen === 'routine-execution') && (
            <section className="habit-section routines-page" aria-label="Rotinas">
              <header className="page-header header-with-action module-header">
                <div className="module-heading">
                  <span className="module-heading-icon">
                    <ListChecks size={22} />
                  </span>
                  <div>
                    <h1>Rotinas</h1>
                    <p>Organize sequências que tornam o seu dia mais simples.</p>
                  </div>
                </div>
                <button className="primary-button">
                  <Plus size={17} /> Nova rotina
                </button>
              </header>
              <label className="routine-date-bar">
                Dia da ocorrência <input type="date" value={today} readOnly />
              </label>
              <div className="routine-page-list">
                {routineFixtures
                  .slice(0, screen === 'routine-execution' ? 1 : undefined)
                  .map((routine, index) => (
                    <RoutineSequenceCard
                      key={routine.id}
                      routine={routine}
                      items={routineItems[index]}
                      occurrence={index === 0 ? routineOccurrence : undefined}
                      completions={index === 0 ? routineCompletions : []}
                      eligible
                      expanded={index === 0}
                      busy={false}
                      onExpand={() => {}}
                      onEdit={() => {}}
                      onStart={() => {}}
                      onComplete={() => {}}
                      onReopen={() => {}}
                      onToggleStep={() => {}}
                    />
                  ))}
              </div>
            </section>
          )}
          {screen === 'projects' && (
            <div className="projects-page">
              <header className="page-header header-with-action module-header">
                <div className="module-heading">
                  <span className="module-heading-icon">
                    <FolderKanban size={22} />
                  </span>
                  <div>
                    <h1>Projetos</h1>
                    <p>Transforme ideias em resultados reais.</p>
                  </div>
                </div>
                <button className="primary-button">
                  <Plus size={17} /> Novo projeto
                </button>
              </header>
              <nav className="tabs project-tabs" aria-label="Status dos projetos">
                <button aria-current="page">Ativos</button>
                <button>Pausados</button>
                <button>Concluídos</button>
                <button>Arquivados</button>
              </nav>
              <div className="project-list">
                {projectFixtures.map((project) => (
                  <ProjectCard key={project.id} project={project} onOpen={() => {}} />
                ))}
              </div>
            </div>
          )}
          {screen === 'project-detail' && (
            <div className="projects-page">
              <button className="text-button project-back">← Todos os projetos</button>
              <ProjectDetailOverview project={projectFixtures[0]} onEdit={() => {}} />
              <div className="project-detail-toolbar">
                <button className="secondary-button">Pausar projeto</button>
                <button className="secondary-button">Mais ações</button>
              </div>
              <section className="project-section">
                <header className="project-section-header">
                  <div>
                    <h2>Próximas etapas</h2>
                    <span>3 tarefas</span>
                  </div>
                </header>
                <div className="project-preview-tasks">
                  <p>□ Revisar o planejamento da semana</p>
                  <p>□ Organizar os documentos</p>
                  <p>✓ Definir a estrutura inicial</p>
                </div>
              </section>
            </div>
          )}
          {screen === 'objectives' && (
            <div className="objectives-page">
              <header className="page-header header-with-action module-header">
                <div className="module-heading">
                  <span className="module-heading-icon objective-heading-icon">
                    <Target size={22} />
                  </span>
                  <div>
                    <h1>Objetivos</h1>
                    <p>Grandes conquistas começam com passos consistentes.</p>
                  </div>
                </div>
                <button className="primary-button">
                  <Plus size={17} /> Novo objetivo
                </button>
              </header>
              <nav className="tabs objective-category-tabs" aria-label="Categorias dos objetivos">
                <button aria-current="page">
                  Todos <span>3</span>
                </button>
                <button>
                  Saúde e corpo <span>1</span>
                </button>
                <button>
                  Aprendizado <span>1</span>
                </button>
                <button>
                  Financeiro <span>1</span>
                </button>
              </nav>
              <div className="objective-list">
                {objectiveFixtures.map((objective, index) => (
                  <ObjectiveCard
                    key={objective.id}
                    objective={objective}
                    category={
                      objective.category === 'health'
                        ? 'Saúde e corpo'
                        : objective.category === 'learning'
                          ? 'Aprendizado'
                          : 'Financeiro'
                    }
                    progress={objectiveProgress[index] ?? null}
                    milestones={
                      index === 0
                        ? { total: 4, completed: 2 }
                        : index === 1
                          ? { total: 3, completed: 1 }
                          : undefined
                    }
                    onOpen={() => {}}
                  />
                ))}
              </div>
            </div>
          )}
          {screen === 'objective-detail' && (
            <div className="objectives-page">
              <button className="text-button objective-back">← Todos os objetivos</button>
              <ObjectiveDetailOverview
                objective={objectiveFixtures[0]}
                category="Saúde e corpo"
                status="Ativo"
                progress={objectiveProgress[0]}
                focusSeconds={0}
                actions={
                  <>
                    <button className="secondary-button">Editar</button>
                    <button className="secondary-button">Ver Timeline</button>
                    <select aria-label="Status do objetivo" defaultValue="active">
                      <option value="active">Ativo</option>
                    </select>
                  </>
                }
              />
              <section className="review-section objective-preview-milestones">
                <div className="section-heading">
                  <h2>Marcos</h2>
                  <button className="secondary-button">+ Novo marco</button>
                </div>
                <p className="field-help">
                  2 de 4 concluídos. O objetivo permanece sob seu controle.
                </p>
                <ol className="milestone-list">
                  <li>✓ Base estabelecida</li>
                  <li>✓ Rotina consistente</li>
                  <li>○ Evolução perceptível</li>
                  <li>○ Resultado desejado</li>
                </ol>
              </section>
              <section className="review-section objective-related">
                <h2>Relacionados</h2>
                <h3>Projetos</h3>
                <div className="objective-link">
                  <button>Organizar o espaço de trabalho</button>
                </div>
                <h3>Hábitos</h3>
                <div className="objective-link">
                  <button>Caminhar diariamente</button>
                </div>
              </section>
            </div>
          )}
          {screen === 'home' && (
            <Home
              store={store}
              now={new Date()}
              onOpen={() => {}}
              onInbox={() => {}}
              onReview={() => {}}
              onPlanning={() => {}}
              onTasks={() => {}}
              onWorkouts={() => {}}
              onNutrition={() => {}}
              onFinance={() => {}}
              loadDay={loadHomeDayPreview}
            />
          )}
        </div>
      </main>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Preview />);
