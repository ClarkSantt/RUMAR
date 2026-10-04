# RUMAR 1.8.0 — MSIX local de desenvolvimento

Este pacote é **local**. Não usa Microsoft Store, Partner Center, Railway, banco remoto, assinatura no GitHub ou credenciais no repositório. O workflow manual `windows-local-msix.yml` compila e publica somente um MSIX **unsigned** para validação estrutural. A assinatura final ocorre neste Windows, com chave privada não exportável em `CurrentUser\My` e certificado público em `LocalMachine\TrustedPeople`.

## Identidade e dados

- Pacote: `RUMAR.Local`, publisher `CN=RUMAR Local Development`, versão MSIX `1.8.0.1` para a correção de close-to-tray, x64. A versão do produto permanece `1.8.0`.
- Identificador Tauri: `com.rumar.desktop.local`, separado do legado `com.rumo.desktop`.
- Namespace de credencial: `RUMAR-Local-v180`; autostart: `RUMAR Local`.
- O pacote local começa com perfil isolado. **Não** copia nem migra automaticamente o banco RUMO 1.0.0.
- O instalador RUMO 1.0.0 e seu banco devem permanecer intactos até lançamento, integridade, gateway e backup terem sido validados no MSIX.

## Assinatura local

A Microsoft documenta `LocalMachine\TrustedPeople` para testar MSIX com certificado autoassinado. O certificado deve ter Code Signing EKU e subject exatamente igual ao Publisher do manifest. O script `scripts/sign-local-msix.ps1` exige certificado no repositório pessoal do Windows e a versão do MSIX como parâmetro; assina `rumar.exe`, recompõe e assina o pacote, confere a identidade do signatário e preserva a assinatura original do Node. A verificação final da cadeia com `signtool verify /pa` ocorre após a instalação do certificado público em TrustedPeople. Não exporta a chave nem usa PFX.

**Limite importante:** confiança local suficiente para **instalar** um MSIX não prova aceitação pelo Smart App Control. A documentação do SAC diz que a aceitação por assinatura depende de emissor confiável do Microsoft Trusted Root Program. Portanto, instalação e lançamento devem ser testados separadamente. Se SAC gerar 3077, parar e registrar o arquivo recusado. Não alterar SAC, Code Integrity ou Defender.

## Ordem de validação

1. CI normal e workflow MSIX estrutural passam.
2. Baixar o artifact privado e conferir hash, manifest, executável e assinatura do Node.
3. Criar certificado local específico, sem capacidade de CA e com chave não exportável; registrar subject, thumbprint, validade e EKU.
4. Assinar executável e pacote; conferir hash e identidade do signatário.
5. Confiar apenas o certificado público em `LocalMachine\TrustedPeople`; então `signtool verify /pa` deve passar para ambos.
6. Instalar o MSIX local e tentar lançamento normal, com SAC ativo.
7. Se abrir, executar smoke no perfil isolado antes de qualquer migração.
8. Só então planejar backup e migração do RUMO legado, sem apagar a origem.

O gateway continua restrito a `127.0.0.1:8787`. Nenhuma conta bancária real deve ser conectada durante a validação do pacote.
