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
import { Habits, HomeHabits } from '../features/habits/Habits';
import { Routines, HomeRoutines } from '../features/routines/Routines';
import { Thoughts } from '../features/thoughts/Thoughts';
import { flushThoughts } from '../features/thoughts/autosave';
import { PlannerCalendar } from '../features/calendar/PlannerCalendar';
import { FocusHost, pauseOpenFocus, requestFocus } from '../features/calendar/focus';
import { HomeAgenda } from '../features/calendar/HomeAgenda';
import { HomeProjects } from '../features/home/HomeProjects';
import { Workouts } from '../features/workouts/Workouts';
import { HomeWorkouts } from '../features/workouts/components/HomeWorkouts';
import { flushWorkouts } from '../features/workouts/persistence';
import { Nutrition } from '../features/nutrition/Nutrition';
import { HomeNutrition } from '../features/nutrition/HomeNutrition';
import { Finance } from '../features/finance/Finance';
import { HomeFinance } from '../features/finance/HomeFinance';
import { FirstRun } from '../features/home/FirstRun';
import { closeDatabase, getDatabase } from '../lib/database/connection';
import { PageErrorBoundary } from '../components/PageErrorBoundary';
import { GlobalSearch } from '../features/search/GlobalSearch';
import type { SearchPage, SearchResult } from '../features/search/repository';
import { WeeklyReview } from '../features/weekly-review/WeeklyReview';
import { suspendLocalNotifications } from '../features/notifications/scheduler';
import { Objectives } from '../features/objectives/Objectives';
import { HomeObjectives } from '../features/objectives/HomeObjectives';
import { Timeline } from '../features/timeline/Timeline';
import { suspendAutomations } from '../features/automations/runtime';
import { MonthlyReview } from '../features/monthly-review/MonthlyReview';
import {
  suspendGoogleCalendar,
  syncGoogleCalendar,
} from '../features/integrations/google-calendar/runtime';
import { setWindowInTray, startBackgroundScheduler } from '../features/windows/background';
import { startWindowsControls } from '../features/windows/runtime';
type Page =
  | 'home'
  | 'inbox'
  | 'tasks'
  | 'settings'
  | 'projects'
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
                    quickSummary={
                      <>
                        <HomeWorkouts
                          day={localDate(now)}
                          onNavigate={() => void navigate('workouts')}
                          compact
                        />
                        <HomeNutrition
                          day={localDate(now)}
                          onNavigate={() => void navigate('nutrition')}
                          compact
                        />
                        <HomeHabits day={localDate(now)} summaryOnly />
                      </>
                    }
                    continuation={
                      <>
                        <HomeAgenda
                          day={localDate(now)}
                          now={now}
                          onOpen={() => void navigate('calendar')}
                        />
                        <HomeProjects
                          revision={store.data}
                          day={localDate(now)}
                          onNavigate={() => void navigate('projects')}
                        />
                        <HomeObjectives onNavigate={(id) => void navigate('objectives', id)} />
                        <HomeRoutines day={localDate(now)} />
                      </>
                    }
                  />
                  <div className="home-more" aria-label="Outras áreas">
                    <HomeFinance day={localDate(now)} onNavigate={() => void navigate('finance')} />
                  </div>
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
            ) : page === 'habits' ? (
              <Habits />
            ) : page === 'routines' ? (
              <Routines />
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
        <GlobalSearch onClose={() => setSearchOpen(false)} onNavigate={openSearchResult} />
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
