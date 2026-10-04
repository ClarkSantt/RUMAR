# Gateway Open Finance — preparação e validação

**Uso pessoal atual:** consulte [OPEN_FINANCE_PERSONAL_MODE.md](OPEN_FINANCE_PERSONAL_MODE.md). O gateway é local, empacotado com o desktop e não exige Railway, HTTPS público, PostgreSQL ou webhook. O restante deste arquivo descreve o fluxo Sandbox e uma possibilidade futura de infraestrutura comercial; **não é requisito para o RUMO pessoal**.

O gateway em `services/rumo-finance-gateway` é um serviço Node.js 24 independente do Tauri. Ele guarda `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` exclusivamente em variáveis de ambiente do servidor. O desktop recebe apenas um Connect Token temporário para o widget oficial; a API Key da Pluggy nunca é enviada a ele. A base financeira principal permanece no SQLite local do RUMO.

## Pré-requisitos

- Conta/credenciais legítimas da Pluggy e permissão para os produtos Accounts e Transactions. Sem elas, os testes HTTP mockados funcionam, mas o Sandbox real não.
- Node.js 24+, volume persistente privado para `GATEWAY_DATABASE_PATH` e HTTPS público para webhooks. O processo Node escuta **somente `127.0.0.1`**; em produção use proxy reverso HTTPS com autenticação/TLS e configure `GATEWAY_PUBLIC_URL` com a origem pública. Nunca exponha diretamente a porta Node à Internet.
- `RUMO_FINANCE_GATEWAY_URL` é usado somente em builds externos de validação. A build pessoal sem essa variável usa o gateway gerenciado em `127.0.0.1:8787`; credenciais ausentes deixam a sincronização indisponível e Finance/OFX/CSV continuam offline.

