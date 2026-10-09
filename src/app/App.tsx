import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
import { AppSidebar, type SidebarPage } from '../components/AppSidebar';
import { useRumo } from '../hooks/useRumo';
import { useClock } from '../hooks/useClock';
import { useTheme } from '../hooks/useTheme';
import { Home } from '../features/home/Home';
import { Tasks } from '../features/tasks/Tasks';
import { InboxPage } from '../features/inbox/Inbox';
import { QuickAdd } from '../features/quick-add/QuickAdd';
import { Settings } from '../features/settings/Settings';
import { TaskEditor } from '../features/tasks/TaskEditor';
import type { TaskOccurrence } from '../types/models';
import { localDate } from '../lib/dates';
import { Projects } from '../features/projects/Projects';
import { Planning } from '../features/planning/Planning';
import { Thoughts } from '../features/thoughts/Thoughts';
import { flushThoughts } from '../features/thoughts/autosave';
import { PlannerCalendar } from '../features/calendar/PlannerCalendar';
import { FocusHost, pauseOpenFocus, requestFocus } from '../features/calendar/focus';
import { Workouts } from '../features/workouts/Workouts';
import { flushWorkouts } from '../features/workouts/persistence';
import { Nutrition } from '../features/nutrition/Nutrition';
import { Finance } from '../features/finance/Finance';
import { FirstRun } from '../features/home/FirstRun';
import { closeDatabase, getDatabase } from '../lib/database/connection';
import { PageErrorBoundary } from '../components/PageErrorBoundary';
import { GlobalSearch } from '../features/search/GlobalSearch';
import type { SearchPage, SearchResult } from '../features/search/repository';
import type { AppCommand } from '../features/search/commands';
import { WeeklyReview } from '../features/weekly-review/WeeklyReview';
import { suspendLocalNotifications } from '../features/notifications/scheduler';
import { Objectives } from '../features/objectives/Objectives';
import { Timeline } from '../features/timeline/Timeline';
import { suspendAutomations } from '../features/automations/runtime';
import { MonthlyReview } from '../features/monthly-review/MonthlyReview';
import {
  suspendGoogleCalendar,
  syncGoogleCalendar,
} from '../features/integrations/google-calendar/runtime';
import { setWindowInTray, startBackgroundScheduler } from '../features/windows/background';
import { startWindowsControls } from '../features/windows/runtime';
import { parseNaturalSchedule } from '../features/quick-add/parser';
import { PlanningRepository } from '../features/planning/repository';
import { addMinutes, type DayPeriod } from '../features/planning/domain';
import { ThoughtsRepository } from '../features/thoughts/repository';
import { BodyProgressRepository } from '../features/body-progress/repository';
type Page =
  | 'home'
  | 'inbox'
  | 'tasks'
  | 'settings'
  | 'projects'
  | 'planning'
  | 'habits'
  | 'routines'
  | 'thoughts'
  | 'workouts'
  | 'nutrition'
  | 'finance'
  | 'calendar'
  | 'review'
  | 'monthly-review'
  | 'objectives'
  | 'timeline';
