import { useEffect, useState } from 'react';
import { Dialog } from '../../../components/Dialog';
import { money } from '../domain';
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
const previewStatusLabels: Record<FinancialPreviewRow['status'], string> = {
  new: 'Nova',
  update: 'Atualização',
  existing: 'Já existente',
  possible: 'Possível duplicata',
  review: 'Requer revisão',
  unmapped: 'Sem vínculo',
};
const connectionStatusLabels: Record<string, string> = {
  connected: 'Conectada',
  syncing: 'Sincronizando',
  error: 'Erro na sincronização',
  reconnect_required: 'Reconexão necessária',
  consent_expired: 'Consentimento expirado',
};

const pluggyProvider = new PluggyFinancialConnectionProvider(
  nativeGatewayTransport,
  pluggyWidgetFlow,
);

export function FinancialPreviewRows({
  rows,
  localAccounts,
  hidden,
}: {
  rows: FinancialPreviewRow[];
  localAccounts: LocalAccount[];
  hidden: boolean;
}) {
  return (
    <ul>
      {rows.slice(0, 12).map((row) => (
        <li key={`${row.account.localId}-${row.transaction.id}`}>
          <span>
            <strong>{row.transaction.description}</strong>
            <small>
              {row.transaction.date} · {row.account.name} →{' '}
              {localAccounts.find((local) => local.id === row.account.linkedFinanceAccountId)
                ?.name ?? 'Não vinculada'}{' '}
              · {previewStatusLabels[row.status]}
            </small>
          </span>
          <strong>
            {hidden
              ? money(row.transaction.amountCents, true)
              : `${row.transaction.type === 'income' ? '+' : '−'}${money(row.transaction.amountCents)}`}
          </strong>
        </li>
      ))}
    </ul>
  );
}

