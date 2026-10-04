# RUMAR 1.8.0

RUMAR é a continuação do RUMO, um aplicativo pessoal e local para Windows.
O nome RUMO aparece em migrations, identificadores e documentação histórica
para preservar a compatibilidade de dados; não indica um serviço em nuvem.

**Estado da distribuição:** o código e a CI estão disponíveis para revisão,
mas ainda não há uma versão 1.8.0 publicamente assinada e validada neste PC.
Não instale artifacts unsigned como substitutos do RUMO legado. Uma candidatura
à SignPath Foundation será apresentada sem afirmar aprovação antecipada.

O código original está sob [MIT](LICENSE). Os dados TACO e componentes de
terceiros conservam suas permissões próprias, descritas em
[avisos de terceiros](THIRD_PARTY_NOTICES.md). Veja também
[privacidade](PRIVACY.md) e [segurança](SECURITY.md).

Para compilar no Windows, instale Node.js 24, Rust stable MSVC e os requisitos
oficiais do Tauri 2. Depois execute `npm ci`, `npm test`,
`npm run typecheck`, `npm run lint`, `npm run build`,
`cd services/rumo-finance-gateway && npm ci && npm test`,
`cd src-tauri && cargo test --locked` e, na raiz,
`npm run desktop:build`. O workflow `windows-ci.yml` executa essa validação em
runner Windows e publica somente artifacts de build, sem credenciais.

**Code signing policy:** o projeto só distribuirá uma build como confiavelmente
assinada após verificar a origem do artifact, obter uma assinatura pública válida
e executar o smoke nativo. Nenhum certificado ou chave privada de assinatura
faz parte deste repositório. A assinatura via SignPath Foundation depende de
avaliação e aprovação externa; veja [política de assinatura](CODE_SIGNING_POLICY.md).

Um aplicativo desktop pessoal para organizar o dia e acompanhar projetos, hábitos, treinos, alimentação e finanças. Os dados principais ficam localmente; não há conta RUMO, servidor próprio nem telemetria. A integração opcional com Google Agenda usa a rede apenas quando ativada.

## Google Agenda — integração opcional em desenvolvimento

**Configurações → Integrações → Google Agenda** oferece um espelho unilateral RUMO → Google. A conexão usa o navegador do sistema, retorno local, PKCE e o escopo limitado `calendar.app.created`. O RUMO cria uma agenda secundária chamada **RUMO**; seus calendários existentes não são importados nem alterados. A conexão não envia eventos imediatamente: escolha fontes, data inicial e horizonte futuro, depois use **Sincronizar agora**. Rotinas e Time Blocks vêm ligados por padrão; Treinos, Tarefas, Objetivos e Marcos ficam desligados. Itens sem horário são ignorados por padrão ou podem virar eventos de dia inteiro.

O SQLite guarda preferências, identificadores de eventos, fila e log técnico limitado. O refresh token fica no Gerenciador de Credenciais do Windows e não entra no SQLite, backup ou exportação JSON. Falhas de rede mantêm o trabalho local e agendam nova tentativa. Desconectar remove a credencial local e preserva a agenda remota; excluir essa agenda é uma ação separada com confirmação. Alterações feitas diretamente no Google não retornam ao RUMO. Consulte [GOOGLE_CALENDAR_SETUP.md](GOOGLE_CALENDAR_SETUP.md) para criar uma credencial OAuth Desktop e configurar a conexão.

As migrations aditivas `0025_google_calendar.sql`, `0026_google_calendar_sources.sql` e `0027_google_calendar_bootstrap.sql` elevam o schema de teste a 27. A integração ainda depende de validação nativa e live antes de ser considerada release 1.7.0; veja `VALIDATION.md`.

## RUMO 1.6.0 — anexos e portabilidade de dados

Projetos, Pensamentos, Objetivos, Momentos da Timeline e transações financeiras aceitam anexos locais. O arquivo é copiado para `%APPDATA%\com.rumo.desktop\attachments\<id>\file.<ext>`; o SQLite guarda vínculo, nome original, tamanho, tipo, caminho relativo e SHA-256. São aceitos PDF, PNG, JPEG, WebP, TXT, CSV, JSON, DOCX e XLSX até 100 MB por arquivo. Abrir e revelar validam tamanho e hash; excluir o vínculo agenda a limpeza da cópia gerenciada. Arquivos originais não são alterados.

**Configurações → Dados** distingue backup de exportação. O backup ZIP serve para restaurar o RUMO e agora inclui os anexos referenciados, com hashes no manifest; backups antigos sem anexos continuam legíveis. A exportação serve para leitura fora do aplicativo: CSV de tarefas, finanças, treinos, progresso corporal, atividade, diário alimentar e objetivos; ICS das fontes visíveis do Calendário e Time Blocks no intervalo escolhido; JSON versionado de todos os domínios e metadados dos anexos. O JSON não embute arquivos: para recuperar os arquivos, use o backup. CSV usa UTF-8 com BOM, ponto e vírgula e neutralização de fórmulas de planilha. O ICS expande blocos recorrentes no período exportado, limitado a um ano, incluindo exceções, sem inventar fuso horário.

A importação local aceita CSV financeiro, CSV de Progresso corporal e ICS. Ela mostra prévia, linhas válidas/problemáticas e exige escolha explícita para importar apenas as válidas. O CSV financeiro permite mapear colunas de data, descrição, valor, tipo, conta e categoria para entidades já existentes; possíveis duplicatas são apenas sinalizadas. Em registros de peso por data e eventos ICS por UID, escolha atualizar ou ignorar conflitos. O histórico guarda arquivo, tipo, data e número de linhas, mas não o payload importado. A Central de Dados mostra tamanhos estimados do banco, anexos e backups; a verificação completa de hashes e órfãos ocorre somente sob demanda. Migrations aditivas `0020` a `0024` elevam o schema a 24 sem editar as versões anteriores.

