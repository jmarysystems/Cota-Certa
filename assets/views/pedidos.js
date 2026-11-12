// Pedidos gerados: lista, itens, recebimento, nota fiscal, impressão e envio.
import { listar, atualizar } from '../api.js';
import * as ui from '../ui.js';

const dataInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const hojeInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function lista(raiz, ctx) {
  ctx.setTitulo('Pedidos');
  document.querySelectorAll('.area-impressao').forEach((n) => n.remove());

  const pedidos = await listar('pedidos_gerados', {
    select: '*, fornecedores(*), pedido_itens(*), cotacoes(codigo, titulo)',
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
    const recebidoBadge = p.recebido
      ? ui.badge('recebido', 'verde')
      : ui.badge('não recebido', 'cinza');
    const nf = p.nota_fiscal
      ? ` · <span class="badge badge-azul">NF ${ui.esc(p.nota_fiscal)}</span>`
      : ' · sem nota fiscal';

    return `
      <div class="cartao">
        <div class="cartao-topo">
          <div>
            <h2 class="mono">${ui.esc(p.numero)} ${ui.badgeStatus(p.status)} ${recebidoBadge}</h2>
            <p class="sub">
              ${ui.esc(p.fornecedores?.razao_social || '—')} ·
              ${ui.dataBR(p.data_pedido)} · ${itens.length} item(ns) ·
              total <strong>${ui.brl(p.valor_total)}</strong>${nf}
              ${p.enviado_em ? ` · enviado em ${ui.dataHoraBR(p.enviado_em)}` : ''}
              ${p.recebido && p.recebido_em ? ` · recebido em ${ui.dataBR(p.recebido_em)}` : ''}
            </p>
          </div>
          <div class="linha-acoes">
            <button type="button" class="botao-pequeno" data-detalhar="${ui.esc(p.id)}">Itens</button>
            ${ctx.admin ? `<button type="button" class="botao-pequeno" data-receber="${ui.esc(p.id)}">Recebimento / NF</button>` : ''}
            <button type="button" class="botao-pequeno" data-imprimir="${ui.esc(p.id)}">Imprimir</button>
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
      </div>
      <p class="sub">Abra os itens, registre o recebimento e a nota fiscal, imprima o pedido ou envie ao fornecedor.</p>
    </div>
    ${blocos}`;

  for (const b of raiz.querySelectorAll('[data-detalhar]')) {
    b.addEventListener('click', () => {
      const alvo = document.getElementById(`itens-${b.dataset.detalhar}`);
      alvo.hidden = !alvo.hidden;
    });
  }

  for (const b of raiz.querySelectorAll('[data-receber]')) {
    b.addEventListener('click', () => {
      const p = pedidos.find((x) => x.id === b.dataset.receber);
      modalRecebimento(p, ctx);
    });
  }

  for (const b of raiz.querySelectorAll('[data-imprimir]')) {
    b.addEventListener('click', () => {
      const p = pedidos.find((x) => x.id === b.dataset.imprimir);
      imprimirPedido(p);
    });
  }

  for (const b of raiz.querySelectorAll('[data-enviar]')) {
    b.addEventListener('click', () => {
      const p = pedidos.find((x) => x.id === b.dataset.enviar);
      modalEnvioPedido(p, ctx);
    });
  }
}

// ---------------------------------------------------------------------
// Recebimento e nota fiscal
// ---------------------------------------------------------------------
function modalRecebimento(p, ctx) {
  const { fechar, corpo } = ui.modal({
    titulo: `Recebimento — ${p.numero}`,
    corpo: `
      <form id="form-recebimento" class="grade grade-2">
        ${ui.campoSelect('Pedido recebido?', 'recebido', [
          { valor: 'sim', rotulo: 'Sim, recebido' },
          { valor: 'nao', rotulo: 'Ainda não' },
        ], p.recebido ? 'sim' : 'nao', { obrigatorio: true })}
        ${ui.campoTexto('Data do recebimento', 'recebido_em',
          dataInput(p.recebido_em) || hojeInput(), { tipo: 'date' })}
        ${ui.campoTexto('Número da nota fiscal', 'nota_fiscal', p.nota_fiscal || '',
          { placeholder: 'ex.: 000123' })}
        <div class="linha-acoes campo-largo">
          <button type="submit" class="botao-primario">Salvar</button>
          <button type="button" id="cancelar">Cancelar</button>
        </div>
      </form>
      <p class="sub" style="margin-top:10px">Marcar como recebido muda o status do pedido para <em>Entregue</em>.</p>`,
  });

  corpo.querySelector('#cancelar').addEventListener('click', fechar);
  corpo.querySelector('#form-recebimento').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = ui.dadosDoForm(ev.target);
    const recebido = d.recebido === 'sim';
    const nota = (d.nota_fiscal || '').trim() || null;

    const dados = {
      recebido,
      recebido_em: recebido
        ? (d.recebido_em ? new Date(`${d.recebido_em}T12:00:00`).toISOString() : new Date().toISOString())
        : null,
      nota_fiscal: nota,
      nota_fiscal_em: nota ? (p.nota_fiscal_em || new Date().toISOString()) : null,
    };

    if (recebido && p.status !== 'entregue') dados.status = 'entregue';
    if (!recebido && p.status === 'entregue') dados.status = 'enviado';

    try {
      await atualizar('pedidos_gerados', p.id, dados);
      fechar();
      ui.toast(recebido ? 'Pedido marcado como recebido.' : 'Pedido marcado como não recebido.');
      ctx.recarregar();
    } catch (erro) {
      ui.toast(erro.message, 'erro');
    }
  });
}

