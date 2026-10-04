import { useState } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Folder,
  History,
  House,
  Inbox,
  ListChecks,
  ListTodo,
  NotebookPen,
  Plus,
  Repeat,
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
  | 'habits'
  | 'routines'
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
    ],
  },
  {
    label: 'Rotina',
    items: [
      { id: 'habits', label: 'Hábitos', Icon: Repeat },
      { id: 'routines', label: 'Rotinas', Icon: ListChecks },
      { id: 'calendar', label: 'Calendário', Icon: CalendarDays },
    ],
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
  return (
    <aside className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}`}>
      <a href="#main" className="skip-link">
        Ir para o conteúdo
      </a>
      <div className="sidebar-brand-row">
        <div className="wordmark" aria-label="RUMAR">
          <span className="brand-symbol" aria-hidden="true">
            <ArrowUpRight size={19} strokeWidth={2.2} />
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
      <nav aria-label="Navegação principal">
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