O JSON portátil tem `format`, `exportVersion: 1`, `rumoVersion`, `exportedAt`, `schemaVersion`, `attachmentFilesIncluded: false` e `data`. Os grupos de `data` são `organization`, `workouts`, `nutrition`, `finance`, `planning`, `continuity`, `objectives`, `automations`, `dataManagement` e `attachments`. Cada grupo contém arrays de registros com IDs e referências originais; migrations internas, filas temporárias de remoção e bytes de arquivos não são exportados. Ele é um formato de leitura/portabilidade versionado, **não** um arquivo para restaurar diretamente no RUMO. CSV do diário alimentar usa uma coluna por nutriente conhecido; valores ausentes permanecem vazios.

## RUMO 1.5.0 — automações, recorrência e revisão mensal

Configurações → Automações permite criar regras internas **Quando → Se → Então**: horários ou acontecimentos dos módulos existentes podem criar tarefa, notificação local, Momento ou vínculo com objetivo. Condições são opcionais; ações não executam scripts, comandos ou SQL do usuário. Cada ocorrência tem registro único, efeito atômico e limite de encadeamento. A regra pode ignorar ocorrências perdidas ou processar a última pendente; consultas de prazos recuperam até 31 dias. As regras e notificações funcionam somente com o aplicativo aberto, e notificações exigem ativação explícita da categoria Automações.

Blocos de tempo podem repetir diariamente, em dias úteis, semanalmente em dias escolhidos ou mensalmente, com término por data, quantidade ou sem término. Meses curtos usam o último dia disponível. O Calendário expande apenas o período consultado; mover, redimensionar ou excluir permite escolher ocorrência ou série. Exceções preservam as demais ocorrências. Uma série de blocos não altera a recorrência ou o prazo da tarefa nem a programação do plano de treino.

Objetivos aceitam marcos ordenáveis, com conclusão manual ou derivada de uma meta financeira existente. Correções nos aportes recalculam os marcos; atingir um marco não conclui automaticamente o objetivo. Prazos e conclusões aparecem no Calendário, Timeline e revisões, respeitando a ocultação financeira. Quick Add aceita `/marco` com escolha explícita do objetivo.

A Revisão Mensal está acessível pela Revisão Semanal. Agrega organização, objetivos, hábitos, rotinas, treinos, foco, atividade, alimentação, corpo e finanças, com comparação ao mês anterior e nota pessoal opcional. A semana/mês atual exclui dias futuros; valores financeiros e conteúdo privado respeitam preferências existentes. As métricas são derivadas, sem snapshots duplicados.

Migrations aditivas `0017_automations_recurrence.sql`, `0018_objective_milestones_reviews.sql` e `0019_automation_milestone_events.sql` levam ao schema 19; migrations anteriores permanecem intactas. Backup/restore inclui essas tabelas. Consulte `VALIDATION.md` para distinguir testes de aplicação, auditoria de navegador, execução nativa e build Windows.

## Planejador e Focus

O Calendário ganhou visualizações Dia, Semana útil, Semana e Mês, blocos de tempo com associação opcional a tarefas, rotinas e treinos, movimentação entre dias e redimensionamento. Agendar uma tarefa não altera seu prazo. Configurações permitem ajustar o intervalo visual e a duração padrão; a Home mostra uma agenda compacta.

Focus registra tempo efetivamente acompanhado, exclui pausas e recupera sessões interrompidas em estado pausado. Tarefas recorrentes e subtarefas são concluídas na ocorrência associada à sessão. Tempo planejado e tempo de foco realizado permanecem separados na Revisão Semanal; sessões concluídas alimentam a Timeline e objetivos vinculados. Quick Add aceita duração em tarefas e o prefixo `/bloco`; lembretes de blocos são opcionais e dependem do aplicativo aberto.

As migrations aditivas `0015_daily_planner.sql` e `0016_focus_occurrence.sql` levam o banco ao schema 16. Consulte `VALIDATION.md` para os resultados e o estado de validação da release.

## Stack

- Tauri 2 / Rust e WebView2 no Windows.
- React 19, TypeScript estrito e Vite.
- SQLite pelo plugin SQL oficial do Tauri; migrations SQL registradas no Rust.
- CSS com tokens semânticos claros/escuros, fonte do sistema e Lucide.
- Vitest, React Testing Library e SQLite real (`node:sqlite`) nos testes.
- Playwright para o teste do executável Windows via WebView2.

## Requisitos Windows

Windows 10/11 x64, Node.js **24 LTS ou posterior**, npm, Rust estável com toolchain `x86_64-pc-windows-msvc`, Microsoft C++ Build Tools com **Desenvolvimento para desktop com C++** e Windows SDK, além do Microsoft Edge WebView2 Runtime. O primeiro build baixa dependências e ferramentas de empacotamento. O aplicativo instalado não precisa de Node ou Rust.

