import {
  Activity,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Plus,
  SlidersHorizontal,
} from 'lucide-react';

function Header({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: typeof CalendarDays;
}) {
  return (
    <header className="page-header module-header">
      <div className="module-heading">
        <span className="module-heading-icon">
          <Icon size={22} />
        </span>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
    </header>
  );
}

const monthEvents: Record<number, { name: string; kind: string; time?: string }[]> = {
  2: [{ name: 'Planejar a semana', kind: 'task' }],
  4: [
    { name: '09:30 Reunião de projeto', kind: 'external' },
    { name: '18:00 Treino de força', kind: 'workout' },
  ],
  7: [{ name: 'Revisar proposta', kind: 'task' }],
  9: [{ name: 'Rotina de estudo', kind: 'routine' }],
  11: [{ name: 'Caminhada', kind: 'habit' }],
  14: [{ name: 'Entregar documentos', kind: 'task' }],
  16: [{ name: 'Treino de mobilidade', kind: 'workout' }],
  20: [{ name: 'Revisão do projeto', kind: 'milestone' }],
  23: [
    { name: '10:00 Consulta', kind: 'external' },
    { name: 'Ler 20 minutos', kind: 'habit' },
  ],
  28: [{ name: 'Preparar próxima semana', kind: 'task' }],
};

function CalendarPreview() {
  return (
    <>
      <Header
        icon={CalendarDays}
        title="Calendário"
        description="Tarefas, hábitos, rotinas, treinos e prazos em um só lugar."
      />
      <div className="calendar-toolbar">
        <button className="secondary-button calendar-today">Hoje</button>
        <button className="icon-button" aria-label="Mês anterior">
          <ChevronLeft size={18} />
        </button>
        <h2>outubro de 2026</h2>
        <button className="icon-button" aria-label="Próximo mês">
          <ChevronRight size={18} />
        </button>
        <button className="secondary-button calendar-filters">
          <SlidersHorizontal size={16} /> Filtros
        </button>
      </div>
      <div className="calendar-grid" aria-label="Calendário mensal">
        {['seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.', 'dom.'].map((day) => (
          <div className="calendar-weekday" key={day}>
            {day}
          </div>
        ))}
        {Array.from({ length: 42 }, (_, index) => {
          const number = index - 2;
          const inMonth = number >= 1 && number <= 31;
          const day = inMonth ? number : number < 1 ? 30 + number : number - 31;
          const events = inMonth ? (monthEvents[day] ?? []) : [];
          return (
            <button
              key={index}
              className={`calendar-cell ${inMonth ? '' : 'outside-month'}`}
              aria-label={`Dia ${day}: ${events.length} itens`}
              aria-current={number === 4 ? 'date' : undefined}
              aria-pressed={false}
            >
              <strong className="calendar-day-number">{day}</strong>
              {events.map((event) => (
                <span className="calendar-event" data-kind={event.kind} key={event.name}>
                  {event.name}
                </span>
              ))}
            </button>
          );
        })}
      </div>
    </>
  );
}

