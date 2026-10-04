import { useEffect, useState } from 'react';
import { getDatabase } from '../../../lib/database/connection';
import type { FinancialConnectionProvider } from './provider';
import { PluggyFinancialConnectionProvider } from './pluggy-provider';
import {
  gatewayConfiguration,
  nativeGatewayTransport,
  pairGateway,
  pluggyWidgetFlow,
  type GatewayConfiguration,
} from './native-gateway';
import { autoSyncPreference, saveAutoSyncPreference, type AutoSyncPreference } from './auto-sync';
import {
  FinancialConnectionsRepository,
  recoverInterruptedSyncs,
  type FinancialPreviewRow,
  type StoredConnection,
  type StoredExternalAccount,
} from './repository';

type LocalAccount = { id: string; name: string };
const periods = [
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
  { days: 180, label: '6 meses' },
  { days: 365, label: '12 meses' },
];

const pluggyProvider = new PluggyFinancialConnectionProvider(
  nativeGatewayTransport,
  pluggyWidgetFlow,
);

export function FinancialConnections({
  provider = null,
}: {
  provider?: FinancialConnectionProvider | null;
}) {
  const [repo, setRepo] = useState<FinancialConnectionsRepository | null>(null);
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [selected, setSelected] = useState('');
  const [accounts, setAccounts] = useState<StoredExternalAccount[]>([]);
  const [localAccounts, setLocalAccounts] = useState<LocalAccount[]>([]);
  const [days, setDays] = useState(90);
  const [preview, setPreview] = useState<FinancialPreviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [gateway, setGateway] = useState<GatewayConfiguration>({
    configured: false,
    paired: false,
  });
  const [pairCode, setPairCode] = useState('');
  const [autoSync, setAutoSync] = useState<AutoSyncPreference>('startup_6h');
  useEffect(() => {
    if (provider) return;
    void gatewayConfiguration()
      .then(setGateway)
      .catch(() => setGateway({ configured: false, paired: false }));
    void autoSyncPreference()
      .then(setAutoSync)
      .catch(() => {});
  }, [provider]);
  useEffect(() => {
    let live = true;
    void getDatabase()
      .then(async (db) => {
        await recoverInterruptedSyncs(db);
        const next = new FinancialConnectionsRepository(db);
        const [rows, locals] = await Promise.all([
          next.connections(),
          db.select<LocalAccount[]>(
            'SELECT id,name FROM finance_accounts WHERE archived_at IS NULL ORDER BY name',
          ),
        ]);
        if (live) {
          setRepo(next);
          setConnections(rows);
          setLocalAccounts(locals);
        }
      })
      .catch(() => live && setError('Não foi possível carregar as conexões.'));
    return () => {
      live = false;
    };
  }, []);
  async function refresh(current: FinancialConnectionsRepository, id = selected) {
    setConnections(await current.connections());
    if (id) setAccounts(await current.accounts(id));
  }
  async function action(work: (current: FinancialConnectionsRepository) => Promise<string>) {
    if (!repo) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setMessage(await work(repo));
      await refresh(repo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Operação não concluída.');
    } finally {
      setBusy(false);
    }
  }
  const connection = connections.find((item) => item.id === selected);
  const effectiveProvider =
    provider ?? (gateway.configured && gateway.paired ? pluggyProvider : null);
  const personal = !provider && gateway.mode === 'personal';
  const activeProvider =
    effectiveProvider && connection?.provider === effectiveProvider.id ? effectiveProvider : null;
  const fromDate = () => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  };
  return (
    <section className="finance-connections" aria-label="Contas conectadas">
      <h2>Contas conectadas</h2>
      <p>Importação somente de leitura, após vínculo explícito de cada conta.</p>
      {personal && (
        <div className="field-help">
          <p>
            Uso pessoal: conecte suas próprias contas no Meu Pluggy e autorize o RUMAR a acessá-las.
            O RUMAR nunca pede senha bancária.
          </p>
          <a href="https://meu.pluggy.ai/" target="_blank" rel="noopener noreferrer">
            Abrir Meu Pluggy
          </a>
          <p>
            Depois de conectar sua conta no Meu Pluggy, vincule-a à aplicação demo no Dashboard
            Pluggy e selecione MeuPluggy ao continuar aqui.
          </p>
        </div>
      )}
      {!effectiveProvider && (
        <>
          {!gateway.configured ? (
            <p className="field-help">
              Gateway Open Finance não configurado nesta build. Finanças, OFX e CSV continuam
              disponíveis offline.
            </p>
          ) : (
            <div className="form-grid">
              {personal && !gateway.available && (
                <p className="field-help">
                  Gateway local indisponível. Finanças continua funcionando offline.
                </p>
              )}
              <p className="field-help">
                Emparelhe esta instalação com o gateway. O código é gerado no servidor e usado uma
                vez.
              </p>
              <label>
                Código de emparelhamento
                <input
                  value={pairCode}
                  onChange={(event) => setPairCode(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <button
                className="secondary-button"
                disabled={busy || pairCode.length < 20}
                onClick={() => {
                  setBusy(true);
                  setError('');
                  void pairGateway(pairCode)
                    .then(async () => {
                      setPairCode('');
                      setGateway(await gatewayConfiguration());
                      setMessage(
                        'Instalação emparelhada. O segredo do dispositivo está no Windows Credential Manager.',
                      );
                    })
                    .catch(() =>
                      setError(
                        'Não foi possível emparelhar. Confira o código e a conexão com o gateway.',
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                Emparelhar
              </button>
            </div>
          )}
        </>
      )}
      {effectiveProvider && (
        <>
          {effectiveProvider.id === 'pluggy' && (
            <label>
              Sincronização automática
              <select
                value={autoSync}
                onChange={(event) => {
                  const next = event.target.value as AutoSyncPreference;
                  setAutoSync(next);
                  void saveAutoSyncPreference(next).catch(() =>
                    setError('Não foi possível salvar a preferência.'),
                  );
                }}
              >
                <option value="manual">Somente manual</option>
                <option value="startup">Ao abrir o RUMAR</option>
                <option value="startup_6h">Ao abrir e a cada 6 horas</option>
                <option value="startup_1h">Ao abrir e a cada 1 hora</option>
                <option value="startup_3h">Ao abrir e a cada 3 horas</option>
                <option value="startup_12h">Ao abrir e a cada 12 horas</option>
                <option value="startup_24h">Ao abrir e a cada 24 horas</option>
              </select>
            </label>
          )}
          <button
            className="secondary-button"
            disabled={busy || !repo}
            onClick={() =>
              void action(async (current) => {
                const id = await current.connect(effectiveProvider);
                setSelected(id);
                setAccounts(await current.discoverAccounts(id, effectiveProvider));
                return 'Instituição conectada. Vincule cada conta antes de importar.';
              })
            }
          >
            {effectiveProvider.id === 'fake'
              ? 'Conectar instituição de teste'
              : personal
                ? 'Continuar com Meu Pluggy'
                : 'Conectar instituição'}
          </button>
        </>
      )}
      {!connections.length && <p>Nenhuma instituição conectada.</p>}
      {connections.length > 0 && (
        <label>
          Instituição
          <select
            value={selected}
            onChange={(event) => {
              const id = event.target.value;
              setSelected(id);
              setPreview([]);
              void repo?.accounts(id).then(setAccounts);
            }}
          >
            <option value="">Selecione</option>
            {connections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.institution_name}
                {item.provider === 'fake' ? ' · simulação' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {connection && (
        <>
          <p>
            Estado: {connection.status} · Última sincronização:{' '}
            {connection.last_synced_at
              ? new Date(connection.last_synced_at).toLocaleString('pt-BR')
              : 'não realizada'}
          </p>
          {personal && connection.last_synced_at && autoSync.startsWith('startup_') && (
            <p>
              Próxima tentativa:{' '}
              {new Date(
                Date.parse(connection.last_synced_at) +
                  Number(autoSync.match(/\d+/)?.[0] ?? 6) * 60 * 60_000,
              ).toLocaleString('pt-BR')}{' '}
              (enquanto o RUMAR estiver aberto).
            </p>
          )}
          {connection.consent_expires_at && (
            <p>
              Consentimento até{' '}
              {new Date(connection.consent_expires_at).toLocaleDateString('pt-BR')}
            </p>
          )}
          {activeProvider && connection.status === 'connected' && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void action(async (current) => {
                  setAccounts(await current.discoverAccounts(selected, activeProvider));
                  return 'Contas consultadas novamente.';
                })
              }
            >
              Atualizar contas
            </button>
          )}
          {accounts.map((account) => (
            <div className="preference-row" key={account.localId}>
              <span>
                {account.name} · {account.currency}
                {account.lastFour ? ` · •••• ${account.lastFour}` : ''}
              </span>
              <label>
                Conta RUMAR
                <select
                  value={account.linkedFinanceAccountId ?? ''}
                  disabled={busy || !activeProvider}
                  onChange={(event) =>
                    void action(async (current) => {
                      await current.mapAccount(account.localId, event.target.value);
                      return 'Conta vinculada.';
                    })
                  }
                >
                  <option value="">Não vinculada</option>
                  {localAccounts.map((local) => (
                    <option key={local.id} value={local.id}>
                      {local.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="text-button"
                disabled={busy || !activeProvider || Boolean(account.linkedFinanceAccountId)}
                onClick={() =>
                  void action(async (current) => {
                    const id = await current.createMappedAccount(account.localId);
                    setLocalAccounts((before) => [...before, { id, name: account.name }]);
                    return 'Conta criada e vinculada.';
                  })
                }
              >
                Criar conta RUMAR
              </button>
            </div>
          ))}
          {activeProvider &&
            ['reconnect_required', 'consent_expired'].includes(connection.status) && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void action(async (current) => {
                    await current.refreshConsent(selected, activeProvider);
                    return 'Consentimento atualizado. Confira as contas antes de sincronizar.';
                  })
                }
              >
                Reconectar instituição
              </button>
            )}
          {activeProvider && ['connected', 'error'].includes(connection.status) && (
            <>
              <label>
                Período inicial
                <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
                  {periods.map((item) => (
                    <option key={item.days} value={item.days}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async (current) => {
                      const rows = await current.preview(
                        selected,
                        activeProvider,
                        connection.last_synced_at ? undefined : fromDate(),
                      );
                      setPreview(rows);
                      return `${rows.length} transações consultadas. Confira antes de importar.`;
                    })
                  }
                >
                  Prévia
                </button>
                <button
                  className="primary-button"
                  disabled={busy || !preview.length}
                  onClick={() =>
                    void action(async (current) => {
                      const result = await current.sync(
                        selected,
                        activeProvider,
                        connection.last_synced_at ? undefined : fromDate(),
                      );
                      setPreview([]);
                      window.dispatchEvent(new Event('rumo-finance-changed'));
                      return `${result.newCount} importadas, ${result.updatedCount} atualizadas, ${result.skippedCount} não importadas.`;
                    })
                  }
                >
                  Importar
                </button>
              </div>
              {!!preview.length && (
                <p role="status">
                  {preview.length} registros ·{' '}
                  {preview.filter((row) => row.status === 'new').length} novos ·{' '}
                  {
                    preview.filter((row) => row.status === 'possible' || row.status === 'review')
                      .length
                  }{' '}
                  para revisão
                </p>
              )}
            </>
          )}
          {activeProvider && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void action(async (current) => {
                  await current.disconnect(selected, activeProvider);
                  setPreview([]);
                  return 'Desconectado. Transações e contas locais foram preservadas.';
                })
              }
            >
              Desconectar
            </button>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
