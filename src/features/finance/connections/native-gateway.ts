import { invoke, isTauri } from '@tauri-apps/api/core';
import type { FinanceGatewayTransport, PluggyConnectFlow } from './pluggy-provider';

export type GatewayConfiguration = {
  configured: boolean;
  paired: boolean;
  available?: boolean;
  mode?: 'personal' | 'external';
};

export async function gatewayConfiguration(): Promise<GatewayConfiguration> {
  if (!isTauri()) return { configured: false, paired: false };
  return invoke<GatewayConfiguration>('finance_gateway_configuration');
}

export async function pairGateway(code: string): Promise<void> {
  if (!isTauri()) throw Error('Disponível somente no aplicativo Windows.');
  await invoke('finance_gateway_pair', { code });
}

export async function unpairGateway(): Promise<void> {
  await invoke('finance_gateway_unpair');
}

export const nativeGatewayTransport: FinanceGatewayTransport = {
  request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: object): Promise<T> {
    if (!isTauri())
      return Promise.reject(Error('Gateway disponível somente no aplicativo Windows.'));
    return invoke<T>('finance_gateway_request', { method, path, body: body ?? null });
  },
};

/** The official widget handles bank login; only its short-lived Connect Token reaches this view. */
export const pluggyWidgetFlow: PluggyConnectFlow = {
  async open(connectToken, connectorIds, sandboxOnly, updateItem) {
    const { PluggyConnect } = await import('pluggy-connect-sdk');
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const widget = new PluggyConnect({
        connectToken,
        includeSandbox: sandboxOnly,
        ...(connectorIds.length ? { connectorIds } : {}),
        ...(updateItem ? { updateItem } : {}),
        forceOauthInBrowser: true,
        language: 'pt',
        onSuccess: ({ item }) => {
          if (settled) return;
          settled = true;
          resolve(item.id);
          void widget.destroy();
        },
        onError: () => {
          if (settled) return;
          settled = true;
          reject(Error('A conexão não foi concluída. Verifique a instituição e tente novamente.'));
          void widget.destroy();
        },
        onClose: () => {
          if (settled) return;
          settled = true;
          reject(Error('Conexão cancelada.'));
          void widget.destroy();
        },
      });
      void widget.init().catch(() => {
        if (settled) return;
        settled = true;
        reject(Error('Não foi possível abrir o fluxo seguro da Pluggy.'));
      });
    });
  },
};
