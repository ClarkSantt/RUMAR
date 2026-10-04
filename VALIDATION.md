# RUMO 1.6 — validação (01/10/2026)

**Implementação de aplicação concluída; validação nativa e empacotamento pendentes por Windows Application Control.** O banco pessoal não foi usado. O schema de teste passou de 19 para **24** pelas migrations aditivas `0020_attachments.sql`, `0021_data_imports.sql`, `0022_external_calendar_filters.sql`, `0023_import_conflicts.sql` e `0024_finance_csv_mapping.sql`; 0001–0019 não foram editadas. Em arquivo SQLite temporário, todas as linhas e colunas preexistentes do schema 19 permaneceram após o upgrade; `PRAGMA integrity_check = ok` e `foreign_key_check` retornou vazio. A migration de filtros acrescenta a fonte `external` sem ocultar eventos antigos.

Anexos de Projects, Thoughts, Objectives, Timeline Moments e Finance Transactions usam diretório gerenciado e caminho relativo. A metadata traz tipo permitido, tamanho e SHA-256. O backend valida vínculo, conteúdo básico, limite de 100 MB, caminho interno e hash ao abrir; a exclusão enfileira limpeza física. Testes de aplicação cobrem vínculo permitido, nomes repetidos, path traversal no metadata, exclusão e a fila. A verificação completa de hash e órfãos é sob demanda; a Central mostra tamanho estimado de banco, anexos e backups sem fazer hashing na abertura. A Busca Global encontra nomes de anexos, mas não pesquisa nomes de comprovantes quando valores financeiros estão ocultos, nem nomes de Momentos em modo privado.

O código nativo de backup usa snapshot consistente SQLite e inclui somente anexos referenciados, com tamanho/hash no manifest e limite total de 2 GB/10 mil arquivos. A validação do restore recusa entradas ZIP inesperadas, caminhos inseguros, tamanho/hash divergente, SQLite inválido e schema futuro antes da substituição. O restore cria backup preventivo; uma correção desta rodada troca apenas o diretório interno `attachments`, evitando nível extra, e informa separadamente falhas de recuperação de banco/arquivos. Backups anteriores ao schema 20 não exigem anexos. **Esses fluxos nativos novos ainda não puderam ser executados**; os testes Rust no código não são contados como aprovados.

Exportações testadas: CSV de Tasks, Finance, Workouts, Body Progress, passos, Nutrition e Objectives; CSV financeiro preserva centavos, acentos e aspas, e neutraliza fórmulas de planilha. Nutrition CSV expõe macros e micros em colunas legíveis, com ausentes em branco. JSON portátil `exportVersion: 1` preserva IDs/relações em grupos de domínio e metadata de anexos, sem bytes de arquivos nem tabelas internas temporárias. ICS inclui fontes visíveis do Calendar, deadlines, Time Blocks avulsos e ocorrências de blocos recorrentes no período selecionado (até um ano), com exclusões/movimentos resolvidos pelo Planner. Eventos de dia inteiro usam `VALUE=DATE`; horários são locais sem fuso inventado. JSON e CSV são para leitura fora do RUMO, não substituem o backup.

Importação testada em SQLite isolado: Finance CSV com mapeamento de data, descrição, valor, tipo, conta e categoria existentes; valores pt-BR, rollback de lote inválido, hash antirreimportação e aviso de duplicata provável sem descarte automático. A prévia separa linhas válidas/problemáticas; importar só as válidas exige confirmação. Body Progress CSV aplica métricas por data sem duplicar o dia; ICS preserva UID e cria evento externo, sem converter em Task. As políticas `ignorar`/`atualizar` conflitos são explícitas e testadas. Histórico persistente guarda nome do arquivo, tipo, horário e contagem, sem manter o payload JSON após processar.

Perfil sintético separado com **5.000 transações**: exportação Finance CSV **21,4 ms**, JSON portátil **16,1 ms** na rodada dirigida de 01/10. São tempos de consulta e serialização em SQLite local, não latência de pintura da UI. A tela inicial da Central não verifica hash dos arquivos; histórico de importação consulta somente os últimos 20 lotes. Nenhum benchmark de renderização nativa foi executado.

**Validação após bump 1.6.0:** `npx prettier --check .` aprovado; lint aprovado; TypeScript aprovado; **290/290 testes de aplicação em 41 arquivos**, preservando os 269 da 1.5 e adicionando 21; frontend production build aprovado (aviso informativo de chunk acima de 500 kB); `npm audit --audit-level=low`: **0 vulnerabilidades**; `git diff --check` aprovado; `node scripts/validate-files.mjs` cobriu **269 arquivos** rastreados/não rastreados. O repositório ainda não tem primeiro commit, então `git diff --check` isoladamente não cobre o código novo. Após o ajuste da prévia de importação, o smoke de **navegador** isolado (`scripts/v160-browser-smoke.mjs`) passou nas seis combinações de 1366×768/1920×1080/2560×1440 e claro/escuro, sem overflow horizontal nem erros de página. Abriu a Central, conferiu prévia financeira válida/inválida, bloqueio de importação parcial sem confirmação e navegação por Tab nos mapeamentos. As capturas claro/escuro de 1366×768 foram inspecionadas; a prévia agora usa colunas legíveis e os checkboxes têm rótulos alinhados. Evidência: `artifacts/v160/ui-b53ea731-e214-4722-a336-ac3e7d463252/report.json`. O harness usa SQLite temporário e um adaptador de IPC local, **não** testa comandos nativos. Não houve smoke nativo nem restart real nesta versão.

**Validação nativa e build:** `cargo check` havia parado na execução do build-script de `tauri-plugin-notification` por Windows Application Control, erro **4551**. Nesta rodada, `cargo fmt --all --check` também foi bloqueado ao iniciar `cargo-fmt` (4551). `npm run desktop:build` falhou antes de Rust/NSIS: Application Control impediu carregar `node_modules/@tauri-apps/cli-win32-x64-msvc/cli.win32-x64-msvc.node` (`ERR_DLOPEN_FAILED`). Logo, não há compilação Rust, testes nativos, smoke nativo, executável ou instalador **1.6.0** aprovados nesta rodada. O `src-tauri/target/release/rumo.exe` presente é de **29/09/2026, versão anterior**, e `RUMO_1.6.0_x64-setup.exe` está ausente; não se atribui hash 1.6 a arquivos antigos. Smart App Control permaneceu ativado, sem exceções ou bypass. A assinatura de código confiável continua tema de distribuição.

Pendência de validação: executar `cargo fmt`, compilação/testes Rust, build Tauri/NSIS, smoke de anexos/backup/restore/restart e auditoria visual em Windows que permita legitimamente executar os componentes nativos ou após assinatura confiável. O restore de anexos corrigido merece prioridade nesse smoke.

---

# RUMO 1.5 — validação (29/09/2026)

**Implementação concluída; validação nativa final pendente.** O bloqueio externo foi reproduzido pelo comando normal, sem alteração de política Windows. Resultados de navegador/SQLite não são apresentados como execução nativa.

## Aplicação e banco

- Suíte atual: **269 testes em 36 arquivos**, preservando os 225 da 1.4 e adicionando 44. Nenhum teste anterior foi removido ou enfraquecido. Rodada completa aprovada após os ajustes funcionais; conferência final após versionamento registrada abaixo.
- Migrations novas: `0017_automations_recurrence.sql`, `0018_objective_milestones_reviews.sql`, `0019_automation_milestone_events.sql`; schema final **19**. Migrations 0001–0016 permanecem intactas. A correção de eventos derivados ganhou 0019, preservando a 0018 já aplicada em validação.
- Tabelas: séries e exceções de blocos; regras, eventos, execuções, origens e fila de notificações de automações; marcos de objetivos; notas mensais. Focus possui referência opcional à série/ocorrência. Índices cobrem datas, ordenação, estado e identificação única das entregas. Preferências anteriores do Calendário são preservadas ao acrescentar a fonte de marcos.
- Testes de upgrade schema 16 → atual preservam dados e integridade; testes em SQLite real fechado/reaberto verificam regras, logs, séries, exceções, referências de Focus, marcos e nota mensal. `PRAGMA integrity_check` passou nos perfis de teste. O banco pessoal não foi usado.

## Comportamento e correções

Automações usam triggers e ações internas permitidas, configs validadas e SQL parametrizado. Efeito e registro único são atômicos; erros desfazem o efeito e produzem log técnico sem conteúdo pessoal. Há limite de encadeamento de três níveis. Horários usam data local; ocorrências perdidas são ignoradas por padrão, ou a última pendente é recuperada por escolha explícita. Prazos têm janela de recuperação de até 31 dias, sem executar antes da criação da regra. Não existe serviço Windows em segundo plano.

Foram corrigidos e testados: fila com mais de 100 notificações anteriormente entregues; condição de conclusão de Task recorrente; recuperação de prazo perdido antes do horário de hoje; seleção da última ocorrência recorrente já devida; recalculação de marco derivado após correção de aporte; valor financeiro pt-BR; atividade do objetivo contendo apenas marcos; gasto de treino automático na Revisão Mensal. Os schedulers de automações e notificações aguardam operações em andamento e permanecem suspensos durante backup/restore/fechamento, retomando em falha.

Recorrência expande somente o intervalo pedido, incluindo exceções movidas para dentro dele. Meses curtos são limitados ao último dia. Alterar uma ocorrência não muda a série; arquivar preserva histórico e Focus. Task, bloco e programação do plano de treino continuam conceitos separados. Marcos manuais mantêm data de conclusão em chamadas repetidas; derivados são calculados dos aportes atuais, sem concluir o objetivo automaticamente. Finance/private mode são respeitados na busca, nas revisões e nas integrações.

## Smoke em navegador e auditoria visual

`scripts/v150-browser-smoke.mjs` usa Edge e SQLite real em perfil temporário identificado `rumo.validation.v150.browser`. Um adaptador exclusivo do harness fornece IPC local; não é importado pelo produto e não executa comandos nativos de backup, restore ou janela. As tentativas iniciais corrigiram ordem de inicialização/middleware e seletores do harness, sem workaround no aplicativo.

Rodada final com código versionado: `artifacts/v150/ui-16b066d9-48d6-45a0-a9ce-40c9376f4076/report.json`. Sete cenários: criar regra semanal pela UI; marco financeiro R$ 10.000 com parsing e aporte; série Seg/Qua/Sex sem materialização futura; editar só uma ocorrência e confirmar exceção; processamento único e regra desativada; abrir Revisão Mensal e salvar nota; reabrir a página sem alterar registros. Tab/Shift+Tab permaneceram no editor e Escape fechou dialogs. Reabertura de página **não equivale a restart nativo**.

**54 combinações**: 1366×768, 1920×1080, 2560×1440 × claro/escuro × nove contextos (lista/formulário/log de automações, marcos, editor recorrente, Dia, Semana, escolha de escopo e Revisão Mensal). Nenhum overflow horizontal da página ou erro de página. Capturas examinadas confirmaram a correção de rolagem do formulário novo e de espaçamento do resumo mensal. O painel semanal pode rolar internamente. Evidências ficam em `artifacts/v150/`, ignorado pelo Git.

## Performance

Perfil SQLite sintético isolado: 5.000 Tasks, 1.000 blocos físicos, 500 séries, 200 objetivos, 1.000 marcos, 100 regras e 10.000 registros de execução, mais 29 dias de passos/Focus. Rodada dirigida sem suíte concorrente (`tests/v150-performance.test.ts`): Dia **21,63 ms**; Semana **36,93 ms**; expansão de dez dias **41,42 ms**; processamento de automações **66,41 ms**; Revisão Mensal **132,91 ms**; Objetivos **0,66 ms**; marcos **0,32 ms**; Timeline **3,72 ms**; Revisão Semanal **46,67 ms**. Resultados variam com carga da máquina; são consultas e lógica local, não tempo de pintura nativa. Nenhum novo benchmark de renderização nativa foi executado.

Históricos/revisões consultam o período; marcos e templates carregam no contexto, recorrência não cria todas as ocorrências futuras, scheduler verifica uma vez por minuto e claims únicos impedem duplicação. A biblioteca e o banco permanecem locais/offline.

## Compilação, execução nativa e backup/restore

Comando: `cargo test --manifest-path src-tauri/Cargo.toml`. Rust compilou no schema 19 e produziu `src-tauri/target/debug/deps/rumo_lib-3e03768cef790d38.exe`. O runner não conseguiu iniciar o processo: **“Uma política de Controle de Aplicativo bloqueou este arquivo. (os error 4551)”**, marcado `never executed`. O aviso do linker MSVC é distinto desse bloqueio.

```text
Native compilation: passed
Native tests: blocked after compilation; not executed
Native smoke: not executed for the final 1.5 build
Error: 4551
Smart App Control: remained enabled
No bypass attempted
```

O limite de schema do restore e o registro de migrations nativas foram atualizados para 19. Testes de aplicação cobrem persistência/upgrade; **backup/restore e encerramento/reabertura nativos com os novos registros não foram executados nesta rodada**. Evidências nativas de versões anteriores permanecem abaixo, sem serem reapresentadas como aprovação da 1.5. Pendência: executar testes nativos e smoke final de restart/backup/restore em Windows que permita legitimamente o binário ou após assinatura confiável.

## Validação final e artefatos

Versionamento consistente em package/lock, Cargo/lock, Tauri e fallback de Sobre: 1.5.0. Rodada final após versionamento:

| Check                             | Resultado                                            |
| --------------------------------- | ---------------------------------------------------- |
| `npx prettier --check .`          | aprovado                                             |
| `npm run lint`                    | aprovado, sem advertências                           |
| `npm run typecheck`               | aprovado                                             |
| `npm test`                        | 269/269, 36 arquivos; 225 anteriores + 44 novos      |
| `npm run build`                   | aprovado; aviso informativo de chunk acima de 500 kB |
| `npm audit --audit-level=low`     | zero vulnerabilidades                                |
| `node scripts/validate-files.mjs` | 249 arquivos de texto, incluindo não rastreados      |
| `git diff --check`                | aprovado                                             |

O repositório continua sem primeiro commit; o diff isolado não cobre arquivos não rastreados. Assinatura de código é pendência de distribuição; não foi utilizado certificado inseguro nem alterada proteção do Windows.

**Build final:** `npm run desktop:build` passou após a última alteração do produto e o bump 1.5.0. Frontend, compilação Rust release, executável x64 e empacotamento NSIS concluídos. O linker MSVC manteve seu aviso conhecido; não houve erro de compilação/empacotamento. Arquivos reais confirmados no filesystem e hashes calculados após o empacotamento:

| Artefato        | Caminho absoluto                                                                                     |      Bytes | Timestamp                  | SHA256                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------- | ---------: | -------------------------- | ------------------------------------------------------------------ |
| Executável      | `%USERPROFILE%\Documents\ChatGPT\Rumo\src-tauri\target\release\rumo.exe`                             | 13.490.176 | 2026-09-29 13:02:53 -03:00 | `DE430F97588C929FEDB0A24207218D5541DBED4AE25801D49F8BAEE2F5A087F9` |
| Instalador NSIS | `%USERPROFILE%\Documents\ChatGPT\Rumo\src-tauri\target\release\bundle\nsis\RUMO_1.5.0_x64-setup.exe` |  3.450.684 | 2026-09-29 13:02:53 -03:00 | `3E7F30631CAE84F35A9FAD7E0ECDFEFD41BB6F62E9E5B6911A27D11D8C36FEE0` |

Gerar o pacote **não equivale a executar os testes/smoke nativos**. Os artefatos permanecem sem assinatura confiável. Uma única pendência de validação: testes nativos e smoke final (restart e backup/restore dos novos registros) em ambiente Windows que permita execução legítima, ou após assinatura de código confiável. Nenhum defeito funcional bloqueante foi identificado nos testes de aplicação e na revisão independente.

---

# RUMO 1.4 — checkpoint de validação (29/09/2026)

**RUMO 1.4.0 implementation complete; release validation partially blocked by Windows Application Control.** Os metadados foram atualizados somente após aprovação dos testes de aplicação, migrations e da build Tauri/NSIS preliminar. A validação nativa final não está concluída.

## Banco e regressões

Migrations novas: `0015_daily_planner.sql` (blocos, sessões de foco, preferências e criação atômica Task/bloco) e `0016_focus_occurrence.sql` (data da ocorrência preservada na sessão). Migrations anteriores não foram alteradas. A suíte aplica ambas, valida integridade e cobre upgrade do schema 14, preservação de tabelas anteriores, prazo independente do agendamento, recuperação de foco e persistência em arquivo SQLite fechado/reaberto.

Foram corrigidos três problemas encontrados na revisão independente: conclusão de tarefa/subtarefas recorrentes na data errada durante Focus; erro de pausa sem feedback/retry; pedido de agendamento reapresentado ao retornar ao Calendário. Testes de componentes com SQLite real verificam essas correções. O redimensionamento também restaura a geometria em falha/cancelamento, e a navegação mensal respeita o atributo `hidden` apesar do CSS de botões existente.

## Resultados atuais

- **225/225 testes em 30 arquivos**, preservando os 206 anteriores e acrescentando 19.
- TypeScript, ESLint e frontend de produção passaram após as correções funcionais. O Vite mantém o aviso de chunk acima de 500 kB.
- `npm audit --audit-level=low`: zero vulnerabilidades.
- Validação integral: 227 arquivos de texto, incluindo não rastreados; `git diff --check` passou. O Git ainda não possui primeiro commit, portanto o diff isolado não cobre toda a árvore.
- Quatro testes nativos de backup/restore passaram na rodada com schema 15. Após registrar schema 16, a compilação dos testes terminou, mas o Windows bloqueou sua execução com erro 4551. Esse resultado **não equivale a testes nativos atuais aprovados**.

## Smoke, persistência e visual

Somente o perfil isolado `com.rumo.validation.v140` foi usado, sem tocar no banco pessoal. Na WebView2 real, Quick Add criou tarefa com duração e prazo nulo, além de bloco livre. Arrastar um bloco para outro dia, redimensionar e criar sobreposição produziram horários persistidos e colunas lado a lado. Focus foi pausado/retomado; fechamento nativo normal seguido de reabertura recuperou a sessão pausada com 48 segundos, sem contabilizar o intervalo offline; a sessão foi retomada e finalizada uma única vez. Backup/restore nativo no schema 15 preservou blocos, sessões, preferências, Tasks e Settings, com integridade confirmada.

A auditoria anterior às últimas correções cobriu 24 combinações de Dia/Semana útil/Semana/Mês, claro/escuro e 1366×768, 1920×1080, 2560×1440, sem overflow horizontal da página. Diálogos foram exercitados nas seis combinações de tema/resolução; ArrowDown/Enter, Tab e Escape foram verificados. Capturas e relatórios estão em `artifacts/v140/`, ignorados pelo Git. A confirmação visual nativa após as últimas correções ainda está pendente; não se declara auditoria final concluída.

## Desempenho e limites

Consultas de blocos são delimitadas por período; Home consulta o dia, Revisão consulta a semana. O teste sintético com 5.000 blocos verifica a consulta do período abaixo de 1.500 ms, sem carregar todo o histórico na Home. Focus usa checkpoints de cinco segundos; pausas e recuperação não creditam tempo offline. Planejamento não é tratado como tempo realizado. Lembretes reutilizam entrega única e privacidade existentes, começam desativados e exigem aplicativo aberto.

