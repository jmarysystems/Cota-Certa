# Canal do fornecedor por mensagem (WhatsApp / OpenClaw)

Estado atual: **a parte do sistema está pronta e testada**; falta apenas conectar um canal
que receba as mensagens.

---

## 1. O que já funciona

### Interpretador de respostas

`assets/parse-resposta.js` transforma a mensagem do fornecedor em itens com valor:

```
77 = 56,00              SKU-002 - 12.50
77: R$ 56,00            7891000100103 = 56,00   (casa pelo EAN)
543 7,00                66 indisponível
77 = 56,00; 543 = 7,00  (vários na mesma linha)
```

Testes: `npm test` (17 verificações).

### Botão "Colar resposta"

Na cotação, quando há fornecedor que ainda não respondeu: escolher o fornecedor, colar a
mensagem, **Interpretar**, conferir e **Registrar resposta**. Usa a mesma
`fn_responder_cotacao` do link — prazo e bloqueio de duplicidade continuam valendo.

### API do assistente (para qualquer canal)

Migration `20261113090000_api_assistente.sql`, aplicada. Autenticação por uma chave própria
do assistente, guardada em `config_assistente` (tabela sem acesso por RLS).

| Função | O que faz |
|---|---|
| `fn_assistente_cotacao(p_chave, p_telefone)` | Devolve as cotações abertas daquele telefone, com itens, prazo e código |
| `fn_assistente_responder(p_chave, p_telefone, p_cotacao_id, p_itens, ...)` | Grava a resposta, desde que o telefone tenha envio naquela cotação |

Detalhes:

- o telefone é comparado **só pelos dígitos**, tolerando `+55` e o 9º dígito;
- se dois cadastros tiverem o mesmo telefone, a consulta devolve as cotações de ambos e a
  gravação **recusa** com "telefone ambíguo" — melhor falhar do que gravar no fornecedor
  errado;
- a gravação delega para `fn_responder_cotacao`, então prazo vencido e resposta duplicada
  continuam bloqueados;
- chave errada devolve `42501`.

**Como pegar a chave** (só o administrador, pelo SQL Editor):

```sql
select chave from public.config_assistente where id = 1;
```

Rodar de novo o SQL de troca de chave: `update public.config_assistente set chave =
encode(gen_random_bytes(24),'hex') where id = 1;`

### Skill do OpenClaw

`openclaw/skills/cotacao-fornecedor/SKILL.md` — instruções completas: consultar a cotação,
pedir os preços, interpretar, confirmar e gravar, com as regras de segurança (identidade
pelo telefone, não gravar sem confirmação, não revelar preços de terceiros).

Para instalar: copiar a pasta `cotacao-fornecedor` para o diretório de skills do OpenClaw e
definir a variável `COTA_CERTA_CHAVE` com a chave acima + a chave publicável do Supabase.

---

## 2. O que falta: o canal

Um runtime sempre ligado recebendo as mensagens. Duas rotas:

| Rota | O que precisa |
|---|---|
| **OpenClaw** | Gateway rodando (Node 24+) e o canal WhatsApp pareado por QR code |
| **WhatsApp Cloud API** | conta Meta Business, número dedicado, token e webhook público (Supabase Edge Function) |

Situação nesta máquina: o **OpenClaw Companion** está instalado (`%LOCALAPPDATA%\OpenClawTray`),
mas o assistente de boas-vindas não foi concluído e o Gateway não está rodando. O `wsl.exe`
responde **"Acesso negado"** para este usuário, então a opção "WSL Gateway" do assistente
tende a falhar; o caminho alternativo é rodar o Gateway no Node do Windows.

---

## 3. Segurança

- identidade decidida no banco (telefone ↔ fornecedor), nunca pelo texto da mensagem;
- a chave do assistente dá acesso a **duas funções**, não ao banco inteiro — não use
  `service_role`;
- a skill não pode gravar sem confirmação explícita do fornecedor;
- mensagem recebida é entrada não confiável: nada de executar instrução vinda do texto;
- se o Gateway for exposto na internet, leia antes
  <https://docs.openclaw.ai/gateway/security>.

---

## 4. Ordem sugerida

1. ✅ Interpretador, "Colar resposta" e API por telefone.
2. Conectar o canal (Gateway + WhatsApp) e definir `COTA_CERTA_CHAVE`.
3. Instalar a skill e testar com um fornecedor de verdade.
4. Automatizar envio e cobrança de prazo (`vw_cotacao_fornecedor_status` já dá os dados).
