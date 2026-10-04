import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppSidebar } from '../../src/components/AppSidebar';
import { Home } from '../../src/features/home/Home';
import type { RumoStore } from '../../src/hooks/useRumo';
import type { Snapshot, Task } from '../../src/types/models';
import '../../src/styles/global.css';
import '../../src/styles/visual-foundation.css';

const today = '2026-10-04';
function task(id: string, title: string, date: string, completed = false): Task {
  return {
    id,
    title,
    description: '',
    priority: 'normal',
    due_date: date,
    due_time: null,
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
    task('2', 'Separar documentos para o projeto', today),
    task('3', 'Caminhar por 30 minutos', today),
    task('4', 'Responder mensagem importante', today),
    task('5', 'Organizar notas', '2026-10-03'),
  ],
  subtasks: [],
  completions: [],
  subtaskCompletions: [],
  inbox: [
    {
      id: 'i1',
      content: 'Ideia',
      status: 'pending',
      created_at: today,
      updated_at: today,
      processed_at: null,
    },
    {
      id: 'i2',
      content: 'Lembrete',
      status: 'pending',
      created_at: today,
      updated_at: today,
      processed_at: null,
    },
  ],
  settings: { name: 'Ana', theme: 'light' },
};
const store = { data, busy: false, run: async () => true } as unknown as RumoStore;
function Preview() {
  return (
    <div className="app-shell">
      <AppSidebar
        activePage="home"
        inboxCount={2}
        ready
        onNavigate={() => {}}
        onAdd={() => {}}
        onSearch={() => {}}
      />
      <main id="main" tabIndex={-1}>
        <div className="content">
          <div className="home-layout">
            <div className="home-primary">
              <Home
                store={store}
                now={new Date(2026, 9, 4, 10)}
                onOpen={() => {}}
                onInbox={() => {}}
                onReview={() => {}}
              />
            </div>
            <aside className="home-rail" aria-label="Continuidade do dia">
              <section className="secondary-section">
                <div className="section-heading">
                  <h2>Agenda de hoje</h2>
                  <button className="text-button">Ver dia</button>
                </div>
                <button className="review-line">
                  <span>11:30</span>
                  <strong>Próximo · Planejar a semana</strong>
                </button>
                <button className="review-line">
                  <span>16:00</span>
                  <strong>Próximo · Caminhada</strong>
                </button>
              </section>
              <section className="habit-section">
                <div className="habit-heading">
                  <h2>Hábitos de hoje</h2>
                </div>
                <div className="habit-list">
                  <article className="habit-row">
                    <div className="habit-row-main">
                      <input type="checkbox" aria-label="Ler" /> <strong>Ler</strong>
                    </div>
                    <p>0 de 1 hoje</p>
                  </article>
                  <article className="habit-row">
                    <div className="habit-row-main">
                      <input type="checkbox" aria-label="Água" checked readOnly />{' '}
                      <strong>Água</strong>
                    </div>
                    <p>Meta de hoje registrada</p>
                  </article>
                </div>
              </section>
              <section className="habit-section">
                <div className="habit-heading">
                  <h2>Rotinas de hoje</h2>
                </div>
                <div className="habit-list">
                  <article className="habit-row">
                    <strong>Rotina da manhã</strong>
                    <p>3 de 4 etapas</p>
                  </article>
                </div>
              </section>
              <section className="secondary-section">
                <div className="section-heading">
                  <h2>Treino</h2>
                  <button className="text-button">Abrir</button>
                </div>
                <p>Treino de força · 5 exercícios</p>
              </section>
            </aside>
          </div>
          <div className="home-more">
            <section className="secondary-section">
              <div className="section-heading">
                <h2>Em andamento</h2>
              </div>
              <p>Projeto pessoal · próxima etapa</p>
            </section>
            <section className="secondary-section">
              <div className="section-heading">
                <h2>Alimentação</h2>
              </div>
              <p>Resumo do dia</p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Preview />);
