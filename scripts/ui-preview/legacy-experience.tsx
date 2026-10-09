import {
  Archive,
  BookOpen,
  CalendarDays,
  HeartPulse,
  ListTodo,
  NotebookPen,
  Plus,
  Search,
} from 'lucide-react';
import '../../src/features/thoughts/thoughts.css';
import '../../src/features/timeline/timeline.css';
import '../../src/features/weekly-review/review-experience.css';
import '../../src/features/settings/settings.css';

const entries = [
  {
    title: 'Uma ideia para o projeto',
    excerpt: 'Organizar a próxima etapa com mais clareza.',
    time: '09:24',
  },
  {
    title: 'Notas da semana',
    excerpt: 'O que aprendi ao manter uma rotina simples.',
    time: '08:17',
  },
  { title: 'Lembrar depois', excerpt: 'Uma pergunta que vale revisitar.', time: '07:36' },
];
function ThoughtsPreview() {
  return (
    <div className="thoughts-page">
      <header className="page-header header-with-action">
        <h1>Pensamentos</h1>
        <button className="primary-button">
          <Plus size={17} /> Novo pensamento
        </button>
      </header>
      <div className="thought-layout">
        <aside className="thought-list" aria-label="Pensamentos salvos">
          <div className="thought-search">
            <Search size={16} />
            <input aria-label="Buscar pensamentos" placeholder="Buscar pensamentos" />
          </div>
          <h2 className="thought-group">Hoje</h2>
          {entries.map((item, index) => (
            <button
              key={item.title}
              className={`thought-list-item ${index === 0 ? 'selected' : ''}`}
              aria-current={index === 0 ? 'true' : undefined}
            >
              <strong>{item.title}</strong>
              <span>{item.excerpt}</span>
              <time>{item.time}</time>
            </button>
          ))}
          <h2 className="thought-group">Ontem</h2>
          <button className="thought-list-item">
            <strong>Primeiros passos</strong>
            <span>Começar pequeno e continuar.</span>
            <time>18:02</time>
          </button>
        </aside>
        <section className="thought-editor" aria-label="Editor de pensamento">
          <label className="sr-only" htmlFor="thought-title">
            Título
          </label>
          <input id="thought-title" defaultValue="Uma ideia para o projeto" />
          <div className="thought-toolbar">
            <time>4 de outubro de 2026</time>
            <span className="thought-save-status">Salvo neste computador</span>
            <button className="text-button">Visualizar Markdown</button>
          </div>
          <label className="sr-only" htmlFor="thought-content">
            Pensamento
          </label>
          <textarea
            id="thought-content"
            className="thought-content-editor"
            defaultValue={
              'Quero começar pela próxima ação clara.\n\nO projeto fica mais leve quando separo o que precisa ser feito agora do que pode esperar.\n\nUma pequena decisão hoje já ajuda a seguir em frente.'
            }
          />
          <p className="thought-help">Markdown: # título, - lista, **negrito** e *itálico*.</p>
          <details className="thought-more">
            <summary>Organizar e transformar</summary>
            <div className="thought-actions">
              <span>Transformar em</span>
              <button className="secondary-button">Tarefa</button>
              <button className="secondary-button">Projeto</button>
              <button className="secondary-button">Inbox</button>
              <button className="icon-button" aria-label="Arquivar pensamento">
                <Archive size={17} />
              </button>
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}
const timelineEvents = [
  {
    time: '11:17',
    icon: CalendarDays,
    source: 'Planejamento',
    title: 'Planejamento concluído',
    summary: 'Sessão no Projeto RUMAR',
  },
  {
    time: '10:24',
    icon: ListTodo,
    source: 'Tarefas',
    title: 'Tarefa concluída',
    summary: 'Revisar prioridades da semana',
  },
  {
    time: '09:17',
    icon: HeartPulse,
    source: 'Hábitos',
    title: 'Hábito concluído',
    summary: 'Leitura · 20 páginas',
  },
  {
    time: '07:52',
    icon: CalendarDays,
    source: 'Treinos',
    title: 'Treino Push concluído',
    summary: 'Força · membros superiores',
  },
  {
    time: '07:36',
    icon: NotebookPen,
    source: 'Pensamentos',
    title: 'Pensamento registrado',
    summary: '',
  },
];
function TimelinePreview({ filters = false }: { filters?: boolean }) {
  return (
    <div className="timeline-page">
      <header className="page-header header-with-action timeline-header">
        <div>
          <h1>Timeline</h1>
          <p>Seu histórico, dia após dia.</p>
        </div>
        <button className="primary-button">
          <Plus size={16} /> Registrar momento
        </button>
      </header>
      <div className="timeline-primary-filters">
        <div className="timeline-quick-filters" role="group" aria-label="Módulos da Timeline">
          {[
            'Todos',
            'Planejamento',
            'Tarefas',
            'Projetos',
            'Hábitos',
            'Treinos',
            'Nutrição',
            'Corpo',
            'Finanças',
            'Pensamentos',
            'Focus',
          ].map((label, index) => (
            <button key={label} className={index === 0 ? 'active' : ''}>
              {label}
            </button>
          ))}
        </div>
        <label className="timeline-search">
          <span className="sr-only">Buscar</span>
          <input type="search" placeholder="Buscar no histórico…" />
        </label>
      </div>
      <div className="timeline-periods" role="group" aria-label="Período da Timeline">
        <button>Hoje</button>
        <button>7 dias</button>
        <button className="active">30 dias</button>
        <button>Personalizado</button>
      </div>
      <details className="timeline-advanced" open={filters}>
        <summary>Período e filtros avançados</summary>
        <div className="timeline-filters">
          <label>
            Período inicial
            <input type="date" defaultValue="2026-07-06" />
          </label>
          <label>
            Período final
            <input type="date" defaultValue="2026-10-04" />
          </label>
          <label>
            Módulo
            <select>
              <option>Todos os módulos</option>
            </select>
          </label>
          <label>
            Objetivo
            <select>
              <option>Todos</option>
            </select>
          </label>
          <label className="timeline-private">
            <input type="checkbox" /> Ocultar conteúdo sensível
          </label>
        </div>
      </details>
      <div className="timeline-days">
        <section className="timeline-day">
          <h2>Hoje</h2>
          <div>
            {timelineEvents.map(({ time, icon: Icon, source, title, summary }) => (
              <button className="timeline-event" key={time}>
                <time>{time}</time>
                <span className="timeline-event-mark">
                  <Icon size={17} />
                </span>
                <span className="timeline-event-copy">
                  <small className="timeline-event-source">{source}</small>
                  <strong>{title}</strong>
                  <small>{summary}</small>
                </span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </section>
        <section className="timeline-day">
          <h2>Ontem</h2>
          <div>
            <button className="timeline-event">
              <time>18:02</time>
              <span className="timeline-event-mark">
                <BookOpen size={17} />
              </span>
              <span className="timeline-event-copy">
                <small className="timeline-event-source">Pensamentos</small>
                <strong>Pensamento criado</strong>
                <small />
              </span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
function ReviewsPreview({ monthly = false }: { monthly?: boolean }) {
  return (
    <div className="legacy-review-page">
      <header className="page-header">
        <h1>Revisão {monthly ? 'mensal' : 'semanal'}</h1>
        <p>
          {monthly
            ? 'Entenda o período e registre o que deseja levar adiante.'
            : 'Olhe para a semana e escolha o que vem a seguir.'}
        </p>
      </header>
      <div className="review-navigation">
        <button className="secondary-button">{monthly ? 'Mês' : 'Semana'} anterior</button>
        <strong>{monthly ? 'Outubro de 2026' : '28/09 a 04/10'}</strong>
        <button className="secondary-button">{monthly ? 'Próximo mês' : 'Semana atual'}</button>
        <button className="secondary-button">Revisão {monthly ? 'semanal' : 'mensal'}</button>
      </div>
      <section className="review-story">
        <h2>O que aconteceu</h2>
        <div className="review-story-summary">
          <p>
            <strong>3/7</strong>
            <span>planejamentos concluídos</span>
          </p>
          <p>
            <strong>7</strong>
            <span>tarefas concluídas</span>
          </p>
          <p>
            <strong>5/7</strong>
            <span>consistência de hábitos</span>
          </p>
          <p>
            <strong>2</strong>
            <span>treinos realizados</span>
          </p>
        </div>
        <p className="review-planning-detail">1 pulado · 0 cancelados · 185 min de foco</p>
      </section>
      <section className="review-story review-writing">
        <h2>Reflexão</h2>
        <p>Os números preparam o contexto. As respostas registram o que você quer levar adiante.</p>
        {[
          ['worked', 'O que funcionou bem?', 'Manter poucos blocos claros.'],
          ['failed', 'O que não funcionou?', 'Interrupções no fim da tarde.'],
          ['change', 'O que quero mudar?', 'Proteger o primeiro bloco do dia.'],
          ['priorities', 'Quais são as prioridades da próxima semana?', 'RUMAR, saúde e leitura.'],
        ].map(([id, label, value]) => (
          <label className="review-question" key={id} htmlFor={`review-${id}`}>
            <span>{label}</span>
            <textarea id={`review-${id}`} defaultValue={value} rows={3} />
          </label>
        ))}
        <div className="review-writing-actions">
          <button className="secondary-button">Salvar respostas</button>
          <button className="primary-button">Finalizar revisão</button>
        </div>
      </section>
      {!monthly && (
        <section className="review-story review-next">
          <h2>O que vem a seguir</h2>
          <button className="review-line">
            <strong>Próxima semana</strong>
            <span>3 tarefas · 2 treinos · 1 prazo de projeto</span>
          </button>
        </section>
      )}
      <details className="review-context" open>
        <summary>Explorar registros {monthly ? 'e comparação' : 'por área'}</summary>
        <div className="review-grid">
          <section className="review-section">
            <h2>Organização</h2>
            <button className="review-line">
              <strong>Tarefas</strong>
              <span>7 concluídas · 3 pendentes</span>
            </button>
            <button className="review-line">
              <strong>Projetos</strong>
              <span>1 com atividade</span>
            </button>
          </section>
          <section className="review-section">
            <h2>Bem-estar</h2>
            <button className="review-line">
              <strong>Hábitos</strong>
              <span>5 registros</span>
            </button>
            <button className="review-line">
              <strong>Treinos</strong>
              <span>2 realizados</span>
            </button>
          </section>
        </div>
      </details>
    </div>
  );
}
const settingsLabels = [
  'Geral',
  'Aparência',
  'Notificações',
  'Planejamento',
  'Automações',
  'Windows',
  'Templates',
  'Backup e dados',
  'Privacidade',
  'Integrações',
  'Sobre',
];
function SettingsPreview({ section = 'Geral' }: { section?: string }) {
  return (
    <div className="settings-page">
      <header className="page-header settings-header">
        <h1>Configurações</h1>
        <p>Encontre e ajuste as preferências do RUMAR.</p>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Seções de configurações">
          <input type="search" aria-label="Buscar seção" placeholder="Buscar seção…" />
          {settingsLabels.map((label) => (
            <button key={label} aria-current={label === section ? 'page' : undefined}>
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <section className="settings-section">
            <h2>{section}</h2>
            {section === 'Geral' ? (
              <>
                <form>
                  <label htmlFor="preview-name">Como podemos chamar você?</label>
                  <div className="name-field">
                    <input id="preview-name" defaultValue="Ana" />
                    <button className="secondary-button">Salvar</button>
                  </div>
                </form>
                <div className="preference-row">
                  <span>Primeiro dia da semana</span>
                  <strong>Segunda-feira</strong>
                </div>
              </>
            ) : (
              <>
                <p>O banco fica neste computador. Backups manuais são salvos onde você escolher.</p>
                <div className="settings-data-paths">
                  <p className="data-path">
                    <strong>Banco local:</strong> C:\Users\Ana\AppData\Roaming\RUMAR\rumo.db
                  </p>
                  <p className="data-path">
                    <strong>Backups automáticos:</strong> C:\Users\Ana\AppData\Roaming\RUMAR\backups
                  </p>
                  <div className="form-actions">
                    <button className="secondary-button">Alterar pasta</button>
                    <button className="secondary-button">Usar pasta padrão</button>
                    <button className="text-button">Abrir pasta</button>
                  </div>
                </div>
                <div className="name-field backup-preferences">
                  <label htmlFor="preview-frequency">Backup automático</label>
                  <select id="preview-frequency" defaultValue="daily">
                    <option value="daily">Diário</option>
                  </select>
                  <div className="backup-retention-grid" aria-label="Retenção de backups">
                    <label>
                      Diários
                      <input type="number" defaultValue="7" />
                    </label>
                    <label>
                      Semanais
                      <input type="number" defaultValue="4" />
                    </label>
                    <label>
                      Mensais
                      <input type="number" defaultValue="6" />
                    </label>
                  </div>
                  <button className="secondary-button">Salvar backup automático</button>
                </div>
                <p className="field-help">
                  A retenção usa a data do manifest: 7 diários, 4 semanais e 6 mensais. Backups
                  manuais e pré-migration não são removidos.
                </p>
                <p>Último backup automático: 09/10/2026, 08:15:00</p>
                <p>Próximo backup: 10/10/2026, 08:15:00</p>
                <div className="name-field">
                  <button className="secondary-button">Criar backup agora</button>
                  <button className="secondary-button">Restaurar backup</button>
                  <button className="secondary-button">Verificar integridade</button>
                </div>
                <div className="settings-health" role="status">
                  <h3>Estado dos dados</h3>
                  <p>SQLite: ok · Chaves estrangeiras: ok · Schema 32/32</p>
                  <p>Anexos: 12/12 íntegros · 0 sem vínculo</p>
                  <p>Backups encontrados: 8 · último em 09/10/2026, 08:15:00</p>
                </div>
                <div className="settings-restore">
                  <p>
                    <strong>Backup selecionado:</strong> C:\Backups\RUMAR-backup-2026-10-09.zip
                  </p>
                  <p>RUMAR 1.8.0 · schema 32 · criado em 09/10/2026, 08:15:00</p>
                  <p>Banco: 4,2 MB · anexos: 12 · checksums e integridade validados</p>
                  <p>
                    Restaurar substituirá os dados atuais. O RUMAR criará antes um backup
                    preventivo.
                  </p>
                  <label>
                    <input type="checkbox" /> Entendo que os dados atuais serão substituídos
                  </label>
                  <button className="primary-button" disabled>
                    Confirmar restauração
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
export function LegacyExperiencePreview({ screen }: { screen: string }) {
  if (screen === 'thoughts') return <ThoughtsPreview />;
  if (screen === 'timeline' || screen === 'timeline-filters')
    return <TimelinePreview filters={screen === 'timeline-filters'} />;
  if (screen === 'reviews' || screen === 'reviews-monthly')
    return <ReviewsPreview monthly={screen === 'reviews-monthly'} />;
  return <SettingsPreview section={screen === 'settings-data' ? 'Backup e dados' : 'Geral'} />;
}