## Confirmação de execução nativa — 29/09/2026

Comando normal: `cargo test --manifest-path src-tauri/Cargo.toml`.

```text
Native execution blocked by Windows Application Control.
Compilation status: Finished test profile; test binary produced.
Execution status: Blocked; test process never executed.
Error: 4551 — Uma política de Controle de Aplicativo bloqueou este arquivo.
Stage: Running unittests src/lib.rs (target/debug/deps/rumo_lib-835ff4c6bf4718fc.exe).
Smart App Control: remained enabled.
No bypass attempted.
```

A rodada atual de aplicação passou novamente: 225 testes/30 arquivos, Prettier, lint, TypeScript, frontend production build, `npm audit` com zero vulnerabilidades, `git diff --check` e validação integral de 227 arquivos. Não houve mudança funcional nesta continuação. Não foi executado novo benchmark de renderização nativa. Smoke final, crash/recovery e backup/restore nativos no schema 16 continuam pendentes; as evidências anteriores acima são identificadas pelo estágio em que foram obtidas.

## Build de produção e empacotamento final 1.4.0

Depois do bump consistente em package/lockfile, Tauri, Rust/Cargo.lock e Sobre, foram repetidos em série Prettier, lint, TypeScript, **225/225 testes de aplicação**, frontend production build, `npm audit` (zero vulnerabilidades), `git diff --check`, validação integral (227 arquivos) e `cargo fmt --check`. Todos passaram. Nenhuma funcionalidade foi reimplementada nesta continuação.

`npm run desktop:build` terminou com código 0: `Finished release profile [optimized]` em 5 min 08 s, executável produzido e `makensis` gerou um bundle NSIS x64. Os únicos avisos foram o conhecido do linker MSVC e o chunk Vite acima de 500 kB. Compilação de produção e empacotamento estão aprovados; execução e smoke nativos finais **não** estão aprovados. Não foi feita nova tentativa de execução após o bloqueio reproduzível dos testes.

Artefatos finais, após o versionamento, confirmados no filesystem:

| Artefato        | Caminho absoluto                                                                                     |      Bytes | Timestamp                  | SHA256                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------- | ---------: | -------------------------- | ------------------------------------------------------------------ |
| Executável      | `%USERPROFILE%\Documents\ChatGPT\Rumo\src-tauri\target\release\rumo.exe`                             | 13.460.480 | 2026-09-29 01:26:02 -03:00 | `F224D2347790705D63FD45389B71C6F7B7D09369229EDACEA0CBFEE055CEFB4A` |
| Instalador NSIS | `%USERPROFILE%\Documents\ChatGPT\Rumo\src-tauri\target\release\bundle\nsis\RUMO_1.4.0_x64-setup.exe` |  3.435.174 | 2026-09-29 01:26:02 -03:00 | `CF8903F0E1E4D4AC4211002F39D99369C7D043CCCA6CE5021520A5040A68A412` |

Após essa build, somente documentação foi atualizada. Os binários permanecem sem assinatura de código confiável. Smart App Control permaneceu ativado; não houve bypass.

## Bloqueio externo e trabalho restante

Após a última recompilação funcional, `tauri dev` também recebeu erro 4551 do Controle de Aplicativo do Windows ao iniciar `rumo.exe`. A proteção permaneceu ativada; não houve alteração de política, renomeação de binário ou tentativa de contorno. A versão anterior do dev havia funcionado para os smoke tests acima. A compilação Tauri de produção e o empacotamento NSIS preliminar passaram, apesar do bloqueio da execução dos testes. A pendência é executar a validação nativa final em um ambiente Windows que permita executar o binário legitimamente, ou após assinatura de código confiável. Essa validação inclui smoke, recuperação, backup/restore e confirmação visual das últimas correções.

---

# Validação — Fase 2

Data: 27/09/2026. A Fase 1 permanece preservada, incluindo seus 27 testes originais. A validação funcional/visual da Fase 2 ocorreu na WebView2 real por `tauri dev`, com SQLite e perfil separado `com.rumo.validation.phase2`.

## Verificações finais

- Prettier check: passou.
- `npm run lint`: passou, sem avisos.
- `npm run typecheck`: passou.
- `npm test`: **77 testes em 10 arquivos, todos passaram**.
- `npm run build`: passou.
- `npm audit`: **zero vulnerabilidades**.
- `git diff --check`: passou.
- `npm run desktop:build`: passou; release x64 e instalador NSIS gerados em 27/09/2026 após as últimas correções. Compilação release: 3 min 47 s; instalador: 2,82 MiB.

O repositório começou vazio e os arquivos continuam não rastreados; `git diff --check` não substitui o check de formatação, também executado. Não foi criado commit. Bancos, arquivos auxiliares, `artifacts/` e `src-tauri/target/` estão ignorados.

## Cobertura e integridade

- Projects: CRUD, datas/estados, seções ordenadas, Tasks reais, progresso calculado, próxima ação, confirmação de pendências e exclusão atômica mantendo Tasks por padrão.
- Habits: diário, dias selecionados e meta semanal; booleano/quantitativo, desfazer, histórico, consistência por elegibilidade e projeto opcional.
- Routines: itens editáveis/ordenados, execução parcial/completa, reabertura e independência por data. Teste RTL cobre checkbox com conexão assíncrona.
- Thoughts: texto longo, título opcional, busca, arquivo, conversões idempotentes, debounce de 700 ms/fila, erro/retry e flush. Salvo só após confirmação SQLite.
- Calendar: quatro tipos de entidades, recorrências/horários/estados, atualização após edição e nenhuma tabela de eventos duplicados.
- Inbox: Task/Project/Thought, repetição, destinos concorrentes, conteúdo integral e rollback.
- Upgrade: arquivo SQLite com schema 0001 preenchido recebe 0002; comparação preserva Tasks, Subtasks, recorrência, conclusões, Inbox e Settings, inclusive após reabrir. FKs/constraints impedem seção de outro projeto e item de outra rotina.

As migrations `0001_foundation.sql` e `0002_organization.sql` permanecem registradas no Rust e nos testes. Nenhuma migration foi recriada na finalização.

## Smoke tests reais

- **Reset da Vida:** duas seções, seis Tasks, duas concluídas, progresso 2/6 e próxima ação.
- **Aprender guitarra:** Fundamentos/Músicas, quatro Tasks, hábito Seg/Qua/Sex de 30 min vinculado e visível no projeto. Registro histórico de 30 min; Home em dia elegível verificada com relógio de teste sem alterar Windows.
- **Rotina da noite:** cinco itens, três marcados; execução parcial preservada após reinício.
- **Pensamento longo:** navegação imediata, reabertura, nova edição, fechamento nativo e conteúdo integral preservado.
- **Calendar:** Task 28/09 → 30/09 e prazo do Project 30/09 → 05/10; data anterior removida, nova exibida sem reinício/reload geral.
- **Conversões:** Ctrl+Espaço; Inbox→Task/Project/Thought; Thought→Task/Project/Inbox repetidas sem duplicação e com original preservado.
- **Home:** Tasks, Habits elegíveis, Routines, próximos prazos e projetos ativos.

A recusa anterior da automação foi falha de revisão por limite de uso, não diagnóstico de ação insegura/bug. Na retomada, o script recusou corretamente o banco pessoal não vazio; os cenários passaram no perfil isolado.

## Persistência

Encerramento nativo confirmado e reabertura compararam **todas as tabelas iguais**: Projects, Sections, Tasks/Subtasks/conclusões, Habits/Entries, Routines/Items/Occurrences/Completions, Thoughts, Inbox e Settings. Inclui a última edição antes do fechamento. Evidência: `artifacts/phase2/restart-report.json`.

## Visual e teclado

**1366×768 e 1920×1080, claro/escuro:** Home, Projects lista/detalhe, Habits/histórico, Routine execução/editor, Thoughts editor/Markdown, Calendar/dia, Inbox, dialogs/drawers. Sem overflow horizontal relevante. Tab/Shift+Tab contêm foco; Escape fecha; captura rápida funciona. Estados vazios confirmados após limpeza dos registros isolados.

Regressão `scripts/visual-dev.mjs --phase2-profile`: **16 subtarefas longas**, rolagem interna, cabeçalho/rodapé fixos, ausência de overflow e atalhos passaram. Capturas/relatórios úteis em `artifacts/phase2/` e `artifacts/visual-dev/`, fora do Git. A confirmação final usou os mesmos arquivos frontend aprovados; não houve mudança funcional nesta finalização.

## Correções e performance

- Routine captura `checked` antes da espera assíncrona.
- Calendar reconsulta o período quando snapshot muda e ao retornar de outra página; Home atualiza progresso após Tasks.
- CSS global vem antes dos módulos para preservar ordem das camadas, botões e editor amplo.
- Habits consultam resumo recente; detalhe carrega somente hábito/período selecionado. Routines filtram data/rotina. Tasks carregam conclusões hoje ±30 dias; histórico antigo sob demanda em Concluídas e subtarefas por ocorrência. Calendar consulta 42 dias visíveis; Thoughts lista resumos e abre conteúdo integral sob demanda.

## Limpeza e distribuição

Perfil `%APPDATA%\com.rumo.validation.phase2` conferido e removido após encerrar processo. Banco pessoal `%APPDATA%\com.rumo.desktop\rumo.db` preservado. Configuração temporária e rascunhos de schema duplicados removidos. Scripts úteis mantidos, com verificação do identificador de teste e limpeza das referências de conversão antes de excluir registros.

Smart App Control permaneceu ativado. O executável de produção não possui assinatura de código confiável e pode ser bloqueado pelo Smart App Control. Isso é questão de distribuição/release, não bug funcional. Assinatura ficará para Fase 6/release. Não se afirma smoke bem-sucedido da produção não assinada: evidência funcional/visual final é `tauri dev`.

Artefatos:

- `src-tauri/target/release/rumo.exe`
- `src-tauri/target/release/bundle/nsis/RUMO_0.1.0_x64-setup.exe`

Desenvolvimento e release emitiram aviso `linker_messages` com mensagem de criação de biblioteca/objeto MSVC; não impediu compilação/execução.

**Fase 2 concluída. Nenhuma pendência bloqueante conhecida na Fase 2.** A Fase 3 não foi iniciada.

---

# Validação — Fase 3: Treinos

Data: 27/09/2026. A seção acima registra o checkpoint histórico da Fase 2; nesta entrega a Fase 3 foi implementada. Os 77 testes das Fases 1 e 2 continuam na suíte.

## Banco e cobertura

`0003_workouts.sql` foi adicionada sem modificar as migrations anteriores. Cria biblioteca de exercícios, planos, dias, exercícios planejados, sessões, snapshot de exercícios por sessão e séries. Chaves estrangeiras, índices, checks e triggers cobrem um único treino em andamento, início atômico com séries planejadas, preservação do histórico e entrada opcional de hábito com origem rastreável. O teste de upgrade aplica 0003 a um banco da Fase 2 preenchido e compara Tasks, Projects, Habits, Routines, Thoughts, Inbox e Settings; reabre também uma sessão em andamento com seus sets.

A suíte contém **124 testes em 16 arquivos**, incluindo os 77 anteriores. Cobertura nova: biblioteca/customização/arquivo, planos/dias/ordem, decimal pt-BR, `total`/`per_side`/`per_dumbbell`/`bodyweight`/`none`, séries e ciclo da sessão, cópia sem marcar como concluída, falha/retry/flush da fila, histórico, PRs, volume, hábito elegível e idempotente, agenda, planos arquivados em consulta e regressões de interface com SQLite real.

## Smoke test no aplicativo real

Executado em `tauri dev` + WebView2, com identificador e banco **com.rumo.validation.phase3**, separado do perfil pessoal. Os scripts recusam outro identificador.

- Plano **PPL + Upper/Lower**, dias Push/Pull/Legs/Upper/Lower; Upper com Supino reto 3×6–10, Remada baixa 3×8–12 e Desenvolvimento 3×8–12. Hábito booleano **Treinar**, 4 vezes por semana, vinculado ao plano.
- Sessão Upper com **25 kg/lado × 10**, **27,5 kg/lado × 9** e **30 kg/lado × 8**. O encerramento nativo antes de finalizar preservou sessão `in_progress`, IDs, números, tipos de carga, repetições e três séries. Reabertura confirmou os dados e permitiu concluir.
- A conclusão gerou uma única entrada de hábito; iniciar e descartar não geram entrada, e finalizar novamente é idempotente nos testes. Home exibiu planejado, em andamento e concluído.
- Segunda sessão Upper mostrou o treino anterior. Copiar cargas manteve as séries abertas. **30 kg/lado × 9** mostrou comparação de +1 repetição e nova marca; histórico e Evolução refletiram a sessão. Corrigir a série histórica para **30 × 10** atualizou resumo, volume, PR e Evolução sem reinício.
- Calendar mostrou Upper planejado na sexta; mudar para sábado removeu a ocorrência anterior e mostrou a nova sem reiniciar. A sessão real de domingo permaneceu no histórico do calendário. Arquivar o plano retirou a agenda futura e manteve estrutura consultável em modo de leitura e sessões antigas legíveis.
- Pensamento longo, observação de sessão e tema escuro foram salvos no perfil isolado; Tab levou de carga para repetições. Fechamento nativo e reabertura compararam **todas as tabelas iguais**. Evidências ignoradas pelo Git: `artifacts/phase3/in-progress.json`, `final.json`, `functional-report.json`, `finalize-report.json` e `visual-report.json`.

## Fechamento investigado

O segundo pedido de fechamento que falhou **não chegou a executar `window.destroy()`**. O trace real de `flushWorkouts()` foi: `Preencha a carga e as repetições antes de marcar a série.` O smoke test havia editado a série imediatamente após copiar cargas, antes de a interface receber o snapshot atualizado; enviou carga nula com a série marcada. A barreira de fechamento preservou corretamente a janela aberta e a série incompleta não foi confirmada no banco.

`SessionEditor.run()` agora aguarda a leitura do snapshot atualizado antes de liberar o formulário. O harness também espera a carga aparecer no input antes de editar. Teste RTL + SQLite e o segundo treino real confirmam a sequência; fechamento nativo posterior terminou e preservou o banco. O erro visto no CDP ao chamar `destroy()` diretamente de `page.evaluate` não foi usado como diagnóstico do fluxo normal; a chamada direta perde o próprio contexto WebView. Não há evidência de erro de runtime no fechamento normal após a correção.

## Métricas, performance e visual

PRs e volume vêm das séries concluídas de sessões finalizadas, separados por exercício e tipo de carga. Aquecimento e descarte não entram. Volume registrado = carga informada × reps para cargas numéricas; lado/halter não são dobrados. Peso corporal e ausência de carga não recebem volume físico presumido. Marcas lifetime são agregadas em SQL; o gráfico SVG consulta somente o exercício/período selecionado (30/90/365 dias), com tabela equivalente. Home consulta agenda do dia e sessão aberta; Histórico pagina 30 sessões; Calendar consulta 42 dias.

Playwright na WebView2 validou **1366×768 e 1920×1080, claro/escuro** em Home, Hoje, Plano, Biblioteca, Histórico, Evolução, Calendário e sessão. Foram registradas 32 verificações/capturas sem overflow horizontal. Foco por Tab entre carga e repetições e estrutura da sessão foram verificados. O visual manteve a linguagem da Fase 2.

## Verificações finais e distribuição

- Prettier check: passou nos arquivos de código, scripts, testes e documentação.
- `npm run lint`: passou sem avisos.
- `npm run typecheck`: passou.
- `npm test`: **124 testes em 16 arquivos, todos passaram**; os 77 anteriores continuam presentes.
- `npm run build`: passou; a build frontend foi refeita também pelo Tauri.
- `npm audit --audit-level=low`: **zero vulnerabilidades**.
- `git diff --check`: passou. Como o repositório permanece com arquivos não rastreados desde a criação, o comando não os inspeciona; Prettier e os testes cobrem os novos arquivos de código.
- `npm run desktop:build`: passou após as correções funcionais; compilação release Rust e instalador NSIS x64 gerados em 27/09/2026. O linker MSVC emitiu apenas o aviso `linker_messages` de criação de biblioteca/objeto.

Artefatos verificados no filesystem após a build:

- Executável: `%USERPROFILE%\OneDrive\Documentos\ChatGPT\Rumo\src-tauri\target\release\rumo.exe` (11.381.760 bytes, SHA-256 `C99A3A1E0F6CD0BA705C7D654CC6FB693BA1868F527D3432F54A74C8571D2769`).
- Instalador NSIS: `%USERPROFILE%\OneDrive\Documentos\ChatGPT\Rumo\src-tauri\target\release\bundle\nsis\RUMO_0.1.0_x64-setup.exe` (2.974.184 bytes, SHA-256 `321C923214777E04994804E94599DFC18ECBCB6CF4F0396E722DEC76B3552249`).

O perfil temporário `%APPDATA%\com.rumo.validation.phase3` foi conferido e removido após o fechamento. O banco pessoal `%APPDATA%\com.rumo.desktop\rumo.db` permaneceu intacto. Logs e capturas úteis ficaram em `artifacts/phase3/`, ignorados pelo Git.

Smart App Control permaneceu ativado. O executável/instalador sem assinatura confiável pode ser bloqueado; isso é questão de distribuição, não bug funcional. Assinatura de código fica para a Fase 6/release.

**Fase 3 concluída. Nenhuma pendência bloqueante conhecida na Fase 3.**

---

# Validação — Fase 4: Alimentação

Data: 27/09/2026. As Fases 1–3 continuam cobertas pela suíte: **124 testes anteriores preservados; 138 testes em 18 arquivos passaram** no total. Nenhuma funcionalidade de Finanças foi iniciada.

## Banco e fonte nutricional

`0004_nutrition.sql` foi registrada após 0003 e cria `food_sources`, `foods`, `food_nutrients`, `meals`, `meal_items`, `diet_plans`, `diet_meals`, `food_diary_entries`, `nutrition_goals` e `body_weight_entries`, com FKs, checks, índices e triggers. `0005_nutrition_units.sql` foi registrada depois da 0004 e adiciona `base_grams_equivalent` sem mudar o checksum da migration já aplicada. Testes de upgrade de banco preenchido da Fase 3 verificaram preservação de Tasks, Inbox, Settings, Projects, Habits, Routines, Thoughts e Workouts; o upgrade 0004→0005 preservou catálogo e nutrientes. O banco pessoal não foi migrado nos smoke tests.

A migration importa **597 alimentos da TACO 4ª edição**, separados dos alimentos personalizados do usuário; 9.688 registros de nutrientes vieram da planilha fornecida. `scripts/import-taco.py` lê o XLSX em modo somente leitura e mapeia colunas para chaves nutricionais estáveis. Cabeçalhos repetidos da planilha são ignorados; a categoria de “Frango, peito, sem pele, grelhado” foi confirmada como “Carnes e derivados”. `Tr` fica marcado como traço sem valor numérico; `NA` e campos vazios ficam ausentes, sem serem apresentados como zero medido. A identificação por fonte e item original prepara uma importação TBCA futura sem acoplar refeições e diário à planilha TACO.

## Cálculos e funções

