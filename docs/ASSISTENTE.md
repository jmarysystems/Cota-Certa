# Canal do fornecedor por mensagem

**Decisão do projeto: o sistema funciona 100% online, sem OpenClaw e sem nenhum processo
rodando na máquina do cliente.** Este documento registra o que garante isso e o que já está
pronto caso o canal automático seja retomado um dia.

---

## 1. O que sustenta o "100% online"

| Peça | Onde roda |
|---|---|
| Interface (SPA) | GitHub Pages, com o domínio `www.jmarysystems.com.br` |
| Banco, autenticação e regras | Supabase (Postgres + Auth + REST/RPC) |
| Resposta do fornecedor | Link com token, aberto no navegador de qualquer celular |

Nenhum computador precisa estar ligado: o fornecedor responde às 3h da manhã e a cotação é
gravada do mesmo jeito.

## 2. Os dois caminhos de resposta (ambos online)

1. **Link público** — `resposta.html?token=…`, com prazo e bloqueio de duplicidade.
2. **Colar resposta** — o fornecedor respondeu por WhatsApp ou e-mail? O comprador cola a
   mensagem na cotação, confere e registra. Roda no navegador, usa o mesmo
   `fn_responder_cotacao`.

O interpretador de texto (`assets/parse-resposta.js`) é o mesmo nos dois e tem testes
próprios: `npm test`.

## 3. Pronto, mas desligado: a API por telefone

A migration `20261113090000_api_assistente.sql` criou uma interface para um **canal
hospedado** (não local) operar em nome do fornecedor:

| Função | O que faz |
|---|---|
| `fn_assistente_cotacao(p_chave, p_telefone)` | Cotações abertas daquele telefone, com itens e prazo |
| `fn_assistente_responder(p_chave, p_telefone, p_cotacao_id, p_itens, …)` | Grava a resposta, se o telefone tiver envio naquela cotação |

- autenticação por uma chave própria, guardada em `config_assistente` (sem acesso por RLS);
- telefone comparado só pelos dígitos (tolera `+55` e o 9º dígito);
- delega para `fn_responder_cotacao`, então prazo e duplicidade continuam valendo;
- se dois fornecedores tiverem o mesmo telefone, a gravação **recusa** em vez de gravar no
  cadastro errado.

Chave: `select chave from public.config_assistente where id = 1;`

Enquanto não houver canal, essas funções ficam sem uso — e sem risco, porque exigem a chave.

## 4. Se um dia o canal automático for retomado

O caminho compatível com "100% online" é um **webhook no Supabase**, não um programa na
máquina:

```
WhatsApp Cloud API ──webhook──► Supabase Edge Function ──► fn_assistente_*
                                        │
                                        └──► resposta ao fornecedor
```

Passos: criar a Edge Function com `verify_jwt = false`, validar a assinatura do provedor,
chamar `fn_assistente_cotacao` para montar a pergunta e `fn_assistente_responder` para
gravar. Nada disso exige servidor próprio.

## 5. O que evitar

- Rodar Gateway ou assistente no PC do escritório: quebra a disponibilidade e vira ponto
  único de falha.
- Deixar qualquer serviço exposto na internet sem autenticação.

## 6. Segurança

- identidade do fornecedor é decidida **no banco** (telefone ↔ cadastro), nunca pelo texto;
- a chave do assistente dá acesso a duas funções, não ao banco — não usar `service_role`;
- mensagem recebida é entrada não confiável: nada de executar instrução vinda do texto;
- o `anon` continua sem enxergar tabela alguma; o fornecedor só entra pelo token.
