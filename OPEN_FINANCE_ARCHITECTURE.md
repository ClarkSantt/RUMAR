# Open Finance Brasil — decisão para RUMO 1.8

**Modo pessoal atual:** o gateway é local e restringe o acesso ao Connector 200 do Meu Pluggy. Consulte [OPEN_FINANCE_PERSONAL_MODE.md](OPEN_FINANCE_PERSONAL_MODE.md). A análise abaixo registra a evolução do projeto e não exige servidor público para uso individual.

Data da pesquisa: 01/10/2026. Escopo: consulta de contas e transações, sem iniciação de pagamentos.

## Decisão

O RUMO **não acessará diretamente** APIs bancárias do Open Finance Brasil como aplicativo pessoal desktop. Segundo o [Banco Central](https://www.bcb.gov.br/meubc/faqs/p/os-bancos-e-instituicoes-que-participam-do-open-finance), a participação é de instituições autorizadas; o compartilhamento é entre uma instituição transmissora e uma receptora, mediante consentimento do cliente. O [guia técnico de receptoras](https://openfinancebrasil.atlassian.net/wiki/spaces/OF/pages/941818299/Organiza%2Bes%2Bconsumidoras%2Bde%2Bdados%2Be%2Bservi%2Bos%2Breceptoras%2Biniciadoras) requer declaração de software, registro dinâmico e certificado de transporte ICP-Brasil. A [especificação DCR](https://openfinancebrasil.atlassian.net/wiki/spaces/OF/pages/1334116474/EN%2BOpen%2BFinance%2BBrasil%2BDynamic%2BClient%2BRegistration%2B-%2Bv2.1.0) exige software statement assinado pelo diretório e identidade compatível com o certificado. Isso não equivale a um fluxo OAuth público para desktop independente.

O caminho futuro é um provedor autorizado, com consentimento externo explícito, ou um parceiro institucional. Mesmo por provedor, o RUMO não embutirá `client_secret` no executável. A autenticação privilegiada e eventual recepção de webhooks exigem um intermediário confiável, mantido fora do cliente desktop, ou outra solução formalmente documentada pelo provedor. Sem essa infraestrutura e credenciais legítimas, **não haverá conexão bancária live**. Não serão usados scraping, automação de Internet Banking, senha bancária ou API informal de banco.

## Provedores avaliados

| Opção         | Evidência oficial                                                                                                                                                                                                                           | Consequência para o RUMO                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Acesso direto | [BCB](https://www.bcb.gov.br/meubc/faqs/s/open-finance), [guia de receptoras](https://openfinancebrasil.atlassian.net/wiki/spaces/OF/pages/941818299/Organiza%2Bes%2Bconsumidoras%2Bde%2Bdados%2Be%2Bservi%2Bos%2Breceptoras%2Biniciadoras) | Requer participação e credenciais institucionais; não adequado ao app pessoal.                                                                                                       |
| Pluggy        | [Autenticação](https://v2.docs.pluggy.ai/en/reference/authentication), [widget](https://docs.pluggy.ai/en/docs/integration-checklist/setup-widget)                                                                                          | API de contas/transações e Connect Token, mas a própria documentação exige servidor para manter `clientId`/`clientSecret` e emitir token do widget. Não integrar diretamente no EXE. |
| Belvo         | [Integração Brasil](https://developers.belvo.com/pt-br/products/aggregation_brazil/aggregation-brazil-integration-widget)                                                                                                                   | Widget regulado, sandbox/Mockbank e coleta assíncrona por webhooks; requer chave secreta e endpoint de webhook. Não é um fluxo desktop local puro.                                   |

Preço e acesso de produção dependem de proposta/contrato e não foram confirmados para uso pessoal. Nenhum provedor foi escolhido nem conectado nesta versão. Isso evita criar vínculo comercial, backend ou tratamento de dados bancários sem uma decisão informada.

## Arquitetura preparada

`FinancialConnectionProvider` representa conexão, consentimento, contas e transações de forma independente do fornecedor. `FakeFinancialConnectionProvider` permite testar normalização, mapeamento, deduplicação, falhas transitórias e sincronização incremental em banco isolado. A migration aditiva `0028_financial_connections.sql` guarda conexão, contas descobertas, vínculo com conta RUMO, identidade/status de transação e runs técnicos. Não guarda tokens nem payload bruto. O saldo informado pelo provedor é apenas um snapshot separado; nunca substitui o saldo calculado da conta local. Uma conta externa só recebe transações após vínculo explícito, e esse vínculo não pode ser trocado quando já há histórico importado.

A primeira importação permite escolher 30, 90, 180 ou 365 dias. Depois, a consulta padrão recua sete dias a partir do último sync e inclui a transação pendente mais antiga, se houver. O ID externo é a identidade principal; reimportar não duplica e a transição pending → posted pode trocar o ID externo mantendo a linha local. Correspondências prováveis com OFX são retidas para revisão, sem merge automático. Transferências e pagamentos de fatura também ficam em revisão para não duplicar despesas. Regras existentes de categorização são reutilizadas. Falhas externas deixam o run com código técnico e permitem nova tentativa.

A tabela antiga `finance_transactions` tem uma constraint de `source` já aplicada em bancos existentes. A 0028 não reconstrói essa tabela: a origem efetiva `open_finance` é identificada pelo vínculo em `financial_external_transaction_links` e pelo `external_id` com prefixo `of:`; a lista financeira apresenta essa origem. O registro local usa `source='manual'` por compatibilidade com a constraint antiga. Esta decisão deve ser considerada ao criar filtros ou exportações futuros.

A aba **Finanças → Contas conectadas** mostra o estado local, mapeamento, prévia e consentimento. Na etapa inicial, antes do gateway, somente o provider fake era usado nos testes; a integração Pluggy Sandbox em andamento está descrita abaixo. A conexão bancária Live continua indisponível até validação e autorização apropriadas.

O uso local de Finance, OFX e CSV continua disponível sem rede. Backup e exportação podem conter transações normalizadas, mas nunca credenciais de provedor. Desconectar não apaga histórico importado.

## Evolução em andamento — gateway Pluggy (02/10/2026)

A decisão acima permanece: nenhuma credencial privilegiada entra no desktop. Foi criado `services/rumo-finance-gateway`, com identidade revogável por instalação, API Key server-side em cache, Connect Token limitado, endpoints autenticados e webhook com header configurado pela API da Pluggy. O adaptador `PluggyFinancialConnectionProvider` reutiliza o contrato neutro; o fake continua para regressões. O desktop usa um comando Rust/WinHTTP que guarda o segredo do dispositivo no Windows Credential Manager, e o widget oficial recebe só o Connect Token. O widget é carregado sob demanda. O modo padrão do backend aceita somente conectores Sandbox; Live requer opção explícita no servidor e validações adicionais.

O backend persiste apenas dispositivo, Item e `dirty_version`/IDs de webhook. Transações e contas são normalizadas na resposta e importadas no SQLite local por meio do repository já existente. O scheduler local tenta sincronizar ao abrir e depois em janelas de seis horas; um webhook pode antecipar o ciclo, sem expor o desktop à Internet. Com o processo encerrado, não há sincronização. O fluxo e o deploy estão em `OPEN_FINANCE_BACKEND_SETUP.md`.

O cursor da Pluggy é transitório por rodada de consulta, por conta; o RUMO não o avança de forma permanente. Se uma página falha, o próximo sync repete a janela de datas e os vínculos por ID evitam duplicação. Cursor repetido ou malformado interrompe a rodada. Reembolso fica para revisão, pois classificá-lo automaticamente como receita comum distorceria os totais; compra e pagamento de fatura não são importados como duas despesas. Credenciais de dispositivo no Windows Credential Manager ficam vinculadas à origem do gateway compilada no aplicativo.

**Estado:** backend e frontend compilam/testam com mocks, mas ainda não existe teste Pluggy Sandbox real, credenciais autorizadas, validação nativa Windows ou build desta evolução. A descrição anterior de “nenhum provider live” documenta a etapa anterior; não deve ser interpretada como uma conexão Live já habilitada agora.

## Limitações e validação

Esta decisão é uma avaliação técnica e de produto baseada nas fontes oficiais acima; não substitui análise jurídica de uma operação comercial. Nenhuma conta bancária pessoal foi usada. Validação live e preço contratual permanecem pendentes. O bloqueio Windows Application Control (erro 4551) continua impedindo a execução nativa recente neste ambiente; não será contornado.
