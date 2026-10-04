# Code signing policy

O RUMAR ainda não recebeu certificado ou aprovação da SignPath Foundation.
Artifacts produzidos pela CI atual são **unsigned** e servem somente à
validação de compilação, testes e empacotamento. Não são uma release confiável.

O mantenedor do projeto é o titular da conta GitHub `ClarkSantt`, responsável
pelos commits, revisão de contribuições e aprovação manual de cada futura
solicitação de assinatura. Mudanças de terceiros serão revisadas antes do merge.
O acesso ao repositório e à plataforma de assinatura deve usar MFA.

Se a SignPath Foundation aceitar o projeto, a política e o workflow serão
atualizados com a identidade e as restrições aprovadas. Somente artifacts
provenientes de jobs GitHub-hosted verificáveis, do commit declarado e com
metadados consistentes de produto/versão serão solicitados para assinatura.
Binários de projetos upstream, como o runtime Node.js oficial, manterão a
assinatura e licença originais e não serão apresentados como código próprio.

O RUMAR guarda dados locais no dispositivo. Integrações Google Agenda e Pluggy
só transferem dados aos respectivos serviços quando configuradas pelo usuário;
veja [PRIVACY.md](PRIVACY.md). Alterações do sistema, instalação e desinstalação
serão documentadas antes de qualquer release. Uma assinatura válida não
substitui o teste de execução com Smart App Control ativo.
