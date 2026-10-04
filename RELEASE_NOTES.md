# RUMO 1.6.0 — anexos locais e portabilidade

- Anexos locais em Projetos, Pensamentos, Objetivos, Momentos e transações financeiras, com cópia gerenciada, limites, tipo permitido e SHA-256.
- Backup/restore estendido aos anexos; o manifest registra arquivos e hashes, mantendo leitura de backups anteriores.
- Central de Dados com diagnóstico de armazenamento, integridade de anexos sob demanda, CSV por módulo, JSON versionado e ICS das fontes visíveis e Time Blocks.
- Importação local de CSV financeiro, CSV de progresso corporal e ICS, com prévia, mapeamento, política explícita de conflitos e histórico.
- Migrations aditivas 0020–0024; dados do schema 19 preservados em teste de upgrade isolado.

Os arquivos JSON e CSV são para leitura externa; o ZIP de backup continua sendo o formato de restauração. O JSON contém metadados, não o conteúdo binário dos anexos. A validação nativa desta versão depende de um ambiente Windows que permita executar a toolchain e o binário; consulte `VALIDATION.md` para resultados efetivos.

---

# RUMO 1.5.0 — implementação concluída, validação nativa pendente

- Automações locais com regras Quando/Se/Então, efeitos internos atômicos, execução única, limites de encadeamento e histórico técnico. Funcionam com o aplicativo aberto; notificações exigem opt-in.
- Blocos recorrentes diários, em dias úteis, semanais ou mensais; término configurável, exceções e edição individual ou da série sem materializar o futuro.
- Marcos de objetivos manuais ou derivados de metas financeiras, ordenação, prazos e integração com Timeline, Calendário, Home, revisões, busca e `/marco`.
- Revisão Mensal com agregações por período, comparação ao mês anterior e nota opcional, respeitando preferências de privacidade.
- Migrations aditivas 0017, 0018 e 0019, schema 19. Nenhuma migration anterior foi alterada.

A compilação nativa de testes terminou, mas sua execução foi bloqueada pelo Windows Application Control, erro 4551. A aprovação dos testes de aplicação e da auditoria em navegador não substitui o smoke nativo final. Smart App Control permaneceu ativado; nenhum bypass foi tentado. Evidências, status de empacotamento e hashes finais estão em `VALIDATION.md`.

---

# RUMO 1.4.0 — implementação concluída, validação nativa pendente

- Calendário com visualizações Dia/Semana útil/Semana/Mês, painel Não agendado, blocos independentes dos prazos, movimentação e redimensionamento.
- Focus com pausa, recuperação após encerramento e tempo realizado separado do planejamento.
- Agenda compacta na Home; integração de foco com Timeline, Objetivos e Revisão Semanal.
- Quick Add com duração e `/bloco`; lembretes locais opcionais para blocos.
- Migrations aditivas 0015 e 0016, schema 16. Testes de aplicação aprovados; a execução dos testes nativos foi bloqueada pelo Windows Application Control após compilação, erro 4551. A validação nativa final permanece pendente; proteções mantidas e nenhum bypass tentado.

Executável e instalador NSIS x64 1.4.0 foram gerados com sucesso. Tamanhos, timestamps e SHA256 estão em `VALIDATION.md`. A build produzida não equivale à aprovação do smoke nativo final; o pacote permanece sem assinatura confiável.

---

# RUMO 1.3.0

- **Objetivos:** criar, atualizar, pausar, concluir ou arquivar; vincular registros existentes de diferentes módulos e acompanhar progresso manual ou derivado sem duplicar dados.
- **Timeline pessoal:** acontecimentos dos módulos existentes agrupados por dia, Momentos próprios, filtros por período/grupo/fonte/objetivo, busca e paginação. Modo privado e ocultação financeira também se aplicam à busca textual da Timeline.
- **Integrações:** Home e Revisão Semanal mostram objetivos; Calendário inclui seus prazos; Busca Global e Quick Add encontram/criam objetivos e momentos.
- **Banco:** migration aditiva `0014_objectives_timeline.sql`, sobre schema 13, preservando preferências anteriores.

O RUMO continua local e offline. Os binários Windows permanecem sem assinatura de código confiável.

---

# RUMO 1.2.0

