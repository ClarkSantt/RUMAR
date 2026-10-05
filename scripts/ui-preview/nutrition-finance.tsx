import { useState } from 'react';
import { NutrientSummary, NutritionTodayMeals } from '../../src/features/nutrition/Nutrition';
import { FinanceOverviewMetrics } from '../../src/features/finance/Finance';
import {
  FinancialImportConfirmation,
  FinancialPreviewRows,
} from '../../src/features/finance/connections/FinancialConnections';
import type { DiaryEntry } from '../../src/features/nutrition/types';
import type { FinancialPreviewRow } from '../../src/features/finance/connections/repository';

const meals: DiaryEntry[] = [
  ['1', 'Café da manhã', 'Aveia com banana', 180],
  ['2', 'Almoço', 'Arroz, feijão e legumes', 340],
  ['3', 'Lanche', 'Iogurte natural', 120],
].map(([id, meal_label, food_name, grams_equivalent]) => ({
  id: String(id),
  entry_date: '2026-10-04',
  meal_label: String(meal_label),
  food_id: String(id),
  food_name: String(food_name),
  quantity: Number(grams_equivalent),
  unit: 'g',
  grams_equivalent: Number(grams_equivalent),
  nutrients_json: '{}',
  source_meal_id: null,
  notes: '',
  created_at: '',
  updated_at: '',
}));

const fakeExternalAccount = {
  id: 'demo-account',
  localId: 'local-demo',
  linkedFinanceAccountId: 'local-finance',
  name: 'Conta de demonstração',
  type: 'checking' as const,
  currency: 'BRL',
  lastFour: '0000',
  balanceCents: null,
};
const previewRows: FinancialPreviewRow[] = [
  {
    id: 'one',
    date: '2026-10-04',
    description: 'Mercado de exemplo',
    amountCents: 6890,
    type: 'expense' as const,
    status: 'posted' as const,
  },
  {
    id: 'two',
    date: '2026-10-03',
    description: 'Pagamento fictício',
    amountCents: 190000,
    type: 'income' as const,
    status: 'posted' as const,
  },
].map((transaction) => ({
  account: fakeExternalAccount,
  transaction: { ...transaction, accountId: fakeExternalAccount.id, postedAt: null },
  status: 'new' as const,
  localTransactionId: null,
}));

const summary = {
  income_cents: 480000,
  expense_cents: 176000,
  reserved_cents: 55000,
  balance_cents: 304000,
  available_cents: 249000,
  planned_available_cents: 230000,
  planned_income_cents: 450000,
  planned_expense_cents: 180000,
  planned_goal_cents: 40000,
};

