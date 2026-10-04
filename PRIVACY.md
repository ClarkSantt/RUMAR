# Privacidade

O RUMAR guarda tarefas, projetos, hábitos, treinos, alimentação, finanças e
demais dados pessoais em SQLite e arquivos locais no dispositivo do usuário.
Não existe conta RUMAR, telemetria ou servidor RUMAR para sincronizar esses
dados. Backups e exportações criados pelo usuário também ficam locais e podem
conter dados pessoais sem criptografia própria.

As integrações opcionais com Google Agenda e Pluggy usam a rede somente depois
de configuradas pelo usuário. O gateway Pluggy pessoal é um processo local em
`127.0.0.1`; ele se comunica com a API da Pluggy quando a sincronização é
iniciada ou agendada. O usuário gerencia consentimento bancário no Meu Pluggy.
O RUMAR não pede senha bancária e não mantém um servidor cloud próprio.

As políticas dos serviços externos também se aplicam quando cada integração é
utilizada: <https://pluggy.ai/> e <https://policies.google.com/privacy>.