- **Revisão Semanal:** síntese de organização, hábitos, rotinas, treinos, atividade, alimentação, corpo e finanças, com próximos compromissos e nota opcional. Respeita a privacidade de valores financeiros.
- **Templates:** tarefas, projetos, rotinas, planos de treino e refeições podem ser salvos e reaplicados como cópias independentes. Refeições podem ser lançadas no diário.
- **Notificações locais:** lembretes por categoria, ativados pelo usuário, com opção de ocultar conteúdo sensível e entrega única enquanto o aplicativo está aberto.
- **Quick Add:** Ctrl + Espaço captura tarefas, pensamentos, passos, peso e transações com parsing local; entradas ambíguas seguem para o Inbox. Ctrl + K continua a busca global.
- **Banco:** migration aditiva `0013_continuity.sql`, preservando dados e migrations anteriores.

O RUMO continua offline. Notificações não funcionam com o processo totalmente encerrado, pois esta versão não instala serviço em segundo plano. Os binários Windows seguem sem assinatura de código confiável.

---

# RUMO 1.1.0

- **Treinos:** criação guiada de planos, divisão editável e ordenável, vários dias da semana por treino, exercícios e energia planejada; Hoje, Home e Calendário acompanham o plano ativo.
- **Perfil e atividade:** Configurações → Perfil reúne dados pessoais e objetivo; o peso usa os registros de Progresso corporal. Passos diários editáveis e médias observadas de 7/30 dias alimentam os cálculos automaticamente.
- **Energia e alimentação:** TMB estimada por Mifflin-St Jeor, rotina cotidiana, diferença de passos e sessões concluídas compõem o gasto estimado. O objetivo gera uma meta inicial ajustável; Alimentação mostra cálculo, ingestão, restante e balanço semanal. O gasto de treino é automático por padrão, com ajustes opcionais. Passos atribuídos a treino podem ser informados para evitar sobreposição.
- **Exercícios:** biblioteca local ampliada de 14 para 236 exercícios, com busca por aliases, filtros de músculo e equipamento e metadados opcionais para exercícios personalizados.
- **Calendário:** filtros persistentes por fonte e visibilidade individual de hábitos e rotinas, sem alterar seus registros ou recorrências.
- **Banco:** migrations aditivas `0010_planning_energy.sql`, `0011_activity_overlap.sql` e `0012_exercise_library.sql`; dados e backups anteriores preservados.

A energia calculada é uma estimativa, não uma medição clínica. A meta inicial de perda/ganho usa diferença conservadora de 250 kcal/dia e pode ser ajustada; o usuário escolhe seu objetivo e não recebe prescrição clínica. Binários Windows permanecem sem assinatura de código confiável e podem ser bloqueados pelo Smart App Control.

---

# RUMO 1.0.0

Primeira versão consolidada do aplicativo desktop pessoal, com dados locais em SQLite e funcionamento offline.

- **Organização:** Home, tarefas e subtarefas, Inbox, projetos e seções.
- **Ritmo pessoal:** hábitos, rotinas, pensamentos com autosave e calendário.
- **Treinos:** planos, exercícios, sessões, séries persistentes, histórico e evolução.
- **Progresso corporal:** peso e medidas compartilhados entre Treinos e Alimentação, histórico por métrica e comparação entre datas.
- **Alimentação:** catálogo TACO local, alimentos personalizados, refeições, dieta, diário, metas, peso e compras.
- **Finanças:** contas, transações, importação OFX local, planejamento, objetivos e patrimônio.
- **Busca:** Ctrl+K encontra registros dos módulos principais, respeitando a preferência de ocultar valores financeiros.
- **Dados:** backup manual e automático, retenção, restore com backup preventivo e verificação de integridade.

O instalador Windows x64 é distribuído sem assinatura de código nesta etapa. O Smart App Control pode bloquear binários sem assinatura confiável; isso não indica defeito funcional do RUMO. A assinatura requer um certificado legítimo antes de distribuição ampla.

# RUMO 1.7.0 — integração Google Agenda (em validação)

- Espelho opcional e unilateral do RUMO para uma agenda secundária criada pelo aplicativo.
- OAuth Desktop no navegador do sistema com retorno local, PKCE, `state` e escopo `calendar.app.created`; refresh token no Gerenciador de Credenciais do Windows.
- Preferências por fonte e item, primeira sincronização explícita, fila persistente, reconciliação idempotente, recorrências e exceções.
- Migrations aditivas 0025–0027, sem alterar as versões anteriores. Dados locais são salvos antes do envio remoto.

A implementação ainda não é uma release aprovada: o Windows Application Control bloqueou a compilação nativa da rodada atual (erro 4551) e não foi realizado teste com conta Google de teste. Consulte `VALIDATION.md` para os resultados efetivos. O Smart App Control permaneceu ativado.

---