export default function App() {
  const store = useRumo(),
    now = useClock();
  const [page, setPage] = useState<Page>('home'),
    [capture, setCapture] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [searchTarget, setSearchTarget] = useState<SearchResult | null>(null),
    [timelineObjectiveId, setTimelineObjectiveId] = useState(''),
    [bodyProgressRequest, setBodyProgressRequest] = useState(0),
    [firstRun, setFirstRun] = useState(false),
    [plannerRequest, setPlannerRequest] = useState(0),
    [scheduleTask, setScheduleTask] = useState<{
      id: string;
      date: string | null;
      request: number;
    } | null>(null),
    [editor, setEditor] = useState<{ row: TaskOccurrence | null } | null>(null);
  const autoBackupChecked = useRef(false);
  const exitPending = useRef(false);
  const quickReturnToTray = useRef(false);
  const { notice, setNotice } = store;
  const exitApplication = useCallback(async () => {
    if (exitPending.current) return;
    exitPending.current = true;
    let resumeAutomations: (() => void) | undefined;
    let resumeNotifications: (() => void) | undefined;
    let resumeGoogle: (() => void) | undefined;
    try {
      resumeAutomations = await suspendAutomations();
      resumeNotifications = await suspendLocalNotifications();
      resumeGoogle = await suspendGoogleCalendar();
      await flushThoughts();
      await flushWorkouts();
      await pauseOpenFocus();
      await closeDatabase();
      await invoke('native_exit');
    } catch (error) {
      resumeGoogle?.();
      resumeNotifications?.();
      resumeAutomations?.();
      exitPending.current = false;
      console.error(
        'RUMAR: falha técnica ao encerrar.',
        error instanceof Error ? error.name : 'erro',
      );
      setNotice({ error: true, message: 'Erro ao salvar. O RUMAR permanece aberto.' });
    }
  }, [setNotice]);
  useEffect(() => {
    if (!store.data || autoBackupChecked.current) return;
    autoBackupChecked.current = true;
    void invoke('automatic_backup').catch(() =>
      setNotice({
        error: true,
        message: 'O backup automático não foi criado. Verifique em Configurações → Dados.',
      }),
    );
  }, [store.data, setNotice]);
  useEffect(() => {
    if (!store.data || store.data.settings.name !== 'Gustavo') return;
    let active = true;
    void getDatabase()
      .then((db) =>
        db.select<{ completed: number; has_data: number }[]>(`SELECT
      EXISTS(SELECT 1 FROM settings WHERE key='welcome_complete' AND value='1') completed,
      (EXISTS(SELECT 1 FROM tasks) OR EXISTS(SELECT 1 FROM inbox_items) OR EXISTS(SELECT 1 FROM projects)
       OR EXISTS(SELECT 1 FROM habits) OR EXISTS(SELECT 1 FROM routines) OR EXISTS(SELECT 1 FROM thoughts)
       OR EXISTS(SELECT 1 FROM workout_sessions) OR EXISTS(SELECT 1 FROM food_diary_entries)
       OR EXISTS(SELECT 1 FROM finance_transactions)) has_data`),
      )
      .then((rows) => {
        if (active) setFirstRun(!rows[0]?.completed && !rows[0]?.has_data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [store.data]);
  useTheme(store.data?.settings.theme ?? 'system');
  const databaseReady = Boolean(store.data);
  useEffect(() => {
    const listener = (event: Event) => {
      const data = (event as CustomEvent<{ id: string; date: string | null }>).detail;
      void Promise.all([flushThoughts(), flushWorkouts()])
        .then(() => {
          setScheduleTask({ ...data, request: Date.now() });
          setPlannerRequest(Date.now());
          setPage('calendar');
        })
        .catch(() =>
          setNotice({ error: true, message: 'Não foi possível concluir as gravações pendentes.' }),
        );
    };
    window.addEventListener('rumo-schedule-task', listener);
    return () => window.removeEventListener('rumo-schedule-task', listener);
  }, [setNotice]);
  const refreshStore = store.run;
  useEffect(() => {
    if (!databaseReady) return;
    return startBackgroundScheduler(() => {
      void refreshStore(async () => {});
    });
  }, [databaseReady, refreshStore]);
  useEffect(() => {
    if (!databaseReady) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void startWindowsControls({
      quick: (returnToTray) => {
        quickReturnToTray.current = returnToTray;
        setCapture(true);
      },
      focus: () => requestFocus({ title: 'Focus' }),
      sync: () => void syncGoogleCalendar().catch(() => {}),
      exit: () => void exitApplication(),
    })
      .then((stop) => {
        if (disposed) stop();
        else cleanup = stop;
      })
      .catch(() =>
        setNotice({ error: true, message: 'Os controles do Windows não puderam ser ativados.' }),
      );
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [databaseReady, exitApplication, setNotice]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'Space' && !e.repeat && !e.isComposing) {
        e.preventDefault();
        if (store.data && !document.querySelector('dialog[open]')) setCapture(true);
      }
      if (e.ctrlKey && e.code === 'KeyK' && !e.repeat && !e.isComposing) {
        e.preventDefault();
        if (store.data && !document.querySelector('dialog[open]')) setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [store.data]);
  async function navigate(next: Page, objectiveId = '') {
    try {
      await flushThoughts();
      await flushWorkouts();
      setSearchTarget(null);
      setTimelineObjectiveId(objectiveId);
      setBodyProgressRequest(0);
      setPage(next);
    } catch {
      setNotice({
        error: true,
        message:
          'Há alterações não salvas. A página permanece aberta; corrija os campos ou tente novamente.',
      });
    }
  }
  useEffect(() => {
    if (!notice || notice.error || notice.undo) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);
  const openTask = (row: TaskOccurrence) => setEditor({ row });
  function openSearchResult(next: SearchPage, result: SearchResult) {
    setSearchOpen(false);
    void (async () => {
      await flushThoughts();
      await flushWorkouts();
      setSearchTarget({ ...result, id: result.contextId ?? result.id });
      setTimelineObjectiveId('');
      setBodyProgressRequest(0);
      setPage(next);
      if (next === 'tasks') {
        const task = store.data?.tasks.find((item) => item.id === result.id);
        if (task)
          setEditor({ row: { task, date: task.due_date, completed: task.status === 'completed' } });
      }
    })().catch(() =>
      store.setNotice({ error: true, message: 'Há alterações não salvas. Tente novamente.' }),
    );
  }
  async function executeCommand(command: AppCommand) {
    setSearchOpen(false);
    if (command.kind === 'navigate' && command.page) {
      await navigate(command.page as Page);
      return;
    }
    if (command.kind === 'start-workout') {
      await navigate('workouts');
      return;
    }
    if (command.kind === 'record-weight' && !command.payload) {
      setBodyProgressRequest((value) => value + 1);
      setPage('workouts');
      return;
    }
    if (
      (command.kind === 'create-task' ||
        command.kind === 'create-thought' ||
        command.kind === 'create-planning' ||
        command.kind === 'capture-inbox') &&
      !command.payload
    ) {
      if (command.kind === 'create-task') setEditor({ row: null });
      else if (command.kind === 'capture-inbox') setCapture(true);
      else await navigate(command.kind === 'create-thought' ? 'thoughts' : 'planning');
      return;
    }
    try {
      const db = await getDatabase();
      if (command.kind === 'create-task') {
        const parsed = parseNaturalSchedule(command.payload ?? '', localDate());
        await store.run(
          (repo) =>
            repo.createTask({
              title: parsed.title || command.payload || 'Nova tarefa',
              description: '',
              priority: 'normal',
              due_date: parsed.date,
              due_time: parsed.time,
              recurrence: null,
            }),
          'Tarefa criada.',
        );
      } else if (command.kind === 'create-thought') {
        const repo = new ThoughtsRepository(db);
        const row = await repo.create();
        await repo.save(row.id, { title: '', content: command.payload ?? '' });
        await store.run(async () => {}, 'Pensamento registrado.');
      } else if (command.kind === 'capture-inbox') {
        await store.run((repo) => repo.createInbox(command.payload ?? ''), 'Guardado no Inbox.');
      } else if (command.kind === 'create-planning') {
        const parsed = parseNaturalSchedule(command.payload ?? '', localDate());
        const schedule = parsed.time ? 'fixed' : parsed.dayPeriod ? 'period' : 'flexible';
        await new PlanningRepository(db).save({
          date: parsed.date ?? localDate(),
          title: parsed.title || command.payload || 'Planejamento',
          notes: '',
          schedule,
          startTime: parsed.time,
          endTime: parsed.time ? addMinutes(parsed.time, 30) : null,
          dayPeriod: (parsed.dayPeriod as DayPeriod | null) ?? null,
          sourceType: 'standalone',
          sourceId: null,
        });
        await store.run(async () => {}, 'Item planejado.');
      } else if (command.kind === 'record-weight') {
        const value = Number((command.payload ?? '').replace(',', '.').replace(/\s*kg$/i, ''));
        if (!Number.isFinite(value))
          throw Error('Informe o peso, por exemplo: registrar peso 78,4');
        await new BodyProgressRepository(db).saveWeight(localDate(), value);
        await store.run(async () => {}, 'Peso registrado.');
      } else if (command.kind === 'toggle-theme') {
        const next = store.data?.settings.theme === 'dark' ? 'light' : 'dark';
        await store.run((repo) => repo.saveSetting('theme', next), 'Tema alterado.');
      } else if (command.kind === 'start-focus') {
        const title = command.payload?.trim() || 'Focus';
        const matches = await db.select<{ type: 'task' | 'project'; id: string; title: string }[]>(
          `SELECT 'task' type,id,title FROM tasks
           WHERE archived_at IS NULL AND status='pending' AND lower(title)=lower($1)
           UNION ALL
           SELECT 'project' type,id,name title FROM projects
           WHERE archived_at IS NULL AND status='active' AND lower(name)=lower($1) LIMIT 2`,
          [title],
        );
        const match = matches.length === 1 ? matches[0] : null;
        requestFocus({
          title: match?.title ?? title,
          taskId: match?.type === 'task' ? match.id : null,
          projectId: match?.type === 'project' ? match.id : null,
        });
      }
    } catch (error) {
      store.setNotice({
        error: true,
        message: error instanceof Error ? error.message : 'Não foi possível executar o comando.',
      });
    }
  }
  function openRelated(next: Page, id?: string, type?: string) {
    if (!id || !['tasks', 'projects', 'thoughts', 'workouts', 'finance'].includes(next)) {
      void navigate(next, next === 'objectives' ? id : '');
      return;
    }
    const group =
      type === 'workout_plan'
        ? 'Planos de treino'
        : type === 'financial_goal'
          ? 'Objetivos financeiros'
          : type === 'workout'
            ? 'Sessões'
            : '';
    openSearchResult(next as SearchPage, {
      id,
      title: '',
      detail: '',
      group,
      page: next as SearchPage,
    });
  }
  return (
    <div className="app-shell">
      <AppSidebar
        activePage={page}
        inboxCount={store.data?.inbox.length ?? 0}
        ready={databaseReady}
        onNavigate={(next: SidebarPage) => void navigate(next)}
        onAdd={() => setCapture(true)}
        onSearch={() => setSearchOpen(true)}
      />
      <main id="main" tabIndex={-1}>
        <PageErrorBoundary key={page}>
          <div className="content">
            {store.startupError ? (
              <div className="startup-state" role="alert">
                <h1>Não foi possível abrir seu banco.</h1>
                <p>
                  Seus dados não foram substituídos. Verifique o acesso ao arquivo local e tente
                  novamente.
                </p>
                <p>
                  Se o problema continuar, feche e abra o RUMAR novamente. Seus dados permanecem
                  neste computador.
                </p>
                <button className="primary-button" onClick={() => void store.retry()}>
                  Tentar novamente
                </button>
              </div>
            ) : !store.data ? (
              <div className="startup-state" role="status">
                Abrindo seu espaço…
              </div>
            ) : page === 'home' ? (
              <>
                {firstRun && (
                  <FirstRun
                    store={store}
                    onDone={() => {
                      setFirstRun(false);
                      void navigate('settings');
                    }}
                  />
                )}
                <div className="home-experience">
                  <Home
                    store={store}
                    now={now}
                    onOpen={openTask}
                    onInbox={() => void navigate('inbox')}
                    onReview={() => void navigate('review')}
                    onPlanning={() => void navigate('planning')}
                    onTasks={() => void navigate('tasks')}
                    onWorkouts={() => void navigate('workouts')}
                    onNutrition={() => void navigate('nutrition')}
                    onFinance={() => void navigate('finance')}
                  />
                </div>
              </>
            ) : page === 'review' ? (
              <WeeklyReview
                onNavigate={(next) => void navigate(next)}
                onTimeline={() => void navigate('timeline')}
                onMonthlyReview={() => void navigate('monthly-review')}
              />
            ) : page === 'monthly-review' ? (
              <MonthlyReview
                onNavigate={(next, id) => void navigate(next, id)}
                onTimeline={(id) => {
                  setTimelineObjectiveId(id ?? '');
                  void navigate('timeline');
                }}
                onWeeklyReview={() => void navigate('review')}
              />
            ) : page === 'objectives' ? (
              <Objectives
                key={
                  searchTarget?.page === 'objectives'
                    ? searchTarget.id
                    : timelineObjectiveId || 'objectives'
                }
                initialId={
                  searchTarget?.page === 'objectives'
                    ? searchTarget.id
                    : timelineObjectiveId || undefined
                }
                onNavigate={openRelated}
                onTimeline={(id) => void navigate('timeline', id)}
              />
            ) : page === 'timeline' ? (
              <Timeline
                key={timelineObjectiveId || searchTarget?.id || 'timeline'}
                objectiveId={timelineObjectiveId || undefined}
                initialQuery={searchTarget?.page === 'timeline' ? searchTarget.title : undefined}
                onNavigate={openRelated}
              />
            ) : page === 'tasks' ? (
              <Tasks
                store={store}
                day={localDate(now)}
                onOpen={openTask}
                onCreate={() => setEditor({ row: null })}
              />
            ) : page === 'inbox' ? (
              <InboxPage store={store} />
            ) : page === 'projects' ? (
              <Projects
                key={searchTarget?.page === 'projects' ? searchTarget.id : 'projects'}
                store={store}
                onOpen={openTask}
                initialProjectId={searchTarget?.page === 'projects' ? searchTarget.id : undefined}
              />
            ) : page === 'planning' || page === 'habits' || page === 'routines' ? (
              <Planning
                initialTab={page === 'habits' ? 'habits' : page === 'routines' ? 'models' : 'plan'}
              />
            ) : page === 'thoughts' ? (
              <Thoughts
                key={searchTarget?.page === 'thoughts' ? searchTarget.id : 'thoughts'}
                store={store}
                initialThoughtId={searchTarget?.page === 'thoughts' ? searchTarget.id : undefined}
              />
            ) : page === 'workouts' ? (
              <Workouts
                key={
                  bodyProgressRequest
                    ? `body-${bodyProgressRequest}`
                    : searchTarget?.page === 'workouts'
                      ? searchTarget.id
                      : 'workouts'
                }
                day={localDate(now)}
                searchTarget={searchTarget?.page === 'workouts' ? searchTarget : undefined}
                openBodyProgress={bodyProgressRequest > 0}
              />
            ) : page === 'nutrition' ? (
              <Nutrition
                key={searchTarget?.page === 'nutrition' ? searchTarget.id : 'nutrition'}
                day={localDate(now)}
                searchTarget={searchTarget?.page === 'nutrition' ? searchTarget : undefined}
                onBodyProgress={() => {
                  setSearchTarget(null);
                  setBodyProgressRequest((value) => value + 1);
                  setPage('workouts');
                }}
              />
            ) : page === 'finance' ? (
              <Finance
                key={searchTarget?.page === 'finance' ? searchTarget.id : 'finance'}
                day={localDate(now)}
                searchTarget={searchTarget?.page === 'finance' ? searchTarget : undefined}
              />
            ) : page === 'calendar' ? (
              <PlannerCalendar
                key={plannerRequest}
                onScheduleConsumed={() => setScheduleTask(null)}
                scheduleTask={scheduleTask}
                onCreate={() => setEditor({ row: null })}
                store={store}
                day={localDate(now)}
                onOpen={openTask}
                onNavigate={openRelated}
              />
            ) : (
              <Settings store={store} />
            )}
          </div>
        </PageErrorBoundary>
      </main>
      {capture && store.data && (
        <QuickAdd
          store={store}
          onClose={() => {
            setCapture(false);
            if (quickReturnToTray.current) {
              quickReturnToTray.current = false;
              void import('@tauri-apps/api/window')
                .then(({ getCurrentWindow }) => getCurrentWindow().hide())
                .then(() => setWindowInTray(true))
                .catch(() => {});
            }
          }}
        />
      )}
      {store.data && <FocusHost store={store} />}
      {searchOpen && store.data && (
        <GlobalSearch
          onClose={() => setSearchOpen(false)}
          onNavigate={openSearchResult}
          onCommand={(command) => void executeCommand(command)}
        />
      )}
      {editor && store.data && (
        <TaskEditor row={editor.row} store={store} onClose={() => setEditor(null)} />
      )}
      {store.notice && (
        <div
          className={`toast ${store.notice.error ? 'toast-error' : ''}`}
          role={store.notice.error ? 'alert' : 'status'}
        >
          <span>{store.notice.message}</span>
          {store.notice.undo && (
            <button disabled={store.busy} onClick={() => void store.notice?.undo?.()}>
              Desfazer
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Fechar aviso"
            onClick={() => store.setNotice(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