Consulte os [pré-requisitos oficiais do Tauri](https://v2.tauri.app/start/prerequisites/). Para Rust, `rustup default stable-msvc`. Abra um novo terminal após instalar os requisitos.

A [CI Windows](WINDOWS_CI.md) valida frontend, gateway mockado, `cargo check`/`cargo test` e empacotamento Tauri/NSIS em runner limpo; smoke nativo interativo e integrações com banco real permanecem verificações separadas. O [Open Finance pessoal](OPEN_FINANCE_PERSONAL_MODE.md) usa o Connector 200 do Meu Pluggy e gateway local, sem hospedagem mensal.

## Instalação e desenvolvimento

Na raiz do repositório:

```powershell
npm ci
npm run desktop
```

O Tauri inicia o Vite automaticamente. `npm run dev` inicia somente o frontend e **não disponibiliza SQLite no navegador**; não existe fallback silencioso para dados temporários ou localStorage. Para usar o produto, execute `npm run desktop`.

## Verificações

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run desktop:build
npx prettier --check src tests scripts *.json *.ts *.js *.md src-tauri/*.json src-tauri/capabilities/*.json
```

`npm run test:watch` acompanha testes durante desenvolvimento. `npm run format` formata o código. Testes de banco aplicam o SQL versionado em SQLite real, verificam a conversão atômica e fecham/reabrem um arquivo físico. Também cobrem recorrência, tarefas, subtarefas, preferências, validações, teclado e rollback visual em falhas.

Após a build Windows, `npm run test:desktop` executa os cenários no **executável de produção**. Só execute em um perfil de teste, sem outra instância aberta. O script recusa bancos com tarefas ou capturas existentes; cria dados pelo próprio aplicativo, encerra e reabre o processo, compara os registros persistidos, restaura as preferências e remove seus dados ao terminar. Usa a porta local 9223 apenas durante o teste. Capturas e relatório ficam em `artifacts/desktop/` (fora do Git). Se o processo for interrompido à força antes da limpeza, use outro perfil Windows ou remova apenas o banco de teste que você criou.

## Build Windows

```powershell
npm run desktop:build
```

Saídas:

- `src-tauri/target/release/rumo.exe`: aplicativo.
- `src-tauri/target/release/bundle/nsis/RUMO_<versão>_x64-setup.exe`: instalador NSIS em português.

O executável usa WebView2. O instalador pode precisar instalar esse runtime se ausente. O pacote não está assinado digitalmente. A compilação inclui o frontend e o SQLite; não usa um servidor web local em produção.

Para uma distribuição assinada, use certificado legítimo no armazenamento de certificados do Windows e uma configuração local de build com `bundle.windows.certificateThumbprint`, `digestAlgorithm` e `timestampUrl`, ou o `signCommand` suportado pelo Tauri para o serviço de assinatura contratado. Certificado/chave privada e configuração local não devem entrar no Git. Gere novamente o pacote e confira a assinatura de executável e instalador antes de publicar; nenhuma assinatura improvisada é usada nesta release.

Se o Windows informar que uma política de Controle de Aplicativo bloqueou o executável, consulte Segurança do Windows → Controle de aplicativos e navegador → Controle inteligente de aplicativos. O Smart App Control não oferece exceção individual; uma distribuição compatível precisa de assinatura de código reconhecida. Não confunda esse bloqueio com falha de compilação. Consulte a [orientação oficial da Microsoft](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions).

## Uso

- O aplicativo abre no **Início**, com tarefas de hoje e ocorrências elegíveis. O nome inicial é Gustavo e pode ser editado.
- Digite no campo rápido e pressione Enter. Na Home/Hoje, a tarefa recebe a data atual. Nas outras visualizações, ela nasce sem data.
- Clique no título para abrir o editor lateral. Apenas o título é obrigatório. Salve e reabra para adicionar subtarefas; as alterações de subtarefas são persistidas individualmente.
- **Ctrl + Espaço**, com a janela ativa, abre o Quick Add. Ele sugere tarefa, pensamento, passos, peso ou transação, pede confirmação dos dados reconhecidos e envia texto ambíguo ao Inbox. Prefixos opcionais incluem `/t`, `/pensamento`, `/passos`, `/peso`, `/gasto` e `/receita`. Esc fecha. O Inbox continua disponível.
- **Ctrl + K** abre a busca global local. Resultados de tarefas, projetos, Inbox, hábitos, rotinas, pensamentos, treinos, alimentos, refeições, dietas e finanças ficam agrupados e limitados; setas, Enter e Escape funcionam no diálogo. Com valores financeiros ocultos, a busca usa rótulos genéricos para resultados financeiros.
- **Próximas** mostra recorrências de 30 dias e todas as tarefas avulsas futuras, agrupadas por data. **Todas** inclui pendentes sem data e séries encerradas para edição. **Concluídas** mostra o histórico.
- O checkbox de tarefas recorrentes futuras fica indisponível até o dia da ocorrência. Tarefas avulsas podem ser concluídas antecipadamente.
- Excluir tarefa pede confirmação e oferece desfazer. Tarefas e capturas são arquivadas, preservando seus dados. Subtarefas são excluídas após confirmação.
- Claro, Escuro e Sistema persistem no SQLite. Sistema acompanha alterações do sistema operacional enquanto o aplicativo está aberto.

## Banco local

O plugin resolve `sqlite:rumo.db` relativo ao diretório de configuração do aplicativo. No Windows:

```text
%APPDATA%\com.rumo.desktop\rumo.db
```

É a fonte de verdade. Na primeira abertura, o RUMO pergunta como chamar você e não insere dados de demonstração. Para criar um backup consistente, use **Configurações → Dados → Criar backup agora**; o SQLite produz um snapshot mesmo com WAL ativo. O ZIP contém `rumo.db`, `manifest.json` e os anexos referenciados, com versão do aplicativo, versão do schema, data e hashes SHA-256. O restore valida banco e anexos antes de substituir dados, cria um backup preventivo e reinicia o aplicativo para aplicar migrations antigas. Backups automáticos podem ficar desligados ou ocorrer diariamente/semanalmente, com retenção configurável; backups manuais não entram nessa limpeza. A seção Dados também executa `PRAGMA integrity_check` sob demanda. Guarde ZIPs e exportações em local seguro: contêm dados pessoais sem criptografia.

Não altere o identificador `com.rumo.desktop` em releases, pois ele define a localização dos dados. A desinstalação NSIS oferece uma opção explícita para excluir os dados; deixe-a desmarcada para preservar o banco em `%APPDATA%`.

Tabelas da migration `0001_foundation.sql`:

| Tabela                | Responsabilidade                                                      |
| --------------------- | --------------------------------------------------------------------- |
| `settings`            | Nome, tema e timestamps                                               |
| `tasks`               | Dados, prazo, prioridade, regra recorrente, arquivo e origem no Inbox |
| `subtasks`            | Definições ordenadas e conclusão avulsa                               |
| `task_completions`    | Conclusão única por tarefa e data de ocorrência                       |
| `subtask_completions` | Conclusão única por subtarefa e data de ocorrência                    |
| `inbox_items`         | Captura, estado e rastreabilidade de processamento                    |

Há índices por prazo/status, recorrência, subtarefas, Inbox e ocorrências. Chaves estrangeiras são ativadas por padrão pelo SQLx usado no plugin. Textos são passados como parâmetros, nunca concatenados em SQL.

### Atomicidade e exclusão

A conversão Inbox → Task usa um `INSERT ... SELECT` condicional com `source_inbox_id UNIQUE`. Um trigger processa o item na mesma transação implícita do INSERT. Falhar em qualquer etapa reverte ambas. Cliques repetidos retornam a mesma tarefa. Capturas com mais de 500 caracteres preservam o conteúdo completo na descrição e usam os primeiros 500 como título. A origem permanece armazenada.

Não usamos `BEGIN` e `COMMIT` separados pelo frontend: o plugin trabalha com um pool e chamadas distintas não garantem a mesma conexão. Cada operação de escrita é um statement atômico. A UI serializa mutações, confirma persistência antes do sucesso e desfaz o checkbox otimista em erro. Se a escrita for confirmada, mas a leitura posterior falhar, o aviso diferencia esse estado e orienta recarregar.

Arquivar uma tarefa também oculta seu histórico e subtarefas, sem apagá-los. Desfazer restaura tudo. O Inbox convertido fica como processado mesmo se a tarefa for arquivada, evitando conversão duplicada posterior.

## Datas e recorrência

Helpers centralizados em `src/lib/dates`. Datas civis usam `YYYY-MM-DD`, horários opcionais usam `HH:mm`, timestamps de auditoria usam ISO 8601 UTC. A UI usa pt-BR, semana começando na segunda e timezone local. A data local não é calculada cortando um timestamp UTC. O relógio atualiza em até 15 segundos e também ao retomar o foco.

Uma série ocupa uma linha em `tasks`, com regra JSON. Não criamos centenas de tarefas. O domínio calcula as ocorrências:

- Diária: todos os dias a partir do início.
- Semanal: mesmo dia da semana do início.
- Dias específicos: conjunto explícito de dias, `0=domingo` até `6=sábado`.
- Mensal: dia do início; em meses curtos usa o último dia e volta ao dia original no mês seguinte.
- Término opcional inclusivo.

Somente tarefas avulsas pendentes entram em Atrasadas. Ocorrências recorrentes perdidas não acumulam débito. Marcar hoje grava `(task_id, occurrence_date)` e não encerra a série. Subtarefas recorrentes seguem a mesma independência por dia; concluir todas não conclui a tarefa principal. Mudanças de regra afetam a série e preservam conclusões já registradas, inclusive no histórico se a regra for removida. A descrição e o título no histórico refletem a definição atual da tarefa, não uma cópia antiga do texto.

## Migrations

As migrations ficam em `src-tauri/migrations/` e são registradas em `src-tauri/src/lib.rs` com versão inteira crescente e `MigrationKind::Up`. O primeiro `Database.load()` aplica as migrations pelo plugin antes da leitura de dados, permitindo exibir falhas no frontend. Nenhum componente cria tabelas. O SQLx registra versões/checksums em `_sqlx_migrations` e aplica migrations transacionalmente. Consulte a [documentação do plugin SQL](https://v2.tauri.app/plugin/sql/).

Para evoluir o schema:

1. Crie uma migration com o próximo número disponível, preservando dados existentes.
2. Registre a nova `Migration` com versão crescente e `include_str!` no Rust.
3. Atualize os testes para aplicar a sequência e validar atualização de um banco com dados anteriores.
4. Execute testes e build desktop. Nunca reescreva uma migration já distribuída nem apague o banco para esconder problemas.

As migrations são `0001_foundation.sql` a `0012_exercise_library.sql`. A `0008_release.sql` adiciona `backup_preferences`; a `0009_body_progress.sql` cria o progresso corporal compartilhado e migra o peso antigo. As versões 0010/0011 acrescentam planejamento, energia e passos do treino; a 0012 amplia a biblioteca local e seus metadados. Nenhuma migration anterior foi alterada. Um backup de schema antigo suportado é migrado após o reinício provocado pelo restore. Um backup com schema futuro é rejeitado antes de alterar o banco atual.

## Arquitetura

```text
src/
  app/                 composição, navegação e atalhos
  components/          diálogo acessível, captura inline e estados vazios
  features/
    home/              visão do dia
    tasks/             domínio puro, listas, editor e subtarefas
    inbox/             captura e processamento
    projects/          projetos, seções e tarefas associadas
    habits/            registros por data e consistência
    routines/          sequências e execuções independentes
    thoughts/          editor, autosave e conversões
    calendar/          agregação mensal das entidades reais
    workouts/          planos, biblioteca, sessões, séries e evolução
    body-progress/     peso e medidas compartilhados entre treinos e alimentação
    energy/            perfil geral, atividade e estimativas compartilhadas
    nutrition/         TACO, refeições, dieta, diário, peso e compras
    finance/           contas, ledger, OFX, planos, objetivos e patrimônio
    search/            consulta local agrupada e navegação (Ctrl+K)
    settings/          perfil, aparência, dados, privacidade e Sobre
  hooks/               coordenação de persistência, relógio e tema
  lib/database/        contrato SQL e conexão Tauri
  lib/dates/           datas civis e apresentação pt-BR
  services/            repositório SQL parametrizado
  types/               modelos e contratos
  styles/              tokens e componentes CSS
src-tauri/
  src/                 entrada desktop, backup/restore e registro de migrations
  migrations/          schema versionado
  capabilities/        permissões locais da janela
tests/                 regras, banco real e componentes
scripts/               validação do executável
```

SQL não entra em componentes. O repositório concentra persistência; o domínio calcula recorrência e visualizações sem depender de React ou Tauri. O hook coordena mutações e erro, sem substituir o SQLite como fonte de verdade. O diálogo nativo contém o foco e restaura o elemento anterior; controles têm labels, foco visível e teclado. A janela tem mínimo de 900×620 e layout desktop.

## Organização pessoal

- **Projetos:** descrição, datas, estados, seções ordenadas e tarefas reais. Progresso e próxima ação são calculados; concluir com pendências requer confirmação. Excluir mantém tarefas sem projeto por padrão; a opção de apagá-las é explícita e atômica.
- **Hábitos:** diário, dias selecionados ou meta semanal; registro booleano ou quantitativo com unidade livre. Histórico editável por data e resumo de semana/30 dias consideram os dias elegíveis. O projeto é opcional.
- **Rotinas:** sequência ordenada, frequência e horário opcional. Cada data tem execução independente; itens podem ser marcados/desmarcados e a ocorrência concluída/reaberta. A seleção de data acessa execuções anteriores.
- **Pensamentos:** título opcional, texto longo, Markdown simples com prévia segura e busca local em título/conteúdo. Autosave de 700 ms, fila serial e estado Salvo somente após confirmação SQLite. Trocar de página ou fechar normalmente a janela aguarda o flush; falhas mantêm o aplicativo aberto para nova tentativa. Encerramento forçado do processo não permite aguardar gravação pendente.
- **Calendário:** mês começando segunda, dois rótulos por célula e painel do dia. Agrega tarefas/recorrências, hábitos, rotinas e prazos de projetos sem tabela de eventos duplicados. Editar uma tarefa atualiza o período aberto; retornar após editar um projeto consulta novamente os dados.
- **Inbox:** conversões para tarefa, projeto ou pensamento processam a captura no mesmo statement, com proteção contra repetição. Pensamentos também viram tarefa, projeto ou captura sem apagar o original.
- **Início:** tarefas continuam em destaque, seguidas de hábitos/rotinas elegíveis, próximos prazos e até três projetos ativos.

### Migration 0002

`0002_organization.sql` adiciona `projects`, `project_sections`, `habits`, `habit_entries`, `routines`, `routine_items`, `routine_occurrences`, `routine_item_completions` e `thoughts`. A migration 0001 permanece intacta.

Tasks têm `project_id` e `project_section_id` opcionais; triggers impedem seções de outro projeto. Excluir seção desvincula somente a seção. Excluir projeto desvincula tarefas e hábitos, salvo escolha explícita de excluir também tarefas. Entradas de hábito são únicas por hábito/data, ocorrências por rotina/data e marcações por ocorrência/item. FKs e índices cobrem relações e consultas por intervalo. Origens de conversão são únicas para idempotência. Exclusões compostas usam triggers atômicos, sem transações fragmentadas pelo pool.

### Carregamento e validação

Histórico de hábitos é limitado ao resumo recente; o editor consulta 30 dias até a data escolhida e somente daquele hábito. Rotinas consultam a ocorrência da data/rotina selecionada. Conclusões de tarefas no snapshot inicial ficam em hoje ±30 dias; a aba Concluídas solicita o histórico completo e subtarefas antigas são consultadas pontualmente. Definições de tarefas mantêm o fluxo da Fase 1. O calendário busca registros do intervalo visível de 42 dias. Pensamentos listam apenas resumos dos 100 mais recentes; textos completos são carregados ao abrir, e a busca inclui registros mais antigos.

Os **77 testes das Fases 1 e 2** permanecem na suíte. Os testes da Fase 3 cobrem banco real, upgrade, agenda, sessão retomável, métricas, fila de gravação e interface. Evidências e resultados finais estão em `VALIDATION.md`.

Os scripts `phase2-smoke.mjs` e `phase2-details.mjs` exigem o identificador **com.rumo.validation.phase2** antes de operar. Use uma configuração Tauri de teste com esse identificador e WebView2 com depuração local na porta 9223. Nunca use o banco pessoal para esses scripts. `seed` começa somente com tabelas vazias; `verify` verifica a primeira reabertura; `details` verifica relações/conversões/calendário; `visual` captura os detalhes; `close` solicita fechamento nativo e compara o banco; `reopened` compara todas as tabelas após reinício. `reset` apaga exclusivamente dados do perfil de teste identificado. Os cenários de calendário usam setembro/outubro de 2026. Artefatos de evidência ficam em `artifacts/phase2/`, ignorados pelo Git.

## Treinos — Fase 3

- **Biblioteca:** exercícios locais e personalizados com busca, filtros, equipamento, grupo muscular, notas e arquivamento. Arquivar preserva as sessões antigas e retira o exercício dos novos snapshots.
- **Planos:** vários planos, um ativo para Início e Calendário. Dias têm nome, ordem e dia da semana opcional. Cada exercício do dia define séries, faixa de repetições, descanso e notas. Planos arquivados continuam consultáveis em modo de leitura; suas sessões preservam nomes e exercícios da época.
- **Sessões:** iniciar cria a sessão e o snapshot de exercícios/séries num único statement SQLite. Somente uma sessão pode ficar em andamento. Cargas, repetições, tipo, conclusão e notas são salvos durante a edição por fila serial com debounce; navegação e fechamento normal aguardam gravações pendentes. Uma falha mantém o rascunho visível e oferece retry. O treino pode ser retomado, concluído parcialmente, descartado ou corrigido no histórico. Copiar o treino anterior preenche apenas séries ainda abertas, sem marcá-las como feitas.
- **Cargas:** `total`, `per_side`, `per_dumbbell`, `bodyweight` (peso corporal, com carga adicional opcional) e `none`. A interface aceita `27,5` e `27.5` como 27,5; o valor mantém seu tipo. `30 kg/lado` não vira automaticamente 60 kg total.
- **Marcas e volume:** maior carga, maior número de repetições por carga e maior volume registrado por sessão são derivados de séries concluídas em sessões concluídas, por exercício e tipo de carga. Aquecimento, séries abertas e sessões descartadas não entram. Volume registrado é **valor informado × repetições** para `total`, `per_side` e `per_dumbbell`, sem dobrar lado/halter nem afirmar peso físico total. Peso corporal e sem carga não recebem volume numérico de carga. Corrigir/excluir série ou sessão recalcula marcas e gráfico; e1RM não foi implementado.
- **Integrações:** vincular um hábito booleano ao plano registra a entrada elegível apenas ao concluir uma sessão, sem duplicá-la e preservando conclusão manual. Início consulta apenas agenda do dia e sessão aberta. Calendário deriva treino planejado do plano ativo e mostra sessões realizadas, sem tabela de eventos duplicada. Histórico tem páginas de 30 sessões; Evolução consulta apenas o exercício e período selecionados (30, 90 ou 365 dias).

A migration `0003_workouts.sql` adiciona `exercises`, `workout_plans`, `workout_days`, `workout_day_exercises`, `workout_sessions`, `workout_session_exercises` (snapshot) e `workout_sets`, além da origem opcional da entrada de hábito. Migrations 0001/0002 não foram alteradas. O upgrade de banco preenchido da Fase 2 e a reabertura de sessão estão cobertos por testes.

Para smoke tests, use somente uma configuração Tauri com identificador **com.rumo.validation.phase3**. `scripts/phase3-smoke.mjs`, `phase3-audit.mjs` e `phase3-finalize.mjs` verificam esse identificador antes de ler ou alterar dados; relatórios e capturas ficam em `artifacts/phase3/` (ignorado pelo Git). Nunca execute esses scripts no perfil pessoal. Smart App Control permanece ativo; assinatura de código está prevista para Fase 6/release.

## Alimentação — Fase 4

- **Alimentos:** catálogo local da TACO 4ª edição com 597 alimentos, busca por nome/fonte e detalhe nutricional. Alimentos personalizados podem ser criados, editados e arquivados. A fonte (`taco` ou `custom`) e o ID original ficam separados do ID interno; um importador TBCA poderá adicionar outra fonte sem alterar refeições e diário.
- **Refeições e dieta:** refeições reutilizáveis contêm itens e gramagem equivalente explícita. A dieta organiza refeições por dia da semana, calcula calorias, macros e micronutrientes do dia e permite manter uma única dieta ativa. A lista de compras deriva dos sete dias planejados e consolida por alimento em gramas; não cria uma cópia desatualizada.
- **Diário:** registra o consumo real por data e refeição, inclusive cópia de uma refeição da dieta ativa naquele dia. Cada entrada guarda um snapshot dos nutrientes proporcionais para preservar o histórico se um alimento personalizado for editado depois. O histórico consulta apenas o intervalo solicitado.
- **Metas, peso e Início:** metas diárias opcionais para energia, carboidratos, proteínas e gorduras. O resumo mostra consumido, meta e diferença, sem julgamento. A aba Progresso mostra o peso compartilhado com Treinos, com histórico, correção e gráfico. O Início consulta só os totais do dia e metas; Tasks mantêm prioridade. Calendário e Hábitos não criam registros alimentares automáticos nesta fase.

`0004_nutrition.sql` cria `food_sources`, `foods`, `food_nutrients`, `meals`, `meal_items`, `diet_plans`, `diet_meals`, `food_diary_entries`, `nutrition_goals` e `body_weight_entries`. `0005_nutrition_units.sql` adiciona a gramagem equivalente da base sem alterar o checksum da 0004. Chaves estrangeiras, checks, índices e triggers mantêm integridade e a atualização dos nutrientes de alimentos personalizados atômica. As migrations anteriores permanecem intactas. O seed da TACO é parte da 0004: aplica uma vez por banco, sem API externa nem duplicação na inicialização. `scripts/import-taco.py <caminho-da-planilha.xlsx>` documenta a conversão do arquivo fornecido, com `openpyxl`; o original é somente leitura. Depois de distribuir uma migration, não a regenere in-place: crie uma nova versão para atualizar a base.

Os valores da TACO são por **100 g de parte comestível**. Calorias e nutrientes de item = valor da base × gramas consumidas / gramas equivalentes da base. Para `ml`, unidade, colher, xícara e porção, o usuário informa a gramagem equivalente tanto na definição de alimento personalizado quanto no item consumido; o RUMO não adivinha densidade ou porção. `Tr` é preservado como traço sem valor numérico; `NA`/campos vazios ficam ausentes e aparecem como `—`, não como medição zero. A planilha fornecida tem energia, macros, fibras e vários minerais/vitaminas, mas não traz B12, folato, D e E na tabela principal; esses campos ficam disponíveis para fontes futuras ou alimentos personalizados. Valores agregados usam somente nutrientes presentes. O importador `scripts/import-taco.py` mapeia colunas para chaves estáveis, isolando o formato da planilha do restante do domínio.

O smoke `scripts/phase4-smoke.mjs` exige o identificador **com.rumo.validation.phase4** antes de qualquer escrita. Use `tauri dev` com configuração isolada e WebView2 na porta local 9224; nunca execute com o perfil pessoal. Capturas e relatórios ficam em `artifacts/phase4/`, ignorado pelo Git.

## Finanças — Fase 5

- **Contas e transações:** contas BRL com saldo inicial, receitas, despesas e transferências. Valores são `INTEGER` em centavos; as datas civis não passam por conversão UTC. Uma transferência debita uma conta e credita outra sem contar como receita/despesa. Compra no cartão é despesa; pagamento da fatura é transferência para o cartão. Saldos são derivados do saldo inicial e do ledger, inclusive no patrimônio.
- **Categorias e OFX:** categorias editáveis e regras `contains`/`exact` por descrição normalizada. Importação local de OFX 1.x SGML e 2.x XML, com prévia e escolha explícita para possíveis duplicatas sem FITID. Hash do arquivo evita reimportar o mesmo lote; FITID é único por conta/fonte. O lote e as transações entram em um único statement SQLite com trigger, revertido integralmente se qualquer linha falhar. O conteúdo bruto não é persistido; apenas campos normalizados necessários ficam no ledger. XML com DTD/entidades é rejeitado.
- **Planejamento:** receita, despesas e aportes planejados por mês ficam separados do realizado. Orçamentos por categoria mostram planejado/realizado. Recorrências e assinaturas são previsões; registrar como realizado é uma ação explícita e idempotente por recorrência/data. Disponível realizado = receitas − despesas − aportes registrados no mês; disponível planejado usa os três valores do plano. Nenhum desses totais é sinônimo de patrimônio líquido.
- **Objetivos e patrimônio:** valor real de objetivo = inicial + histórico de aportes; rendimento projetado nunca é lançado no saldo real. A projeção converte taxa anual para mensal por `(1 + taxa)^(1/12) − 1`, arredonda rendimento em centavos a cada mês e adiciona o aporte **ao fim** do mês, até atingir a meta ou o limite de 600 meses. É uma estimativa matemática com premissas informadas pelo usuário, não recomendação de investimento. Patrimônio líquido = saldo das contas (cartões podem ser negativos) + últimas avaliações de ativos manuais − últimas avaliações de passivos manuais. Avaliações anteriores permanecem no histórico.
- **Privacidade e desempenho:** ocultar valores persiste no SQLite; o Início consulta apenas o resumo do mês e mostra uma seção compacta quando há dados. Transações usam filtros SQL e páginas de 50; histórico patrimonial de 12 meses é carregado sob demanda. Não há login bancário, scraping, envio de OFX, credenciais ou telemetria.

`0006_finance.sql` cria contas, categorias, regras, transações, lotes OFX, planos mensais, orçamentos, recorrências, objetivos/aportes, bens/avaliações e preferência visual. `0007_finance_integrity.sql` acrescenta origem OFX e vínculo de recorrência, índices únicos e triggers de integridade sem alterar o checksum da 0006 já aplicada em bancos de validação. As migrations 0001–0005 permanecem intactas. `scripts/phase5-smoke.mjs` exige o identificador **com.rumo.validation.phase5** antes de qualquer escrita e usa OFX sintético em perfil separado; a porta CDP local de validação é 9225. Evidências ficam em `artifacts/phase5/`, ignorado pelo Git.

## Refinamento de interface e progresso corporal

Treinos → **Progresso corporal** reúne peso, percentual de gordura e medidas de pescoço, ombros, peito, cintura, abdômen, quadril, braços, antebraços, coxas e panturrilhas, com lados separados. Aceita decimais com vírgula ou ponto, gráfico por métrica e comparação entre datas; variações são descritivas. A evolução de cargas permanece no detalhe de cada exercício da Biblioteca. Alimentação → **Progresso** usa o mesmo peso e oferece atalho para as medidas completas. Não há duas fontes de verdade nem cópia entre módulos.

`0009_body_progress.sql` acrescenta `body_measurement_records` e `body_measurement_values`. A migração escolhe o peso mais recentemente editado de cada data de `body_weight_entries`, preserva todos os registros legados para auditoria e não faz gravação dupla. Um registro por data recebe alterações parciais de métricas de forma atômica; editar o peso na Alimentação mantém as medidas do mesmo dia. Os dados continuam exclusivamente no SQLite local. A interface mantém os tokens, temas e navegação existentes, com largura útil maior, cabeçalhos mais compactos e estados vazios mais orientativos.

## Validação da release 1.0.0

A release histórica **1.0.0** usou schema **9**, com 160 testes frontend/banco e quatro testes nativos de backup. `RELEASE_NOTES.md` resume as capacidades; `VALIDATION.md` registra evidências, hashes e limites de distribuição. Os scripts `phase6-*` exigem o identifier `com.rumo.validation.phase6`; instalação, upgrade, restore e fechamento foram exercitados apenas nesse perfil. O cenário de upgrade usou um pacote de teste 0.1.0 e um banco sintético schema 8; não é um executável histórico arquivado. Exportação CSV não faz parte da release; backup completo é o mecanismo de proteção dos dados.

## Planejamento e balanço energético (1.1.0)

O plano de treino usa os exercícios e sessões já existentes. Em **Treinos → Plano**, crie um plano, monte e ordene a divisão, atribua a cada treino zero ou mais dias da semana e configure exercícios, séries, faixa de repetições, descanso e energia planejada. Dia sem treino fixo pode ser iniciado manualmente; dia da semana sem treino é descanso. Somente o plano ativo alimenta Hoje, Home e Calendário. A migration aditiva `0010_planning_energy.sql` preserva os weekdays anteriores e mantém sessões históricas separadas do plano atual.

**Configurações → Perfil** reúne nome, data de nascimento, altura, parâmetro biológico usado pela fórmula, peso atual e objetivo corporal. Salvar peso nesse formulário grava diretamente em Progresso corporal; medições posteriores em Treinos ou Alimentação atualizam o mesmo dado e os cálculos. No primeiro uso, o nome é solicitado e o usuário é conduzido ao Perfil. **Treinos → Progresso corporal** registra passos por data; médias de 7 e 30 dias usam apenas registros reais. Sem histórico suficiente, a referência inicial é 5.000 passos; após três dias registrados, a referência passa a ser a média móvel dos 30 dias anteriores, sem configuração manual.

O domínio compartilhado calcula **TMB estimada** por Mifflin-St Jeor: `10 × peso_kg + 6,25 × altura_cm − 5 × idade + 5` para parâmetro masculino, ou `− 161` para feminino. A idade é derivada da data de nascimento em cada dia. A fórmula foi publicada por [Mifflin et al. (1990)](https://pubmed.ncbi.nlm.nih.gov/2305711/); não equivale a medida laboratorial. A rotina cotidiana usa fator conservador 1,2, que inclui uma referência de 5.000 passos e exclui treino estruturado. A diferença entre passos reais (ou média observada) e referência é convertida em uma **aproximação** com caminhada a 3 MET e cadência de 100 passos/min, subtraindo a energia de repouso já contada. Essa cadência é uma [heurística de caminhada moderada](https://pubmed.ncbi.nlm.nih.gov/28459099/), não uma medição da velocidade de cada passo. Se houver treino concluído e não for possível separar passos do treino no total, o ajuste de passos é omitido para evitar dupla contagem; o usuário pode informar essa parcela opcionalmente. A migration `0011_activity_overlap.sql` preserva o total de passos e armazena a parcela incluída em treino.

Treinos concluídos recebem estimativa automática por duração real e peso, usando `(MET − 1) × 3,5 × peso_kg / 200 × minutos`; **3,5 MET** representa musculação geral no [Compendium of Physical Activities 2024](https://pacompendium.com/conditioning-exercise/). A duração é limitada a 240 minutos nessa estimativa automática para evitar registros abertos por engano produzirem valores extremos. O usuário pode desligar, informar valor manual ou escolher 6 MET em ajuste avançado. O valor manual representa energia **adicional** ao repouso. Para projeção de treino futuro, o RUMO estima duração pelo número de séries e descansos configurados, com mínimo de 30 minutos; isso não entra no balanço realizado. Sessões continuam com snapshot histórico de exercícios.

O usuário escolhe perder, manter ou ganhar peso; o RUMO calcula **meta estimada** inicial a partir do gasto e diferença conservadora de 250 kcal/dia para perda/ganho, que pode ser ajustada nas opções avançadas. Isso não é prescrição. **Alimentação → Hoje** mostra meta, ingestão registrada, restante, detalhes “Como foi calculado?” e balanço `consumo − gasto estimado`. A semana soma somente dias transcorridos com ingestão e distingue passos estimados dos registrados. O balanço não é convertido em perda de peso. Metas antigas de macros permanecem disponíveis; o cálculo opcional por percentuais ou g/kg usa 4/4/9 kcal/g.

O **Calendário** oferece filtros persistentes para tarefas, projetos, hábitos, rotinas e treinos. Hábitos e rotinas também têm controle individual “Mostrar no calendário”. Preferências ausentes mantêm a visibilidade anterior; ocultar não altera Home, recorrência, histórico ou a entidade. Não foi criada fonte de Alimentação sem evento temporal útil.

`0012_exercise_library.sql` amplia o catálogo local de 14 para **236 exercícios** em grupos/equipamentos variados, com aliases, músculos secundários e padrão de movimento opcionais. IDs estáveis e `INSERT OR IGNORE` preservam exercícios customizados e evitam duplicação no upgrade; a Biblioteca carrega sob demanda, com lotes de 80. Os testes 1.1 usam o identificador separado `com.rumo.validation.v110`; `scripts/v110-smoke.mjs` o confere antes de ler ou escrever. As evidências ficam em `artifacts/v110/`, ignorado pelo Git. Não use esses scripts no perfil pessoal. A versão 1.1 usou schema **12**; a release 1.0.0 permanece descrita acima como histórico.

## Continuidade semanal (1.2.0)

**Início → Revisão Semanal** agrega a semana de segunda a domingo, com navegação para semanas anteriores. Ela lê tarefas e projetos, ocorrências elegíveis de hábitos e rotinas, treinos concluídos e programados, passos, peso, diário alimentar, balanço energético, finanças e compromissos da próxima semana. Os valores financeiros obedecem a “Ocultar valores”. Dias futuros não são tratados como falha; uma nota pessoal opcional é a única informação salva pela revisão. As consultas têm intervalo limitado à semana e históricos extensos não são carregados na Home.

**Templates** podem ser salvos a partir de tarefas, projetos, rotinas, planos de treino e refeições. A galeria fica em Configurações e é carregada ao abrir. Aplicar um template cria registros independentes, com itens/seções próprios; editar ou excluir o template não modifica cópias já criadas. Refeições também podem ser aplicadas diretamente ao diário. O conteúdo possui formato JSON versionado e validado, mas tarefas, treinos e refeições reais continuam em tabelas próprias. A aplicação de estruturas com vários registros usa um único statement SQLite com trigger, de modo que falhas revertem a criação parcial.

**Configurações → Notificações** permite ativar, por categoria, lembretes locais de tarefas com horário, rotinas, treinos, contas previstas, passos, peso e revisão semanal. Tudo começa desligado; conteúdo sensível fica oculto por padrão, e valores financeiros não entram no texto. O agendador verifica vencimentos uma vez por minuto enquanto o RUMO está aberto e registra uma chave única para impedir entrega duplicada. É necessário permitir notificações no Windows. **Não há serviço em segundo plano:** com o aplicativo totalmente fechado, esses lembretes não são disparados nem recuperados depois do horário. O clique na notificação não promete abrir um registro específico no desktop; abra o módulo pelo RUMO.

**Quick Add** usa parsing local de datas e números pt-BR, sem IA ou rede. Ele cria tarefas, pensamentos, passos e peso nas entidades já existentes. Uma sugestão financeira exige confirmação do tipo e da conta antes de gravar. Se a interpretação não for clara, a captura vai para o Inbox. **Ctrl + K** continua reservado à busca global.

`0013_continuity.sql` adiciona templates e aplicações, preferências e entregas de notificações, notas semanais e antecedência opcional em tarefas. É aditiva sobre as migrations 0001–0012; a versão 1.2 usou schema **13**. Os testes e smoke da versão 1.2 usam somente perfil isolado `com.rumo.validation.v120`, nunca o banco pessoal.

## Objetivos e Timeline (1.3.0)

**Objetivos** reúne metas pessoais sem duplicar Tasks, Projects, Habits ou os demais registros. Um objetivo pode ter categoria, prazo, status, descrição, vínculos com múltiplas entidades e atualizações curtas. Seu progresso pode ser informado manualmente ou derivado de um Project, objetivo financeiro ou medida corporal existente. Concluir ou arquivar o objetivo não conclui nem apaga seus vínculos. A Home mostra até três objetivos ativos e a Revisão Semanal destaca atividade relacionada. Valores de progresso financeiro obedecem a “Ocultar valores”.

**Timeline** agrega acontecimentos das tabelas de origem: tarefas concluídas, projetos, hábitos, rotinas, treinos, medidas, passos, diário alimentar, finanças, objetivos e pensamentos. “Momentos” são notas pessoais criadas diretamente na Timeline. A tela consulta um período limitado, carrega 40 eventos por vez e permite filtrar por período, grupo, módulo, objetivo e texto. O modo privado, em Configurações → Privacidade, oculta detalhes sensíveis; a busca da Timeline também respeita essa ocultação. Ctrl + K encontra objetivos e títulos de momentos; Ctrl + Espaço aceita `/objetivo` e `/momento` no Quick Add. O Calendário pode exibir prazos de objetivos e respeita filtros globais/individuais.

`0014_objectives_timeline.sql` acrescenta `objectives`, `objective_links`, `objective_updates`, `timeline_notes` e a ação transacional de criar e vincular Task, Project ou Habit. Ela amplia as preferências do Calendário preservando linhas anteriores; eventos derivados da Timeline não são copiados para outra tabela. O schema atual é **14**. Testes e smoke usam apenas `com.rumo.validation.v130`; `artifacts/v130/` é ignorado pelo Git. Backups de schema antigo continuam migráveis após restore; o backup/restore nativo já reconhece schema 14.