interface PreviewCounts {
  total: number;
  new: number;
  update: number;
  review: number;
  existing: number;
}
export function FinancialImportConfirmation({
  connection,
  mappedAccounts,
  localAccounts,
  days,
  counts,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  connection: StoredConnection;
  mappedAccounts: StoredExternalAccount[];
  localAccounts: LocalAccount[];
  days: number;
  counts: PreviewCounts;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog title="Confirmar importação" onClose={onClose} busy={busy} error={error}>
      <div className="finance-confirm-import">
        <p>
          Confira o destino antes de adicionar transações ao RUMAR. Registros para revisão não são
          importados automaticamente.
        </p>
        <dl>
          <div>
            <dt>Instituição</dt>
            <dd>{connection.institution_name}</dd>
          </div>
          <div>
            <dt>Origem → destino</dt>
            <dd>
              {mappedAccounts
                .map(
                  (account) =>
                    `${account.name} → ${localAccounts.find((local) => local.id === account.linkedFinanceAccountId)?.name ?? 'Conta RUMAR'}`,
                )
                .join('; ') || 'Nenhuma conta vinculada'}
            </dd>
          </div>
          <div>
            <dt>Período</dt>
            <dd>
              {connection.last_synced_at ? 'Desde a última sincronização' : `Últimos ${days} dias`}
            </dd>
          </div>
          <div>
            <dt>Prévia</dt>
            <dd>
              {counts.total} registros · {counts.new} novos · {counts.update} atualizações ·{' '}
              {counts.review} para revisão · {counts.existing} já existentes
            </dd>
          </div>
        </dl>
        <div className="form-actions">
          <button className="secondary-button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary-button"
            disabled={busy || counts.new + counts.update === 0}
            onClick={onConfirm}
          >
            Confirmar e importar
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function FinancialConnections({
  provider = null,
  hidden = false,
}: {
  provider?: FinancialConnectionProvider | null;
  hidden?: boolean;
}) {
  const [repo, setRepo] = useState<FinancialConnectionsRepository | null>(null);
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [selected, setSelected] = useState('');
  const [accounts, setAccounts] = useState<StoredExternalAccount[]>([]);
  const [localAccounts, setLocalAccounts] = useState<LocalAccount[]>([]);
  const [days, setDays] = useState(90);
  const [preview, setPreview] = useState<FinancialPreviewRow[]>([]);
  const [confirmImport, setConfirmImport] = useState(false);
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
  const previewCounts = {
    total: preview.length,
    new: preview.filter((row) => row.status === 'new').length,
    update: preview.filter((row) => row.status === 'update').length,
    review: preview.filter((row) => row.status === 'possible' || row.status === 'review').length,
    existing: preview.filter((row) => row.status === 'existing').length,
  };
  const mappedAccounts = accounts.filter((account) => account.linkedFinanceAccountId);
  return (
    <section className="finance-connections" aria-label="Contas conectadas">
      <div className="finance-connections-intro">
        <h2>Contas conectadas</h2>
        <p>
          Consulte suas instituições, vincule cada conta e confira a prévia antes de importar. A
          conexão consulta dados em modo somente leitura; a importação grava no banco local do
          RUMAR.
        </p>
      </div>
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
      {!connections.length && (
        <p className="finance-connections-empty">
          Nenhuma instituição conectada. Você pode continuar usando Finanças sem conexão.
        </p>
      )}
      {connections.length > 0 && (
        <label>
          Instituição
          <select
            value={selected}
            onChange={(event) => {
              const id = event.target.value;
              setSelected(id);
              setPreview([]);
              setConfirmImport(false);
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
          <p className="finance-connection-status">
            Estado: {connectionStatusLabels[connection.status] ?? 'Requer atenção'} · Última
            sincronização:{' '}
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
            <div className="preference-row finance-account-mapping" key={account.localId}>
              <span>
                <strong>{account.name}</strong> · {account.currency}
                {account.lastFour ? ` · •••• ${account.lastFour}` : ''}
              </span>
              <label>
                Conta RUMAR
                <select
                  value={account.linkedFinanceAccountId ?? ''}
                  disabled={busy || !activeProvider}
                  onChange={(event) =>
                    void action(async (current) => {
                      setPreview([]);
                      setConfirmImport(false);
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
                <select
                  value={days}
                  onChange={(event) => {
                    setDays(Number(event.target.value));
                    setPreview([]);
                    setConfirmImport(false);
                  }}
                >
                  {periods.map((item) => (
                    <option key={item.days} value={item.days}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              {mappedAccounts.length > 0 && (
                <p className="field-help">
                  Origem e destino:{' '}
                  {mappedAccounts
                    .map(
                      (account) =>
                        `${account.name} → ${localAccounts.find((local) => local.id === account.linkedFinanceAccountId)?.name ?? 'Conta RUMAR'}`,
                    )
                    .join('; ')}
                  .
                </p>
              )}
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
                      setConfirmImport(false);
                      return `${rows.length} transações consultadas. Confira antes de importar.`;
                    })
                  }
                >
                  Prévia
                </button>
                <button
                  className="primary-button"
                  disabled={busy || previewCounts.new + previewCounts.update === 0}
                  onClick={() => setConfirmImport(true)}
                >
                  Revisar importação
                </button>
              </div>
              {!!preview.length && (
                <section className="finance-connection-preview" aria-label="Prévia da importação">
                  <h3>Prévia da importação</h3>
                  <p role="status">
                    {preview.length} registros · {previewCounts.new} novos · {previewCounts.update}{' '}
                    atualizações · {previewCounts.review} para revisão · {previewCounts.existing} já
                    existentes
                  </p>
                  <FinancialPreviewRows
                    rows={preview}
                    localAccounts={localAccounts}
                    hidden={hidden}
                  />
                  {preview.length > 12 && (
                    <p className="field-help">
                      Mostrando 12 de {preview.length} registros. A confirmação considera toda a
                      prévia.
                    </p>
                  )}
                </section>
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
      {confirmImport && connection && activeProvider && (
        <FinancialImportConfirmation
          connection={connection}
          mappedAccounts={mappedAccounts}
          localAccounts={localAccounts}
          days={days}
          counts={previewCounts}
          busy={busy}
          error={error}
          onClose={() => setConfirmImport(false)}
          onConfirm={() =>
            void action(async (current) => {
              const result = await current.sync(
                selected,
                activeProvider,
                connection.last_synced_at ? undefined : fromDate(),
              );
              setPreview([]);
              setConfirmImport(false);
              window.dispatchEvent(new Event('rumo-finance-changed'));
              return `${result.newCount} importadas, ${result.updatedCount} atualizadas, ${result.skippedCount} não importadas.`;
            })
          }
        />
      )}
    </section>
  );
}