Copie `.env.example` para um arquivo privado fora do controle de versão e forneça as variáveis pelo gerenciador de segredos do ambiente. O arquivo de exemplo contém apenas nomes. `GATEWAY_WEBHOOK_SECRET` deve ser aleatório, com pelo menos 32 caracteres. Configure explicitamente `GATEWAY_MODE=sandbox` e `GATEWAY_DEPLOYMENT=local` para teste local, ou `GATEWAY_DEPLOYMENT=production` atrás de HTTPS público. Sandbox rejeita ambos os flags Live. A presença de credenciais nunca ativa Live: o modo Live exige separadamente `GATEWAY_MODE=live`, `GATEWAY_DEPLOYMENT=production`, `GATEWAY_ALLOW_LIVE=true` e `GATEWAY_LIVE_PILOT_APPROVED=true`. **Esses flags permanecem desativados neste checkpoint.** A [documentação oficial](https://v2.docs.pluggy.ai/en/docs/connect-widget/environments) informa que Sandbox e Live usam o mesmo widget, diferenciados por conectores.

## Sequência para Sandbox

1. Crie uma conta Pluggy autorizada para testes e obtenha as credenciais Sandbox no painel do provedor.
2. Configure o gateway em máquina/volume de teste. Copie `.env.example` para configuração privada e forneça `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `GATEWAY_DATABASE_PATH`, `GATEWAY_PUBLIC_URL` e um `GATEWAY_WEBHOOK_SECRET` aleatório. Mantenha `GATEWAY_ALLOW_LIVE=false`.
3. Inicie o gateway com `npm start`; o arquivo SQLite próprio é criado automaticamente. Verifique `GET /health`: `status=ok`, `environment=sandbox` e `apiVersion=v1`.
4. Gere o código temporário com `npm run pair-code`, abra **Finanças → Contas conectadas** no RUMO de teste e faça o pareamento. Compile esse cliente com `RUMO_FINANCE_GATEWAY_URL` apontando à origem do gateway de teste; não embuta credenciais Pluggy.
5. Registre o webhook com `npm run register-webhook` quando houver HTTPS público configurado. Abra o widget no RUMO, escolha somente um conector Sandbox, confirme o Item, descubra contas, faça o mapeamento explícito, revise a prévia e importe um período inicial.
6. Sincronize novamente e confirme que não há duplicatas, que a atualização aparece ao receber webhook e que o Finance offline continua acessível se o gateway parar.

**Produção:** a opção simples preparada é uma VM Linux privada com Node.js 24 sob systemd, SQLite do gateway em volume persistente exclusivo e Caddy terminando TLS, encaminhando apenas para `127.0.0.1:8787`. Há exemplos em `services/rumo-finance-gateway/deploy/`; não contêm hostname real nem segredo. DNS público, certificado válido, firewall que exponha apenas HTTPS, conta de serviço sem privilégios, backup do volume e arquivo de ambiente legível apenas pela conta de serviço precisam ser configurados no host real. O serviço falha no início se faltarem URL HTTPS, credenciais server-side, segredo de webhook ou caminho absoluto de banco fora do checkout. `GET /health` devolve apenas estado, versão e ambiente. Caddy faz proxy TLS e limite de corpo; o gateway mantém limite de 16 KiB, timeout, rate limit por IP, autenticação de dispositivo, autenticação/idempotência do webhook e retenção de IDs por 90 dias. Para múltiplas réplicas, o limitador em memória não basta; este desenho prevê **uma** instância.

O webhook público deverá ser `https://<host>/v1/webhooks/pluggy`. Registre-o só depois de DNS/TLS validado, com header `X-Rumo-Webhook-Secret` próprio. Teste requisição sem segredo (401), evento repetido (idempotente) e corpo acima do limite. O gateway não guarda o payload financeiro integral. `OPEN_FINANCE_BACKEND_SETUP.md` não substitui um deploy efetivo: ainda não há host/URL pública nesta validação.

O workflow manual `windows-gateway-candidate.yml` aceita **somente a origem HTTPS pública na porta padrão 443**, sem credenciais, verifica `/health` em Sandbox e então compila o desktop com identifier de produção e essa URL. Ele não conecta banco pessoal nem ativa Live. O workflow normal continua compilando sem URL embutida. Não execute o candidato antes de existir um endpoint público controlado e validado.

```text
cd services/rumo-finance-gateway
npm test
npm run pair-code
npm start
```

`pair-code` gera um código aleatório de uso único por dez minutos. Digite-o em Finanças → Contas conectadas no desktop. A resposta cria uma identidade aleatória de dispositivo, e **somente o módulo Rust** guarda o segredo em Windows Credential Manager. O servidor conserva SHA-256 do segredo de alta entropia, não seu valor. `npm run revoke-device -- <device-id>` revoga a instalação no servidor. Não use o código de pareamento como token permanente.

Com HTTPS público ativo, execute `npm run register-webhook` uma vez. O comando registra `event=all` com `X-Rumo-Webhook-Secret`, conforme os [headers oficiais da Pluggy](https://v2.docs.pluggy.ai/en/docs/developer-tools/webhooks-ref). O webhook rejeita requisições sem o header e eventos fora dos tópicos `item/` e `transactions/`; `eventId` impede repetição. O backend marca o Item como atualizado, sem guardar o payload ou transações. A janela pode estar fechada/tray: no próximo ciclo ativo o desktop consulta o estado e importa dados. Após rotação do segredo, revise/substitua a inscrição antiga na Pluggy; o comando não altera silenciosamente um webhook existente.

O serviço guarda somente `devices` (ID/hash/revogação), `pair_codes` temporários, `items` (ID, proprietário opaco, instituição, flag/versão de atualização) e `webhook_events` (ID e data). Não armazena contas, saldos, transações ou senhas bancárias. O arquivo do gateway **não** é o `rumo.db` pessoal nem faz parte do backup/exportação do desktop. Proteja e faça backup do volume do gateway conforme a política do operador. O esquema próprio é criado no início e adiciona `dirty_version` a instalações anteriores do gateway.

## API

- `GET /health` retorna apenas status, versão do gateway/API e ambiente, sem dados financeiros.
- `POST /v1/device/pair` (código de uso único).
- `POST /v1/open-finance/connect-token` (device auth; token de 30 min; opções em `options.clientUserId`).
- `POST/GET /v1/open-finance/connections`, `GET /:id/status`, `GET /:id/accounts`, `GET /:id/transactions`, `POST /:id/sync` e `DELETE /:id` (device auth, ownership por Item/conta).
- `POST /v1/webhooks/pluggy` (header secreto próprio; idempotência por `eventId`).

As respostas financeiras são DTOs do RUMO, não payload bruto Pluggy. `GET /connections` lista apenas Items do dispositivo; `status` informa estado e `dirtyVersion`; `accounts` devolve contas normalizadas; `transactions` devolve `rows` e `nextCursor`; `sync` confirma uma versão específica de atualização. Erros JSON contêm `code` e `message` genérica, além de `error` legado para compatibilidade; exemplos incluem `unauthorized_device`, `pairing_expired`, `provider_unavailable`, `provider_rate_limited`, `connection_not_found` e `invalid_request`. Nenhum erro inclui credenciais ou resposta bruta do provedor.

O gateway usa a [API Key server-side](https://v2.docs.pluggy.ai/en/reference/authentication) da Pluggy por até 115 minutos e renova em um 401. Consulta `GET /v2/transactions` com cursor e data inicial, sem usar a API paginada antiga. O cursor é usado apenas durante a rodada; falha não avança `last_synced_at`, e a próxima rodada repete a janela sobreposta. GETs 429/5xx têm no máximo duas novas tentativas; POSTs não são repetidos cegamente. Há limite de 16 KiB no corpo de entrada, 15 s em chamadas upstream, 4 MiB na resposta nativa, rate limiting por IP e respostas sem stack trace/segredos. IDs de webhook têm retenção de 90 dias. O proxy reverso deve impor também limites e proteção contra abuso em múltiplas instâncias; o rate limiter do processo é local e **não** substitui controle distribuído. CORS não é habilitado: o desktop chama o gateway via WinHTTP nativo.

## Estado da validação

O Sandbox E2E local de 03/10/2026 passou com credenciais DPAPI, gateway loopback e perfil Smoke isolado: Item Sandbox, duas contas, 15 transações importadas, segunda sync sem duplicação e disconnect. A CI Windows também compilou Rust/Tauri/NSIS. Isso **não** equivale a deploy público ou Live. O webhook real não foi exercitado porque não há endpoint HTTPS público; o workflow de candidato com URL de produção também não foi executado. Live permanece desabilitado. Consulte `VALIDATION.md` para números e pendências atuais.
