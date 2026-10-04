import { useEffect, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { localDate } from '../../lib/dates';
import { BodyProgressRepository } from '../body-progress/repository';
import { parseMeasurement } from '../body-progress/domain';
import { desiredBalance, generalProfile, validateProfile, type EnergyProfile } from './domain';
import { EnergyRepository } from './repository';

export function GeneralProfile() {
  const [saved, setSaved] = useState<EnergyProfile | null>(null);
  const [birth, setBirth] = useState('');
  const [height, setHeight] = useState('');
  const [parameter, setParameter] = useState<EnergyProfile['biological_parameter']>('male');
  const [objective, setObjective] = useState<'lose' | 'maintain' | 'gain'>('maintain');
  const [weight, setWeight] = useState('');
  const [savedWeight, setSavedWeight] = useState<number | null>(null);
  const [override, setOverride] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void getDatabase()
      .then(async (db) => {
        const [profile, weights] = await Promise.all([
          new EnergyRepository(db).profile(),
          new BodyProgressRepository(db).weights(1),
        ]);
        return { profile, weight: weights[0]?.weight_kg ?? null };
      })
      .then(({ profile, weight: current }) => {
        if (!live) return;
        setSaved(profile);
        if (profile) {
          setBirth(profile.birth_date);
          setHeight(String(profile.height_cm));
          setParameter(profile.biological_parameter);
          setObjective(profile.objective === 'custom' ? 'maintain' : profile.objective);
          setOverride(
            profile.automatic
              ? profile.balance_override == null
                ? ''
                : String(profile.balance_override)
              : profile.objective === 'maintain'
                ? ''
                : String(Math.abs(desiredBalance(profile))),
          );
        }
        setSavedWeight(current);
        setWeight(current === null ? '' : String(current));
      })
      .catch(() => {
        if (live) setError('Não foi possível carregar o perfil.');
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <form
      className="energy-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        setMessage('');
        void (async () => {
          const kg = parseMeasurement(weight, 'weight');
          const profile = generalProfile(birth, Number(height), parameter, objective, saved);
          profile.balance_override = override.trim() ? Number(override.replace(',', '.')) : null;
          validateProfile(profile, localDate());
          const db = await getDatabase();
          if (savedWeight === null || kg !== savedWeight)
            await new BodyProgressRepository(db).save(localDate(), { weight: kg });
          await new EnergyRepository(db).saveProfile(profile);
          setSaved(profile);
          setSavedWeight(kg);
          setWeight(String(kg));
          setMessage('Perfil salvo. Alimentação e Treinos usarão estes dados automaticamente.');
        })()
          .catch((cause) =>
            setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o perfil.'),
          )
          .finally(() => setBusy(false));
      }}
    >
      <p>
        Informe estes dados uma vez. O peso permanece no Progresso corporal e é atualizado aqui
        quando você registrar uma nova medição.
      </p>
      <div className="form-grid">
        <label>
          Data de nascimento
          <input
            type="date"
            required
            value={birth}
            onChange={(e) => setBirth(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Altura (cm)
          <input
            type="number"
            min="100"
            max="250"
            step="0.1"
            required
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Parâmetro biológico da fórmula
          <select
            value={parameter}
            onChange={(e) => setParameter(e.target.value as EnergyProfile['biological_parameter'])}
            disabled={busy}
          >
            <option value="male">Masculino (+5)</option>
            <option value="female">Feminino (−161)</option>
          </select>
        </label>
        <label>
          Peso atual (kg)
          <input
            inputMode="decimal"
            required
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Objetivo corporal
          <select
            value={objective}
            onChange={(e) => setObjective(e.target.value as typeof objective)}
            disabled={busy}
          >
            <option value="lose">Perder peso</option>
            <option value="maintain">Manter peso</option>
            <option value="gain">Ganhar peso</option>
          </select>
        </label>
      </div>
      <details>
        <summary>Ajustes avançados (opcional)</summary>
        {saved && !saved.automatic && (
          <p className="field-help">
            O perfil anterior usava fator de rotina {saved.base_factor} e referência de{' '}
            {saved.habitual_steps.toLocaleString('pt-BR')} passos. O ajuste desejado foi mantido
            abaixo. Ao salvar, o RUMAR passa ao cálculo automático; os registros de peso e atividade
            continuam preservados.
          </p>
        )}
        <label>
          Ajuste da meta estimada (kcal/dia)
          <input
            type="number"
            min="0"
            max="20000"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            disabled={busy}
            placeholder="Automático"
          />
        </label>
        <p className="field-help">
          Sem ajuste, a estimativa inicial usa 250 kcal/dia de diferença para perda ou ganho.
          Manutenção usa zero. Isto não é prescrição.
        </p>
      </details>
      <button className="primary-button" disabled={busy}>
        Salvar perfil
      </button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