function PlannerPreview({ week = false }: { week?: boolean }) {
  const blocks = [
    { top: 70, height: 58, title: 'Leitura matinal', time: '08:00–08:45', type: 'routine' },
    { top: 204, height: 73, title: 'Reunião de projeto', time: '10:00–11:00', type: 'custom' },
    { top: 330, height: 90, title: 'Trabalho no projeto', time: '12:00–13:15', type: 'task' },
    { top: 530, height: 73, title: 'Treino de força', time: '15:00–16:00', type: 'workout' },
  ];
  const days = week ? ['seg., 5', 'ter., 6', 'qua., 7', 'qui., 8', 'sex., 9'] : ['dom., 4 de out.'];
  const columns = `56px repeat(${days.length}, minmax(0, 1fr))`;
  return (
    <>
      <Header
        icon={CalendarDays}
        title="Calendário"
        description="O prazo diz o que precisa ser feito. O bloco reserva quando você pretende fazer."
      />
      <div className="planner-toolbar">
        <button className="secondary-button">Hoje</button>
        <button className="icon-button" aria-label="Período anterior">
          <ChevronLeft size={18} />
        </button>
        <button className="icon-button" aria-label="Próximo período">
          <ChevronRight size={18} />
        </button>
        <strong>{week ? '5–9 de outubro de 2026' : 'domingo, 4 de outubro de 2026'}</strong>
        <div className="planner-views" aria-label="Visualização do calendário">
          {['Dia', 'Semana útil', 'Semana', 'Mês'].map((label, index) => (
            <button key={label} aria-pressed={index === (week ? 1 : 0)}>
              {label}
            </button>
          ))}
        </div>
        <button className="secondary-button planner-panel-toggle">Não agendado</button>
        <button className="primary-button">
          <Plus size={16} /> Novo bloco
        </button>
      </div>
      <div className="planner-layout">
        <div className="planner-scroll">
          <div className="planner-sheet" style={{ minWidth: week ? 750 : 0 }}>
            <div className="planner-head" style={{ gridTemplateColumns: columns }}>
              <span />
              {days.map((name) => (
                <strong key={name}>{name}</strong>
              ))}
            </div>
            <div className="planner-all-day" style={{ gridTemplateColumns: columns }}>
              <small>Dia todo</small>
              {days.map((name, index) => (
                <div key={name}>
                  {index === 0 && <button>Entregar documentos do projeto</button>}
                </div>
              ))}
            </div>
            <div className="planner-grid" style={{ gridTemplateColumns: columns }}>
              <div className="planner-hours" style={{ height: 840 }}>
                {Array.from({ length: 12 }, (_, index) => (
                  <span key={index} style={{ top: index * 70 }}>
                    {String(index + 7).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
              {days.map((name, dayIndex) => (
                <div className="planner-column" style={{ height: 840 }} key={name}>
                  {blocks
                    .filter(
                      (_, index) => !week || index === dayIndex || (dayIndex === 4 && index === 3),
                    )
                    .map((block) => (
                      <div
                        key={block.title}
                        className={`planner-block source-${block.type}`}
                        style={{ top: block.top, height: block.height, left: '8px', right: '8px' }}
                      >
                        <button className="planner-block-open">
                          <strong>{block.title}</strong>
                          <small>{block.time}</small>
                        </button>
                        <button
                          className="planner-resize"
                          aria-label={`Redimensionar ${block.title}`}
                        />
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </div>
        </div>
        <aside className="planner-unscheduled">
          <div className="planner-unscheduled-heading">
            <h2>Não agendado</h2>
            <span>3</span>
          </div>
          <p className="field-help">Arraste para um horário ou use Agendar.</p>
          <label>
            Mostrar
            <select defaultValue="all">
              <option value="all">Todos</option>
            </select>
          </label>
          {['Revisar prioridades da semana', 'Separar documentos', 'Caminhar por 30 minutos'].map(
            (name) => (
              <div className="planner-candidate" key={name}>
                <span>{name}</span>
                <button className="text-button">Agendar</button>
              </div>
            ),
          )}
          <button className="secondary-button">+ Nova tarefa</button>
        </aside>
      </div>
    </>
  );
}

function WorkoutsPreview() {
  return (
    <>
      <Header
        icon={Dumbbell}
        title="Treinos"
        description="Planeje, registre e acompanhe seu próprio ritmo."
      />
      <nav className="tabs" aria-label="Seções de treinos">
        {['Hoje', 'Plano', 'Histórico', 'Exercícios', 'Progresso corporal'].map((label, index) => (
          <button key={label} aria-current={index === 0 ? 'page' : undefined}>
            {label}
          </button>
        ))}
      </nav>
      <section className="workout-today workout-today-scheduled">
        <p className="workout-kicker">Treino de hoje</p>
        <h2>Força · membros superiores</h2>
        <p>6 exercícios</p>
        <button className="primary-button">Iniciar treino</button>
      </section>
      <section className="workout-today workout-overview">
        <p className="workout-kicker">Seu plano</p>
        <h2>Plano de força</h2>
        <p>Último treino: membros inferiores · 2 de outubro de 2026</p>
      </section>
      <section className="secondary-section">
        <h2>Escolher treino</h2>
        <div className="workout-choose">
          <label>
            Dia do plano ativo
            <select defaultValue="upper">
              <option value="upper">Membros superiores · 6 exercícios</option>
            </select>
          </label>
          <button className="secondary-button">Iniciar escolhido</button>
        </div>
      </section>
    </>
  );
}

function WorkoutSessionPreview() {
  return (
    <div className="workout-session">
      <button className="text-button">← Voltar aos treinos</button>
      <header className="page-header">
        <p className="eyebrow">Plano de força</p>
        <h1>Força · membros superiores</h1>
        <p>4 de outubro de 2026 · em andamento</p>
      </header>
      <section className="workout-execution-exercise" aria-label="Supino reto com barra">
        <div className="section-heading">
          <div>
            <h2>Supino reto com barra</h2>
            <p className="field-help">3 × 8–10 · kg · Descanso 90s</p>
          </div>
          <button className="text-button">+ Série</button>
        </div>
        <div className="workout-previous">
          <p>Último treino</p>
          <p>70 kg × 8 · 70 kg × 8 · 67,5 kg × 9</p>
          <button className="text-button">Usar cargas anteriores</button>
        </div>
        {[1, 2, 3].map((number) => (
          <div className="workout-set" key={number}>
            <span className="workout-set-number">{number}</span>
            <label>
              Carga
              <input
                value={number === 3 ? '' : '70'}
                readOnly
                aria-label={`Carga da série ${number}`}
              />
            </label>
            <label>
              Repetições
              <input
                value={number === 1 ? '8' : number === 2 ? '8' : ''}
                readOnly
                aria-label={`Repetições da série ${number}`}
              />
            </label>
            <label className="workout-set-check">
              <input type="checkbox" checked={number < 3} readOnly /> Feita
            </label>
            <button className="icon-button" aria-label={`Ações da série ${number}`}>
              ···
            </button>
          </div>
        ))}
      </section>
      <section className="workout-execution-exercise" aria-label="Remada com halteres">
        <div className="section-heading">
          <div>
            <h2>Remada com halteres</h2>
            <p className="field-help">3 × 10–12 · kg</p>
          </div>
          <button className="text-button">+ Série</button>
        </div>
        <div className="workout-previous">Último treino · 24 kg × 10</div>
      </section>
    </div>
  );
}

function WorkoutHistoryPreview() {
  return (
    <>
      <Header
        icon={Dumbbell}
        title="Treinos"
        description="Planeje, registre e acompanhe seu próprio ritmo."
      />
      <nav className="tabs" aria-label="Seções de treinos">
        {['Hoje', 'Plano', 'Histórico', 'Exercícios', 'Progresso corporal'].map((label, index) => (
          <button key={label} aria-current={index === 2 ? 'page' : undefined}>
            {label}
          </button>
        ))}
      </nav>
      <h2>Histórico de treinos</h2>
      {[
        'Membros inferiores · 2 de outubro · 1h05',
        'Membros superiores · 29 de setembro · 58 min',
        'Mobilidade · 27 de setembro · 35 min',
      ].map((name) => (
        <button className="workout-history-row" key={name}>
          <span>
            <strong>{name}</strong>
            <small>Treino concluído</small>
          </span>
          <span>Ver sessão →</span>
        </button>
      ))}
    </>
  );
}

function BodyPreview() {
  const points = [
    [36, 43],
    [110, 53],
    [184, 48],
    [258, 73],
    [332, 82],
    [406, 78],
    [480, 94],
    [564, 99],
  ];
  return (
    <>
      <Header
        icon={Dumbbell}
        title="Treinos"
        description="Planeje, registre e acompanhe seu próprio ritmo."
      />
      <nav className="tabs" aria-label="Seções de treinos">
        {['Hoje', 'Plano', 'Histórico', 'Exercícios', 'Progresso corporal'].map((label, index) => (
          <button key={label} aria-current={index === 4 ? 'page' : undefined}>
            {label}
          </button>
        ))}
      </nav>
      <section className="body-progress" aria-label="Progresso corporal">
        <div className="workout-section-heading">
          <div>
            <h2>Progresso corporal</h2>
            <p>Peso e medidas em um só lugar, sem interpretar suas mudanças.</p>
          </div>
          <button className="primary-button">
            <Plus size={16} /> Nova medição
          </button>
        </div>
        <div className="body-overview">
          <div>
            <span>Peso atual</span>
            <strong>76,4 kg</strong>
            <small>4 de outubro de 2026</small>
          </div>
          <div>
            <span>Últimos 30 dias</span>
            <strong>−1,8 kg</strong>
            <small>Variação descritiva</small>
          </div>
          <div>
            <span>Gordura corporal</span>
            <strong>18,2%</strong>
          </div>
          <div>
            <span>Última medição</span>
            <strong>4 de out.</strong>
          </div>
        </div>
        <section className="body-section">
          <div className="section-heading">
            <h3>Evolução</h3>
            <label>
              Métrica{' '}
              <select defaultValue="weight">
                <option value="weight">Peso</option>
              </select>
            </label>
          </div>
          <div className="body-chart">
            <svg viewBox="0 0 600 150" role="img" aria-label="Evolução de peso">
              {[40, 75, 110].map((y) => (
                <line key={y} x1="36" x2="564" y1={y} y2={y} className="body-chart-grid" />
              ))}
              <line x1="36" x2="564" y1="122" y2="122" className="body-chart-axis" />
              <polygon
                className="body-chart-area"
                points={`36,122 ${points.map(([x, y]) => `${x},${y}`).join(' ')} 564,122`}
              />
              <polyline points={points.map(([x, y]) => `${x},${y}`).join(' ')} />
              {points.map(([x, y], index) => (
                <circle key={x} cx={x} cy={y} r="4">
                  <title>{`Medição ${index + 1}`}</title>
                </circle>
              ))}
              <text x="36" y="143">
                set.
              </text>
              <text x="544" y="143">
                out.
              </text>
            </svg>
            <table className="body-history-table">
              <caption>Histórico de peso</caption>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>4 de outubro</td>
                  <td>76,4 kg</td>
                </tr>
                <tr>
                  <td>20 de setembro</td>
                  <td>77,2 kg</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section className="body-section">
          <h3>Medidas</h3>
          <div className="body-metric-grid">
            {[
              ['Cintura', '82 cm', '−2 cm desde a medição anterior'],
              ['Braço esquerdo', '34 cm', '+0,4 cm desde a medição anterior'],
              ['Braço direito', '34,5 cm', '+0,2 cm desde a medição anterior'],
              ['Quadril', '98 cm', 'Sem medição anterior'],
            ].map(([label, value, change]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{change}</small>
              </div>
            ))}
          </div>
        </section>
      </section>
    </>
  );
}

export function TemporalFitnessPreview({ screen }: { screen: string }) {
  if (screen === 'calendar') return <CalendarPreview />;
  if (screen === 'planner') return <PlannerPreview />;
  if (screen === 'planner-week') return <PlannerPreview week />;
  if (screen === 'workouts') return <WorkoutsPreview />;
  if (screen === 'workout-session') return <WorkoutSessionPreview />;
  if (screen === 'workout-history') return <WorkoutHistoryPreview />;
  if (screen === 'body-progress') return <BodyPreview />;
  return <Activity />;
}
