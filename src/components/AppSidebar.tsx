import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Folder,
  History,
  House,
  Inbox,
  ListTodo,
  NotebookPen,
  Plus,
  ScrollText,
  Search,
  Settings2,
  Target,
  Utensils,
  Wallet,
} from 'lucide-react';

export type SidebarPage =
  | 'home'
  | 'inbox'
  | 'tasks'
  | 'projects'
  | 'objectives'
  | 'planning'
  | 'calendar'
  | 'workouts'
  | 'nutrition'
  | 'finance'
  | 'thoughts'
  | 'timeline'
  | 'review'
  | 'settings';

const groups = [
  { label: 'Início', items: [{ id: 'home', label: 'Início', Icon: House }] },
  {
    label: 'Organização',
    items: [
      { id: 'inbox', label: 'Inbox', Icon: Inbox },
      { id: 'tasks', label: 'Tarefas', Icon: ListTodo },
      { id: 'projects', label: 'Projetos', Icon: Folder },
      { id: 'objectives', label: 'Objetivos', Icon: Target },
      { id: 'planning', label: 'Planejamento', Icon: CalendarClock },
    ],
  },
  {
    label: 'Rotina',
    items: [{ id: 'calendar', label: 'Calendário', Icon: CalendarDays }],
  },
  {
    label: 'Vida',
    items: [
      { id: 'workouts', label: 'Treinos', Icon: Dumbbell },
      { id: 'nutrition', label: 'Alimentação', Icon: Utensils },
      { id: 'finance', label: 'Finanças', Icon: Wallet },
    ],
  },
  {
    label: 'Registros',
    items: [
      { id: 'thoughts', label: 'Pensamentos', Icon: NotebookPen },
      { id: 'timeline', label: 'Timeline', Icon: History },
      { id: 'review', label: 'Revisões', Icon: ScrollText },
    ],
  },
] as const;

const preferenceKey = 'rumar.sidebar.collapsed';

export function AppSidebar({
  activePage,
  inboxCount,
  ready,
  onNavigate,
  onAdd,
  onSearch,
}: {
  activePage: string;
  inboxCount: number;
  ready: boolean;
  onNavigate: (page: SidebarPage) => void;
  onAdd: () => void;
  onSearch: () => void;
}) {
  const navigationRef = useRef<HTMLElement>(null);
  const [hasMoreNavigation, setHasMoreNavigation] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(preferenceKey) === 'true';
    } catch {
      return false;
    }
  });
  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(preferenceKey, String(next));
    } catch {
      // The shell remains usable if local preferences are unavailable.
    }
  }
  useEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;
    const update = () =>
      setHasMoreNavigation(
        navigation.scrollTop + navigation.clientHeight < navigation.scrollHeight - 2,
      );
    navigation.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(navigation);
    const frame = window.requestAnimationFrame(update);
    return () => {
      window.cancelAnimationFrame(frame);
      navigation.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [collapsed]);
  return (
    <aside className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}`}>
      <a href="#main" className="skip-link">
        Ir para o conteúdo
      </a>
      <div className="sidebar-brand-row">
        <div className="wordmark" aria-label="RUMAR">
          <span className="brand-symbol" aria-hidden="true">
            <img src="/assets/rumar/brand/mountain-mark.png" alt="" />
          </span>
          <span className="sidebar-label">RUMAR</span>
        </div>
        <button
          className="icon-button sidebar-collapse"
          aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
          onClick={toggleCollapsed}
        >
          {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
        </button>
      </div>
      <div className="sidebar-actions">
        <button
          className="settings-link search-link"
          onClick={onSearch}
          disabled={!ready}
          aria-label="Buscar (Ctrl+K)"
          title={collapsed ? 'Buscar (Ctrl+K)' : undefined}
        >
          <Search size={18} />
          <span className="sidebar-label">Buscar</span>
          <kbd className="sidebar-label">Ctrl+K</kbd>
        </button>
        <button
          className="capture-button"
          onClick={onAdd}
          disabled={!ready}
          aria-label="Adicionar (Ctrl+Espaço)"
          title="Adicionar (Ctrl+Espaço)"
        >
          <Plus size={18} />
          <span className="sidebar-label">Adicionar</span>
        </button>
      </div>
      <nav ref={navigationRef} aria-label="Navegação principal">
        {groups.map((group) => (
          <div className="sidebar-group" key={group.label}>
            <p className="nav-label sidebar-label">{group.label}</p>
            {group.items.map(({ id, label, Icon }) => (
              <button
                key={id}
                aria-label={id === 'inbox' && inboxCount > 0 ? `Inbox, ${inboxCount} itens` : label}
                title={collapsed ? label : undefined}
                aria-current={
                  activePage === id || (id === 'review' && activePage === 'monthly-review')
                    ? 'page'
                    : undefined
                }
                onClick={() => onNavigate(id)}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="sidebar-label">{label}</span>
                {id === 'inbox' && inboxCount > 0 && (
                  <span className="nav-count" aria-label={`${inboxCount} itens na Inbox`}>
                    {inboxCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>
      {hasMoreNavigation && (
        <button
          className="sidebar-scroll-cue"
          aria-label="Ver mais seções abaixo na navegação"
          title="Ver mais seções abaixo"
          onClick={() =>
            navigationRef.current?.scrollBy(0, navigationRef.current.clientHeight * 0.75)
          }
        >
          <ChevronDown size={15} aria-hidden="true" />
          <span className="sidebar-label">Mais seções</span>
        </button>
      )}
      <div className="sidebar-bottom">
        <button
          className="settings-link"
          aria-label="Configurações"
          title={collapsed ? 'Configurações' : undefined}
          aria-current={activePage === 'settings' ? 'page' : undefined}
          onClick={() => onNavigate('settings')}
        >
          <Settings2 size={18} aria-hidden="true" />
          <span className="sidebar-label">Configurações</span>
        </button>
        <div className="local-status" title="Seu espaço. Neste computador.">
          <span aria-hidden="true" />
          <span className="sidebar-label">Neste computador</span>
        </div>
      </div>
    </aside>
  );
}
