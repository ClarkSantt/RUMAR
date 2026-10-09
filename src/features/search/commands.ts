import { localDate } from '../../lib/dates';
import { parseNaturalSchedule } from '../quick-add/parser';

export type CommandKind =
  | 'navigate'
  | 'create-task'
  | 'create-thought'
  | 'create-planning'
  | 'capture-inbox'
  | 'start-focus'
  | 'record-weight'
  | 'start-workout'
  | 'toggle-theme';

export interface AppCommand {
  id: string;
  title: string;
  detail: string;
  kind: CommandKind;
  payload?: string;
  page?: string;
}

const navigation: AppCommand[] = [
  ['home', 'Home'],
  ['planning', 'Planejamento'],
  ['tasks', 'Tarefas'],
  ['projects', 'Projetos'],
  ['workouts', 'Treinos'],
  ['nutrition', 'Nutrição'],
  ['finance', 'Finanças'],
  ['thoughts', 'Pensamentos'],
].map(([page, label]) => ({
  id: `open-${page}`,
  title: `Abrir ${label}`,
  detail: 'Navegação',
  kind: 'navigate',
  page,
}));

const actions: AppCommand[] = [
  {
    id: 'new-task',
    title: 'Nova Task',
    detail: 'Criar uma tarefa',
    kind: 'create-task',
  },
  {
    id: 'new-thought',
    title: 'Novo Thought',
    detail: 'Registrar um pensamento',
    kind: 'create-thought',
  },
  {
    id: 'new-planning',
    title: 'Novo Planning Item',
    detail: 'Planejar no dia',
    kind: 'create-planning',
  },
  {
    id: 'capture-inbox',
    title: 'Capturar no Inbox',
    detail: 'Guardar sem classificar',
    kind: 'capture-inbox',
  },
  {
    id: 'start-focus',
    title: 'Iniciar Focus',
    detail: 'Começar uma sessão',
    kind: 'start-focus',
  },
  {
    id: 'record-weight',
    title: 'Registrar peso',
    detail: 'Abrir Progresso corporal',
    kind: 'record-weight',
  },
  {
    id: 'start-workout',
    title: 'Iniciar treino de hoje',
    detail: 'Abrir Treinos',
    kind: 'start-workout',
  },
  {
    id: 'toggle-theme',
    title: 'Trocar tema',
    detail: 'Alternar claro e escuro',
    kind: 'toggle-theme',
  },
];

const forbidden = /\b(apagar|excluir|deletar|resetar|restaurar|desinstalar)\b/i;

export function commandSuggestions(raw: string, today = localDate()): AppCommand[] {
  const query = raw.trim();
  if (forbidden.test(query)) return [];
  const normalized = query.toLocaleLowerCase('pt-BR');
  const interpreted: AppCommand[] = [];
  const patterns: [RegExp, CommandKind, string, string][] = [
    [
      /^(?:nova tarefa|criar tarefa)\s+(.+)$/i,
      'create-task',
      'Criar Task',
      'Tarefa com data sugerida',
    ],
    [
      /^(?:novo pensamento|criar pensamento)\s+(.+)$/i,
      'create-thought',
      'Criar Thought',
      'Pensamento privado',
    ],
    [
      /^(?:capturar inbox|capturar)\s+(.+)$/i,
      'capture-inbox',
      'Capturar no Inbox',
      'Sem classificação automática',
    ],
    [/^planejar\s+(.+)$/i, 'create-planning', 'Criar Planning Item', 'Planejamento sugerido'],
    [
      /^iniciar foco(?:\s+(.+))?$/i,
      'start-focus',
      'Iniciar Focus',
      'Vincular quando houver correspondência única',
    ],
    [/^registrar peso(?:\s+(.+))?$/i, 'record-weight', 'Registrar peso', 'Progresso corporal'],
  ];
  for (const [pattern, kind, title, detail] of patterns) {
    const match = query.match(pattern);
    if (!match) continue;
    const payload = match[1]?.trim() ?? '';
    const schedule =
      kind === 'create-task' || kind === 'create-planning'
        ? parseNaturalSchedule(payload, today)
        : null;
    interpreted.push({
      id: `interpreted-${kind}`,
      title: schedule?.title ? `${title}: ${schedule.title}` : title,
      detail:
        schedule && (schedule.date || schedule.time)
          ? [schedule.date, schedule.time].filter(Boolean).join(' · ')
          : detail,
      kind,
      payload,
    });
  }
  const catalog = [...navigation, ...actions];
  if (!query) return catalog;
  const ranked = catalog
    .filter((command) =>
      `${command.title} ${command.detail}`.toLocaleLowerCase('pt-BR').includes(normalized),
    )
    .sort(
      (a, b) =>
        Number(!a.title.toLocaleLowerCase('pt-BR').startsWith(normalized)) -
        Number(!b.title.toLocaleLowerCase('pt-BR').startsWith(normalized)),
    );
  return [
    ...interpreted,
    ...ranked.filter((item) => !interpreted.some((row) => row.id === item.id)),
  ].slice(0, 12);
}

export function hasDestructiveCommand(query: string) {
  return forbidden.test(query);
}
