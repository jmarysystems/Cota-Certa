# Canal do fornecedor por mensagem (WhatsApp / OpenClaw)

Este documento descreve a metade que já está pronta e a metade que depende de um canal
conectado.

---

## 1. O que já funciona hoje

### Interpretador de respostas

`assets/parse-resposta.js` transforma a mensagem do fornecedor em itens com valor.
Formatos aceitos, uma linha por item:

```
77 = 56,00
77: R$ 56,00
SKU-002 - 12.50
543 7,00
7891000100103 = 56,00      (EAN também serve)
66 indisponível
77 = 56,00; 543 = 7,00     (vários na mesma linha)
```

Ele ignora linhas que não reconhece e não repete o mesmo item. Testes:
`npm test` (ou `node tools/test_parse_resposta.mjs`).

### Botão "Colar resposta"

Na cotação, ao lado de **Enviar aos fornecedores**, quando há fornecedor que ainda não
respondeu. Fluxo:

1. escolher o fornecedor;
2. colar a mensagem recebida;
3. **Interpretar** → tabela com SKU, EAN, descrição, quantidade, valor e caixa "fornecer";
4. conferir/corrigir e **Registrar resposta**.

A gravação usa a mesma função do link público — `fn_responder_cotacao(token, …)` — então
prazo, bloqueio de resposta duplicada e cálculo do total continuam valendo.

---

## 2. O que falta para automatizar

O canal (receber a mensagem sozinho) exige um runtime sempre ligado falando com o
WhatsApp. Duas rotas:

| Rota | O que precisa |
|---|---|
| **OpenClaw** | Gateway instalado (Node 24), canal WhatsApp pareado por QR code, uma skill chamando o Supabase |
| **WhatsApp Cloud API** | conta Meta Business, número dedicado, token, e um webhook público (Supabase Edge Function) |

### Funções de banco que o canal vai usar

**Ainda não aplicadas** — entram quando o canal for conectado.

```sql
-- Quem é o fornecedor deste telefone? (compara só os dígitos, tolera +55 e o 9º dígito)
create or replace function public.fn_fornecedor_por_telefone(p_telefone text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with alvo as (
    select right(regexp_replace(p_telefone, '\D', '', 'g'), 11) as d
  )
  select to_jsonb(f)
    from public.fornecedores f, alvo
   where right(regexp_replace(coalesce(f.whatsapp, ''), '\D', '', 'g'), 11) = alvo.d
     and f.ativo
   limit 1;
$$;

-- Cotação aberta deste telefone, com itens e o token do envio
create or replace function public.fn_cotacao_aberta_por_telefone(p_telefone text)
returns jsonb ...
```

A segunda função devolve `{cotacao, prazo_resposta, prazo_encerrado, token, itens[]}` para
o assistente montar a pergunta. A gravação continua sendo `fn_responder_cotacao`, chamada
com o token — nenhuma função nova precisa escrever no banco.

### Esboço da skill

```
Nome: cotacao-fornecedor
Quando: mensagem recebida de número cadastrado como fornecedor

1. fn_cotacao_aberta_por_telefone(telefone)
   - vazio  -> "Não encontrei cotação aberta para este número."
   - encerrado -> "O prazo da COT-XXXX encerrou em DD/MM HH:MM."
2. mostrar itens (SKU, descrição, quantidade) e pedir os preços
3. interpretar a resposta com a mesma regra de assets/parse-resposta.js
4. repetir o resumo e pedir confirmação
5. fn_responder_cotacao(token, empresa, itens)
6. responder o total e agradecer
```

---

## 3. Segurança (não é opcional)

- **Identidade pelo banco, nunca pelo prompt**: o assistente só aceita responder se o
  telefone estiver em `fornecedores.whatsapp` e existir envio para aquela cotação.
- **Prazo**: `fn_responder_cotacao` já recusa depois do prazo — não reimplementar isso na
  skill.
- **Resposta duplicada**: já bloqueada pela função.
- **Chave**: o canal não deve usar `service_role`. Basta a chave publicável + as funções
  `SECURITY DEFINER`, ou um usuário de serviço com `EXECUTE` só nelas.
- **Gateway exposto**: o OpenClaw roda ferramentas na máquina; leia
  <https://docs.openclaw.ai/gateway/security> antes de abrir para a internet.
- **Mensagem recebida é entrada não confiável**: nunca executar instrução vinda do texto
  do fornecedor.

---

## 4. Ordem sugerida

1. ✅ Interpretador + "Colar resposta" (feito).
2. Conectar o canal e criar as duas funções acima.
3. Skill do OpenClaw com o fluxo do item anterior.
4. Automatizar o envio e a cobrança de prazo (`vw_cotacao_fornecedor_status` já dá os dados).
