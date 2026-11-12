# Modelo de dados e permissões — Sistema de Cotação

Projeto Supabase: `cowbpaaaguylhlvnlaac` · PostgreSQL 17.11
Migration: `supabase/migrations/20261112090000_estrutura_e_permissoes.sql`

---

## 1. Perfis de usuário

| Perfil | Código em `usuarios.tipo` | O que é |
|---|---|---|
| Administrador do Sistema | `admin_sistema` | Você. Único, não pode ser excluído nem ter o perfil alterado. Herda todas as permissões de Administrador. |
| Administrador | `administrador` | Cria/gerencia cotações, fornecedores, produtos e usuários. |
| Leitura | `leitura` | Só consulta. Não altera nada. |
| Fornecedor | `fornecedor` | Vê apenas as cotações e pedidos endereçados a ele e responde pelo link. |
| Público (sem login) | `anon` | Só acessa a cotação pelo link com token. Nenhuma tabela é exposta. |

**Garantias do Administrador do Sistema** (trigger `fn_protege_admin_sistema` + índice único parcial):

- `delete` na linha de `admin_sistema` → erro `42501`.
- alterar `tipo` de `admin_sistema` para outro → erro `42501`.
- promover qualquer outro usuário a `admin_sistema` → erro `42501`.
- segundo registro com `tipo = 'admin_sistema'` → erro de unicidade.

> Observação: as policies comparam com `'administrador'`, e a função `tipo_usuario()` devolve `administrador` para quem é `admin_sistema`. Assim o Administrador do Sistema passa em todas as regras sem duplicar cada policy.

---

## 2. Tabelas

### 2.1 `usuarios`
Perfil do usuário, ligado ao login do Supabase Auth (`auth.users`).

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `auth_user_id` | uuid | FK → `auth.users`, único. É o vínculo com o login |
| `nome` | text | obrigatório |
| `cpf_cnpj` | text | obrigatório, único, só dígitos (11 ou 14) — é o login |
| `tipo` | text | `admin_sistema` \| `administrador` \| `leitura` \| `fornecedor` |
| `fornecedor_id` | uuid | FK → `fornecedores` (obrigatório para perfil fornecedor) |
| `ativo` | boolean | padrão `true` |
| `criado_em`, `atualizado_em` | timestamptz | |

> A senha **não** fica nesta tabela: o Supabase Auth guarda o hash em `auth.users.encrypted_password`. Guardar senha em texto puro seria uma falha grave.

### 2.2 `fornecedores`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `razao_social` | text | obrigatório |
| `nome_fantasia` | text | |
| `cnpj_cpf` | text | único quando preenchido (comparado sem máscara) |
| `pais`, `estado`, `cidade`, `bairro`, `cep`, `numero` | text | localização |
| `contato_nome` | text | quem recebe cotação e pedido |
| `email` | text | destinatário do pedido |
| `whatsapp` | text | destinatário do pedido |
| **`prazo_entrega`** | text | *novo* — ex.: "5 dias úteis" |
| **`tipo_pagamento`** | text | *novo* — `dinheiro`\|`a_vista`\|`boleto`\|`pix`\|`transferencia`\|`cartao` |
| **`prazo_pagamento_dias`** | integer | *novo* — ex.: 30 |
| `observacoes` | text | *novo* |
| `ativo` | boolean | *novo*, padrão `true` |
| `criado_em`, `atualizado_em` | timestamptz | |

### 2.3 `produtos`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `sku` | text | único, comparado em maiúsculas sem espaços; não pode ser vazio |
| `descricao` | text | obrigatório |
| `unidade` | text | obrigatório |
| `origem` | text | *novo* — `manual` ou `lista:<nome>` |
| `criado_em`, `atualizado_em` | timestamptz | |

### 2.4 `produto_por_fornecedor`
N:N entre produto e fornecedor (quem fornece o quê). `id`, `produto_id`, `fornecedor_id` (par único).

### 2.5 `lista_de_produtos`
Listas/planilhas de itens importadas.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `lista` | text | nome da lista |
| `sku`, `descricao`, `unidade` | text | |
| `quantidade` | numeric | |
| `ordem` | integer | ordem de exibição |
| **`produto_id`** | uuid | *novo* — FK → `produtos`, preenchida na importação |
| **`importado_em`** | timestamptz | *novo* |
| `criado_em` | timestamptz | |

