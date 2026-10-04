# Google Agenda no RUMO

Esta integração é opcional e unilateral: **RUMO → agenda secundária RUMO no Google**. O banco local continua sendo a fonte de verdade. Ela exige internet durante autorização e sincronização; os demais módulos continuam locais. A aplicação não solicita senha Google nem recebe o refresh token no React.

## Preparar a credencial OAuth Desktop

1. No [Google Cloud Console](https://console.cloud.google.com/), crie ou selecione um projeto sob seu controle.
2. Ative a [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com).
3. Configure a tela de consentimento OAuth, nome e contatos exigidos pelo Google. Se o projeto estiver em modo de teste, adicione a conta autorizada como usuário de teste.
4. Crie um **OAuth client ID** do tipo **Desktop app** em APIs e serviços → Credenciais. Copie somente o **Client ID**. O aplicativo desktop é um cliente público; não inclua client secret no repositório nem trate um secret embutido como proteção.
5. No RUMO, abra **Configurações → Integrações → Google Agenda**, cole o Client ID e escolha a data inicial. Clique **Conectar com Google**. O navegador padrão abre a autorização e retorna a `127.0.0.1` numa porta temporária; o RUMO valida `state` e PKCE S256.
6. Após conectar, confirme as fontes e o horizonte de 30 ou 90 dias (ou sem limite futuro). Clique **Sincronizar agora** para iniciar o primeiro envio. Deixar para depois não envia eventos.

O escopo solicitado é [`https://www.googleapis.com/auth/calendar.app.created`](https://developers.google.com/workspace/calendar/api/auth), para agendas criadas pelo aplicativo. O RUMO cria uma agenda secundária chamada **RUMO** e conserva o ID no SQLite para reutilizá-la. Se ela tiver sido excluída diretamente no Google, use **Recriar agenda ausente** após reconectar.

## Semântica e privacidade

- Rotinas e Time Blocks são as fontes iniciais. Um Time Block prevalece sobre a ocorrência correspondente de rotina ou treino; uma Task com Time Block não cria outro evento avulso.
- Recorrências diárias, semanais e mensais comuns usam RRULE. Recorrências com `COUNT` ou ajuste para o último dia de meses curtos usam RDATE numa janela móvel; em modo sem limite futuro essa janela especial é de dois anos e é estendida por reconciliações posteriores. Exceções canceladas/movidas são preservadas.
- Eventos temporizados usam o fuso IANA do sistema; eventos de dia inteiro usam `DATE`. Os itens sem horário não recebem um horário inventado.
- Alterações locais são salvas primeiro no SQLite. A fila persistente processa os eventos quando há conexão, em lotes e com backoff para falhas temporárias. Editar um evento no Google não altera o RUMO; uma reconciliação posterior pode repor o estado local.
- O refresh token fica no **Gerenciador de Credenciais do Windows**, associado ao identificador local da integração. Access token vive apenas na memória do processo. Banco, ZIP de backup e JSON portátil não guardam tokens. Restaurar um backup em outro Windows exige reconectar a conta.
- **Desconectar** para o envio e remove a credencial local, mas mantém a agenda e os eventos no Google. **Excluir agenda RUMO** apaga a agenda secundária remota após confirmação explícita. Eventos ocultos ou excluídos no RUMO são removidos do espelho quando a preferência de exclusão remota está ativa.

Esta versão ainda não foi validada com uma conta Google de teste nem com execução nativa no Windows atual. A suíte local usa um cliente Google simulado; o resultado efetivo está em `VALIDATION.md`.
