# CI Windows de validação nativa

O workflow [`.github/workflows/windows-ci.yml`](.github/workflows/windows-ci.yml) usa o runner oficial `windows-2022`, Node.js 24 e Rust estável MSVC. Ele roda em `push` e pode ser iniciado manualmente por **Actions → Windows native validation → Run workflow**. O cache é usado apenas para pacotes npm; os artefatos Rust são recompilados em checkout limpo para investigar o bloqueio local de proc-macros.

A ordem é: `npm ci` do desktop; Prettier, lint, TypeScript, testes com fakes, build frontend, audit e validação integral; `npm ci`/testes/check sintático/audit do gateway; versões Rust, `cargo metadata --locked`, `cargo tree --locked`, `cargo check --locked`, `cargo test --locked`; e, somente se tudo passar, `npm run desktop:build`. O workflow confirma `rumo.exe` e exatamente um instalador NSIS x64, imprime tamanho e SHA-256, e publica **apenas esses dois binários sem assinatura** como artifact de validação por sete dias. Não altera `Cargo.lock`, não configura certificado e não executa correções automáticas de dependências.

Os testes normais usam mocks/fakes. A CI não recebe segredos Pluggy ou Google, não acessa banco pessoal, não conecta conta bancária, não executa Sandbox/Live nem smoke interativo de tray, WebView ou instalador. O gateway não é iniciado com credenciais nesta pipeline; o build desktop sem `RUMO_FINANCE_GATEWAY_URL` mantém a conexão Open Finance indisponível. Um build verde confirma compilação/empacotamento, **não** assinatura, distribuição ou funcionamento de integrações live.

## Execução e interpretação

O repositório privado `ClarkSantt/RUMO` possui a branch `main`. O primeiro run completo aprovado foi o [37042127435](https://github.com/ClarkSantt/RUMO/actions/runs/37042127435), no commit `032c9f3`. A execução ocorre em cada push e também pode ser iniciada pela aba Actions ou por `gh workflow run windows-ci.yml --ref main`. Os binários desse run são artifacts de validação sem assinatura, não uma release publicada.

Se `cargo check --locked` passar no runner limpo e falhar apenas nesta máquina, isso isola fortemente o problema no ambiente local. O diagnóstico local registrou Code Integrity **3077** ao negar a DLL recém-compilada de `serialize-to-javascript-impl`; o Rust mostrou E0463 como consequência. Se o mesmo erro surgir na CI, examine o primeiro erro e o log completo do passo Rust antes de atribuir a causa: pode haver erro real de código, dependência, runner ou política. Não altere proteção do Windows para tentar obter verde. `cargo test` e Tauri/NSIS só executam após `cargo check` passar.

Para reproduzir manualmente em **outro Windows autorizado**, com Node 24, Rust MSVC e pré-requisitos Tauri instalados, execute na raiz do projeto:

```powershell
npm ci
npx prettier --check .
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=low
node scripts/validate-files.mjs
cd services/rumo-finance-gateway
npm ci
npm test
Get-ChildItem src,test -Recurse -File -Filter *.mjs | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
npm audit --audit-level=low
cd ../..
cd src-tauri
cargo metadata --locked --format-version 1 | Out-Null
cargo tree --locked
cargo check --locked
cargo test --locked
cd ..
npm run desktop:build
```

O check sintático do gateway na CI percorre seus arquivos `.mjs` com `node --check`. A build Tauri usa a versão atual do repositório, **1.6.0**; não é uma release 1.8.0.