### 2.6 `cotacoes`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| **`codigo`** | text | *novo* — `COT-AAAA-00001`, gerado por trigger, único |
| `titulo`, `observacao` | text | |
| `fornecedor` | text | legado (a relação real é `cotacao_envios`) |
| **`status`** | text | *novo* — `rascunho`\|`finalizada`\|`enviada`\|`em_analise`\|`aprovada`\|`cancelada` |
| **`criado_por`** | uuid | *novo* — FK → `usuarios` |
| **`finalizada_em`** | timestamptz | *novo* |
| **`prazo_resposta`** | date | *novo* |
| `criado_em`, **`atualizado_em`** | timestamptz | |

### 2.7 `cotacao_itens`
Itens da cotação: `id`, `cotacao_id` (FK), `sku`, `descricao`, `quantidade`, `unidade`, `ordem`.

### 2.8 `cotacao_envios` — controle de quem recebeu / respondeu
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `cotacao_id` | uuid | FK → `cotacoes` |
| `fornecedor_id` | uuid | FK → `fornecedores` |
| `canal` | text | `email` \| `whatsapp` |
| **`token`** | uuid | *novo* — chave do link público, único |
| **`status`** | text | *novo* — `pendente`\|`enviado`\|`entregue`\|`lido`\|`respondido`\|`erro` |
| **`respondido_em`** | timestamptz | *novo* |
| **`ultimo_envio_em`** | timestamptz | *novo* |
| **`tentativas`** | integer | *novo* — incrementa a cada reenvio |
| **`erro`**, **`mensagem_id`** | text | *novo* — retorno da API de e-mail/WhatsApp |
| `enviado_em`, `enviado_por` | timestamptz, uuid | |

Regra: **um registro por (cotação, fornecedor, canal)**. Reenviar atualiza a linha e soma `tentativas`.

### 2.9 `cotacao_respostas`
Cabeçalho da resposta do fornecedor: `id`, `cotacao_id`, `fornecedor_id`, `empresa`, `prazo_entrega`, `pagamento`, `validade`, `observacao`, `total`, `itens` (jsonb bruto), `criado_em`.

### 2.10 `cotacao_respostas_itens` — *nova*
Resposta item a item, normalizada. É a base do ranking.

`id`, `resposta_id` (FK), `cotacao_item_id` (FK), `sku`, `descricao`, `quantidade`, `unidade`, `valor_unitario`, `valor_total` (calculado), `disponivel`, `observacao`, `criado_em`.
Índice único por `(resposta_id, cotacao_item_id)`.

### 2.11 `cotacoes_aprovadas` — *nova*
Um vencedor por item, no formato que você descreveu.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `cotacao_id` | uuid | FK |
| `cotacao_item_id` | uuid | FK, único por cotação |
| `fornecedor_id` | uuid | FK — o fornecedor vencedor |
| `resposta_item_id` | uuid | FK — a oferta vencedora |
| `sku`, `descricao`, `quantidade`, `unidade` | | cópia do item |
| `valor_de_custo_do_fornecedor` | numeric | custo unitário |
| `valor_total` | numeric | calculado (`quantidade × custo`) |
| `selecionado_automaticamente` | boolean | `false` quando você escolheu manualmente |
| `aprovado_por`, `aprovado_em`, `observacao` | | |

### 2.12 `pedidos_gerados` — *nova*
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `numero` | text | `PED-AAAA-00001`, sequencial, único |
| `cotacao_id` | uuid | FK |
| `fornecedor_id` | uuid | FK |
| `valor_total` | numeric | recalculado por trigger a partir dos itens |
| `data_pedido` | date | padrão `current_date` |
| `status` | text | `gerado`\|`enviado`\|`confirmado`\|`entregue`\|`cancelado` |
| `canal_envio` | text | `email` \| `whatsapp` |
| `enviado_em`, `enviado_para` | | data e destinatário do envio |
| **`recebido`** | boolean | *novo* — se o pedido já foi recebido (padrão `false`) |
| **`recebido_em`** | timestamptz | *novo* — data do recebimento |
| **`nota_fiscal`** | text | *novo* — número da nota fiscal recebida (não pode ser vazio) |
| **`nota_fiscal_em`** | timestamptz | *novo* — quando a NF foi registrada |
| `observacao`, `criado_por`, `criado_em` | | |

