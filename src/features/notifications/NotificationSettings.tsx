import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { getDatabase } from '../../lib/database/connection';
import { defaultNotifications, type NotificationPreferences } from './domain';
import { NotificationsRepository } from './repository';

const categories: { key: keyof NotificationPreferences; label: string }[] = [
  { key: 'automations', label: 'Automações' },
  { key: 'blocks', label: 'Time Blocks' },
  { key: 'tasks', label: 'Tarefas' },
  { key: 'routines', label: 'Rotinas' },
  { key: 'workouts', label: 'Treinos' },
  { key: 'finance', label: 'Finanças' },
  { key: 'activity', label: 'Atividade' },
  { key: 'body', label: 'Progresso corporal' },
  { key: 'review', label: 'Revisão Semanal' },
];
const times: { key: keyof NotificationPreferences; label: string }[] = [
  { key: 'workout_time', label: 'Horário preferido de treino' },
  { key: 'finance_time', label: 'Avisar sobre conta prevista para amanhã' },
  { key: 'activity_time', label: 'Lembrar de registrar passos' },
  { key: 'body_time', label: 'Lembrar de registrar peso ou medidas' },
  { key: 'review_time', label: 'Lembrar da revisão no domingo' },
];
export function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPreferences>(defaultNotifications);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then((db) => new NotificationsRepository(db).preferences())
      .then((value) => {
        if (active) setPrefs(value);
      })
      .catch(() => {
        if (active) setMessage('Não foi possível carregar as preferências.');
      });
    return () => {
      active = false;
    };
  }, []);
  async function save<K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K],
  ) {
    setBusy(true);
    setMessage('');
    try {
      if (key === 'enabled' && value === true) {
        if (!isTauri())
          throw Error('Notificações locais estão disponíveis no aplicativo instalado.');
        const granted = (await isPermissionGranted()) || (await requestPermission()) === 'granted';
        if (!granted) throw Error('O Windows não autorizou notificações para o RUMAR.');
      }
      await new NotificationsRepository(await getDatabase()).save(key, value);
      setPrefs((current) => ({ ...current, [key]: value }));
      setMessage('Preferência salva.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="notification-settings">
      <p>
        Lembretes locais e opcionais enquanto o RUMAR estiver aberto. O Windows pode exibir
        notificações na tela bloqueada.
      </p>
      <label className="preference-row">
        <input
          type="checkbox"
          checked={prefs.enabled}
          disabled={busy}
          onChange={(event) => void save('enabled', event.target.checked)}
        />{' '}
        Notificações
      </label>
      <label className="preference-row">
        <input
          type="checkbox"
          checked={prefs.hide_sensitive}
          disabled={busy}
          onChange={(event) => void save('hide_sensitive', event.target.checked)}
        />{' '}
        Ocultar conteúdo sensível: “Você tem um lembrete.”
      </label>
      <div className="notification-options">
        {categories.map(({ key, label }) => (
          <label className="preference-row" key={key}>
            <input
              type="checkbox"
              checked={Boolean(prefs[key])}
              disabled={busy}
              onChange={(event) => void save(key, event.target.checked)}
            />{' '}
            {label}
          </label>
        ))}
      </div>
      <p className="field-help">
        Tarefas usam data, horário e antecedência definidos no próprio editor. Rotinas usam seu
        horário; os demais horários abaixo só valem se a categoria estiver ativa.
      </p>
      <div className="notification-times">
        {times.map(({ key, label }) => (
          <label key={key}>
            {label}
            <input
              type="time"
              value={String(prefs[key])}
              disabled={busy}
              onChange={(event) => void save(key, event.target.value)}
            />
          </label>
        ))}
        <label>
          Dia do lembrete corporal
          <select
            value={prefs.body_weekday}
            disabled={busy}
            onChange={(event) => void save('body_weekday', Number(event.target.value))}
          >
            <option value={0}>Domingo</option>
            <option value={1}>Segunda</option>
            <option value={2}>Terça</option>
            <option value={3}>Quarta</option>
            <option value={4}>Quinta</option>
            <option value={5}>Sexta</option>
            <option value={6}>Sábado</option>
          </select>
        </label>
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
