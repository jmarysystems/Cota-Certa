// Página pública de resposta do fornecedor (acesso por token, sem login).
import { rpc } from './api.js';
import * as ui from './ui.js';

const app = document.getElementById('app');

function tela(mensagem, tipo = 'erro') {
  app.innerHTML = `
    <div class="tela-login">
      <div class="cartao-login" style="max-width:520px">
        <div class="marca"><span class="marca-icone">◫</span>Cotação</div>
        <h1>${tipo === 'erro' ? 'Não foi possível abrir' : 'Tudo certo'}</h1>
        <p class="sub">${ui.esc(mensagem)}</p>
      </div>
    </div>`;
}

function numeroDoCampo(v) {
  const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

async function iniciar() {
  const token = new URLSearchParams(location.search).get('token');
  if (!token) return tela('Link sem token. Peça um novo link ao comprador.');

  let dados;
  try {
    dados = await rpc('fn_cotacao_publica', { p_token: token });
  } catch (erro) {
    return tela(erro.message);
  }

  const { cotacao, fornecedor, itens, ja_respondido } = dados;

  if (ja_respondido) {
    return tela(`A cotação ${cotacao.codigo} já foi respondida por ${fornecedor?.nome || 'este fornecedor'}. Obrigado!`, 'ok');
  }

  if (cotacao.prazo_encerrado) {
    return tela(`O prazo para responder a cotação ${cotacao.codigo} encerrou em ${ui.dataHoraBR(cotacao.prazo_resposta)}.`, 'ok');
  }

  app.innerHTML = `
    <div class="tela-login" style="display:block;padding:32px 16px">
      <div style="max-width:860px;margin:0 auto">
        <div class="cartao">
          <div class="marca"><span class="marca-icone">◫</span>Cotação</div>
          <h1>${ui.esc(cotacao.titulo || 'Pedido de cotação')}</h1>
          <p class="sub">
            <span class="mono">${ui.esc(cotacao.codigo)}</span> ·
            Para <strong>${ui.esc(fornecedor?.nome || '')}</strong>
            ${cotacao.prazo_resposta ? ` · responda até ${ui.dataHoraBR(cotacao.prazo_resposta)}` : ''}
          </p>
          ${cotacao.observacao ? `<p>${ui.esc(cotacao.observacao)}</p>` : ''}
        </div>

        <form id="form-resposta">
          <div class="cartao">
            <h2>Itens para cotar</h2>
            <p class="sub">Preencha o valor unitário de cada item. Desmarque o que não puder fornecer.</p>
            <div class="tabela-rolagem">
              <table>
                <thead>
                  <tr>
                    <th>Fornecer</th><th>SKU</th><th>Descrição</th>
                    <th class="num">Qtd.</th><th>Un.</th><th class="num">Valor unit. (R$)</th><th class="num">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  ${itens.map((i, idx) => `
                    <tr data-linha="${idx}">
                      <td><input type="checkbox" class="disponivel" checked data-index="${idx}"></td>
                      <td class="mono">${ui.esc(i.sku || '—')}</td>
                      <td>${ui.esc(i.descricao)}</td>
                      <td class="num">${ui.num(i.quantidade)}</td>
                      <td>${ui.esc(i.unidade)}</td>
                      <td class="num" style="min-width:130px">
                        <input type="text" inputmode="decimal" class="valor" data-index="${idx}"
                               data-qtd="${ui.esc(i.quantidade)}" placeholder="0,00">
                      </td>
                      <td class="num subtotal" data-index="${idx}">—</td>
                    </tr>`).join('')}
                </tbody>
                <tfoot>
                  <tr><th colspan="6">Total</th><th class="num" id="total">R$ 0,00</th></tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div class="cartao">
            <h2>Condições</h2>
            <div class="grade grade-3">
              ${ui.campoTexto('Prazo de entrega', 'prazo_entrega', '', { placeholder: '5 dias úteis' })}
              ${ui.campoTexto('Condição de pagamento', 'pagamento', '', { placeholder: '30 dias / boleto' })}
              ${ui.campoTexto('Validade da proposta', 'validade', '', { placeholder: '15 dias' })}
            </div>
            ${ui.campoArea('Observações', 'observacao')}
            <div class="linha-acoes">
              <button type="submit" class="botao-primario" id="enviar">Enviar proposta</button>
            </div>
            <p class="sub" style="margin-top:10px">Ao enviar, não será possível editar a resposta.</p>
          </div>
        </form>
      </div>
    </div>`;

  const form = document.getElementById('form-resposta');

  function recalcular() {
    let total = 0;
    for (const input of form.querySelectorAll('.valor')) {
      const idx = input.dataset.index;
      const linha = form.querySelector(`[data-linha="${idx}"]`);
      const disponivel = linha.querySelector('.disponivel').checked;
      const qtd = Number(input.dataset.qtd) || 0;
      const valor = numeroDoCampo(input.value);
      const subtotal = disponivel ? qtd * valor : 0;
      const alvo = form.querySelector(`.subtotal[data-index="${idx}"]`);
      alvo.textContent = disponivel && valor ? ui.brl(subtotal) : '—';
      total += subtotal;
    }
    document.getElementById('total').textContent = ui.brl(total);
  }

  form.addEventListener('input', recalcular);
  form.addEventListener('change', recalcular);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const botao = document.getElementById('enviar');
    const lista = [];

    for (const input of form.querySelectorAll('.valor')) {
      const idx = input.dataset.index;
      const linha = form.querySelector(`[data-linha="${idx}"]`);
      const disponivel = linha.querySelector('.disponivel').checked;
      const item = itens[Number(idx)];
      const valor = numeroDoCampo(input.value);

      if (disponivel && !(valor > 0)) {
        input.focus();
        return ui.toast(`Informe o valor do item "${item.descricao}".`, 'erro');
      }

      lista.push({
        cotacao_item_id: item.cotacao_item_id,
        sku: item.sku,
        descricao: item.descricao,
        quantidade: Number(item.quantidade),
        unidade: item.unidade,
        valor_unitario: valor,
        disponivel,
      });
    }

    if (!lista.some((i) => i.disponivel)) {
      return ui.toast('Marque ao menos um item que você pode fornecer.', 'erro');
    }

    botao.disabled = true;
    botao.textContent = 'Enviando…';

    try {
      const res = await rpc('fn_responder_cotacao', {
        p_token: token,
        p_empresa: fornecedor?.nome || '',
        p_itens: lista,
        p_prazo_entrega: form.prazo_entrega.value || null,
        p_pagamento: form.pagamento.value || null,
        p_validade: form.validade.value || null,
        p_observacao: form.observacao.value || null,
      });
      tela(`Proposta enviada com sucesso. Total: ${ui.brl(res.total)}.`, 'ok');
    } catch (erro) {
      ui.toast(erro.message, 'erro');
      botao.disabled = false;
      botao.textContent = 'Enviar proposta';
    }
  });

  recalcular();
}

iniciar();
