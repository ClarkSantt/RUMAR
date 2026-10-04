# Avisos de terceiros

O código original do RUMAR é disponibilizado sob a licença MIT em `LICENSE`.
Essa licença não altera as licenças de componentes e dados de terceiros.

## TACO

O catálogo alimentar embutido em `src-tauri/migrations/0004_nutrition.sql`
deriva da *Tabela Brasileira de Composição de Alimentos — TACO*, 4ª edição,
NEPA/UNICAMP, 2011. A publicação original permite reprodução total ou parcial
desde que a fonte seja citada. Fonte e condições:
<https://nepa.unicamp.br/publicacoes/tabela-taco-pdf/>.

O RUMAR não atribui licença MIT aos dados TACO nem afirma ser titular desses
dados. A adequação dessa permissão aos critérios próprios de assinatura da
SignPath Foundation depende de avaliação pela fundação.

## Dependências

As bibliotecas JavaScript e Rust mantêm suas respectivas licenças declaradas
em `package-lock.json`, `services/rumo-finance-gateway/package-lock.json` e
`src-tauri/Cargo.lock`/metadados Cargo. O gateway local empacota o executável
oficial Node.js obtido no ambiente de build, preservando sua assinatura e seus
avisos de licença; o RUMAR não o reassina como código próprio.
