# Segurança

Não inclua tokens, credenciais, bancos pessoais ou backups em issues públicas.
Para relatar uma vulnerabilidade, use um aviso privado de segurança no GitHub:
<https://github.com/ClarkSantt/RUMAR/security/advisories/new>.

O RUMAR é um aplicativo local para Windows. O gateway financeiro pessoal escuta
somente em loopback e guarda credenciais Pluggy protegidas por DPAPI no perfil
do usuário. O repositório e os artifacts de CI não devem conter credenciais.
