// Pedidos gerados: lista, itens e envio ao fornecedor por e-mail/WhatsApp.
import { listar, atualizar } from '../api.js';
import * as ui from '../ui.js';

export async function lista(raiz, ctx) {
  ctx.setTitulo('Pedidos');

  const pedidos = await listar('pedidos_gerados', {
    select: '*, fornecedores(razao_social, email, whatsapp, contato_nome), pedido_itens(*)',
    ordem: 'data_pedido',
    asc: false,
  });

  if (!pedidos.length) {
    raiz.innerHTML = `<div class="cartao"><h2>Pedidos</h2>
      ${ui.vazio('Nenhum pedido gerado. Aprove uma cotação para gerar os pedidos.')}</div>`;
    return;
  }

  const blocos = pedidos.map((p) => {
    const itens = p.pedido_itens || [];
    return `
      <div class="cartao">
        <div class="cartao-topo">
          <div>
            <h2 class="mono">${ui.esc(p.numero)} ${ui.badgeStatus(p.status)}</h2>
            <p class="sub">${ui.esc(p.fornecedores?.razao_social || '—')} ·
              ${ui.dataBR(p.data_pedido)} · ${itens.length} item(ns) ·
              total <strong>${ui.brl(p.valor_total)}</strong>
              ${p.enviado_em ? ` · enviado em ${ui.dataHoraBR(p.enviado_em)}` : ''}</p>
          </div>
          <div class="linha-acoes">
            <button type="button" class="botao-pequeno" data-detalhar="${ui.esc(p.id)}">Itens</button>
            ${ctx.admin ? `<button type="button" class="botao-primario botao-pequeno" data-enviar="${ui.esc(p.id)}">Enviar</button>` : ''}
          </div>
        </div>
        <div id="itens-${ui.esc(p.id)}" hidden>
          <div class="tabela-rolagem"><table>
            <thead><tr><th>SKU</th><th>Descrição</th><th class="num">Qtd.</th><th>Un.</th><th class="num">Custo unit.</th><th class="num">Total</th></tr></thead>
            <tbody>
              ${itens.map((i) => `<tr>
                <td class="mono">${ui.esc(i.sku || '—')}</td>
                <td>${ui.esc(i.descricao)}</td>
                <td class="num">${ui.num(i.quantidade)}</td>
                <td>${ui.esc(i.unidade)}</td>
                <td class="num">${ui.brl(i.valor_de_custo_do_fornecedor)}</td>
                <td class="num">${ui.brl(i.valor_total)}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr><th colspan="5">Total</th><th class="num">${ui.brl(p.valor_total)}</th></tr></tfoot>
          </table></div>
        </div>
      </div>`;
  }).join('');

  raiz.innerHTML = `
    <div class="cartao">
      <div class="cartao-topo">
        <h2>${pedidos.length} pedido(s)</h2>
        <button type="button" id="imprimir" class="botao-pequeno no-print">Imprimir</button>
      </div>
      <p class="sub">Abra os itens e clique em Enviar para disparar e-mail ou WhatsApp ao fornecedor.</p>
    </div>
    ${blocos}`;

  raiz.querySelector('#imprimir').addEventListener('click', () => window.print());

  for (const b of raiz.querySelectorAll('[data-detalhar]')) {
    b.addEventListener('click', () => {
      const alvo = document.getElementById(`itens-${b.dataset.detalhar}`);
      alvo.hidden = !alvo.hidden;
    });
  }

  for (const b of raiz.querySelectorAll('[data-enviar]')) {
    b.addEventListener('click', () => {
      const p = pedidos.find((x) => x.id === b.dataset.enviar);
      modalEnvioPedido(p, ctx);
    });
  }
}

function modalEnvioPedido(p, ctx) {
  const itens = p.pedido_itens || [];
  const fornecedor = p.fornecedores || {};

  const texto = (canal) => [
    `Olá${fornecedor.contato_nome ? ` ${fornecedor.contato_nome}` : ''}!`,
    `Segue o pedido ${p.numero} (${itens.length} item(ns)), total ${ui.brl(p.valor_total)}.`,
    '',
    ...itens.map((i) => `• ${i.quantidade} ${i.unidade} — ${i.descricao}${i.sku ? ` (SKU ${i.sku})` : ''} — ${ui.brl(i.valor_de_custo_do_fornecedor)} un.`),
    '',
    `Data do pedido: ${ui.dataBR(p.data_pedido)}.`,
    canal === 'whatsapp' ? 'Qualquer dúvida, é só responder por aqui.' : 'Qualquer dúvida, é só responder este e-mail.',
  ].join('\n');

  const wa = ui.linkWhatsapp(fornecedor.whatsapp, texto('whatsapp'));
  const em = ui.linkEmail(fornecedor.email, `Pedido ${p.numero}`, texto('email'));

  const { fechar, corpo } = ui.modal({
    titulo: `Enviar pedido ${p.numero}`,
    largura: '640px',
    corpo: `
      <p class="sub">Destinatário: <strong>${ui.esc(fornecedor.razao_social || '—')}</strong></p>
      <label class="campo">
        <span>Mensagem</span>
        <textarea id="previa" rows="8">${ui.esc(texto('email'))}</textarea>
      </label>
      <div class="linha-acoes">
        ${wa ? `<a class="botao botao-primario" target="_blank" rel="noopener" href="${ui.esc(wa)}" data-marcar="whatsapp">Enviar por WhatsApp</a>` : '<span class="sub">Fornecedor sem WhatsApp cadastrado.</span>'}
        ${em ? `<a class="botao" target="_blank" rel="noopener" href="${ui.esc(em)}" data-marcar="email">Enviar por e-mail</a>` : '<span class="sub">Fornecedor sem e-mail cadastrado.</span>'}
        <button type="button" id="fechar">Fechar</button>
      </div>
      <p class="sub" style="margin-top:10px">Ao abrir o aplicativo, o pedido é marcado como enviado.</p>`,
  });

  corpo.querySelector('#fechar').addEventListener('click', fechar);

  for (const a of corpo.querySelectorAll('[data-marcar]')) {
    a.addEventListener('click', async () => {
      try {
        await atualizar('pedidos_gerados', p.id, {
          status: 'enviado',
          canal_envio: a.dataset.marcar,
          enviado_em: new Date().toISOString(),
          enviado_para: a.dataset.marcar === 'email' ? fornecedor.email : fornecedor.whatsapp,
        });
        ui.toast('Pedido marcado como enviado.');
      } catch (erro) { ui.toast(erro.message, 'erro'); }
    });
  }
}
