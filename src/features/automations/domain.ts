import { addDays, localDate, parseDate, validDate } from '../../lib/dates';
import { validTime } from '../notifications/domain';
export const triggers = {
  schedule: 'Tempo',
  task_created: 'Tarefa criada',
  task_completed: 'Tarefa concluída',
  task_due: 'Prazo da tarefa se aproxima',
  task_overdue: 'Tarefa vencida',
  objective_created: 'Objetivo criado',
  objective_completed: 'Objetivo concluído',
  milestone_completed: 'Marco concluído',
  objective_due: 'Prazo do objetivo se aproxima',
  finance_due: 'Recorrência financeira vence',
  goal_contribution: 'Contribuição financeira registrada',
  workout_completed: 'Treino concluído',
  weight_recorded: 'Peso registrado',
  measurement_recorded: 'Medida registrada',
  focus_completed: 'Focus finalizado',
} as const;
export type TriggerType = keyof typeof triggers;
export const actions = {
  task: 'Criar tarefa',
  notification: 'Notificar',
  moment: 'Criar Momento',
  link: 'Vincular ao objetivo',
} as const;
export type ActionType = keyof typeof actions;
export interface TriggerConfig {
  mode?: 'daily' | 'weekly' | 'monthly' | 'once';
  time?: string;
  weekday?: number;
  month_day?: number;
  date?: string;
  days?: number;
}
export interface Conditions {
  project_id?: string;
  entity_id?: string;
  status?: 'pending' | 'completed';
}
export interface ActionConfig {
  title?: string;
  description?: string;
  objective_id?: string;
}
export interface RuleDraft {
  name: string;
  enabled: boolean;
  trigger_type: TriggerType;
  trigger_config: TriggerConfig;
  conditions: Conditions;
  action_type: ActionType;
  action_config: ActionConfig;
  missed_policy: 'ignore' | 'latest';
}
export interface AutomationRule extends RuleDraft {
  id: string;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
}
function keys(value: object, allowed: string[]) {
  if (Object.keys(value).some((k) => !allowed.includes(k)))
    throw Error('Configuração não suportada.');
}
export function validateRule(d: RuleDraft) {
  if (
    !d.name.trim() ||
    d.name.length > 160 ||
    !(d.trigger_type in triggers) ||
    !(d.action_type in actions) ||
    !['ignore', 'latest'].includes(d.missed_policy)
  )
    throw Error('Regra inválida.');
  keys(d.trigger_config, ['mode', 'time', 'weekday', 'month_day', 'date', 'days']);
  keys(d.conditions, ['project_id', 'entity_id', 'status']);
  keys(d.action_config, ['title', 'description', 'objective_id']);
  const c = d.trigger_config;
  if (
    d.trigger_type === 'schedule' &&
    (!c.mode || !['daily', 'weekly', 'monthly', 'once'].includes(c.mode))
  )
    throw Error('Escolha a frequência.');
  if (c.time !== undefined && !validTime(c.time)) throw Error('Horário inválido.');
  if (d.trigger_type === 'schedule' && !c.time) throw Error('Informe o horário.');
  if (c.mode === 'weekly' && (!Number.isInteger(c.weekday) || c.weekday! < 0 || c.weekday! > 6))
    throw Error('Dia inválido.');
  if (
    c.mode === 'monthly' &&
    (!Number.isInteger(c.month_day) || c.month_day! < 1 || c.month_day! > 31)
  )
    throw Error('Dia do mês inválido.');
  if (c.mode === 'once' && (!c.date || !validDate(c.date))) throw Error('Data inválida.');
  if (c.days !== undefined && (!Number.isInteger(c.days) || c.days < 0 || c.days > 365))
    throw Error('Antecedência inválida.');
  if (d.conditions.status && !['pending', 'completed'].includes(d.conditions.status))
    throw Error('Condição inválida.');
  if (
    Object.values(d.conditions)
      .filter((v) => v !== undefined)
      .some((v) => typeof v !== 'string' || v.length > 160)
  )
    throw Error('Condição inválida.');
  if (
    d.action_type !== 'link' &&
    (!d.action_config.title?.trim() || d.action_config.title.length > 160)
  )
    throw Error('Informe o título da ação.');
  if ((d.action_config.description?.length ?? 0) > 2000) throw Error('Descrição muito longa.');
  if (d.action_type === 'link' && !d.action_config.objective_id)
    throw Error('Selecione o objetivo.');
}
function scheduledDate(c: TriggerConfig, day: string) {
  if (c.mode === 'daily') return true;
  if (c.mode === 'weekly') return parseDate(day).getDay() === c.weekday;
  if (c.mode === 'once') return day === c.date;
  const last = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0).getDate();
  return Number(day.slice(8)) === Math.min(c.month_day ?? 1, last);
}
export function scheduledOccurrence(
  c: TriggerConfig,
  now: Date,
  missed: 'ignore' | 'latest',
  createdAt: string,
) {
  const today = localDate(now);
  for (let back = 0; back <= (missed === 'latest' ? 366 : 1); back++) {
    const day = addDays(today, -back);
    if (!scheduledDate(c, day)) continue;
    const at = new Date(`${day}T${c.time ?? '09:00'}:00`);
    if (at > now) continue;
    if (at.getTime() < new Date(createdAt).getTime()) return null;
    if (missed === 'ignore' && now.getTime() - at.getTime() >= 120000) return null;
    return { key: `schedule:${day}:${c.time}`, at: at.toISOString() };
  }
  return null;
}
export function nextOccurrence(c: TriggerConfig, now = new Date()) {
  for (let offset = 0; offset <= 366; offset++) {
    const day = addDays(localDate(now), offset),
      at = new Date(`${day}T${c.time ?? '09:00'}:00`);
    if (scheduledDate(c, day) && at > now) return at.toISOString();
  }
  return null;
}