Calorias, carboidratos, proteínas, gorduras, fibras e micronutrientes usam a proporção **valor da base × gramas do item ÷ gramas equivalentes da base**. Refeição e dieta semanal agregam os nutrientes presentes por alimento; o diário registra consumo real e mantém snapshot nutricional da entrada para preservar dias anteriores após editar um alimento personalizado. Metas opcionais exibem consumido, meta e diferença; teste de UI confirmou 976/2.074 kcal = 1.098 kcal restantes. Em alimentos personalizados, bases como **1 porção = 30 g** exigem equivalência informada; o app não presume que 1 porção = 1 g nem que 100 ml = 100 g. O teste por porção confirmou 120 kcal/30 g → 240 kcal/60 g.

Biblioteca, alimento personalizado, refeições reutilizáveis, dieta por dia da semana, diário, peso com gráfico, histórico e lista de compras consolidada por alimento foram exercitados. A Home consulta só totais e metas do dia e mantém Tasks em destaque. Não há automação alimentar em Hábitos ou eventos alimentares duplicados no Calendário nesta fase.

## Smoke e persistência

No aplicativo real via `tauri dev`, exclusivamente no perfil **com.rumo.validation.phase4**, foram criados alimento personalizado, Café da manhã, Almoço e Jantar com banana, aveia, arroz, frango e ovo; dieta ativa com as três refeições; cinco entradas copiadas para o diário; peso de 72,5 kg; metas e alimento adicional de **1 porção = 30 g**. A lista de compras mostrou os alimentos planejados. Segunda medição de 73 kg verificou o gráfico. O script conferiu o identificador de teste antes de escrever e o perfil foi removido ao final, preservando `%APPDATA%\com.rumo.desktop\rumo.db`.

Após fechamento nativo **sem depuração remota** e reabertura, comparação integral de `foods`, `food_nutrients`, `meals`, `meal_items`, `diet_plans`, `diet_meals`, `food_diary_entries`, `body_weight_entries`, `nutrition_goals` e `settings` confirmou dados idênticos. Incluiu dieta, diário, peso, metas e personalizados. As filas de Thoughts e Workouts estavam vazias. Um pedido de fechamento sob CDP retornou `failed to send message to the webview`; não houve perda de dados, e o fechamento normal sem instrumentação funcionou. Esse erro ficou restrito ao harness WebView/CDP; nenhum workaround foi adicionado ao RUMO.

## Visual e verificações finais

Resumo de calorias/macros inspirado na referência textual fornecida, adaptado aos tokens existentes, com barras suaves e micronutrientes em detalhe. Playwright/WebView2 verificou **32 combinações** das oito telas de Alimentação em **1366×768 e 1920×1080**, **claro e escuro**, sem overflow horizontal. Busca, filtro, estados e Tab da busca para o seletor foram conferidos. O gráfico de peso foi inspecionado com duas medições.

- Prettier check: passou nos arquivos alterados.
- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm test`: **138 testes em 18 arquivos, todos passaram**; 124 testes anteriores preservados.
- `npm run build`: passou; o Tauri repetiu a build frontend.
- `npm audit --audit-level=low`: **0 vulnerabilidades**.
- `git diff --check`: passou. O repositório contém arquivos ainda não rastreados desde sua criação; esse comando não os inspeciona, portanto Prettier e testes também cobrem os arquivos novos.
- `npm run desktop:build`: passou após a última alteração funcional; compilação release e bundle NSIS x64 finalizados. Houve somente o aviso conhecido `linker_messages` do MSVC.

Artefatos confirmados no filesystem, com modificação em **27/09/2026 12:08:47 -03:00**, posterior aos arquivos funcionais mais recentes (12:04:46):

| Artefato                                                                                                       |      Bytes | SHA-256                                                            |
| -------------------------------------------------------------------------------------------------------------- | ---------: | ------------------------------------------------------------------ |
| `%USERPROFILE%\OneDrive\Documentos\ChatGPT\Rumo\src-tauri\target\release\rumo.exe`                             | 11.997.184 | `2600E3C26F07F97EBE82A69470B46A4290CFEF27CC44860BCAA632B6C6727A06` |
| `%USERPROFILE%\OneDrive\Documentos\ChatGPT\Rumo\src-tauri\target\release\bundle\nsis\RUMO_0.1.0_x64-setup.exe` |  3.037.674 | `CA3B9B2AABF75015E6C73C1933BAA5BF24E60BA1A61E938322E7913314BEFCB2` |

Smart App Control permaneceu ativado. Binários sem assinatura confiável podem ser bloqueados pela política do Windows; a assinatura de código fica para a Fase 6/release. Isso não indica falha funcional da Alimentação. **Fase 4 concluída. Nenhuma pendência bloqueante conhecida na Fase 4.**

---

# Validação — Fase 5: Finanças

Data: 27/09/2026. As Fases 1–4 permaneceram na suíte: **138 testes anteriores preservados; 152 testes em 20 arquivos passaram**. A primeira execução antes da implementação teve uma falha intermitente de espera de UI em um teste de Treinos (137/138); o teste isolado e as suítes completas posteriores passaram sem alterar Treinos.

## Banco, dinheiro e cálculos

`0006_finance.sql` adicionou `finance_accounts`, `finance_categories`, `finance_rules`, `finance_import_batches`, `finance_transactions`, `finance_month_plans`, `finance_category_budgets`, `finance_recurring`, `finance_goals`, `finance_goal_contributions`, `finance_assets`, `finance_asset_valuations` e `finance_preferences`. `0007_finance_integrity.sql` acrescentou rastreabilidade de OFX e recorrências, unicidade por recorrência/data e triggers de consistência de categoria. A 0006 foi preservada após aplicação em bancos de teste; as migrations 0001–0005 não foram alteradas. Testes de upgrade **Fase 4 → Fase 5** compararam tabelas anteriores, incluindo Tasks, Inbox, Settings, Projects, Habits, Routines, Thoughts, Workouts e Nutrition; também foi testado upgrade **0006 → 0007** com ledger preenchido.

Dinheiro é armazenado em **centavos inteiros**. O parser pt-BR foi verificado com R$ 0,01, 0,10, 19,90, 1.234,56 e 40.000,00; a formatação separa inteiros e centavos sem converter a quantia armazenada em float. Datas de transação são `YYYY-MM-DD` civis. Receitas/despesas são quantias positivas com tipo explícito. Transferências debitam origem e creditam destino sem entrar nos totais de receita/despesa. Compra de cartão é despesa; quitação é transferência para a conta do cartão, evitando dupla despesa. Saldo de conta = saldo inicial + créditos − débitos; patrimônio líquido = saldos de contas + bens manuais − passivos manuais. Avaliações por data permitem histórico retroativo. O saldo inicial é a base anterior às transações registradas; rendimentos projetados não são lançados como saldo real.

Disponível realizado do mês = receitas realizadas − despesas realizadas − aportes registrados; disponível planejado usa os três valores independentes do plano mensal. Orçamentos por categoria mostram o gasto realizado contra o teto informado. Recorrências/assinaturas são previsões e só viram transações por ação explícita; repetir a ação na mesma data não duplica. Objetivo real = valor inicial + histórico de aportes. Projeção usa taxa mensal `(1 + taxa anual)^(1/12) − 1`, rendimento arredondado a centavos a cada mês e aporte ao **fim** do mês, com limite de 600 meses. Testes cobrem taxa 0%, 5% e 10%, além do caso de R$ 10.000 + R$ 1.000/mês até R$ 40.000 em 30 meses sem rendimento. Projeções são estimativas matemáticas com premissas do usuário, não aconselhamento de investimento.

## OFX, privacidade e desempenho

Importação exclusivamente local de extratos bancários **OFX 1.x SGML e 2.x XML** em BRL. Testes sintéticos cobrem acentos UTF-8 e Windows-1252, valores positivos/negativos, data civil, FITID, TRNTYPE, MEMO e CHECKNUM quando presentes. DTD/entidades XML são rejeitados; não há resolução externa ou acesso à rede. A prévia mostra conta de origem, totais e estados de cada linha. SHA-256 do arquivo identifica lote repetido por conta; FITID tem unicidade por conta/fonte. Sem FITID, coincidência de data, valor, tipo e descrição vira **possível duplicata** com decisão explícita, inclusive dentro do mesmo arquivo. Um teste importou 100 transações sintéticas e reimportou o arquivo com **0 novas/100 duplicadas**. O lote entra por um único `INSERT` com trigger SQLite: falha em uma linha reverte lote e transações. O payload normalizado temporário é limpo pelo trigger; o OFX bruto não é persistido.

Ocultar valores é uma preferência SQLite, usada no módulo e no resumo compacto da Home. Transações são consultadas por mês/filtros e paginadas em blocos de 50; a prévia mostra até 150 linhas com totais do arquivo completo. A Home consulta apenas agregados mensais e preferência visual. Histórico patrimonial de 12 meses é carregado sob demanda, com tabela junto ao gráfico. Nenhum conteúdo bancário é enviado, logado integralmente ou usado para pedir credenciais.

## Smoke, persistência e visual

Executado no aplicativo real via `tauri dev` + WebView2 com perfil isolado **com.rumo.validation.phase5**; `scripts/phase5-smoke.mjs` verificou esse identificador antes de escrever. Foram criadas **Conta principal, Reserva e Cartão**; regra **IFOOD → Alimentação**; importado OFX sintético de três transações; a segunda tentativa do mesmo arquivo não criou transação. A prévia de outro hash sinalizou dois FITIDs já conhecidos e uma possível duplicata sem FITID. A descrição **Salário** preservou o acento. Duas transferências (reserva e pagamento do cartão) não inflaram receitas/despesas; a compra no cartão contou uma vez. Plano de **R$ 5.000 receita − R$ 3.000 despesas − R$ 500 objetivos = R$ 1.500 disponível planejado**. Foram registrados objetivo **Carro**, aporte de R$ 500, orçamento de Alimentação, assinatura Internet e bem manual de R$ 30.000. Privacidade visual e resumo da Home foram exercitados.

Após fechamento **nativo** e reabertura, comparação integral das 13 tabelas financeiras confirmou dados idênticos: três contas, seis transações, uma regra, um lote OFX, plano, orçamento, recorrência, objetivo, aporte, bem, avaliação e preferência. O perfil temporário foi inspecionado e removido depois; `%APPDATA%\com.rumo.desktop\rumo.db` não foi usado.

Playwright/WebView2 auditou **24 combinações** de Visão geral, Transações, Planejamento, Objetivos, Patrimônio e Home em **1366×768 e 1920×1080**, **claro e escuro**, sem overflow horizontal. Prévia OFX e foco por Tab da busca para o filtro seguinte foram conferidos. Capturas e relatórios permanecem em `artifacts/phase5/` (ignorado pelo Git). O layout usa tokens, tipografia, sidebar e estados existentes, sem linguagem julgadora.

## Verificações finais e artefatos

- Prettier check dos arquivos da Fase 5: passou.
- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm test -- --reporter=dot`: **152 testes em 20 arquivos, todos passaram**; 138 anteriores preservados.
- `npm run build`: passou; o Tauri repetiu a build frontend.
- `npm audit --audit-level=low`: **0 vulnerabilidades**.
- `git diff --check`: passou. O repositório permanece inteiramente não rastreado desde sua criação; o comando não inspeciona esses arquivos, portanto Prettier, testes e build complementam a validação.
- `npm run desktop:build`: passou após a última alteração funcional; executável release e instalador NSIS x64 gerados. Apenas o aviso MSVC `linker_messages` conhecido apareceu.

Artefatos verificados no filesystem, ambos modificados em **27/09/2026 13:06:09 -03:00**, depois dos arquivos funcionais mais recentes (13:02:15):

| Artefato                                                                                                       |      Bytes | SHA-256                                                            |
| -------------------------------------------------------------------------------------------------------------- | ---------: | ------------------------------------------------------------------ |
| `%USERPROFILE%\OneDrive\Documentos\ChatGPT\Rumo\src-tauri\target\release\rumo.exe`                             | 12.020.736 | `EAF038116CFB5112570D81421D74F56230540A98B2CE4318C56E421B845C4036` |
| `%USERPROFILE%\OneDrive\Documentos\ChatGPT\Rumo\src-tauri\target\release\bundle\nsis\RUMO_0.1.0_x64-setup.exe` |  3.051.068 | `BAD008ACBC626F8051EEAA3FC2FBD40EABFA12EF508EF0EE13007B6D9F264612` |

Smart App Control permaneceu ativo. Binários sem assinatura confiável podem ser bloqueados na distribuição; a assinatura de código fica para a Fase 6/release. Os smoke tests funcionais usaram `tauri dev`, sem desativar proteções. **Fase 5 concluída. Nenhuma pendência bloqueante conhecida na Fase 5.**

---

# Validação — Fase 6: RUMO 1.0.0

Data: 27/09/2026. As 152 verificações automatizadas anteriores permaneceram na suíte; o total atual é **156 testes em 23 arquivos**, todos passando. A migration aditiva `0008_release.sql` registra frequência e retenção de backup sem alterar as versões 0001–0007. Testes de upgrade 0007→0008 e 0005→0008 preservaram dados e aplicaram a sequência completa.

## Backup, restore e integridade

O backup usa a API de snapshot do SQLite, incluindo gravações presentes no WAL, e produz ZIP com `rumo.db` e `manifest.json` (versão do aplicativo, schema, timestamp, tipo e SHA-256). O arquivo só é confirmado após escrita e sincronização bem-sucedidas. A inspeção limita tamanho, exige exatamente esses dois caminhos, compara hash e schema, rejeita schema futuro e executa `PRAGMA integrity_check`. O restore valida tudo antes de tocar no banco, cria backup preventivo e aplica o snapshot; falha durante a aplicação tenta recuperar a cópia preventiva. O aplicativo reinicia após restore para executar migrations antigas no novo processo.

No perfil isolado `com.rumo.validation.phase6`, foram criados registros sintéticos representando Task, Project, Habit, Routine, Thought, Workout, Nutrition, Finance e Settings. Backup A, alterações B, restauração de A e restauração preventiva de B foram conferidos por consultas e integrity check. O backup preventivo guardou o estado B. Um backup de schema 5 foi restaurado e, após reinício nativo, migrado ao schema 8 preservando Task, Project, Thought, Workout Plan, Meal e Settings. Oito arquivos inválidos (ZIP sem manifest, sem banco, SQLite corrompido, hash incorreto, schema futuro, Zip Slip, caminho extra e arquivo aleatório renomeado) foram rejeitados sem alterar B. O backup automático criou três arquivos, aplicou retenção de dois e preservou um backup manual mesmo com nome parecido. As frequências desativada/diária/semanal foram cobertas por teste de domínio. Arquivos temporários SQLite e seus sidecars são removidos pelo processo nativo.

Configurações → Dados oferece localização do banco, backup manual, frequência automática, retenção, restore com confirmação e verificação de integridade. Os ZIPs não são criptografados; devem ser guardados em local seguro. Nenhum teste leu ou modificou `%APPDATA%\com.rumo.desktop`.

## Busca, experiência e auditorias

Ctrl+K abre busca local agrupada e limitada em Tasks, Projects, Inbox, Habits, Routines, Thoughts, Workout Plans, Exercises, Foods, Meals, Diets, Finance Transactions e Financial Goals. Esc fecha, setas navegam e Enter abre o resultado; Ctrl+Espaço continua reservado à captura rápida. Com ocultação financeira ativa, os resultados financeiros recebem rótulo genérico, sem mostrar descrições potencialmente monetárias ou quantias. A navegação real para projeto, Thought, exercício, objetivo e alimento foi validada na WebView2 isolada.

Primeira abertura sem dados apresentou boas-vindas simples e solicitou nome, sem conta e sem dados de demonstração. Onze páginas vazias abriram sem alerta; uma Task criada pelo campo rápido foi encontrada com Ctrl+K e aberta por Enter. A Home manteve Tasks em destaque; Calendar continuou agregando apenas origens temporais já previstas. Auditoria Playwright na WebView2 percorreu 12 páginas em **1366×768, 1920×1080 e 2560×1440**, nos temas **Claro e Escuro**: **72 combinações sem overflow horizontal**. A seção Dados e o diálogo de busca foram inspecionados com foco visível; controles compactos de frequência/retenção foram ajustados após revisão visual.

Busca estática no código de runtime não encontrou `fetch`, Axios, analytics, telemetria, Sentry, PostHog ou URLs de rede. A configuração CSP restringe conexões a IPC local. Os logs encontrados registram somente nomes técnicos de erro; não incluem OFX, Thought completo ou transações. O parser OFX rejeita DTD/entidades e limita tamanho; repositórios usam parâmetros SQL. O ZIP não é extraído por caminhos fornecidos no arquivo: apenas `manifest.json` e `rumo.db` exatos são aceitos, bloqueando Zip Slip. O fechamento nativo normal e o reinício após restore passaram; erro WebView/CDP relatado em fase anterior permaneceu restrito à instrumentação, sem perda de dados observada.

## Performance e instalação controlada

Teste SQLite sintético separado carregou **5.000 Tasks, 1.000 Thoughts, 1.000 Workout Sessions, 10.000 Workout Sets, 5.000 Food Diary Entries, 10.000 Finance Transactions** e os 597 alimentos TACO. Nesta máquina, as consultas medidas foram: snapshot inicial 27 ms, busca global 5 ms, resumo Home 1 ms, Calendar 51 ms, busca de alimentos <1 ms, diário do dia 1 ms, transações paginadas 5 ms e histórico de treino <1 ms. São tempos de consulta em teste, não medição de tempo total de renderização da UI. A busca limita resultados; histórico e finanças continuam paginados ou por período. Não foi detectado gargalo que exigisse alteração arquitetural.

Um instalador NSIS **de validação**, com nome e identificador distintos do produto pessoal, instalou 0.1.0, iniciou com schema 8 e foi atualizado para 1.0.0. Após atualização, Task, transação financeira e `PRAGMA integrity_check` permaneceram corretos. A desinstalação silenciosa removeu executável e registro, mas preservou o banco de teste com SHA-256 idêntico. O script NSIS gerado só remove `%APPDATA%\<identificador>` quando o usuário marca explicitamente a opção de apagar dados; upgrade não a executa. O perfil temporário de validação foi removido após os testes.

## Verificações e distribuição

- Prettier check, ESLint, TypeScript, `cargo fmt --check` e `cargo check --tests`: passaram.
- `npm test`: **156/156**; os 152 testes anteriores permaneceram. `cargo test --release --lib`: **4/4 testes nativos Rust passaram**, incluindo snapshot WAL, restore preventivo, arquivos inválidos/futuros e retenção. O Smart App Control bloqueou somente o build-script de debug; não foi desativado nem contornado.
- `npm audit --audit-level=low`: **0 vulnerabilidades**.
- `git diff --check`: passou, mas não cobre o conteúdo ainda não rastreado porque o repositório não possui primeiro commit. `scripts/validate-files.mjs` examinou **160 arquivos de texto rastreados e não rastreados**, sem whitespace final ou marcadores de conflito; Prettier cobriu código, scripts, testes e documentação.
- Frontend production build: passou na build Tauri de validação e na build final de produção 1.0.0.
- `npm run desktop:build`: passou após a última alteração funcional, gerando executável e NSIS de produção x64. O linker MSVC emitiu apenas o aviso informativo `linker_messages`.

Artefatos finais confirmados no filesystem, modificados em **27/09/2026 16:51:06 -03:00**:

| Artefato                                                                                                       | Bytes      | SHA-256                                                            |
| -------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| `%USERPROFILE%\OneDrive\Documentos\ChatGPT\Rumo\src-tauri\target\release\rumo.exe`                             | 12.963.840 | `7A6ED0B35C01959165E570C12B6B58DA8A9CE6F0F01CE99EAA9DC30029CA0878` |
| `%USERPROFILE%\OneDrive\Documentos\ChatGPT\Rumo\src-tauri\target\release\bundle\nsis\RUMO_1.0.0_x64-setup.exe` | 3.319.396  | `719D62B854AE36458321AB55CB96B01BBDC3DA69C7DCB17EBBC005FBDC520095` |

O NSIS final declara `PRODUCTNAME=RUMO`, `VERSION=1.0.0` e `BUNDLEID=com.rumo.desktop`. Smart App Control permaneceu ativo. A release permanece sem assinatura de código confiável; uma distribuição ampla requer certificado legítimo. Não foi feita exceção ou alteração de política. **Nenhuma pendência funcional bloqueante conhecida no RUMO 1.0.0.** A assinatura depende de certificado legítimo antes da distribuição ampla.

---

# Refinamento UI/UX e progresso corporal — 27/09/2026

Esta etapa amplia o produto existente, sem alterar migrations 0001–0008 ou os fluxos de Backup/Restore e Busca Global. A interface preserva cores, tipografia, sidebar e temas. A largura útil chega a 1160 px; cabeçalhos e espaçamentos foram compactados. A Home organiza os resumos secundários em uma grade responsiva e mantém Tasks em destaque. Projetos, Hábitos e Rotinas ganharam resumos/progresso mais informativos e estados vazios com ação; Treinos Hoje ganhou contexto do plano e última sessão; Pensamentos ganhou área master-detail mais ampla; o indicador principal de Finanças ganhou hierarquia. Tasks, Inbox e Calendar mantiveram suas interações existentes.

`0009_body_progress.sql` cria `body_measurement_records` (uma data por registro) e `body_measurement_values` (métrica, valor e unidade), com FK, constraints, índice e aplicação atômica de alterações parciais por triggers. A migration copia o peso de `body_weight_entries` para a fonte compartilhada; quando existem duas entradas legadas na mesma data, escolhe a mais recentemente editada para o registro diário e conserva ambas na tabela antiga para auditoria. Não há gravação dupla posterior. O número real migrado no perfil pessoal dependerá do histórico do usuário; **o perfil pessoal não foi aberto nem alterado nesta validação**. Nos testes, um registro legado foi migrado integralmente e o caso de duas entradas no mesmo dia produziu um registro diário, mantendo as duas originais. `PRAGMA integrity_check` retornou `ok`, inclusive após reabertura física do banco.

Treinos → Progresso corporal aceita peso, gordura corporal e medidas independentes de pescoço, ombros, peito, cintura, abdômen, quadril, braços, antebraços, coxas e panturrilhas. Aceita vírgula decimal; valor ausente não vira zero. Mostra o último valor disponível, variação descritiva, gráfico e tabela por métrica, comparação entre duas datas, edição e exclusão. A evolução de cargas segue disponível dentro do detalhe do exercício. Alimentação → Progresso consulta e corrige o **mesmo** peso, preservando as outras medidas da data e oferecendo link para Treinos. A variação de 30 dias aparece apenas quando há duas datas com peso no período. O formulário de 16 métricas recebe foco e rolagem ao abrir.

O smoke usou somente o identificador isolado `com.rumo.validation.phase6`. Pela UI, foram registradas medidas em 01/09 e 27/09/2026, inclusive lados esquerdo/direito; a comparação mostrou diferenças. O peso de 27/09 foi corrigido em Alimentação de 91,4 para **90,8 kg** e apareceu imediatamente em Treinos, com a cintura de 91 cm preservada. A tabela legada continuou sem novas linhas. Após fechamento nativo e reabertura do executável isolado, os dois registros, o peso compartilhado e a integridade SQLite foram confirmados novamente. O script `scripts/body-progress-smoke.mjs` recusa outro identificador antes de escrever.

A auditoria Playwright/WebView2 percorreu **17 seções × 3 resoluções (1366×768, 1920×1080 e 2560×1440) × 2 temas (Claro/Escuro): 102 combinações sem overflow horizontal**. Incluiu Home, Tasks, Inbox, Projects, Habits, Routines, Calendar, cinco seções de Treinos, duas de Alimentação, Finance, Thoughts e Settings. Capturas de estados vazios e do progresso preenchido foram inspecionadas. O formulário de 16 medidas em 1366×768 não apresentou overflow; Tab encontrou foco visível. Evidências e relatório estão em `artifacts/body-progress/` (ignorado pelo Git).

Na validação automatizada mais recente: **160/160 testes passaram**, incluindo os **156 anteriores**; lint, TypeScript, Prettier e `cargo fmt --check` passaram. O frontend e a build Tauri/NSIS de produção passaram após a última alteração de código. `cargo test --release --lib` passou **4/4**. A mudança do schema atual para 9 exigiu atualizar o fixture de backup “futuro” para versão 10; o teste falhou antes desse ajuste e passou depois, sem alterar a lógica de restore. `npm audit --audit-level=low` encontrou **0 vulnerabilidades**; `scripts/validate-files.mjs` verificou **170 arquivos** rastreados/não rastreados. `git diff --check` passou, mas o repositório ainda não tem primeiro commit, portanto esse comando isoladamente não cobre seus arquivos.

Artefatos finais desta etapa, ambos modificados em **27/09/2026 18:02:56 -03:00**:

| Artefato                                                                                                       |      Bytes | SHA-256                                                            |
| -------------------------------------------------------------------------------------------------------------- | ---------: | ------------------------------------------------------------------ |
| `%USERPROFILE%\OneDrive\Documentos\ChatGPT\Rumo\src-tauri\target\release\rumo.exe`                             | 12.971.520 | `F6B82D1AFB517794BDBA5D8CB9423835A4A988DE428238D14C78533365E5A529` |
| `%USERPROFILE%\OneDrive\Documentos\ChatGPT\Rumo\src-tauri\target\release\bundle\nsis\RUMO_1.0.0_x64-setup.exe` |  3.321.938 | `C8B4A52B3345A2BFDD025767F1060D444C5CCAFD6B47113997DEBFAAB95A1C34` |

Smart App Control permaneceu ativo. O executável e o instalador não têm assinatura de código confiável e podem ser bloqueados na distribuição. Esta seção registra o refinamento e **não substitui a checklist restante de distribuição da Fase 6**, agora com o schema 9.

---

# Encerramento definitivo da Fase 6 — RUMO 1.0.0

Data: 27/09/2026. Este encerramento sucede o refinamento acima. Nenhum módulo, layout ou migration foi reimplementado. A versão já estava aplicada como 1.0.0 no checkpoint e foi mantida, com conferência de package/package-lock, Cargo, Tauri, Sobre e NSIS; não houve regressão artificial para depois fazer outro bump. O identifier de produção permanece `com.rumo.desktop`. O banco pessoal não foi aberto, copiado, modificado ou removido.

## Classificação do checkpoint e resultado

| Requisitos                                                    | Estado encontrado | Resultado final                                                   |
| ------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------- |
| Global Search, Ctrl+K, Ctrl+Espaço e privacidade              | CONCLUÍDO         | Revalidado por testes e na WebView2 instalada                     |
| Backup manual, restore, preventivo, manifest/hash/integridade | CONCLUÍDO         | Revalidado com schema 9                                           |
| Backup automático, frequência e retenção                      | CONCLUÍDO         | Três automáticos, dois retidos, manual preservado                 |
| Settings, Dados, Sobre e onboarding                           | CONCLUÍDO         | Instalação limpa abriu 11 páginas sem alerta; versão 1.0.0        |
| Auditorias de rede, logs, SQL, OFX, ZIP e paths               | CONCLUÍDO         | Reinspecionadas sem problema concreto identificado                |
| Performance e dataset grande                                  | CONCLUÍDO         | Suíte sintética executada novamente                               |
| UI/UX e Progresso corporal                                    | CONCLUÍDO         | Auditoria de 102 combinações preservada; smoke direcionado passou |
| Upgrade, instalação e uninstall com schema 9                  | PARCIAL           | Cenário controlado executado e documentado abaixo                 |
| Scripts de release após refinamento                           | PARCIAL           | Expectativas de schema e aba de Exercícios atualizadas            |
| CSV                                                           | AUSENTE           | Opcional não implementado; não bloqueia backup completo           |
| Versão 1.0.0, notas, README                                   | CONCLUÍDO         | Notas agora incluem Progresso corporal                            |
| Assinatura de código                                          | AUSENTE           | Pendência de distribuição, não funcional                          |
| Validação integral e artefatos finais                         | PARCIAL           | Nova rodada e nova build finais registradas abaixo                |

## Evidências funcionais finais

`phase6-smoke.mjs` passou no schema 9 com Task, Project, Habit, Routine, Thought, Workout, Nutrition, Body Progress, Finance e Settings sintéticos. Backup A, alteração B, restore A e restore do preventivo B retornaram os valores esperados e integrity check `ok`. O backup automático gerou três arquivos e reteve dois; um backup manual com nome parecido foi preservado. Oito arquivos inválidos foram recusados sem mudar os dados: ZIP sem manifest, sem banco, banco corrompido, hash incorreto, schema futuro **10**, Zip Slip, caminho extra e arquivo aleatório renomeado.

Busca real abriu Project, Thought, Exercise, Finance Goal e Food. O teste do exercício ainda apontava para a antiga aba Evolução; somente o seletor do harness foi atualizado para Exercícios, onde o detalhe já funciona. Com privacidade ativa, a busca usou “Transação financeira” e não mostrou quantias nem descrições monetárias. Ctrl+Espaço continuou abrindo captura, enquanto Ctrl+K abriu busca. Primeiro uso limpo solicitou nome, não inseriu demonstração e abriu 11 páginas sem alerta.

No aplicativo 1.0.0 instalado de validação, o Thought foi editado pela UI e o peso registrado como **70,5 kg** em Alimentação foi lido em Treinos pela mesma fonte. Criou-se um backup final schema 9. Após fechamento nativo normal e reabertura, comparação integral de **48 tabelas** confirmou igualdade, incluindo Task, Thought, peso, Finance e Settings; integrity check permaneceu `ok`. Não foi observado erro de fechamento nessa rodada. Não foi repetida a auditoria visual completa, pois nenhum componente visual foi modificado neste encerramento.

## Upgrade, installer e uninstall

Foi gerado um pacote **de teste** 0.1.0 com as fontes atuais e identifier `com.rumo.validation.phase6`, sem lançá-lo para migrar dados antes da hora. Um fixture fechado de schema 8 com dados representativos foi colocado exclusivamente nesse perfil. Esse é um cenário equivalente de upgrade, **não um binário histórico original**. O NSIS instalou 0.1.0 em `artifacts/phase6-install`; o pacote 1.0.0 atualizou a mesma instalação e seu registro passou a 1.0.0. Ao abrir o novo executável, migrations chegaram a 9 e as **12 tabelas anteriores comparadas permaneceram integralmente iguais**: Tasks, Projects, Habits, Routines, Thoughts, planos/sessões Workout, Meals, Food Diary, Finance, Settings e peso legado. O peso de 70 kg foi migrado à nova fonte compartilhada.

Um backup desse schema 8 foi restaurado e o reinício nativo aplicou a migration 9, preservando os dados e peso de 70 kg. O backup preventivo schema 9 foi restaurado depois e recuperou o peso de 70,5 kg e o estado final, também comparado pelas 48 tabelas.

NSIS de produção foi inspecionado: RUMO, 1.0.0, x64, `com.rumo.desktop`, instalação por usuário, atalhos de menu/desktop configurados e opção explícita para apagar dados. A instalação real de teste usou nome/identifier distintos para não tocar no produto pessoal. A primeira invocação automatizada do desinstalador com `/S`, iniciada no diretório do repositório, retornou sem remover a instalação. A execução com diretório NSIS explícito removeu executável e registro; depois o pacote foi reinstalado e a desinstalação `/S` normal, com `WorkingDirectory` definido para o diretório instalado, também removeu ambos. A diferença ficou restrita ao contexto de lançamento do harness, sem mudança no produto. **Não se afirma teste interativo do wizard de uninstall.** O banco de teste permaneceu byte a byte igual, SHA-256 `641F7594DA2F89BF84A672AF2E4FC69847FD961EFA3FDE4741F90F83C0E1B22E`. A seção gerada só remove o diretório de dados quando a opção de apagar dados é marcada e não está em modo de upgrade.

## Segurança, privacidade e performance

A busca estática atual em `src` e `src-tauri/src` não encontrou URLs externas, `fetch`, Axios, analytics, telemetry, Sentry ou PostHog. CSP permite IPC e assets locais. Tooling, documentação, depuração CDP e o bootstrapper do WebView2 durante instalação são distintos do runtime offline do aplicativo. Logs encontrados incluem apenas mensagens técnicas e nomes de erro, sem textos de Thoughts, OFX, transações, medições, diário ou bancos. Repositórios usam parâmetros SQL; nomes de tabelas/colunas dinâmicos são listas internas, não entrada do usuário. OFX rejeita DTD/entidades e limita tamanho. Backup aceita somente os dois nomes ZIP exatos, limita tamanho, valida hash/schema e SQLite antes de substituir o banco; não extrai caminhos arbitrários. O file picker seleciona um arquivo e a validação nativa ainda é obrigatória.

`.gitignore` cobre bancos/sidecars, logs, artifacts, perfis de smoke, backups ZIP, OFX pessoais, exports/local-data, arquivos de certificado e configuração local de assinatura; fixtures explicitamente permitidos são preservados. Não existe CSV de exportação no runtime, portanto não se adicionou escopo nessa etapa.

O teste sintético foi executado novamente com 5.000 Tasks, 1.000 Thoughts, 1.000 Workout Sessions, 10.000 Sets, 597 alimentos TACO, 5.000 entradas alimentares e 10.000 transações. Nesta rodada: consultas de snapshot 63 ms, busca 21 ms, resumo Home 2 ms, Calendar 139 ms, alimentos 1 ms, diário 2 ms, finanças paginadas 9 ms e histórico de treino <1 ms. Esses números medem consultas SQLite em suíte concorrente, não o tempo total de pintura da UI. Não houve gargalo evidente que justificasse refactor. A inicialização limpa e o app instalado foram exercitados sem travamento observado.

## Distribuição

Smart App Control permaneceu ativado, sem alteração de política, exceção ou certificado improvisado. A assinatura futura usa as opções já suportadas pelo Tauri e documentadas no README. **A release 1.0.0 está tecnicamente concluída, mas permanece sem assinatura de código. Smart App Control pode bloquear binários não assinados. A infraestrutura está preparada para assinatura futura.** Os resultados finais e hashes a seguir correspondem à rodada após esta checklist; os registros anteriores permanecem como histórico.

## Rodada final 1.0.0

- `npm test -- --reporter=dot`: **160/160**, 24 arquivos; todos os 160 testes do checkpoint preservados.
- `cargo test --release --lib`: **4/4**.
- ESLint, TypeScript, Prettier check e `cargo fmt --check`: passaram.
- `npm run build`: passou. O aviso de bundle frontend acima de 500 kB é informativo; startup e consultas foram exercitados, sem refactor por limite arbitrário.
- `npm audit --audit-level=low`: **0 vulnerabilidades**.
- `scripts/validate-files.mjs`: **174 arquivos de texto** rastreados/não rastreados verificados.
- `git diff --check`: passou; continua insuficiente isoladamente porque não há primeiro commit. Nenhum commit automático foi criado.
- Na última rodada sintética concorrente: snapshot 220 ms, busca 9 ms, Home 1 ms, Calendar 190 ms, alimentos 1 ms, diário 1 ms, finanças 9 ms e histórico de treino <1 ms.

Os perfis temporários `com.rumo.validation.phase6`, checkpoint de smoke e diretório da instalação isolada foram removidos após confirmar que não estavam em uso. Fixtures, scripts e evidências necessárias foram preservados em `artifacts`, fora do Git. Nenhuma limpeza tocou o identifier pessoal.

## Artefatos finais confirmados

`npm run desktop:build` terminou com código 0, incluindo frontend, executável release e instalador NSIS x64. O aviso conhecido do linker MSVC foi informativo. Os arquivos abaixo foram confirmados no filesystem após a build final; timestamp local **2026-09-27 20:41:48 -03:00** para ambos.

| Artefato   | Caminho relativo ao repositório                                 | Tamanho em bytes | SHA256                                                             |
| ---------- | --------------------------------------------------------------- | ---------------: | ------------------------------------------------------------------ |
| Executável | `src-tauri/target/release/rumo.exe`                             |         12971520 | `83615BA967A349B2275E65CDE0657E6540881C3404C372422C7BFD906EE92902` |
| Instalador | `src-tauri/target/release/bundle/nsis/RUMO_1.0.0_x64-setup.exe` |          3322975 | `A3C87FC666A0A4D59631483051E62F71F4F333D6B4D419DCD76E84E2F3A130F4` |

Schema final: **9**. Migrations preservadas: `0001_foundation.sql`, `0002_organization.sql`, `0003_workouts.sql`, `0004_nutrition.sql`, `0005_nutrition_units.sql`, `0006_finance.sql`, `0007_finance_integrity.sql`, `0008_release.sql` e `0009_body_progress.sql`.

Os itens inicialmente parciais de scripts, upgrade/installer e validação integral foram concluídos pelas evidências desta seção. A versão 1.0.0 já estava aplicada no checkpoint; sua consistência foi confirmada em package metadata, Cargo, Tauri, Sobre e NSIS, sem rollback artificial de versão. As seis fases estão encerradas. Nenhuma pendência funcional bloqueante conhecida no RUMO 1.0.0. Permanece a assinatura legítima de código como pendência de distribuição. Exportação CSV opcional não foi implementada.

---

# RUMO 1.1.0 — planejamento, energia e calendário

**Atualização de 28/09/2026:** o fluxo técnico de Perfil Energético descrito abaixo foi substituído por **Configurações → Perfil**. A validação final desta revisão e os hashes da build atualizada constam ao fim desta seção; os resultados anteriores permanecem como histórico do checkpoint, não como resultado final.

Data: 27/09/2026. Continuação aditiva da release 1.0.0; as migrations 0001–0009 foram preservadas e o banco pessoal `com.rumo.desktop` não foi usado em testes. `0010_planning_energy.sql` acrescenta weekdays múltiplos, atividade diária, perfil energético compartilhado, configuração/snapshot de energia de treino e preferências globais/individuais do Calendário. `0011_activity_overlap.sql` acrescenta os passos incluídos em treino ao registro diário; foi criada separadamente porque a 0010 já tinha sido aplicada no perfil de validação. O schema final é **11**. Backup/restore nativo aceita essa versão e rejeita schema futuro, conforme testes de backup existentes.

O plano ativo pode ser criado com divisão livre, ordenação, zero ou mais weekdays por treino e exercícios existentes/customizados. Hoje, Home e Calendário derivam a agenda do mesmo plano. O upgrade de 9→10 preservou tabelas antigas e o weekday legado; o upgrade de 10→11 preservou atividade e iniciou `workout_steps=0`. O teste de reabertura confirmou perfil, agenda e filtro do Calendário. Preferências ausentes mantêm a visibilidade prévia dos eventos; ocultar um hábito/rotina no Calendário não muda sua recorrência, Home ou histórico.