### 2.13 `pedido_itens` — *nova*
`id`, `pedido_id` (FK), `cotacao_aprovada_id` (FK), `sku`, `descricao`, `quantidade`, `unidade`, `valor_de_custo_do_fornecedor`, `valor_total` (calculado).
Trigger `trg_recalcula_total_pedido` mantém `pedidos_gerados.valor_total` em sincronia.

---

## 3. Matriz de permissões

Legenda: **L** = ler · **E** = editar · **C** = cadastrar · **X** = excluir · **—** = sem acesso · **L\*** = lê apenas os próprios registros

| Tabela | Admin do Sistema | Administrador | Leitura | Fornecedor | Público (link) |
|---|---|---|---|---|---|
| `usuarios` | L E C X¹ | L E C X¹ | L | L\* | — |
| `fornecedores` | L E C X | L E C X | L | L\* | — |
| `produtos` | L E C X | L E C X | L | — | — |
| `produto_por_fornecedor` | L E C X | L E C X | L | — | — |
| `lista_de_produtos` | L E C X | L E C X | L | — | — |
| `cotacoes` | L E C X | L E C X | L | L\* | L (via token) |
| `cotacao_itens` | L E C X | L E C X | L | L\* | L (via token) |
| `cotacao_envios` | L E C X | L E C X | L | L\* | — |
| `cotacao_respostas` | L E C X | L E C X | L | L\* | C (via token) |
| `cotacao_respostas_itens` | L E C X | L E C X | L | L\* | C (via token) |
| `cotacoes_aprovadas` | L E C X | L E C X | L | L\* | — |
| `pedidos_gerados` | L E C X | L E C X | L | L\* | — |
| `pedido_itens` | L E C X | L E C X | L | L\* | — |

¹ Exceto a própria linha de `admin_sistema`, que nunca pode ser excluída nem ter o perfil alterado (trigger).

Regras gerais:

- **Negado por padrão**: RLS ligado em todas as 13 tabelas; sem policy = sem acesso.
- **`anon` não enxerga tabela nenhuma.** Antes desta migration, `cotacoes` e `cotacao_itens` tinham `using (true)` e `cotacao_respostas` aceitava insert de qualquer um — ou seja, qualquer pessoa com a chave pública conseguia listar todas as cotações e injetar respostas falsas. Isso foi fechado.
- O acesso do fornecedor sem login é feito por duas funções `security definer` com token: `fn_cotacao_publica(token)` e `fn_responder_cotacao(token, ...)`. O token é único por cotação+fornecedor+canal e não aparece em listagens.

### Views auxiliares

| Objeto | Para que serve |
|---|---|
| `vw_cotacao_fornecedor_status` | Funil por fornecedor: recebeu e-mail? recebeu WhatsApp? leu? respondeu? quantas respostas? |
| `vw_resultado_cotacao` | Ranking de ofertas por item, com `posicao` (1 = menor custo) |

Ambas com `security_invoker = true`, então respeitam o RLS de quem consulta.

---

## 4. Funções (RPC)

| Função | Quem chama | O que faz |
|---|---|---|
| `importar_skus_da_lista(p_lista)` | Admin | Copia os SKUs distintos da lista para `produtos` (insere ou atualiza), amarra `lista_de_produtos.produto_id` e devolve `{inseridos, atualizados, total}`. |
| `fn_importar_lista_para_cotacao(p_cotacao_id, p_lista)` | Admin | Faz a importação acima **e** copia os itens da lista para `cotacao_itens`, continuando a numeração de `ordem`. |
| `fn_registrar_envio(p_cotacao_id, p_fornecedor_id, p_canal, p_status, p_erro, p_mensagem_id)` | Admin | Cria/atualiza o envio, gera o token e marca a cotação como `enviada`. Chamar depois de disparar e-mail/WhatsApp. |
| `fn_cotacao_publica(p_token)` | Público | Devolve cotação + itens + dados do fornecedor. Marca o envio como `lido`. |
| `fn_responder_cotacao(p_token, p_empresa, p_itens, p_prazo_entrega, p_pagamento, p_validade, p_observacao)` | Público | Grava a resposta e os itens, calcula o total, marca `respondido` e a cotação como `em_analise`. Bloqueia resposta duplicada. |
| `fn_aprovar_cotacao(p_cotacao_id, p_itens)` | Admin | Sem `p_itens`: aprova automaticamente o **menor custo por item**. Com `p_itens` (`[{cotacao_item_id, fornecedor_id}]`): respeita sua escolha manual. Grava em `cotacoes_aprovadas` e muda o status para `aprovada`. |
| `fn_gerar_pedidos(p_cotacao_id)` | Admin | Agrupa as aprovações por fornecedor e cria um `pedidos_gerados` + `pedido_itens` para cada um. Idempotente: não duplica pedido já gerado. |