export function NutritionFinancePreview({ screen }: { screen: string }) {
  const [hidden, setHidden] = useState(false);
  const nutrition = screen.startsWith('nutrition-');
  const connections = screen.startsWith('finance-connection');
  const nutritionTab =
    screen === 'nutrition-foods' ? 'Alimentos' : screen === 'nutrition-diet' ? 'Dieta' : 'Hoje';
  const financeTab = connections
    ? 'Contas conectadas'
    : screen === 'finance-transactions'
      ? 'Transações'
      : screen === 'finance-planning'
        ? 'Planejamento'
        : 'Visão geral';
  return (
    <div className={nutrition ? 'nutrition-preview' : 'finance-page'}>
      <header className="page-header">
        <h1>{nutrition ? 'Alimentação' : 'Finanças'}</h1>
        <p>
          {nutrition
            ? 'Planeje suas refeições e acompanhe o que consumiu, no seu ritmo.'
            : 'Seu dinheiro, organizado com clareza.'}
        </p>
      </header>
      {nutrition ? (
        <>
          <nav
            className="tabs nutrition-tabs nutrition-navigation"
            aria-label="Seções de alimentação"
          >
            {[
              'Hoje',
              'Diário',
              'Progresso',
              'Dieta',
              'Refeições',
              'Compras',
              'Alimentos',
              'Histórico',
            ].map((label, index) => (
              <span className="nutrition-nav-item" key={label}>
                {[0, 3, 6].includes(index) && (
                  <span className="nutrition-nav-label" aria-hidden="true">
                    {index === 0 ? 'Acompanhar' : index === 3 ? 'Planejar' : 'Consultar'}
                  </span>
                )}
                <button aria-current={nutritionTab === label ? 'page' : undefined}>{label}</button>
              </span>
            ))}
          </nav>
          {screen === 'nutrition-today' ? (
            <section className="nutrition-page">
              <div className="section-heading">
                <h2>Hoje</h2>
                <time dateTime="2026-10-04">4 de outubro</time>
              </div>
              <NutrientSummary
                values={{ energy_kcal: 1640, protein_g: 98, carbohydrate_g: 175, fat_g: 51 }}
                goals={{ calories: 2200, protein_g: 140, carbs_g: 240, fat_g: 70 }}
                title="Alimentação de hoje"
              />
              <button className="text-button">Definir metas diárias</button>
              <NutritionTodayMeals entries={meals} onDiary={() => {}} />
              <section className="nutrition-section">
                <h2>Atividade diária</h2>
                <p className="field-help">
                  Detalhes de energia e atividade continuam disponíveis abaixo do diário.
                </p>
              </section>
            </section>
          ) : screen === 'nutrition-foods' ? (
            <section className="nutrition-page">
              <div className="section-heading">
                <h2>Alimentos</h2>
                <button className="primary-button">Criar alimento</button>
              </div>
              <div className="nutrition-search">
                <label>
                  Buscar alimento
                  <input placeholder="Arroz, frango, banana…" />
                </label>
              </div>
              <div className="nutrition-split">
                <div className="nutrition-list nutrition-food-list">
                  {['Aveia em flocos', 'Banana', 'Arroz integral', 'Feijão', 'Iogurte natural'].map(
                    (food) => (
                      <button key={food}>
                        {food}
                        <small>TACO · 100 g</small>
                      </button>
                    ),
                  )}
                </div>
                <div className="nutrition-section">
                  <h3>Aveia em flocos</h3>
                  <p className="field-help">Composição por 100 g · fonte TACO</p>
                  <NutrientSummary
                    values={{ energy_kcal: 394, protein_g: 13.9, carbohydrate_g: 66.6, fat_g: 8.5 }}
                    title="Composição do alimento"
                  />
                  <button className="secondary-button">Registrar no diário</button>
                </div>
              </div>
            </section>
          ) : (
            <section className="nutrition-page">
              <div className="section-heading">
                <h2>Dieta</h2>
                <button className="primary-button">Nova dieta</button>
              </div>
              <div className="nutrition-plan-list">
                <button aria-current="true">Semana de exemplo</button>
              </div>
              <div className="nutrition-week">
                {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => (
                  <button aria-pressed={day === 'Dom'} key={day}>
                    {day}
                  </button>
                ))}
              </div>
              <div className="nutrition-section">
                <h3>Domingo</h3>
                {[
                  'Café da manhã · Aveia com banana',
                  'Almoço · Arroz, feijão e legumes',
                  'Jantar · Sopa de legumes',
                ].map((meal) => (
                  <div className="nutrition-item" key={meal}>
                    {meal}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <div className="finance-toolbar">
            <nav className="nutrition-tabs" aria-label="Seções de Finanças">
              {[
                'Visão geral',
                'Transações',
                'Planejamento',
                'Objetivos',
                'Patrimônio',
                'Contas conectadas',
              ].map((label) => (
                <button key={label} aria-current={financeTab === label ? 'page' : undefined}>
                  {label}
                </button>
              ))}
            </nav>
            <button className="text-button" onClick={() => setHidden(!hidden)}>
              {hidden ? 'Mostrar valores' : 'Ocultar valores'}
            </button>
          </div>
          {screen === 'finance-overview' ? (
            <>
              <div className="finance-section-heading">
                <h2>Outubro de 2026</h2>
                <label>
                  Mês
                  <input type="month" defaultValue="2026-10" />
                </label>
              </div>
              <FinanceOverviewMetrics summary={summary} hidden={hidden} />
              <div className="finance-grid">
                <section className="finance-panel">
                  <h2>Planejado e realizado</h2>
                  <dl className="finance-facts">
                    {[
                      ['Receita planejada', 450000],
                      ['Receita realizada', 480000],
                      ['Despesas planejadas', 180000],
                      ['Despesas realizadas', 176000],
                    ].map(([label, amount]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>
                          {hidden
                            ? 'R$ •••••'
                            : new Intl.NumberFormat('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              }).format(Number(amount) / 100)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section className="finance-panel">
                  <h2>Gastos por categoria</h2>
                  <div className="finance-bars">
                    {['Alimentação', 'Casa', 'Transporte'].map((category, i) => (
                      <div key={category}>
                        <span>{category}</span>
                        <div className="finance-bar">
                          <i style={{ width: hidden ? '0%' : `${[60, 35, 20][i]}%` }} />
                        </div>
                        <strong>
                          {hidden ? 'R$ •••••' : ['R$ 680,00', 'R$ 410,00', 'R$ 220,00'][i]}
                        </strong>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
              <section className="finance-panel finance-recent">
                <div className="finance-section-heading">
                  <h2>Transações recentes</h2>
                  <button className="text-button">Ver transações</button>
                </div>
                <ul className="finance-list">
                  {['Mercado de exemplo', 'Assinatura fictícia', 'Pagamento fictício'].map(
                    (description, i) => (
                      <li key={description}>
                        <span>
                          {description}
                          <small>Outubro · {i === 2 ? 'Receita' : 'Despesa'}</small>
                        </span>
                        <strong>
                          {hidden ? 'R$ •••••' : ['R$ 68,90', 'R$ 29,90', 'R$ 1.900,00'][i]}
                        </strong>
                      </li>
                    ),
                  )}
                </ul>
              </section>
            </>
          ) : screen === 'finance-transactions' ? (
            <>
              <div className="finance-section-heading">
                <h2>Transações</h2>
                <label>
                  Mês
                  <input type="month" defaultValue="2026-10" />
                </label>
              </div>
              <div className="finance-filters">
                <label>
                  Buscar
                  <input placeholder="Descrição" />
                </label>
                <label>
                  Conta
                  <select>
                    <option>Todas</option>
                  </select>
                </label>
                <label>
                  Categoria
                  <select>
                    <option>Todas</option>
                  </select>
                </label>
                <label>
                  Tipo
                  <select>
                    <option>Todos</option>
                  </select>
                </label>
              </div>
              <div className="finance-grid finance-transactions-layout">
                <section className="finance-panel">
                  <h3>Movimentações</h3>
                  <ul className="finance-list">
                    {['Mercado de exemplo', 'Assinatura fictícia', 'Pagamento fictício'].map(
                      (description, i) => (
                        <li key={description}>
                          <span>
                            {description}
                            <small>2026-10-04 · {i === 2 ? 'Receita' : 'Despesa'}</small>
                          </span>
                          <strong>
                            {hidden ? 'R$ •••••' : ['− R$ 68,90', '− R$ 29,90', '+ R$ 1.900,00'][i]}
                          </strong>
                          <button className="text-button">Editar</button>
                        </li>
                      ),
                    )}
                  </ul>
                </section>
                <section className="finance-panel">
                  <details className="finance-disclosure">
                    <summary>Nova transação</summary>
                    <p>Formulário de registro.</p>
                  </details>
                </section>
              </div>
              <details className="finance-administration">
                <summary>Importação OFX, categorias e regras</summary>
              </details>
            </>
          ) : screen === 'finance-planning' ? (
            <>
              <div className="finance-section-heading">
                <h2>Planejamento de outubro de 2026</h2>
                <label>
                  Mês
                  <input type="month" defaultValue="2026-10" />
                </label>
              </div>
              <div className="finance-grid">
                <section className="finance-panel">
                  <h3>Plano mensal</h3>
                  <dl className="finance-facts">
                    {[
                      ['Receita prevista', 'R$ 4.500,00'],
                      ['Despesas previstas', 'R$ 1.800,00'],
                      ['Aportes planejados', 'R$ 400,00'],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{hidden ? 'R$ •••••' : value}</dd>
                      </div>
                    ))}
                  </dl>
                  <button className="secondary-button">Editar plano</button>
                </section>
                <section className="finance-panel">
                  <h3>Orçamento por categoria</h3>
                  <ul className="finance-list">
                    <li>
                      <span>
                        Alimentação
                        <small>
                          Realizado {hidden ? 'R$ •••••' : 'R$ 680,00'} de{' '}
                          {hidden ? 'R$ •••••' : 'R$ 800,00'}
                        </small>
                      </span>
                    </li>
                    <li>
                      <span>
                        Casa
                        <small>
                          Realizado {hidden ? 'R$ •••••' : 'R$ 410,00'} de{' '}
                          {hidden ? 'R$ •••••' : 'R$ 500,00'}
                        </small>
                      </span>
                    </li>
                  </ul>
                </section>
              </div>
            </>
          ) : (
            <section className="finance-connections" aria-label="Contas conectadas">
              <div className="finance-connections-intro">
                <h2>Contas conectadas</h2>
                <p>
                  Consulte suas instituições, vincule cada conta e confira a prévia antes de
                  importar. A conexão consulta dados em modo somente leitura; a importação grava no
                  banco local do RUMAR.
                </p>
              </div>
              <p className="field-help">Ambiente de demonstração com dados fictícios.</p>
              <button className="secondary-button">Continuar com Meu Pluggy</button>
              <label>
                Instituição
                <select>
                  <option>Banco de teste</option>
                </select>
              </label>
              <p className="finance-connection-status">
                Estado: Conectada · Última sincronização: não realizada
              </p>
              <div className="preference-row finance-account-mapping">
                <span>
                  <strong>Conta de demonstração</strong> · BRL · •••• 0000
                </span>
                <label>
                  Conta RUMAR
                  <select>
                    <option>Conta local fictícia</option>
                  </select>
                </label>
                <button className="text-button">Criar conta RUMAR</button>
              </div>
              <p className="field-help">
                Origem e destino: Conta de demonstração → Conta local fictícia.
              </p>
              <label>
                Período inicial
                <select>
                  <option>90 dias</option>
                </select>
              </label>
              <div className="form-actions">
                <button className="secondary-button">Prévia</button>
                <button className="primary-button">Revisar importação</button>
              </div>
              {(screen === 'finance-connection-preview' ||
                screen === 'finance-connection-confirmation') && (
                <section className="finance-connection-preview" aria-label="Prévia da importação">
                  <h3>Prévia da importação</h3>
                  <p>2 registros · 2 novos · 0 para revisão · 0 já existentes</p>
                  <FinancialPreviewRows
                    rows={previewRows}
                    localAccounts={[{ id: 'local-finance', name: 'Conta local fictícia' }]}
                    hidden={hidden}
                  />
                </section>
              )}
              {screen === 'finance-connection-confirmation' && (
                <FinancialImportConfirmation
                  connection={{
                    id: 'demo',
                    provider: 'fake',
                    external_connection_id: 'demo',
                    institution_name: 'Banco de teste',
                    status: 'connected',
                    consent_expires_at: null,
                    last_synced_at: null,
                  }}
                  mappedAccounts={[fakeExternalAccount]}
                  localAccounts={[{ id: 'local-finance', name: 'Conta local fictícia' }]}
                  days={90}
                  counts={{ total: 2, new: 2, update: 0, review: 0, existing: 0 }}
                  busy={false}
                  onClose={() => {}}
                  onConfirm={() => {}}
                />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
