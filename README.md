# Cotação

Sistema web de cotação com fornecedores, respostas por link público, comparação
por menor custo, aprovação e geração de pedidos. Front-end estático (HTML + JS
puro, sem build) e banco no Supabase (PostgreSQL com RLS).

- **Aplicação:** `index.html` (área interna) e `resposta.html` (link do fornecedor)
- **Banco:** projeto Supabase `cowbpaaaguylhlvnlaac`
- **Repositório:** https://github.com/jmarysystems/Cota-Certa
- **Publicado em:** https://www.jmarysystems.com.br/Cota-Certa/

---

## 1. Como o acesso funciona

O login é por **CPF/CNPJ + senha**. Como o Supabase Auth exige e-mail, o
documento é convertido em uma identidade sintética:

```
11999990001  ->  11999990001@cotacao.app
```

Esse endereço não recebe mensagem nenhuma — é só a chave de login. O domínio
(`LOGIN_DOMAIN` em `assets/config.js`) precisa ter formato válido; o GoTrue
recusa `.local`, `.test`, `.invalid`. Troque por um domínio seu quando tiver.

**Perfis:**

| Perfil | Pode |
|---|---|
| `admin_sistema` | Tudo. Único, não pode ser excluído nem rebaixado (regra no banco). |
| `administrador` | Cria/edita cotações, fornecedores, produtos, listas e usuários; envia, aprova e gera pedidos. |
| `leitura` | Só consulta. |
| `fornecedor` | Vê apenas as cotações e pedidos dele e responde pelo link. |

---

## 2. Configuração obrigatória no Supabase

1. **Desligar a confirmação de e-mail** — sem isso, ninguém consegue entrar,
   porque o endereço sintético não existe:
   *Authentication → Providers → Email → Confirm email = OFF*.
2. **Criar o primeiro usuário** (o Administrador do Sistema):
   - *Authentication → Users → Add user* com e-mail `SEUCPF@cotacao.app` e uma senha;
   - copie o **UID** do usuário;
   - no *SQL Editor*, rode (trocando os valores):

   ```sql
   insert into public.usuarios (auth_user_id, nome, cpf_cnpj, tipo)
   values ('<UID>', 'Seu Nome', '<SEUCPF>', 'admin_sistema');
   ```

   A partir daí os demais usuários são criados dentro do próprio sistema, em
   **Usuários → Novo usuário**.

   > Só pode existir **um** `admin_sistema`: o banco bloqueia um segundo.

---

## 3. Publicar no GitHub Pages

1. Suba o conteúdo deste repositório na branch `main`.
2. *Settings → Pages → Source: Deploy from a branch → main / (root)*.
3. O site fica em `https://<usuario>.github.io/<repo>/`.

O `index.html` e o `resposta.html` usam caminhos relativos, então funcionam em
qualquer subpasta. O arquivo `.nojekyll` evita o processamento do Jekyll.

Para publicar sem instalar nada: **Add file → Upload files** e arraste as pastas
`assets`, `docs`, `supabase`, `tools` junto com os arquivos da raiz.

---

## 4. Como usar

```
Dashboard     → economia gerada pelas cotações aprovadas, por mês e por fornecedor
Fornecedores  → cadastre o fornecedor (contato, e-mail, WhatsApp, prazo,
                tipo/prazo de pagamento)Produtos      → cadastre manualmente ou importe uma planilha
Prod. por fornec. → relacione SKU ↔ fornecedor (manual ou importando planilha);
                é essa tabela que permite enviar a cotação só a quem fornece os itens
Listas        → a planilha vira uma lista; os SKUs são sincronizados em Produtos
Cotações      → nova cotação → adicione itens ou importe uma lista → Finalizar
              → Enviar aos fornecedores (gera link único por fornecedor)
Link público  → o fornecedor abre resposta.html?token=... e envia a proposta
Colar resposta → o fornecedor respondeu por WhatsApp/e-mail? cole a mensagem em
              "Colar resposta": ela vira itens com valor, você confere e registra
Resultado     → vw_resultado_cotacao marca o menor custo de cada item
Aprovação     → confirme os vencedores (ou troque manualmente)
Pedidos       → gere um pedido por fornecedor e envie por WhatsApp/e-mail
```