A TMB é uma **estimativa** de Mifflin-St Jeor usando peso de Progresso corporal, altura, data de nascimento e parâmetro biológico escolhido. O fator cotidiano configurado pelo usuário inclui passos habituais e exclui treino estruturado. O ajuste de passos vem desligado por padrão; quando ativado, exige coeficiente explícito e usa `(passos totais − passos do treino incluídos no total − passos habituais) / 1.000 × coeficiente`. O registro mantém os passos totais e limita a parcela do treino ao total. O gasto de treino é desativado, manual ou estimado por MET líquido do repouso; o valor planejado não conta como sessão concluída. Sessões concluídas entram uma vez e correção/exclusão recalculam o balanço. Objetivo e balanço são escolhidos pelo usuário. Metas dinâmicas opcionais de macros suportam valores manuais, percentuais somando 100% ou proteína/gordura em g/kg com carboidratos restantes; usa 4/4/9 kcal/g. A semana soma apenas dias transcorridos com ingestão registrada e diferencia passos estimados pela média dos reais. Não há inferência automática de perda de peso a partir do balanço.

O smoke nativo usou exclusivamente `com.rumo.validation.v110`, confirmado pelo identificador e caminho do banco antes de gravar. Pela UI, registrou peso 80 kg, perfil energético com 7.000 passos habituais e déficit configurado, 10.000 e depois 8.500 passos, plano ativo A/B/C/Upper/Lower e Upper em quinta/sexta; Alimentação mostrou meta dinâmica com ingestão sintética, e o filtro Hábitos do Calendário foi ocultado. O dado de alimento sintético e um exercício de fixture foram inseridos somente no banco isolado do smoke. O primeiro clique automatizado no checkbox de filtro excedeu o tempo porque o estado controlado aguardava a escrita assíncrona; a interface passou a atualizar a marcação imediatamente, preservando rollback em falha. Após fechamento nativo e reabertura, plano, weekdays, peso, passos e filtro foram confirmados. Pela UI, 1.500 dos 8.500 passos foram atribuídos ao treino; um segundo fechamento/reabertura confirmou a parcela persistida e ajuste energético recalculado. Ambos os fechamentos nativos terminaram normalmente.

A auditoria WebView2 percorreu **5 telas alteradas × 3 resoluções (1366×768, 1920×1080, 2560×1440) × 2 temas (Claro/Escuro) = 30 combinações**, sem alerta de interface nem overflow horizontal no documento. Telas: Treinos/Plano, Progresso corporal, Alimentação/Hoje, Calendário e Home. Capturas e relatório ficam em `artifacts/v110/visual/`, ignorados pelo Git. Foram inspecionadas capturas representativas de Plano claro em 1366×768 e Alimentação escura em 1920×1080. A auditoria não repete as 102 combinações de telas antigas da release 1.0.0.

Na rodada final após o versionamento, **180/180 testes passaram**, incluindo os 160 da 1.0.0; 20 testes novos cobrem cálculo, weekdays, energia, macros, migração e visibilidade. TypeScript, ESLint, Prettier e `cargo fmt --check` passaram. O frontend de produção passou, com aviso informativo de chunk acima de 500 kB. `npm audit --audit-level=low` encontrou **0 vulnerabilidades**; `scripts/validate-files.mjs` verificou **186 arquivos de texto** rastreados/não rastreados. `git diff --check` passou, mas continua insuficiente isoladamente porque o repositório ainda não tem primeiro commit. O teste sintético existente incluiu 5.000 Tasks, 1.000 Thoughts, 1.000 Workout Sessions, 10.000 Sets, 597 alimentos TACO, 5.000 entradas alimentares e 10.000 transações; na rodada 1.1, snapshot 103 ms, busca 10 ms, Home 1 ms, Calendário 246 ms, alimentos 1 ms, Alimentação Hoje 1 ms, finanças 10 ms e histórico Workout <1 ms. São tempos de consultas SQLite sob testes concorrentes, não pintura total da UI.

`cargo test --release --lib`: **4/4**, incluindo snapshot com WAL, restore preventivo, rejeição de backups inválidos/futuros e retenção automática. `npm run desktop:build`: passou após a última alteração funcional e o bump para 1.1.0; frontend, executável release e NSIS x64 foram gerados. O aviso de biblioteca do linker MSVC foi informativo.

Artefatos finais confirmados no filesystem, ambos modificados em **2026-09-27 21:46:14 -03:00**:

| Artefato        | Caminho relativo ao repositório                                 |      Bytes | SHA-256                                                            |
| --------------- | --------------------------------------------------------------- | ---------: | ------------------------------------------------------------------ |
| Executável      | `src-tauri/target/release/rumo.exe`                             | 12.982.272 | `391DC31852478CC37FF4E2AD56BCD53C53FA950069BD1BFF2E850E51311758AB` |
| Instalador NSIS | `src-tauri/target/release/bundle/nsis/RUMO_1.1.0_x64-setup.exe` |  3.332.128 | `AAA2978574467559801212081B3D6088F0C9122FE6A77409683CE984FB9261B3` |

O perfil temporário `com.rumo.validation.v110` foi removido após o segundo fechamento, com caminho absoluto e ausência de processos conferidos. Capturas/relatório permanecem em `artifacts/v110/` para revisão, fora do Git. Smart App Control permaneceu ativo. Os binários continuam sem assinatura de código confiável e podem ser bloqueados por essa política; assinatura é assunto de distribuição, não defeito funcional. O identificador de produção permanece `com.rumo.desktop` para conservar o banco do usuário.

## Revisão final 1.1.0 — fluxo automático (28/09/2026)

Esta revisão substitui o formulário técnico anterior. **Configurações → Perfil** pede data de nascimento, altura, parâmetro da fórmula, peso e objetivo. O peso é gravado e lido em Progresso corporal, sem cópia independente em Settings. TMB, rotina cotidiana, ajuste de passos, gasto de sessão e meta são derivados; ajustes avançados e dados legados continuam disponíveis. O método e as premissas estão no README. Alimentação não bloqueia uso com um formulário técnico e mostra “Como foi calculado?”. Sessões não concluídas não contam como treino realizado; quando não há separação dos passos de treino, o ajuste de passos é omitido para evitar dupla contagem.

`0012_exercise_library.sql` é aditiva sobre 0010/0011: preserva os 14 exercícios anteriores, acrescenta 222 built-ins, totalizando **236**, sem nomes duplicados. O teste de upgrade 11→12 conservou exercício personalizado e confirmou reaplicação idempotente e `PRAGMA integrity_check = ok`. A biblioteca busca aliases e combina filtros; a lista inicial é limitada a 80 e o restante é carregado sob demanda. A suite inclui regressão do plano A/B/C/Upper/Lower após reabertura.

**Validação funcional atual:** 186/186 testes em 26 arquivos, com os 160 testes da 1.0.0 preservados. Um teste de UI antigo passou a buscar “Supino reto” antes de abrir seu histórico devido à paginação da biblioteca; nenhuma assertiva foi removida. Corrigiu-se também a consulta da sessão anterior quando duas sessões têm o mesmo `started_at` em milissegundos. No perfil isolado `com.rumo.validation.v110`, o smoke pela UI criou os cinco dias do plano, associou “Supino reto com halteres”, encontrou “Tríceps corda na polia” pelo alias “pulley corda”, concluiu Lower com uma série e mostrou gasto estimado. Após reabrir, confirmou cinco dias, sessão concluída e série persistida. O perfil, o peso, 8.500 passos, parcela de 1.500 passos atribuída a treino e o filtro Hábitos oculto já haviam sido confirmados após reinício. A Alimentação exibiu meta, consumo, restante e composição da estimativa com ingestão sintética; somente o perfil de validação foi escrito.

**Visual:** 42 combinações (7 telas alteradas × 3 resoluções: 1366×768, 1920×1080 e 2560×1440 × temas claro/escuro), sem overflow horizontal nem alertas. Telas: Treinos/Plano, Exercícios, Progresso corporal, Alimentação/Hoje, Calendário, Home e Configurações/Perfil. Capturas estão em `artifacts/v110/visual/`, ignoradas pelo Git.

**Verificações após mover o repositório para `%USERPROFILE%\Documents\ChatGPT\Rumo`:** dependências foram reinstaladas pelo lockfile porque a cópia de `node_modules` estava incompleta. O frontend mostrou apenas o aviso informativo de chunk >500 kB. Prettier identificou apenas `index.html`, que foi formatado antes do check final. A primeira compilação Rust encontrou `OUT_DIR` antigo no cache release movido; somente `src-tauri/target/release` foi limpo para recompilar no caminho novo. O repositório ainda não tem primeiro commit, portanto `git diff --check` sozinho não cobre arquivos não rastreados.
**Resultado final após a mudança de caminho:** Prettier passou em **170 arquivos** verificados em lotes, ESLint e TypeScript passaram, a suíte passou **186/186** novamente, o frontend de produção passou, `npm audit --audit-level=low` retornou **0 vulnerabilidades**, `scripts/validate-files.mjs` passou em **192 arquivos**, `git diff --check` e `cargo fmt --check` passaram. `cargo test --release --lib` passou **4/4**, incluindo backup/restore. `npm run desktop:build` gerou executável e instalador NSIS x64 após a última alteração funcional; o único aviso Rust foi informativo do linker MSVC. O diretório temporário `%USERPROFILE%\AppData\Roaming\com.rumo.validation.v110` foi removido após verificar o identificador, a ausência de processo RUMO e a distinção do perfil de produção `com.rumo.desktop`.

Artefatos finais gerados em **2026-09-28 16:19:34 -03:00**:

| Artefato        | Caminho absoluto                                                                                     |      Bytes | SHA-256                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------- | ---------: | ------------------------------------------------------------------ |
| Executável      | `%USERPROFILE%\Documents\ChatGPT\Rumo\src-tauri\target\release\rumo.exe`                             | 13.016.064 | `6E0A7D3D2E52314ACAF060C8144C164B69FBB77AD68BD25466DBD52025C5101D` |
| Instalador NSIS | `%USERPROFILE%\Documents\ChatGPT\Rumo\src-tauri\target\release\bundle\nsis\RUMO_1.1.0_x64-setup.exe` |  3.333.025 | `330EBE6D9E2DD65E58F65047B64D5AC6DCE332574CB938049CFA0F750D5DCC11` |

Smart App Control permaneceu ativado. Os artefatos não têm assinatura de código confiável e podem ser bloqueados na distribuição; isso não indica bug funcional do RUMO.

## RUMO 1.2.0 — continuidade semanal (28/09/2026)

`0013_continuity.sql` foi aplicada depois da schema 12 em banco de teste, preservando Task, Project e Settings existentes, com `PRAGMA integrity_check = ok`. A migration adiciona `templates`, `template_applications`, `template_diary_applications`, `notification_preferences`, `notification_deliveries`, `weekly_review_notes` e antecedência opcional de lembrete em Tasks. Nenhuma migration anterior foi editada. A cópia de templates compostos é atômica: exercício inexistente provoca rollback sem plano parcial; instâncias de Routine e Workout são independentes do template e entre si. A cópia de Meal para diário manteve proporção de nutrientes.

A Revisão Semanal consulta somente a semana selecionada e a seguinte, reúne Tasks, Projects, Habits, Routines, Workouts, passos, peso, Nutrition e Finance, e respeita `Ocultar valores` (a UI exibiu `R$ •••••` no perfil isolado). Semana vazia e semana parcial passaram nos testes. A Home mostra apenas acesso compacto; a nota é salva por semana. O Quick Add usa parsing local de datas e decimais pt-BR; casos testados incluem tarefa com horário, 9.230 passos, 90,8 kg, R$ 83,40, pensamento e texto ambíguo encaminhado ao Inbox. A transação pede confirmação de tipo/conta. Ctrl + K e Ctrl + Espaço foram exercitados separadamente.

Notificações começam desativadas e exigem permissão do Windows. Preferências e identificadores de entrega ficam no SQLite; a mesma entrega não é reclamada duas vezes. O smoke nativo no perfil `com.rumo.validation.v120` ativou a categoria, chamou a API oficial de notificação e confirmou uma única linha de entrega após nova verificação. A aparição visual do toast na área de notificações do Windows não foi inspecionada diretamente. O agendador roda apenas enquanto o aplicativo está aberto, a cada minuto; não há entrega com o processo encerrado nem roteamento por clique no desktop. Conteúdo sensível fica oculto por padrão e finanças nunca incluem valor no lembrete.

O smoke da versão 1.2 usou exclusivamente `%USERPROFILE%\AppData\Roaming\com.rumo.validation.v120\rumo.db`. Pela UI foram criados Task, passos, peso, Thought, Inbox, transação e templates; Project, Habit, Routine, Workout e Nutrition foram acrescentados somente nesse perfil para conferir a agregação e a aplicação dos modelos. Templates de Routine, Workout e Meal foram instanciados, e uma Meal foi copiada ao diário. O fechamento nativo seguido de reabertura confirmou contagens idênticas em 23 tabelas, passos e peso preservados, nota semanal persistente e `integrity_check = ok`. Após corrigir chaves React para usar IDs, não houve novo aviso de chave duplicada.

A auditoria visual cobriu **18 combinações** das três telas novas (Revisão, Quick Add e Configurações/Templates/Notificações) em 1366×768, 1920×1080 e 2560×1440, nos temas claro e escuro. Não houve overflow horizontal. Tab, Escape e o foco do Quick Add foram verificados. O processamento da Revisão usa agregações SQL delimitadas por semana; a galeria de templates carrega ao abrir; o Quick Add não inicializa módulos inteiros para apresentar o diálogo. Não foi executado benchmark numérico de base grande nesta versão, portanto não há latência máxima medida a declarar.

O repositório ainda não possui primeiro commit; por isso `git diff --check` isoladamente não cobre os arquivos não rastreados. A validação integral usa também `scripts/validate-files.mjs` e Prettier. O identificador de produção permanece `com.rumo.desktop`; o perfil pessoal não foi usado no smoke. Smart App Control permaneceu ativado. Binários sem assinatura confiável podem ser bloqueados na distribuição; assinatura de código continua pendente e não representa defeito funcional.

**Validação final 1.2.0:** Prettier (`--check .`), ESLint, TypeScript, **197/197 testes em 27 arquivos** (os 186 da versão 1.1 preservados, 11 novos), frontend de produção, `cargo fmt --check`, **4/4 testes nativos** de backup/restore, `git diff --check` e validação integral de **205 arquivos** passaram. `npm audit --audit-level=low` encontrou **0 vulnerabilidades**. `npm run desktop:build` recompilou o frontend e gerou aplicativo e instalador NSIS x64 após a última mudança funcional. Houve apenas o aviso informativo do linker MSVC sobre os arquivos `.lib/.exp` e o aviso Vite de chunk acima de 500 kB.

| Artefato        | Caminho absoluto                                                                                     |      Bytes | Modificado (-03:00) | SHA-256                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------- | ---------: | ------------------- | ------------------------------------------------------------------ |
| Executável      | `%USERPROFILE%\Documents\ChatGPT\Rumo\src-tauri\target\release\rumo.exe`                             | 13.429.248 | 2026-09-28 21:32:57 | `987EF23D7AFBFB90854412D9717E7F2E26770B512ADDB567BED8B65A25FE2E13` |
| Instalador NSIS | `%USERPROFILE%\Documents\ChatGPT\Rumo\src-tauri\target\release\bundle\nsis\RUMO_1.2.0_x64-setup.exe` |  3.418.318 | 2026-09-28 21:32:57 | `2AC764958861BDC1E517B7E4F1F96B48D78BDF6912F791C89034A539D105A568` |

## RUMO 1.3.0 — Objetivos e Timeline (28/09/2026)

`0014_objectives_timeline.sql` é aditiva sobre schema 13. Cria `objectives`, `objective_links`, `objective_updates`, `timeline_notes` e uma ação SQLite para criar Task/Project/Habit e vínculo atomicamente. A migration amplia as preferências existentes do Calendário sem perder filtros anteriores; `PRAGMA integrity_check` passou. Objetivos ligados usam as entidades originais, aceitam vários vínculos e derivam progresso de Project, meta financeira ou medida corporal. Arquivar/concluir Objetivo não altera os itens vinculados. O progresso financeiro segue “Ocultar valores”.

A Timeline lê os módulos de origem sem armazenar cópias de seus eventos, agrupa por data local, consulta inicialmente 90 dias e pagina até 40 registros por vez. Habits, medidas e diário são agregados por dia. Os filtros cobrem grupo, módulo, período, Objetivo e texto. Thought fornece só o título; modo privado oculta detalhes de corpo, Thought, atualização, Momento e Finanças. A busca textual da Timeline pesquisa apenas o texto que seria exibido, impedindo descobrir descrição financeira oculta pelo resultado da busca. A Home lê no máximo três Objetivos ativos; a Revisão Semanal consulta somente Objetivos com vínculos ou atualizações na semana; Busca Global e Quick Add cobrem Objetivos e Momentos. Prazos dos Objetivos aparecem no Calendário e respeitam visibilidade global e individual.

**Testes funcionais:** 206/206 em 28 arquivos, incluindo os 197 anteriores e nove novos para upgrade 13→14, vínculos e limpeza referencial, criação atômica, progresso derivado, paginação e filtragem da Timeline, privacidade, Calendar, Revisão Semanal, Busca Global e Quick Add. A suíte foi executada com `--maxWorkers=1` porque a execução paralela anterior provocou timeouts em testes de UI de módulos antigos; esses casos passaram isoladamente sem alterar asserts. TypeScript, ESLint, Prettier, frontend de produção, `cargo fmt --check`, quatro testes nativos de backup, `git diff --check` e `scripts/validate-files.mjs` (212 arquivos) passaram. `npm audit --audit-level=low` encontrou zero vulnerabilidades. O frontend emite apenas aviso de chunk acima de 500 kB.

**Smoke e persistência:** a UI do perfil exclusivo `com.rumo.validation.v130` criou Objetivo “Melhorar composição corporal”, Habit vinculado “Caminhar”, atualização e Momento “Primeira caminhada”. A Timeline filtrou por Objetivo e por Momentos. Após encerramento completo do `tauri dev` e reabertura, o banco isolado conservou 1 Objetivo, 1 vínculo, 1 atualização, 1 Momento e schema 14; `integrity_check = ok`. Backup nativo do schema 14 foi criado, uma alteração posterior foi revertida por restore e o backup preventivo foi confirmado. Também foi restaurado nesse perfil um backup do antigo perfil sintético da 1.2 (schema 13); após reiniciar, a migration 0014 levou-o ao schema 14 com dados antigos e integridade preservados. Por fim, o backup preventivo recuperou o estado da 1.3. O perfil pessoal `com.rumo.desktop` não foi usado nesses testes.

**Visual e desempenho:** 24 combinações de Objetivos, Timeline, Home e Calendário em 1366×768, 1920×1080 e 2560×1440, claro e escuro, sem overflow horizontal ou erro de página. Ctrl+K, Ctrl+Espaço e Escape foram exercitados. Em SQLite sintético isolado com 5.000 Tasks, 5.000 Momentos e 200 Objetivos, as consultas sequenciais mediram: lista de Objetivos 9 ms, primeira página da Timeline 72 ms, página seguinte 103 ms, Busca Global 21 ms e Revisão Semanal 35 ms. A Revisão levava cerca de 1.046 ms antes de restringir a agregação a Objetivos com vínculos/atualizações. São tempos de consulta local, não de pintura total da interface.

