import { Check, Plus, Search } from 'lucide-react';

const rows = [
  ['09:00–10:00', 'Revisar proposta', 'Tarefa'],
  ['10:30–11:00', 'Avançar projeto pessoal', 'Projeto'],
  ['Manhã', 'Beber água', 'Hábito'],
  ['Flexível', 'Organizar referências', 'Item avulso'],
] as const;

export function PlanningFoundationPreview({ screen }: { screen: string }) {
  const today = screen === 'planning-today';
  const models = screen === 'planning-models';
  return (
    <section className="planning-page">
      <header className="page-header planning-header">
        <div>
          <h1>Planejamento</h1>
          <p>Organize o tempo sem alterar a conclusão de tarefas e projetos.</p>
        </div>
        <button className="primary-button">
          <Plus size={17} /> Novo item
        </button>
      </header>
      <nav className="tabs planning-tabs" aria-label="Áreas de planejamento">
        {['Planejar', 'Hoje', 'Hábitos', 'Modelos'].map((label) => (
          <button
            key={label}
            aria-current={
              (models ? label === 'Modelos' : today ? label === 'Hoje' : label === 'Planejar')
                ? 'page'
                : undefined
            }
          >
            {label}
          </button>
        ))}
      </nav>
      {models ? (
        <div className="models-layout">
          <aside className="model-list">
            <h2>Modelos</h2>
            <form>
              <input placeholder="Novo modelo" />
              <button className="primary-button">
                <Plus size={16} />
              </button>
            </form>
            {['Rotina da manhã', 'Preparar treino', 'Fechamento do dia'].map((name, i) => (
              <button key={name} aria-current={i === 0 ? 'true' : undefined}>
                <strong>{name}</strong>
                <small>{i === 0 ? 'Migrado de Rotinas' : 'Bloco único'}</small>
              </button>
            ))}
          </aside>
          <section className="model-detail">
            <header>
              <div>
                <h2>Rotina da manhã</h2>
                <p>Comece o dia com clareza.</p>
              </div>
              <button className="primary-button">Aplicar hoje</button>
            </header>
            <div className="model-mode">
              <button aria-pressed="true">Bloco único</button>
              <button>Expandir itens</button>
            </div>
            <ol className="model-items">
              <li>Beber água</li>
              <li>Planejar prioridades</li>
              <li>Alongar</li>
            </ol>
          </section>
        </div>
      ) : (
        <>
          <div className="planning-datebar">
            <button className="secondary-button">←</button>
            <label>
              📅 <input type="date" defaultValue="2026-10-08" />
            </label>
            <button className="secondary-button">Hoje</button>
            <button className="secondary-button">→</button>
          </div>
          {today ? (
            <div className="today-planning">
              {['Agora', 'Depois', 'Pendências', 'Concluídos'].map((section, index) => (
                <section key={section}>
                  <h2>
                    {section}
                    <span>{index === 2 ? 0 : index === 3 ? 1 : 2}</span>
                  </h2>
                  {index === 2 ? (
                    <p className="planning-empty">Nenhum item.</p>
                  ) : (
                    rows
                      .slice(index === 3 ? 0 : index * 2, index === 3 ? 1 : index * 2 + 2)
                      .map(([time, title, type]) => (
                        <article
                          className={`planning-row${index === 3 ? ' status-completed' : ''}`}
                          key={title}
                        >
                          <button className="planning-check">
                            {index === 3 && <Check size={15} />}
                          </button>
                          <button className="planning-row-main">
                            <strong>{title}</strong>
                            <span>
                              {time} · {type}
                            </span>
                          </button>
                        </article>
                      ))
                  )}
                </section>
              ))}
            </div>
          ) : (
            <>
              <button className="secondary-button planning-source-mobile-toggle">
                <Plus size={16} /> Adicionar de tarefas e projetos
              </button>
              <div className="planning-layout">
                <div className="planning-board">
                  {['Manhã', 'Tarde', 'Noite', 'Flexíveis'].map((period, index) => (
                    <section className="planning-period" key={period}>
                      <header>
                        <h2>{period}</h2>
                        <span>{index < 2 ? 2 : index === 3 ? 1 : 0}</span>
                      </header>
                      {index === 2 ? (
                        <p className="planning-empty">Nada planejado neste período.</p>
                      ) : (
                        rows
                          .slice(
                            index === 0 ? 0 : index === 1 ? 2 : 3,
                            index === 0 ? 2 : index === 1 ? 3 : 4,
                          )
                          .map(([time, title, type]) => (
                            <article className="planning-row" key={title}>
                              <button className="planning-check" />
                              <button className="planning-row-main">
                                <strong>{title}</strong>
                                <span>
                                  {time} · {type}
                                </span>
                              </button>
                            </article>
                          ))
                      )}
                    </section>
                  ))}
                </div>
                <aside className="planning-sources">
                  <div className="planning-source-tabs">
                    <button aria-pressed="true">Tarefas</button>
                    <button>Projetos</button>
                  </div>
                  <label className="planning-search">
                    <Search size={15} />
                    <input placeholder="Buscar tarefas…" />
                  </label>
                  <div className="planning-source-list">
                    {[
                      'Preparar apresentação',
                      'Responder mensagens',
                      'Estudar React',
                      'Planejar a semana',
                    ].map((title) => (
                      <button key={title}>
                        <span>
                          <strong>{title}</strong>
                          <small>Sem projeto</small>
                        </span>
                        <Plus size={16} />
                      </button>
                    ))}
                  </div>
                </aside>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