### Importação de planilha

Aceita `.xlsx`, `.xls` e `.csv` com colunas **SKU**, **Descrição**,
**Quantidade** e **Unidade** (nomes sem acento e sem caixa também funcionam).
O processamento é no navegador (SheetJS via CDN); nada é enviado a terceiros.

### Envio de e-mail e WhatsApp

O envio é **manual e rastreável**: o sistema prepara o texto e abre o
WhatsApp (`wa.me`) ou o cliente de e-mail (`mailto:`) já preenchido. O status
fica como *enviado* e vira *lido* quando o fornecedor abre o link.

Para envio automático seria necessária uma Edge Function com `service_role`
(e um provedor de e-mail/WhatsApp) — não incluído nesta versão.

---

## 5. Estrutura

```
index.html                 área interna (SPA)
resposta.html              página pública do fornecedor
assets/
  config.js                URL e chave publicável do Supabase + domínio de login
  api.js                   cliente Supabase, CRUD e RPCs
  parse-resposta.js        interpreta "77 = 56,00" da mensagem do fornecedor
  ui.js                    formatação, modal, toast, links wa.me/mailto
  app.js                   login e roteador por perfil
  styles.css
  resposta.js              lógica da página pública
  views/
    dashboard.js           economia por mês e por fornecedor
    cotacoes.js            lista, criação, detalhe, envio, aprovação, pedidos
    cadastros.js           fornecedores, produtos, importação, listas
    usuarios.js            perfis de acesso
    vinculos.js            produtos por fornecedor (importação por arquivo)
    pedidos.js             pedidos, recebimento, NF e impressão
docs/TABELAS.md            tabelas e matriz de permissões
docs/ASSISTENTE.md         canal do fornecedor por mensagem (OpenClaw / WhatsApp)
supabase/migrations/       DDL versionado (aplicar na ordem dos nomes)
tools/                     utilitários de manutenção (Python, opcionais)
```

### Migrations

| Arquivo | O que faz |
|---|---|
| `20261112090000_estrutura_e_permissoes.sql` | Tabelas, colunas, funções, views, RLS e grants |
| `20261112120000_endurece_funcoes.sql` | Fecha o `EXECUTE` de `PUBLIC` e valida perfil dentro das funções |
| `20261112140000_corrige_admin_sistema.sql` | Permite criar o primeiro Administrador do Sistema |

### Utilitários (`tools/`)

Precisam da variável `SB_DSN` com a connection string do projeto:

```powershell
$env:SB_DSN = "postgresql://postgres:<senha>@db.<ref>.supabase.co:5432/postgres?sslmode=require"
python tools/sql.py "select * from public.cotacoes"
python tools/test_rls.py    # valida permissões por perfil (rollback no fim)
```

`pgclient.py` é um cliente PostgreSQL em Python puro (sem dependências).

---

## 6. Segurança

- **RLS ligado em todas as 13 tabelas**; sem policy, sem acesso.
- **`anon` não lê tabela nenhuma.** O fornecedor entra só pelo link com token,
  via `fn_cotacao_publica` / `fn_responder_cotacao`.
- **Funções administrativas** exigem perfil `administrador` (checagem dentro da
  função, além do `GRANT`) — um usuário `leitura` ou `fornecedor` recebe erro
  `42501` ao tentar aprovar ou gerar pedido.
- **Senha nunca fica no banco da aplicação**: quem guarda é o Supabase Auth.
- A chave em `assets/config.js` é a **publicável** (equivalente à anon):
  foi feita para ficar no navegador. Nunca coloque a `service_role` aqui.

Detalhes e matriz completa: [docs/TABELAS.md](docs/TABELAS.md).

---

## 7. Limitações conhecidas

- Criação de usuário depende de *Confirm email* desligado. Com a confirmação
  ligada, o cadastro enviaria e-mails para um domínio inexistente e falharia.
- Sem envio automático de e-mail/WhatsApp (ver seção 4).
- Sem anexo de PDF no pedido; o botão *Imprimir* da tela de Pedidos serve como
  comprovante.
- Exclusão do usuário `admin_sistema` exige desativar o trigger
  `trg_protege_admin_sistema` — é intencional.