O repositório permanece sem primeiro commit; `git diff --check` isolado não cobre arquivos não rastreados. A validação integral de arquivos e Prettier complementam essa lacuna. Smart App Control permaneceu ativado; os binários Windows sem assinatura confiável podem ser bloqueados na distribuição. Assinatura de código continua pendência de release/distribuição, não um defeito funcional.

**Build final:** `npm run desktop:build` passou após a última alteração funcional e gerou executável x64 e instalador NSIS 1.3.0. A compilação Rust reportou apenas o aviso conhecido do linker MSVC; o Vite reportou o aviso informativo de chunk acima de 500 kB. Artefatos confirmados no filesystem:

| Artefato        | Caminho absoluto                                                                                     |      Bytes | Modificado (-03:00) | SHA-256                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------- | ---------: | ------------------- | ------------------------------------------------------------------ |
| Executável      | `%USERPROFILE%\Documents\ChatGPT\Rumo\src-tauri\target\release\rumo.exe`                             | 13.446.144 | 2026-09-28 22:47:38 | `CA180D3EBA0111D8229824387C5CB3A8A34570BAC817A86D725F232DC0D3C257` |
| Instalador NSIS | `%USERPROFILE%\Documents\ChatGPT\Rumo\src-tauri\target\release\bundle\nsis\RUMO_1.3.0_x64-setup.exe` |  3.425.807 | 2026-09-28 22:47:38 | `B87C9DEEF1E1EC7627059B8CAF28037A3981050A0FF87ACFCB28B692EFB96F15` |

# RUMO 1.7 — checkpoint da integração Google Agenda (01/10/2026)

**Implementação local em andamento; release 1.7.0 ainda não validada.** O banco pessoal não foi usado. O pacote e os metadados continuam em 1.6.0, pois a validação nativa e live não terminou. As migrations aditivas `0025_google_calendar.sql`, `0026_google_calendar_sources.sql` e `0027_google_calendar_bootstrap.sql` levam o schema de teste a 27; 0001–0024 não foram alteradas. O teste de upgrade aplica 0025–0027 sobre schema 24 com Task preexistente, preserva a linha, confirma `integrity_check = ok`, nenhuma violação de chave estrangeira e estado inicial desconectado sem envio automático.

O núcleo local usa agenda secundária RUMO, Client ID OAuth Desktop, navegador do sistema, callback loopback, PKCE S256, `state` e escopo `calendar.app.created`. A camada Rust guarda refresh token no Gerenciador de Credenciais do Windows e access token apenas em memória; o React não recebe tokens. O SQLite guarda somente configuração não secreta, vínculos, fila e log técnico com retenção de 500 registros. O JSON portátil tem allowlist que exclui essas tabelas, e teste explícito procura `access_token`/`refresh_token`. O backup é snapshot SQLite; como não há coluna de token, não carrega credenciais. Ao restaurar em Windows sem credencial, a interface marca necessidade de reconexão. **Esse fluxo nativo de credenciais/restore ainda não foi executado nesta rodada.**

A primeira conexão não inicia o envio: o usuário escolhe data inicial, fontes e horizonte e inicia em **Sincronizar agora**. Rotinas e Time Blocks vêm ativos; Treinos, Tasks, Objetivos e Marcos vêm desativados. Itens sem horário são ignorados por padrão. O motor lê dados locais após commit, reconcilia IDs estáveis, cria/atualiza/remove eventos na agenda secundária, usa fila persistente e retry exponencial. Em teste com cliente fake, create repetido não duplicou, edição fez PATCH, falha de rede preservou a fila, HTTP 429 agendou retry, ausência remota (404) recriou o evento, revogação marcou reconexão e remoção local eliminou o evento remoto. Reduzir a janela futura **não** apagou evento válido; ocultação explícita o removeu. Uma Task representada por Time Block passou a ter apenas o evento do bloco. Desligar o espelho individual de uma rotina removeu somente seu evento remoto, preservando a rotina no SQLite.

Eventos com horário carregam fuso IANA sem offset fixo; all-day usa `DATE`. Rotinas e treinos usam RRULE; séries de Time Block aplicam EXDATE e exceção movida como evento próprio. Recorrência mensal que ajusta meses curtos e séries com `COUNT` usam RDATE dentro de janela móvel. Tarefas recorrentes anteriores à data inicial entram a partir da primeira ocorrência elegível; dias personalizados e exceção de Time Block foram testados. A escolha de ocultar no Calendário interno também é respeitada pelo espelho. Preferências de fontes e itens podem ser alteradas sem modificar os dados locais.

**Validações finais após o último ajuste funcional:** 305/305 testes de aplicação em 42 arquivos, incluindo os 290 anteriores e 15 novos; TypeScript e lint aprovados; `npx prettier --check .` aprovado; frontend de produção aprovado; `npm audit --audit-level=low` com zero vulnerabilidades; `node scripts/validate-files.mjs` conferiu 282 arquivos de texto, incluindo não rastreados; `git diff --check` aprovado. O repositório não tem primeiro commit, então o diff isoladamente não examina toda a árvore. `cargo fmt --check` global encontra diferenças já existentes em arquivos Rust anteriores; `rustfmt --edition 2021 --check src/google_calendar.rs` passou para o módulo Rust novo. O frontend mantém aviso informativo de chunk acima de 500 kB.

**Validação nativa:** `cargo check --offline` e `npm run desktop:build` foram tentados pelo fluxo normal. A build Tauri foi repetida após o último ajuste funcional. Todos pararam no build script/dependência da toolchain antes de verificar o novo módulo: `LoadLibraryExW failed: Uma política de Controle de Aplicativo bloqueou este arquivo (os error 4551)`. Na build release, o arquivo bloqueado foi `time_macros-...dll`; no `cargo check`, `phf_macros-...dll`. O frontend foi compilado pela build Tauri, mas **compilação Rust final, testes Rust, executável 1.7, NSIS e smoke nativo não foram concluídos**. O `rumo.exe` ainda presente em `target/release` tem timestamp 29/09/2026 e pertence à build 1.5.0; não é artefato desta integração. Não existe instalador 1.7.0. Smart App Control permaneceu ativado; nenhum bypass foi tentado. O bloqueio é da execução de macros da toolchain, não um erro de compilação diagnosticado no código do RUMO. A integração com API Google real não foi testada porque não há credencial/conta de teste autorizada neste ambiente; os testes normais usam cliente fake e não exigem rede.

Pendências para fechar a release 1.7.0: validar compilação/testes e smoke nativos em Windows que permita legitimamente executar a toolchain, testar OAuth/sincronização numa conta Google de teste autorizada, auditar a UI nativa e então aplicar o versionamento 1.7.0 e gerar artefatos finais. Nenhum hash ou pacote 1.7 foi declarado.

---

## RUMO 1.8 — checkpoint Windows e Open Finance (02/10/2026)

**Ainda não é uma release validada.** Metadados permanecem em 1.6.0. A base anterior passou 313/313 testes antes do trabalho da 1.8. A migration aditiva `0028_financial_connections.sql` eleva o schema de teste a **28** e não altera 0001–0027. Ela cria `financial_connections`, `financial_external_accounts`, `financial_external_transaction_links` e `financial_sync_runs`, com índices, unicidade de IDs externos e chaves estrangeiras. O teste de upgrade 27→28 preservou conta anterior, `PRAGMA foreign_key_check` ficou vazio e `integrity_check` retornou `ok`. Não há campo de token/secret nessas tabelas.

O contrato `FinancialConnectionProvider` e o fake implementam consentimento, contas, transações paginadas e falhas transitórias. Em banco isolado, testes importaram **500 transações** de duas contas vinculadas explicitamente, repetiram o sync sem duplicar, atualizaram pending→posted sem duplicar, preservaram possível duplicata OFX para revisão, retiveram pagamento de cartão para revisão, preservaram dados após disconnect e repetiram um sync após erro 429 simulado. A prévia passou a consultar vínculos/OFX em lotes por conta. A sincronização normal consulta sete dias de sobreposição e inclui pendências antigas. Conta vinculada com transações não pode ser remapeada; saldo externo permanece separado do saldo local. A aba Finanças → Contas conectadas mostra estados e prévia, mas **não oferece conexão live**: faltam intermediário seguro, credenciais e contrato legítimos. Não houve acesso a conta bancária pessoal. A decisão e fontes estão em `OPEN_FINANCE_ARCHITECTURE.md`.

Windows: foram adicionados tray Tauri, registro de instância única, autostart opcional, preferência de iniciar minimizado, escolha fechar para tray/encerrar, atalho global opcional, comandos de Focus no tray e um scheduler central de 60 segundos/Google a cada cinco minutos. A preferência padrão preserva o encerramento no X. A revisão estática corrigiu o caminho usado no início minimizado para `app_config_dir`, igual ao backup/banco nativo. A lógica de scheduler foi testada com relógio simulado, incluindo modo oculto e parada, mas **não houve smoke nativo**. Os detalhes e limites estão em `WINDOWS_INTEGRATION.md`. O comportamento de menu, hotkey, início automático, Focus e fechamento precisa ser verificado no Windows real antes de declarar release.

**Validações após a última alteração funcional:** suíte de aplicação **326/326 em 46 arquivos**; os 313 anteriores permaneceram verdes. `npx prettier --check .`, ESLint, TypeScript, frontend de produção, `npm audit --audit-level=low` (**0 vulnerabilidades**), `scripts/validate-files.mjs` (**297 arquivos**, incluindo não rastreados), `git diff --check`, `cargo metadata --locked --no-deps` e `rustfmt --check` apenas em `lib.rs`/`windows.rs` passaram. O Vite emitiu somente avisos sobre chunk grande e imports dinâmicos também importados estaticamente. A tentativa normal de `cargo check` atualizou `Cargo.lock`, compilou parte das dependências e parou antes do código Rust do RUMO: `LoadLibraryExW failed: Uma política de Controle de Aplicativo bloqueou este arquivo (os error 4551)` ao carregar `phf_macros-...dll` nos build scripts de autostart/global-shortcut. Não é prova de compilação Rust final nem de erro no código do RUMO. Smart App Control permaneceu ativo; nenhum bypass foi tentado. Não houve build Tauri/NSIS 1.8 nem artefatos 1.8.

**Próximo passo objetivo:** executar checks restantes; revisar estaticamente as APIs Rust Tauri; completar e testar os detalhes de UX Windows/Finanças que faltarem; em ambiente Windows legítimo que permita a toolchain, compilar, executar testes nativos e smoke em perfil isolado. A conexão Open Finance live exige infraestrutura externa segura e validação específica, sem segredo no desktop.

### Continuação Open Finance com gateway Pluggy (02/10/2026)

O gateway separado `services/rumo-finance-gateway` foi implementado em Node.js 24 com SQLite **próprio**, mínimo: códigos de pareamento temporários, hashes de credenciais de dispositivo, referências a Items e IDs/versões de webhook. Não contém histórico de transações nem credenciais Pluggy no banco. `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` são lidos apenas de variáveis do servidor; o exemplo `.env.example` não contém valores. O gateway escuta em loopback, exige HTTPS público para uso não local por proxy reverso, autentica endpoints financeiros por dispositivo e rejeita Item de outro dispositivo. O webhook é autenticado por header configurado na Pluggy, idempotente por `eventId`, e sinaliza atualização por `dirty_version` para não apagar evento novo durante um sync. Eventos de pagamentos são ignorados e confirmados sem iniciar qualquer operação financeira.

O adaptador `PluggyFinancialConnectionProvider` mantém o contrato neutro e o fake anterior. `pluggy-connect-sdk` é carregado sob demanda para o fluxo oficial de consentimento; o modo padrão restringe a seleção a conectores marcados `isSandbox`. O `clientUserId` é o UUID opaco do dispositivo. O comando nativo WinHTTP usa URL de gateway definida na compilação e guarda o segredo do dispositivo no Windows Credential Manager, sem enviá-lo ao JavaScript, SQLite, backup ou exportação. A build distribuída sem `RUMO_FINANCE_GATEWAY_URL` deixa a conexão indisponível, mantendo Finance/OFX/CSV offline. O scheduler local acorda em intervalos de cinco minutos e tenta sync somente em conexão vinculada com atualização pendente ou seis horas de defasagem, conforme preferência; roda também no tray enquanto o processo permanecer vivo. Reconciliação conservadora cobre ID novo de pending→posted apenas com conta/data/valor/descrição normalizada **únicos**; casos ambíguos não são mesclados automaticamente.

**Validações realmente executadas:** no início desta continuação, 326/326 testes de aplicação passaram. Após as alterações funcionais, **328/328 em 47 arquivos** passaram; os 326 anteriores foram preservados e dois testes novos verificam o adaptador e a troca conservadora de ID pending→posted. O gateway passou **6/6** testes Node/HTTP mockados: pareamento de uso único, autenticação/isolamento/revogação de dispositivo, Connect Token, contas/transações normalizadas, cache de API Key/renovação em 401, retry limitado em GET, ausência de retry cego em POST, webhook autenticado/idempotente e versão de dirty. `npx prettier --check .`, ESLint, TypeScript e frontend production build passaram. `npm audit --audit-level=low` retornou **0 vulnerabilidades** tanto no desktop quanto no gateway. `node scripts/validate-files.mjs` examinou **311 arquivos** de texto rastreados e não rastreados; `git diff --check` passou, mas o repositório ainda não tem primeiro commit e esse comando isolado não cobre arquivos não rastreados. `rustfmt --check` passou no módulo Rust novo e em `lib.rs` com `skip_children`; o check global continua mostrando formatação anterior em outros módulos Rust. O build frontend emitiu somente avisos informativos de chunk grande/imports dinâmicos.

**Limites de validação:** não havia credenciais/contrato Pluggy, deployment HTTPS, instituição Sandbox autorizada ou conta bancária de teste; **nenhum teste Pluggy Sandbox ou Live ocorreu**. O caminho Rust/WinHTTP/Credential Manager, o widget no WebView, OAuth em navegador, sync no tray e smoke Windows **não foram executados**. O último `cargo check` deste ambiente já havia parado antes do código RUMO com Windows Application Control **4551** ao carregar `phf_macros` da toolchain. Como o ambiente não mudou, não se repetiu a mesma tentativa nem se contornou a proteção. Portanto compilação Rust final, testes nativos, Tauri/NSIS e performance end-to-end 10 mil transações permanecem pendentes. As medições existentes da suíte cobrem Finance local e exportações, não latência do gateway/Pluggy. Metadados permanecem em **1.6.0**; nenhum pacote ou hash 1.8 foi declarado. O modo Live deve continuar desabilitado até Sandbox, execução nativa, segurança operacional e autorização externa serem validados.

### Auditoria final do gateway Pluggy (02/10/2026)

**Resultado funcional mockado:** 331/331 testes de aplicação em 47 arquivos, incluindo os 328 do checkpoint anterior e três testes novos; gateway 8/8, preservando os seis anteriores. Os novos casos verificam single-flight por conexão, cursor cíclico, duas compras postadas iguais após uma pendência, isolamento completo de Item entre dois dispositivos, cursor de Pluggy malformado/de outra conta e content type de webhook. Reembolso agora fica na prévia como **revisão**, sem ser importado como receita comum; compra original permanece, e pagamento de fatura continua fora das despesas automáticas. A importação testada de 500 transações e o replay sem duplicação permanecem verdes. O cursor não é checkpoint persistente: uma rodada falha não atualiza `last_synced_at`, e a próxima consulta repete a janela sobreposta e deduplica por vínculo externo.