// ---------------------------------------------------------------------
// Impressão
// ---------------------------------------------------------------------
function imprimirPedido(p) {
  document.querySelectorAll('.area-impressao').forEach((n) => n.remove());

  const forn = p.fornecedores || {};
  const itens = p.pedido_itens || [];
  const cot = p.cotacoes || {};

  const endereco = [
    [forn.numero, forn.bairro].filter(Boolean).join(' '),
    [forn.cidade, forn.estado].filter(Boolean).join('/'),
    forn.cep,
  ].filter(Boolean).join(' · ') || '—';

  const el = document.createElement('div');
  el.className = 'area-impressao';
  el.innerHTML = `
    <div class="print-topo">
      <div>
        <h1>PEDIDO ${ui.esc(p.numero)}</h1>
        <div class="print-linha">Data do pedido: <strong>${ui.dataBR(p.data_pedido)}</strong></div>
        <div class="print-linha">Cotação de origem: ${ui.esc(cot.codigo || '—')}${cot.titulo ? ` — ${ui.esc(cot.titulo)}` : ''}</div>
      </div>
      <div style="text-align:right">
        <div class="print-linha">Status: <strong>${ui.esc(ui.STATUS_PEDIDO[p.status] || p.status)}</strong></div>
        <div class="print-linha">Recebido: <strong>${p.recebido ? `Sim${p.recebido_em ? ` em ${ui.dataBR(p.recebido_em)}` : ''}` : 'Não'}</strong></div>
        <div class="print-linha">Nota fiscal: <strong>${ui.esc(p.nota_fiscal || '—')}</strong></div>
      </div>
    </div>

    <h2>Fornecedor</h2>
    <div class="print-grade">
      <div><span>Razão social:</span> <strong>${ui.esc(forn.razao_social || '—')}</strong></div>
      <div><span>CNPJ/CPF:</span> ${ui.esc(forn.cnpj_cpf || '—')}</div>
      <div><span>Endereço:</span> ${ui.esc(endereco)}</div>
      <div><span>Contato:</span> ${ui.esc(forn.contato_nome || '—')}</div>
      <div><span>E-mail:</span> ${ui.esc(forn.email || '—')}</div>
      <div><span>WhatsApp:</span> ${ui.esc(forn.whatsapp || '—')}</div>
    </div>

    <h2>Produtos</h2>
    <table>
      <thead>
        <tr>
          <th style="width:16%">SKU</th>
          <th>Descrição</th>
          <th class="num" style="width:11%">Qtd.</th>
          <th style="width:9%">Un.</th>
          <th class="num" style="width:15%">Custo unit.</th>
          <th class="num" style="width:15%">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itens.map((i) => `<tr>
          <td>${ui.esc(i.sku || '—')}</td>
          <td>${ui.esc(i.descricao)}</td>
          <td class="num">${ui.num(i.quantidade)}</td>
          <td>${ui.esc(i.unidade)}</td>
          <td class="num">${ui.brl(i.valor_de_custo_do_fornecedor)}</td>
          <td class="num">${ui.brl(i.valor_total)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <th colspan="5" class="num">TOTAL DO PEDIDO</th>
          <th class="num">${ui.brl(p.valor_total)}</th>
        </tr>
      </tfoot>
    </table>

    <div class="print-rodape">
      <div>Recebido por: _______________________________________</div>
      <div>Data: ____ / ____ / ________</div>
    </div>
    <div class="print-observacao">Documento gerado pelo sistema de cotação em ${ui.dataHoraBR(new Date().toISOString())}.</div>
  `;

  document.body.appendChild(el);

  const limpar = () => {
    el.remove();
    window.removeEventListener('afterprint', limpar);
  };
  window.addEventListener('afterprint', limpar);

  window.print();

  // Alguns navegadores não disparam afterprint (ou o bloqueiam); garante a limpeza.
  setTimeout(limpar, 30000);
}

// ---------------------------------------------------------------------
// Envio ao fornecedor
// ---------------------------------------------------------------------
function modalEnvioPedido(p, ctx) {
  const itens = p.pedido_itens || [];
  const fornecedor = p.fornecedores || {};

  const texto = (canal) => [
    `Olá${fornecedor.contato_nome ? ` ${fornecedor.contato_nome}` : ''}!`,
    'Segue cotação aprovada pelo sistema Cota-Certa da JMarySystems.',
    '',
    `Segue o pedido ${p.numero} (${itens.length} item(ns)), total ${ui.brl(p.valor_total)}.`,
    '',
    ...itens.map((i) => `• ${i.quantidade} ${i.unidade} — ${i.descricao}${i.sku ? ` (SKU ${i.sku})` : ''} — ${ui.brl(i.valor_de_custo_do_fornecedor)} un.`),
    '',
    `Data do pedido: ${ui.dataBR(p.data_pedido)}.`,
    'Qualquer dúvida, é só contactar por email ou whatsapp.',
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