---

## 5. Fluxo completo

```
1. Cadastro           fornecedores + produtos (ou importação de lista)
2. Cotação            cotacoes (rascunho) + cotacao_itens
                      └─ fn_importar_lista_para_cotacao  ← planilha/lista
3. Finalização        status: finalizada
4. Envio              um cotacao_envios por fornecedor/canal (token gerado)
                      └─ e-mail / WhatsApp disparam no app; fn_registrar_envio grava o resultado
5. Resposta           fornecedor abre o link com token
                      └─ fn_cotacao_publica → fn_responder_cotacao
6. Resultado          vw_resultado_cotacao: menor custo marcado como posição 1
7. Aprovação          fn_aprovar_cotacao  → cotacoes_aprovadas
8. Pedidos            fn_gerar_pedidos    → pedidos_gerados + pedido_itens
9. Envio do pedido    WhatsApp/e-mail ao fornecedor, status do pedido → enviado
10. Recebimento       marca recebido (status → entregue) e registra o número da NF
11. Impressão         layout A4 com dados do fornecedor, itens, totais, NF e assinatura
```

---

## 6. Validação executada

Teste transacional (`test_fluxo.py`, revertido no final) com 2 fornecedores e 3 SKUs:

- importação de 3 SKUs da lista → 3 inseridos, 3 atualizados na segunda passada;
- cotação criada como `COT-2026-0000x` em `rascunho`;
- 2 envios (e-mail e WhatsApp) com tokens distintos;
- 2 respostas gravadas, totais R$ 3.280,00 e R$ 3.030,00;
- resposta duplicada bloqueada (`P0001`);
- ranking por item com posições corretas;
- aprovação automática escolhendo o menor custo por item (R$ 2.960,00 no total);
- 2 pedidos gerados (`PED-2026-00001` e `PED-2026-00002`), cada um com seus itens;
- status final da cotação: `aprovada`.

Sequências reiniciadas em 1 após o teste; o banco está sem dados.

---

## 7. Correções posteriores à primeira versão

### 7.1 `EXECUTE` implícito para `PUBLIC`

No PostgreSQL toda função nasce executável por `PUBLIC`, e `GRANT` para
`authenticated` **não** remove isso. Na prática, o `anon` conseguia chamar
`fn_aprovar_cotacao` e `fn_gerar_pedidos` pela API — aprovando cotações sem
login. A migration `20261112120000_endurece_funcoes.sql`:

- revoga `EXECUTE` de `PUBLIC` em todas as funções de domínio;
- concede apenas aos papéis certos (`anon` só nas duas funções de link);
- adiciona `fn_exige_admin()` e a chama no início de `importar_skus_da_lista`,
  `fn_importar_lista_para_cotacao`, `fn_registrar_envio`, `fn_aprovar_cotacao`
  e `fn_gerar_pedidos`.

Resultado verificado: `anon`, `leitura` e `fornecedor` recebem `42501` ao tentar
qualquer função administrativa, mesmo autenticados.

### 7.2 Primeiro Administrador do Sistema

A primeira versão do trigger recusava **qualquer** promoção para
`admin_sistema`, impedindo a criação do primeiro. A migration
`20261112140000_corrige_admin_sistema.sql` só bloqueia quando já existe outro;
a unicidade continua garantida pelo índice `usuarios_um_admin_sistema`.

### 7.3 Domínio do login sintético

O GoTrue recusa endereços em domínios especiais (`.local`, `.test`, `.invalid`).
Por isso o login usa `<CPF>@cotacao.app` (`LOGIN_DOMAIN` em `assets/config.js`).
A confirmação de e-mail precisa estar desligada no painel.