**Gateway e segurança:** API `/v1`, gateway `0.1.0`; `/health` informa apenas versão, ambiente e status. Erros JSON expõem código e mensagem genérica, sem stack/payload upstream. Todas as rotas financeiras exigem dispositivo autenticado; Item, status, contas, transações, ack de sync e exclusão de outro dispositivo retornam negação, enquanto a lista dele fica vazia. O webhook exige segredo próprio, JSON e tamanho máximo, deduplica por `eventId` e conserva só o ID por até 90 dias. O gateway persiste códigos de pareamento em hash, ID/hash/revogação de dispositivo, Item/proprietário/instituição/dirty version e IDs de webhook; não persiste saldo, contas completas ou transações. A credencial no Windows Credential Manager passou a ser vinculada à origem do gateway embutida na build, evitando reutilização acidental em outra origem. A API Key Pluggy, o Client Secret e o webhook secret permanecem somente no servidor; o Connect Token é transitório no frontend para o widget. A inspeção de arquivos/referências e do `.env.example` não encontrou valores reais. Logs do serviço contêm somente a porta local e respostas administrativas curtas; o comando administrativo `pair-code` exibe o código ao operador de forma intencional, sem gravá-lo em log do servidor. Não há CORS aberto. Sem credenciais configuradas neste ambiente (`PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `GATEWAY_WEBHOOK_SECRET` ausentes; `.env` ausente), **Sandbox E2E não foi executado**; Live também não. Nenhum banco pessoal ou conta bancária real foi usado.

**Checks depois da última alteração funcional:** Prettier `--check .`, ESLint, TypeScript, frontend production build, desktop 331/331, gateway 8/8, check sintático de todos os módulos `.mjs`, `npm audit --audit-level=low` em ambos os pacotes (**0 vulnerabilidades**), `git diff --check`, `scripts/validate-files.mjs` (**312 arquivos rastreados/não rastreados**) e `rustfmt --check` do módulo Rust novo/registro de comandos passaram. O frontend emitiu somente os avisos conhecidos de chunk grande e import dinâmico compartilhado. Não há benchmark novo de 10 mil transações nem medição do gateway sob carga. Como o repositório ainda não possui primeiro commit, `git diff --check` sozinho não examina todos os arquivos.

**Nativo no checkpoint:** a primeira tentativa de `cargo check --locked` avançou até compilar `rumo v1.6.0`, mas parou na dependência `tauri v2.12.0` com `E0463: can't find crate for serialize_to_javascript`; o compilador não concluiu a verificação do módulo Rust do gateway. A investigação e a causa identificada constam na seção seguinte. Testes Rust, WinHTTP/Credential Manager real, widget nativo, tray, Tauri production build e NSIS desta evolução **continuam sem validação**. Os artefatos antigos não são builds Open Finance 1.8. Metadados do desktop seguem em **1.6.0** e não há hash/instalador 1.8 a declarar.

**Próximo passo exato:** em ambiente Windows que permita legitimamente verificar a toolchain, resolver o erro de dependência nativa pelo fluxo normal, compilar e executar testes/smoke em perfil isolado; com credenciais Sandbox autorizadas, exercitar gateway HTTPS → Connect Widget → Item → contas → prévia → importação → replay sem duplicação. Somente depois considerar Live, bump e pacote 1.8.

### Diagnóstico nativo E0463 — 02/10/2026

**Causa identificada:** `tauri v2.12.0` solicita `serialize-to-javascript v0.1.2`, que solicita o proc-macro `serialize-to-javascript-impl v0.1.2`. A resolução de `Cargo.lock` e `cargo tree --locked` está coerente; `Cargo.toml` usa Tauri 2 e plugins Tauri 2, sem incompatibilidade demonstrada. Toolchain: `rustc`/`cargo 1.98.1`, target `x86_64-pc-windows-msvc`, `stable-x86_64-pc-windows-msvc`; `cargo metadata --locked --no-deps` passou e apontou para `src-tauri/target` no próprio workspace. Nenhuma dependência, feature flag, versão ou `Cargo.lock` foi alterado.

O erro inicial completo foi `error[E0463]: can't find crate for serialize_to_javascript` em `tauri-2.12.0/src/event/plugin.rs:5:5`. Após limpar **somente** os artefatos locais de `serialize-to-javascript` com `cargo clean -p serialize-to-javascript`, o erro avançou para `error[E0463]: can't find crate for serialize_to_javascript_impl` em `serialize-to-javascript-0.1.2/src/lib.rs:62:9`. Limpar apenas `serialize-to-javascript-impl` reconstruiu sua DLL, mas o mesmo E0463 permaneceu. O log **Microsoft-Windows-CodeIntegrity/Operational**, evento **3077** às 11:16:33, identifica `rustc.exe` tentando carregar `src-tauri/target/debug/deps/serialize_to_javascript_impl-7e85e7388121c324.dll` e sendo recusado por requisito de assinatura Enterprise/política de integridade. Eventos 3033 correlatos ocorreram no mesmo instante. Portanto, o E0463 é o sintoma no compilador de uma **negação de carregamento pelo Windows Application Control**, não uma versão ausente do crate. Esta rodada não exibiu o texto `os error 4551` no Cargo, mas confirmou o bloqueio de política pelo evento 3077. Nenhum bypass, exceção ou alteração de proteção foi feito; as tentativas de compilação foram encerradas após essa evidência.

**Estado da validação:** `cargo check --locked` bloqueado antes de verificar o código Rust do RUMO; `cargo test`, build Tauri, NSIS e smoke nativo **não executados**. Assim também permanecem sem validação nativa tray, single instance, autostart, hotkey global, notificações, Focus, armazenamento no Credential Manager, attachments/backup/restore da 1.6 e OAuth Google da 1.7. Nenhum perfil pessoal foi usado. Não há variáveis Pluggy Sandbox configuradas (`PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` e `GATEWAY_WEBHOOK_SECRET` ausentes; `.env` do gateway ausente), então Sandbox E2E **não executado**; Pluggy Live continua desabilitado. O Google OAuth live não foi tentado nem foram lidos dados pessoais para procurar um Client ID.

**Próximo passo:** executar a toolchain e os testes em um Windows que permita legitimamente carregar os proc-macros, ou após assinatura confiável apropriada, sem reduzir as proteções. Em seguida: `cargo check --locked`, `cargo test`, Tauri build/NSIS, smoke nativo em perfil isolado e, separadamente, Sandbox Pluggy com credenciais de teste autorizadas. Até lá, não há build de validação 1.8 nem release 1.8 aprovada.

### CI Windows preparada — 02/10/2026

Foi criado `.github/workflows/windows-ci.yml`, documentado em `WINDOWS_CI.md`. Em runner oficial `windows-2022`, o workflow usa Node 24 e Rust estável MSVC; instala os dois pacotes JS com seus lockfiles, roda Prettier/lint/TypeScript/testes/build/audit/validação integral no desktop e testes/check sintático/audit no gateway, depois `cargo metadata --locked`, `cargo tree --locked`, `cargo check --locked` e `cargo test --locked`. Somente após sucesso executa o script real `npm run desktop:build`, exige `rumo.exe` e um NSIS x64, imprime tamanhos/SHA-256 e publica só os dois binários **sem assinatura** como artifacts de validação. Não há cache Rust, credenciais Pluggy/Google, banco pessoal, Sandbox/Live, assinatura ou smoke interativo. A versão do desktop permanece 1.6.0.

**Estado naquele checkpoint: CI preparada, execução remota pendente.** O repositório ainda não possuía commit nem remoto. A execução posterior e os resultados reais estão registrados abaixo.

### CI Windows executada — 02/10/2026

O primeiro commit auditado foi `e110ed3` (`Initial RUMO development checkpoint`). O código foi enviado apenas ao repositório GitHub **privado** `ClarkSantt/RUMO`, branch `main`; a visibilidade `PRIVATE` foi confirmada pela API antes e depois do push. A auditoria pré-commit examinou os 322 arquivos candidatos, `.gitignore`, arquivos ignorados e padrões de segredos. Não foram versionados `.env` real, banco pessoal, backups, attachments pessoais, OFX real, logs locais, certificados, chaves ou artifacts. O `.env.example` contém apenas nomes de campos sem credenciais. Os dois fixtures OFX versionados são sintéticos. O artifact remoto contém somente os dois binários de validação.

O [run 37042127435](https://github.com/ClarkSantt/RUMO/actions/runs/37042127435) executou no runner `windows-2022`, commit `032c9f3`, entre 17:38:51 e 18:00:40 UTC, com Node `24.21.0`, npm `11.19.0`, `rustc 1.99.0` e `cargo 1.99.0` (MSVC). **Conclusão: success.** Prettier, ESLint, TypeScript, **331/331 testes desktop em 47 arquivos**, frontend production build, `npm audit` desktop (**0 vulnerabilidades**) e validação integral (**314 arquivos de texto**) passaram. No gateway, `npm ci`, **8/8 testes mockados**, check sintático `.mjs` e `npm audit` (**0 vulnerabilidades**) passaram. `cargo metadata --locked`, `cargo tree --locked`, `cargo check --locked` e **8/8 testes Rust** passaram, inclusive o teste do callback OAuth e os testes de backup/restore. `npm run desktop:build` gerou `rumo.exe` e instalador NSIS x64 sem assinatura; a CI verificou os dois, calculou SHA-256 e publicou somente esses arquivos no artifact `rumo-windows-unsigned-validation-5` (retenção de sete dias). As cópias baixadas em `artifacts/ci/37042127435/`, ignoradas pelo Git, tiveram hashes idênticos aos do runner; não foram executadas nesta máquina.

| Artefato de validação | Nome                       |      Bytes | SHA-256                                                            |
| --------------------- | -------------------------- | ---------: | ------------------------------------------------------------------ |
| Executável            | `rumo.exe`                 | 14.490.112 | `D7D5256BF9785A3577C0025DB1F50992B5275990586EFB4F201D3CA657C401BB` |
| Instalador NSIS       | `RUMO_1.6.0_x64-setup.exe` |  3.713.241 | `60335F750ADD69E82E25EB7BCC1A40E34B80B95242D8C36CBED963C4F43A9AC8` |

As primeiras execuções remotas revelaram problemas concretos e foram corrigidas em commits separados: `a762468` fixou LF no checkout Windows via `.gitattributes`; `0b7a899` formatou o único trecho restante de `Home.tsx`; `262898a` corrigiu colisão de diretórios temporários e completou a fixture de schema futuro nos testes Rust; `032c9f3` alinhou **somente** `@tauri-apps/plugin-autostart` JS de 2.7.0 para 2.6.0, versão do `tauri-plugin-autostart` já presente em `Cargo.lock`. Nenhuma migration, código funcional de backup/restore, `Cargo.toml` ou `Cargo.lock` foi alterado para esta validação. A execução verde repetiu todos os checks após essas correções.

**E0463:** não se reproduziu no Windows limpo: o código Rust compilou e os testes executaram. Em conjunto com o evento local Code Integrity 3077, isso confirma o bloqueio da DLL proc-macro como problema ambiental da máquina original, sem justificar alteração das dependências Cargo ou redução da segurança do Windows. Esta CI prova compilação, testes e empacotamento; não executa o aplicativo nem o instalador. Permanecem pendentes os smokes de runtime Windows em perfil isolado (tray, single instance, autostart, hotkey, notificações, Focus e Credential Manager), attachments/backup/restore da 1.6 no runtime, OAuth Google live com conta de teste autorizada e Pluggy Sandbox com credenciais de teste. Pluggy Live não foi habilitado. Não houve bump de versão, tag ou GitHub Release.

### Smoke nativo isolado — preparação (02/10/2026)

**CI Windows: PASS** no run `37042127435` para o commit `032c9f3` (331/331 desktop, 8/8 gateway, 8/8 Rust, cargo check, Tauri e NSIS). Este run compilou a configuração de **produção** e seus binários **não foram executados** nesta máquina porque já existe perfil pessoal `com.rumo.desktop`.

Foi preparado um workflow manual separado e sem instalador para compilar `RUMO-Smoke.exe` com overlay `com.rumo.validation.native.v180`, nome `RUMO Smoke`, namespace Credential Manager `RUMO-Smoke-v180` e entrada de autostart `RUMO Smoke Validation`. O preflight exige SHA-256 independente do manifesto, checa identifier no binário e por IPC, confirma diretórios de dados/backup próprios e executa `integrity_check`. A estratégia e checklist estão em `NATIVE_SMOKE.md`. O novo teste Rust usa somente credencial fictícia no namespace `RUMO-Test` e cleanup mesmo em falha. O workflow e teste novos ainda dependem de execução remota; a CI anterior não prova essas alterações.

| Validação            | Estado       | Evidência / limite                                           |
| -------------------- | ------------ | ------------------------------------------------------------ |
| Smoke profile build  | NOT EXECUTED | Workflow manual ainda não executado neste checkpoint.        |
| Identifier isolation | NOT EXECUTED | Configuração separada; requer verificação do build e IPC.    |
| Data isolation       | NOT EXECUTED | Caminhos derivam do identifier; requer preflight no runtime. |
| Credential Manager   | NOT EXECUTED | Teste nativo fictício adicionado, aguardando CI.             |
| Attachments          | NOT EXECUTED | PDF/PNG sintéticos pendentes.                                |
| Backup               | NOT EXECUTED | Snapshot com anexos pendente.                                |
| Restore              | NOT EXECUTED | Restore, legado e rejeição de arquivo inválido pendentes.    |
| Tray                 | NOT EXECUTED | Runtime pendente.                                            |
| Single instance      | NOT EXECUTED | Runtime pendente.                                            |
| Autostart            | NOT EXECUTED | Runtime e cleanup pendentes.                                 |
| Hotkey               | NOT EXECUTED | Runtime e cleanup pendentes.                                 |
| Notifications        | NOT EXECUTED | API, dedupe e toast visual pendentes.                        |
| Focus                | NOT EXECUTED | Runtime e persistência pendentes.                            |

**Pluggy Sandbox: NOT EXECUTED.** Neste ambiente não há `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `GATEWAY_WEBHOOK_SECRET` nem `.env` privado do gateway; também não há endpoint gateway de teste configurado. `OPEN_FINANCE_BACKEND_SETUP.md` documenta as variáveis e o fluxo. Nenhum valor foi lido ou registrado. **Pluggy Live: NOT EXECUTED**, permanece desabilitado. **Google OAuth live/test account: NOT EXECUTED**, sem credenciais/conta de teste autorizadas nesta rodada.

### Smoke nativo isolado — execução de 02/10/2026

Esta seção atualiza o checkpoint de preparação acima. **CI normal: PASS**, run `37065226838`, commit `21babb4d659863259c3940ecd67da54fd2c406cb`: desktop **331/331**, gateway **8/8**, Rust **10/10** (incluindo write/read/replace/delete de credencial fictícia com cleanup), cargo check, Tauri production build e NSIS. O build de produção desta CI **não foi executado** nesta máquina. **Build smoke: PASS**, workflow manual privado run `37065225955`, mesmo commit, sem instalador/release: `RUMO-Smoke.exe`, 14.490.624 bytes, SHA-256 `175F8B141DCD07A8B123A0BBC6A0DCB5F6492D29E1F0E9037F61852562905C14`.

O identifier de produção é `com.rumo.desktop` e o isolado é `com.rumo.validation.native.v180`; productName, namespace Credential Manager e nome de autostart também são distintos. O preflight comparou o hash com o valor copiado separadamente do log da CI, rejeitou o identifier/hash de produção, verificou identifier por IPC, diretório `%APPDATA%/com.rumo.validation.native.v180`, schema **28** e `integrity_check: ok`. O diretório smoke não existia antes da primeira execução; o perfil de produção não foi aberto, copiado ou executado. Nenhuma proteção do Windows foi desativada.

| Validação              | Estado                   | Evidência / limite                                                                                                                                                                                    |
| ---------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smoke profile e dados  | PASS                     | Build isolado, preflight e SQLite sintético schema 28, `integrity_check: ok`.                                                                                                                         |
| Credential Manager     | PASS na CI Rust          | Credencial aleatória `RUMO-Test`, write/read/replace/read/delete/ausência e cleanup; comando de credencial no runtime smoke não foi exposto nem executado.                                            |
| Attachments PDF/PNG    | PASS                     | Dois arquivos sintéticos anexados a Project; `attachment_open` e reveal retornaram sucesso; viewer/Explorer não foram inspecionados visualmente. Dois anexos persistiram após restart.                |
| Backup e restore       | PASS                     | Backup incluiu os dois anexos; alteração e remoção foram revertidas. Backup preventivo continha o estado anterior à restauração. ZIP inválido foi rejeitado sem alterar Project/anexo.                |
| Backup antigo          | PASS                     | Fixture sem anexos, schema 19, restaurada; processo reiniciado; migrations até schema 28, projeto legado e integridade confirmados. Backup moderno sintético foi restaurado de volta com dois anexos. |
| Tray                   | PARCIAL                  | Close-to-tray manteve processo, ocultou janela e permitiu restaurar por API; clique no ícone/menu não foi observado.                                                                                  |
| Single instance        | PASS                     | Segunda instância smoke saiu sem abrir outra aplicação; primeira permaneceu ativa.                                                                                                                    |
| Autostart e minimizado | PASS                     | `enable`/`is_enabled`/`disable`; entrada `RUMO Smoke Validation` ausente no Registry após cleanup. `--rumo-autostart` iniciou oculto e foi restaurado pela API.                                       |
| Hotkey                 | PASS                     | Quick Add abriu com entrada nativa Windows `Ctrl+Alt+R`; configuração smoke liberada após teste. Conflito de hotkey não foi reproduzido.                                                              |
| Notifications          | PARCIAL                  | API chamada com texto fictício; toast visual não observado. Deduplicação lógica coberta por testes de aplicação, não por entrega visual Windows.                                                      |
| Focus                  | PASS na ponte de eventos | Start/pause/resume/finish via comando Tauri `rumo-tray-command` e persistência SQLite; clique físico no menu tray não observado.                                                                      |
| Google Agenda          | NOT EXECUTED live        | Sem Client ID/conta de teste autorizada; os mocks e testes nativos da CI permanecem verdes.                                                                                                           |
| Pluggy Sandbox         | NOT EXECUTED             | Credenciais Sandbox e URL de gateway de teste ausentes; Live desabilitado.                                                                                                                            |

Dois defeitos reais do produto apareceram durante o smoke e foram corrigidos em commits já cobertos pela CI verde: `2325c5f` atualizou a versão de schema aceita pelo restore de 27 para **28**; `21babb4` passou a rebobinar o arquivo de entrada após ler o cabeçalho, antes de copiar attachments. O primeiro backup antigo de teste falhou por **erro da fixture**, não da migration: dois finais de linha CRLF locais na migration 2 produziram checksum diferente do SQL LF incorporado pelo runner Windows. O build diagnóstico isolado do run `37067766211` revelou `migration 2 was previously applied but has been modified`; o gerador agora usa os bytes exatos do commit do artifact e verifica checksums 1–19. Com essa correção apenas no harness, o restore antigo passou. O preflight passou a exigir schema 28, além de integridade.

**Cleanup:** nenhum processo `RUMO-Smoke.exe` ficou ativo; autostart smoke ausente no Registry; preferência do atalho global smoke voltou a vazio; teste Rust removeu sua credencial fictícia. O banco e as fixtures sintéticas foram preservados no perfil separado para auditoria. Ainda faltam observação do clique físico no tray/toast visual, execução live Google com conta de teste autorizada e Pluggy Sandbox com credenciais de teste; nenhum deles deve ser inferido da CI ou dos mocks. Pluggy Live e banco real não foram usados. A versão desktop permanece **1.6.0**.

### Pluggy Sandbox end-to-end — 03/10/2026

Esta seção substitui o estado `NOT EXECUTED` dos checkpoints anteriores. `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` Sandbox foram guardados localmente com DPAPI CurrentUser em `local-data/` ignorado pelo Git; a API Key foi obtida pelo gateway em memória. O gateway escutou apenas em `127.0.0.1:8787`, retornou health `sandbox`, encontrou **14 conectores Sandbox** e manteve `GATEWAY_ALLOW_LIVE=false`. Pareamento temporário, rejeição de replay do código, Connect Token restrito a conectores Sandbox e cleanup do dispositivo de teste passaram. O Client ID, Client Secret, API Key e device secret não foram adicionados ao Git, SQLite ou documentação.

O workflow privado de build Smoke **37090974042**, commit `d3ef9b5`, passou e produziu `RUMO-Smoke.exe` (14.507.008 bytes; SHA-256 `32618E36FD0FF90FC0C80FF0A7A78258AFE7D88D5CF7F2C4EC573677BCA3F84A`). O manifesto confirmou identifier `com.rumo.validation.native.v180` e gateway URL `http://127.0.0.1:8787`; o preflight independente confirmou hash, identifier por IPC, schema 28 e `integrity_check: ok`. O executável de produção e o perfil `com.rumo.desktop` não foram executados ou abertos.

O widget oficial Pluggy Connect abriu no WebView Smoke, mostrou somente conectores Sandbox e criou um Item `Pluggy Bank` via fluxo de teste oficial. O Item pertencia ao dispositivo pareado. Foram descobertas **2 contas** (corrente e cartão), ambas vinculadas explicitamente a **2 contas locais de teste**. A consulta encontrou **16 transações sintéticas** em duas páginas de conta separadas (uma página por conta: 10 corrente e 6 cartão), todas `POSTED`, com IDs externos distintos e snapshots de saldo externos. Uma transferência permaneceu para revisão; **15 transações** foram importadas. O primeiro sync automático foi interrompido pelo harness após persistir 3 linhas, e a recuperação completou as outras 12; não houve perda ou duplicação. Uma segunda sincronização sem mudança criou **0**, atualizou **0** e manteve 15 vínculos/15 transações. O fluxo real do Credential Manager fez write/read/use com a credencial de dispositivo Smoke; unpair, revogação do dispositivo e exclusão da credencial foram confirmados no cleanup.

O Sandbox revelou uma falha de normalização: seis compras de cartão vieram como `CREDIT` com valor negativo e categoria de consumo, mas eram tratadas como receitas. A [documentação oficial do Sandbox Pluggy](https://v2.docs.pluggy.ai/en/docs/guides/sandbox) confirma que essas linhas são compras sintéticas. O commit `d3ef9b5` classificou esse formato como `card_purchase`, mantendo pagamentos ambíguos para revisão, e permitiu reconciliar o tipo de registros previamente vinculados sem duplicá-los. Após reiniciar apenas o gateway Sandbox, o IPC nativo retornou as **6** linhas como `card_purchase`. O novo executável Smoke atualizou **6** lançamentos locais para despesa (0 novos; 10 ignorados) em janela sintética de 90 dias; o sync seguinte atualizou **0**, criou **0** e manteve **15** transações e **6** despesas no cartão. A conexão foi desconectada pela UI; o Item remoto retornou 404, o mapping do gateway foi removido, o estado local ficou `disconnected`, o histórico importado permaneceu e `integrity_check` continuou `ok`.

**Limites reais:** o Sandbox retornou uma página por conta e não exercitou `nextCursor`/paginação múltipla; cursor cíclico e paginação seguem cobertos por fake. Não houve exemplo Sandbox de pending→posted, reembolso ou mudança incremental criada pelo teste. Webhook real não foi exercitado porque o gateway local não possui endpoint HTTPS público; autenticação e idempotência seguem cobertas pelos 8 testes mockados do gateway. O saldo externo permaneceu snapshot separado. Uma rodada inicial interrompida pelo harness deixou uma linha antiga de `financial_sync_runs` com status `running`; a conexão se recuperou e os syncs seguintes concluíram, mas o status histórico dessa rodada não foi finalizado automaticamente. Pluggy Live permaneceu **DISABLED**; nenhuma instituição ou conta bancária real foi conectada.

**Segurança da instrumentação:** uma chamada diagnóstica inicial imprimiu involuntariamente um Connect Token temporário contido no nome de um iframe em saída da ferramenta. O usuário foi avisado; o dispositivo de teste daquele fluxo foi despareado/revogado e o token não foi reutilizado. O histórico dessa saída não pode ser apagado por este teste. Nenhum Client Secret ou API Key foi mostrado. A varredura de valores exatos do Client ID/Secret encontrou **0 ocorrências** nos arquivos rastreados e **0** nos 35 arquivos locais de teste examinados; o registro DPAPI não é rastreado. Logs e bancos locais permaneceram sob `local-data/`; o gateway foi parado, e não restou processo Smoke ativo.

**Validação de código relacionada:** após a correção de compras e reconciliação, testes locais desktop **332/332**, gateway **8/8**, TypeScript, lint, Prettier, frontend build e `git diff --check` passaram. O primeiro CI normal do commit `d3ef9b5` falhou somente num teste legado com data fixa (`02/09`) que havia saído da janela de 30 dias do snapshot em `03/10`; o teste de preservação foi ajustado no commit `eb8e7cc` para consultar o histórico completo. O CI Windows normal **37091160564** do commit `eb8e7cc` terminou **PASS**: Prettier, lint, TypeScript, **332/332** testes desktop, frontend build, audits desktop/gateway, **8/8** testes gateway, validação de arquivos, cargo metadata/tree/check, **10/10** testes Rust, build Tauri, NSIS, hash e upload dos artefatos. O `rumo.exe` não assinado da CI tem 14.490.624 bytes e SHA-256 `BB0116FAA104EF1294D9F59E33E80B4D887498290E69423512D44A64A5EFA09F`; o instalador `RUMO_1.6.0_x64-setup.exe` tem 3.712.764 bytes e SHA-256 `24494E52D8C78C01761C6BA61EA7E292E92E9EA6950224826CCC67906577B79E`. Esses binários de produção não foram executados nesta máquina e permanecem versão **1.6.0**; nenhum bump foi feito.

### Preparação Open Finance para produção — 03/10/2026

Foi corrigido o registro histórico de sync interrompido: ao reabrir Finanças ou iniciar o ciclo em segundo plano, runs iniciados antes do processo atual e ainda em `running` passam a `error` com `error_code=interrupted`, `finished_at` e contadores preservados; a conexão sai de `syncing`. A operação é idempotente e o retry posterior mantém a auditoria antiga. O teste usa SQLite sintético; nenhum banco pessoal foi aberto. A migration 0028 não foi alterada.

O harness de smoke deixou de persistir URLs externas, nomes de iframe e mensagens brutas de erro; um teste específico usa um Connect Token fictício e verifica que ele não aparece nos diagnósticos. Isso previne o vazamento nos scripts versionados revisados, mas não apaga a saída histórica do harness ad hoc mencionada acima. O token anterior não foi reutilizado e o dispositivo daquele teste foi revogado.

O gateway agora exige `GATEWAY_MODE` (`sandbox` ou `live`) e `GATEWAY_DEPLOYMENT` (`local` ou `production`) explícitos, URL pública HTTPS em produção, caminho absoluto de banco fora do checkout, segredo próprio do webhook e Client ID/Secret no servidor. Credenciais por si só nunca ativam Live; Sandbox rejeita flags Live e Live exige aprovação operacional separada. Testes cobrem fail-closed e ausência de valores secretos em erros. O gateway continua em loopback, com timeout, limite de corpo, rate limit local, device auth, webhook autenticado/idempotente e retenção de IDs de eventos por 90 dias. Os exemplos de Caddy/systemd preparam uma instância em VM Linux com SQLite persistente privado; **nenhum host foi implantado**. O workflow manual de candidato só aceita origem HTTPS pública com health `sandbox` antes de compilar o desktop com essa URL e identifier de produção; **não foi executado**, pois ainda não há endpoint público.

**Validação após as alterações:** desktop **333/333**, gateway **12/12**, teste de diagnóstico **1/1**, TypeScript, lint, Prettier, frontend production build, `node --check` do gateway, validação integral de **326** arquivos, `git diff --check` e audits npm desktop/gateway com **0 vulnerabilidades**: PASS. A CI Windows normal **37100100390** do commit `479da30` terminou **PASS** em `windows-2022`: `cargo metadata`, `cargo tree`, `cargo check --locked`, **10/10** testes Rust, build Tauri, instalador NSIS, hashes e artifact privado `rumo-windows-unsigned-validation-15`. O executável `rumo.exe` tem **14.491.136 bytes**, SHA-256 `9E72DBF127554DFD6EA488E5B00BD00FA1D61A48E2F59E6F9FCDEFA9C29BD4F5`; o instalador `RUMO_1.6.0_x64-setup.exe` tem **3.712.087 bytes**, SHA-256 `30DC4358C2F52F5085AF8DB2D0215B4C5F64F0C50A6299CCB4159C888D9945AB`. São binários de validação **sem URL pública embutida** e sem assinatura; não representam um piloto Live. Live permanece **DISABLED**; não houve banco real, Nubank, webhook público ou build desktop com URL pública.

| Production Readiness Check             | Estado em 03/10/2026                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| HTTPS público                          | PENDENTE: nenhum host/DNS/TLS implantado                                                 |
| Segredos protegidos no servidor        | PREPARADO e testado por configuração; provisionamento de produção pendente               |
| Webhook público                        | PENDENTE: endpoint não publicado                                                         |
| Webhook autenticado/idempotente        | PASS em testes mockados; recebimento público real pendente                               |
| Device auth                            | PASS em Sandbox isolado e testes                                                         |
| Logs/diagnósticos sanitizados          | PASS nos caminhos versionados revisados; saída histórica do harness não pode ser apagada |
| Recuperação de sync abandonado         | PASS em teste sintético                                                                  |
| Connect Token ausente dos diagnósticos | PASS em teste de regressão do harness versionado                                         |
| CI Windows deste commit                | PASS: run 37100100390, 333 desktop, 12 gateway, 10 Rust, Tauri/NSIS                      |
| Build desktop com URL HTTPS real       | PENDENTE                                                                                 |
| Pluggy Live                            | DISABLED                                                                                 |

**Resultado atual: NOT READY para piloto Live controlado.** Os gates de deploy HTTPS/webhook público e build de candidato contra o endpoint real continuam abertos. Sandbox permanece validado e separado de Live.

## Open Finance pessoal — CI concluída; smoke GUI local bloqueado

O deploy Railway foi cancelado por mudança de requisito. O projeto Railway `rumo-open-finance-gateway` criado somente nesta tentativa foi enviado para exclusão, sem deploy, dados ou secrets; outro projeto Railway não foi alterado. A arquitetura alvo é gateway filho local em loopback, Connector 200 do Meu Pluggy, DPAPI e scheduler do Windows existente. Pluggy Live comercial continua desabilitado, e nenhuma conta real foi conectada.

Validação local após as alterações iniciais: **334/334** testes desktop, **14/14** gateway mockado, TypeScript, lint, Prettier, frontend build, audits npm desktop/gateway (0 vulnerabilidades), validação integral de 330 arquivos e `git diff --check`: **PASS**. Um teste adicional posterior elevou o gateway para **15/15**, confirmando processo filho em loopback, pareamento de uso único, recusa de porta ocupada e saída ao fechar stdin. O teste Rust de leitura DPAPI fictícia passou posteriormente na CI final. O workflow smoke isolado produziu o binário de commit `1c881d4` (run `37137549423`, SHA-256 `79C6405497E0931A8676FEFB72D4F3D09100D65301EBD9C06799D363C6F5D074`) com recursos Node locais. O preflight confirmou hash e identifier antes de lançar, mas a execução local foi **bloqueada pelo Windows Code Integrity, evento 3077**, antes do app iniciar. Nenhum bypass foi tentado; não se pode declarar smoke de runtime do gateway pessoal. Webhook não é requerido no modo pessoal. Connector 200 com conta real: **NOT EXECUTED** por decisão explícita do usuário. Uma consulta de metadados Pluggy, sem criar Item/conta, confirmou Connector 200 (`MeuPluggy`, não Sandbox, OAuth).

**Fechamento em 03/10/2026.** O commit funcional `dd6e604c1539553b04688c5eb382289bb9235024` passou no workflow Windows `37139341351` (`windows-2022`): Prettier, lint, TypeScript, **335/335** testes desktop, frontend build, audits npm desktop/gateway com **0 vulnerabilidades**, validação de arquivos, **15/15** testes do gateway, `cargo metadata/tree/check --locked`, **11/11** testes Rust, Tauri production build e NSIS. A primeira tentativa desse run teve um timeout isolado de 5 segundos em teste legado de migration; o teste passou localmente (16/16 no arquivo) e a repetição completa do mesmo commit passou 335/335, sem mudar asserts. O artifact privado é `rumo-windows-unsigned-validation-20`. `rumo.exe`: **14.562.304 bytes**, SHA-256 `986CCF815CDDEF13F6D92AF6094DE49C75C71CA818A228330B8A1C5556E8838F`. `RUMO_1.6.0_x64-setup.exe`: **27.231.714 bytes**, SHA-256 `1B218411C516412742EAA851197FC21AE80D0D9194896E8921C8E74DF906FE03`. A versão não foi alterada; não houve release.

O workflow smoke isolado `37139163427` também passou e publicou o artifact privado `rumo-native-smoke-isolated-8`; esse resultado comprova o **build**, não a execução GUI local. O preflight do binário smoke anterior verificou hash e identifier isolado, mas Windows Code Integrity **3077** bloqueou a carga do executável antes do start. Nenhum bypass foi tentado, o arquivo DPAPI copiado para o perfil Smoke foi removido e o perfil de produção permaneceu intocado. Portanto, o runtime do gateway pessoal empacotado ainda **não foi validado nesta máquina**. A integração com Connector 200 usando Item e conta bancária real permanece **NOT EXECUTED**, conforme pedido do usuário.

Railway: o projeto exclusivo desta tentativa, `rumo-open-finance-gateway`, está marcado para exclusão (`deletedAt` preenchido; remoção definitiva programada pela Railway) e a consulta ao serviço retornou **0 deployments**. Nenhum volume, domínio, segredo ou banco foi configurado. Outro projeto Railway não foi alterado. O modo pessoal não depende de Railway, servidor público, PostgreSQL remoto ou webhook. O custo recorrente planejado de infraestrutura é **R$ 0**; as condições do acesso pessoal gratuito pelo Connector 200 são determinadas pela Pluggy, conforme `OPEN_FINANCE_PERSONAL_MODE.md`.

## RUMAR 1.8.0 — MSIX local em 04/10/2026

O workflow Windows normal **37174644254**, commit `4c000a9`, passou: **335/335** desktop, **15/15** gateway, **11/11** Rust, `cargo check --locked`, Tauri release e NSIS `RUMAR_1.8.0_x64-setup.exe`. O workflow MSIX manual **37173814791** passou e gerou o artifact privado estrutural unsigned `RUMAR_1.8.0.0_x64.msix` (41.084.044 bytes; SHA-256 `1768FA97AB8EA1FB70D7630B44F3B94F18929F098271A9465E9314E5DAD9F47D`). O pacote contém `rumar.exe`, Node oficial assinado pela OpenJS Foundation e fontes do gateway, sem `.env`, banco, backup ou credenciais. Manifest: `RUMAR.Local`, publisher `CN=RUMAR Local Development`, x64, versão `1.8.0.0`, `runFullTrust`; identifier Tauri `com.rumar.desktop.local`, distinto do legado `com.rumo.desktop`.

O certificado local `CN=RUMAR Local Development` (thumbprint `F7F81A27DF8B4D97BA62090D2C8C4D093981BE90`) tem EKU Code Signing, `CA=false` e chave privada não exportável em `CurrentUser\My`. Somente o certificado **público** foi importado com UAC em `LocalMachine\TrustedPeople`; ele não está em Trusted Root. O EXE e o MSIX foram assinados localmente, sem PFX ou exportação da chave. `signtool verify /pa /v` passou para ambos, com **0 warnings e 0 errors**. MSIX final local: 41.089.616 bytes; SHA-256 `A99CC04F67F56D3BC37314C0DAB0E2F7F13507020B0E1E5FA1A472793DA82294`. O pacote não tem timestamp externo.

`Add-AppxPackage` instalou `RUMAR.Local` sem substituir RUMO 1.0.0. A ativação normal pelo AppUserModelID iniciou `rumar.exe` em `WindowsApps`; janela responsiva, Smart App Control `VerifiedAndReputablePolicyState=1`, nenhum evento Code Integrity 3077/3089 associado à abertura. O SQLite novo surgiu em `LocalCache\Roaming\com.rumar.desktop.local\rumo.db` do Package Family `RUMAR.Local_nw0ezey2d8pbw`: **28/28 migrations** e `integrity_check=ok`. O banco legado não foi copiado nem migrado.

O usuário confirmou visualmente que a janela RUMAR está utilizável. Uma leitura limitada aos metadados do legado confirmou `rumo.exe` instalado na versão **1.0.0**, banco atual com migration máxima **11** e backup pré-upgrade com migration máxima **9**; ambos retornaram `integrity_check=ok`. As migrations 10 e 11 no banco atual constam como instaladas em **28/09/2026**, antes deste MSIX. Nenhum registro pessoal foi inspecionado ou migrado.

Com Client ID/Secret **fictícios** protegidos por DPAPI somente no perfil MSIX isolado, o app iniciou o `node.exe` empacotado como processo filho; listener somente em `127.0.0.1:8787`, `/health` retornou `ok`, e o dispositivo de teste foi guardado no namespace `RUMAR-Local-v180`. Uma segunda ativação manteve apenas uma instância. Após encerrar forçadamente o app isolado, o Node não ficou órfão. A fixture DPAPI, credencial fictícia e banco de metadata do gateway de teste foram removidos. O app foi reaberto sem essas credenciais; o gateway não iniciou, conforme a condição de configuração. A integridade do SQLite permaneceu `ok` e a migration máxima continuou **28**.

**Limites:** a ferramenta de automação de janelas falhou na inicialização (`windows sandbox failed: helper_unknown_error: apply deny-read ACLs`). Portanto, clique no tray, close-to-tray, saída pelo menu, autostart, hotkey, Focus, notificações, anexos e backup/restore **não foram revalidados visualmente neste MSIX**. O encerramento forçado testou ausência de Node órfão, mas não substitui o teste de `Exit`. O Credential Manager foi exercitado somente pelo pareamento fictício e cleanup; read/use via fluxo UI permanece pendente. As credenciais DPAPI reais não foram acessadas. Nenhuma conta bancária ou Nubank foi conectado; nenhuma importação ocorreu. A migração real do RUMO 1.0.0 permanece **NOT EXECUTED** até o smoke completo do runtime e dos dados isolados passar. O pacote NSIS não foi executado. Nenhuma proteção do Windows foi alterada.

## RUMAR 1.8.0 — correção de close-to-tray e bloqueio do MSIX 1.8.0.1

O smoke manual do MSIX 1.8.0.0 revelou uma falha real: o botão X encerrava o app. O perfil isolado não tinha a preferência antiga `windows_close_behavior`; seu default era `exit`, e o handler JavaScript chamava `exitApplication()`. No commit `0cf2e56`, o `CloseRequested` da janela principal passou a ser interceptado no Rust com `prevent_close()` e `hide()`, e o frontend passou a receber o evento de janela oculta para manter o scheduler em modo tray. O comando explícito **Sair** e o shutdown do gateway no `RunEvent::Exit` foram preservados. A preferência antiga pode permanecer no banco, mas não controla mais o X. Nenhuma migration ou código de Open Finance foi alterado.

A CI normal `37210955346`, tentativa 2, no commit `0cf2e56` passou: **335/335** testes desktop, **15/15** gateway, **11/11** Rust, Prettier, lint, TypeScript, `cargo check --locked`, Tauri release e NSIS. A tentativa 1 do mesmo commit teve somente timeout isolado de 5 segundos em `tests/energy.test.ts`; não houve mudança no teste entre as tentativas. O workflow MSIX manual `37212819320` também passou. Seu pacote estrutural privado unsigned `RUMAR_1.8.0.1_x64.msix` tem 41.082.683 bytes e SHA-256 `242B3E9293E7ECAB58CEABFA7ED0F8995F8762B0CB186D508DB6CE3E1BBF3370`.

O manifest permaneceu `RUMAR.Local`, `CN=RUMAR Local Development`, x64 e full trust; apenas a revisão mínima do pacote subiu para **1.8.0.1** para permitir atualização in-place. O mesmo certificado local já confiado assinou `rumar.exe` e o MSIX, sem exportar a chave privada. `signtool verify /pa /v` passou em ambos com **0 warnings/0 errors**; o Node empacotado manteve assinatura válida da OpenJS Foundation. MSIX assinado: `artifacts/local-msix-signed/1.8.0.1/RUMAR_1.8.0.1_x64-local.msix`, 41.088.240 bytes, SHA-256 `09576ED39BC9F8D586F610CC394EB4F7B22903014FA2E90DF97002FCF0056BE3`. `Add-AppxPackage` atualizou somente `RUMAR.Local` de 1.8.0.0 para 1.8.0.1, mantendo o Package Family `RUMAR.Local_nw0ezey2d8pbw`; RUMO 1.0.0 e seus dados não foram alterados.

**Runtime MSIX 1.8.0.1: BLOCKED.** A ativação normal não criou `rumar.exe` nem `node.exe`. O evento Code Integrity **3077**, record 26907 em 04/10/2026 12:54:45, bloqueou `C:\Program Files\WindowsApps\RUMAR.Local_1.8.0.1_x64__nw0ezey2d8pbw\rumar.exe` sob a política `VerifiedAndReputableDesktop` (`{0283ac0f-fff1-49ae-ada1-8a933130cad6}`): Requested Signing Level **2**, Validated Signing Level **1**, status `0xc0e90002`. O evento correlato **3089**, record 26908, identifica o signatário local e o mesmo hash do EXE. AppModel-Runtime 207 registrou `0x800711C7` ao criar o processo. Isso distingue assinatura criptográfica válida de confiança insuficiente para esta política; não é falha observada do handler de close. Não houve bypass nem repetição de execução após a evidência do bloqueio.

Por isso, **close-to-tray, restauração pelo tray, continuidade do gateway/scheduler e Sair explícito permanecem NOT EXECUTED nesta build**. A fixture de Client ID/Secret fictícios protegida por DPAPI foi removida do perfil isolado; não surgiu credencial de dispositivo de teste, nem ficaram processos RUMAR/Node ativos. Nenhuma credencial real, banco pessoal, migration real, Smart App Control, Code Integrity, Defender ou certificado foi alterado. A instalação isolada permanece em 1.8.0.1; **migração RUMO 1.0.0 → RUMAR não iniciada**.
