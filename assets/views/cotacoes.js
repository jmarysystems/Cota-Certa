// Cotações: lista, criação, detalhe com itens, envio, resultado, aprovação e pedidos.
import { listar, buscar, criar, atualizar, excluir, rpc } from '../api.js';
import * as ui from '../ui.js';

const STATUS_QUE_PERMITE_ENVIO = ['finalizada', 'enviada', 'em_analise'];
const STATUS_QUE_PERMITE_APROVAR = ['enviada', 'em_analise', 'finalizada', 'aprovada'];

export async function lista(raiz, ctx) {
  ctx.setTitulo('Cotações');
  const cots = await listar('cotacoes', { ordem: 'criado_em', asc: false });
  const fornecedor = ctx.perfil.tipo === 'fornecedor';

  const linhas = cots.map((c) => `
    <tr>
      <td class="mono"><a href="#/cotacoes/${c.id}">${ui.esc(c.codigo)}</a></td>
      <td>${ui.esc(c.titulo || '—')}</td>
      <td>${ui.badgeStatus(c.status)}</td>
      <td>${ui.dataBR(c.prazo_resposta)}</td>
      <td>${ui.dataBR(c.criado_em)}</td>
      <td class="acoes"><a class="botao botao-pequeno" href="#/cotacoes/${c.id}">Abrir</a></td>
    </tr>`).join('');

  raiz.innerHTML = `
    <div class="cartao">
      <div class="cartao-topo">
        <h2>${cots.length} cotação(ões)</h2>
        ${ctx.admin ? '<a class="botao botao-primario" href="#/cotacoes/nova">Nova cotação</a>' : ''}
      </div>
      ${cots.length ? `<div class="tabela-rolagem"><table>
        <thead><tr>
          <th>Código</th><th>Título</th><th>Status</th><th>Prazo de resposta</th><th>Criada em</th><th></th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>` : ui.vazio(fornecedor
        ? 'Nenhuma cotação endereçada a você até agora.'
        : 'Nenhuma cotação cadastrada.')}
    </div>`;
}

export async function nova(raiz, ctx) {
  ctx.setTitulo('Nova cotação');
  if (!ctx.admin) {
    raiz.innerHTML = ui.vazio('Apenas administradores podem criar cotações.');
    return;
  }

  raiz.innerHTML = `
    <div class="cartao">
      <h2>Nova cotação</h2>
      <form id="form-cotacao" class="grade grade-2">
        ${ui.campoTexto('Título', 'titulo', '', { obrigatorio: true, placeholder: 'Ex.: Fixadores — obra 12' })}
        ${ui.campoTexto('Prazo para resposta', 'prazo_resposta', '', { tipo: 'date' })}
        ${ui.campoArea('Observação', 'observacao')}
        <div class="linha-acoes campo-largo">
          <button type="submit" class="botao-primario">Criar e abrir</button>
          <a class="botao" href="#/cotacoes">Cancelar</a>
        </div>
      </form>
    </div>`;

  document.getElementById('form-cotacao').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const dados = ui.dadosDoForm(ev.target);
    try {
      const cot = await criar('cotacoes', {
        titulo: dados.titulo,
        prazo_resposta: dados.prazo_resposta,
        observacao: dados.observacao,
        criado_por: ctx.perfil.id,
        status: 'rascunho',
      });
      ui.toast(`Cotação ${cot.codigo} criada.`);
      ctx.irPara(`#/cotacoes/${cot.id}`);
    } catch (erro) {
      ui.toast(erro.message, 'erro');
    }
  });
}

export async function detalhe(raiz, ctx) {
  const id = ctx.id;
  const cot = await buscar('cotacoes', id);
  if (!cot) {
    raiz.innerHTML = ui.vazio('Cotação não encontrada ou sem acesso.');
    return;
  }
  ctx.setTitulo(cot.codigo);

  const ehFornecedor = ctx.perfil.tipo === 'fornecedor';
  const itens = await listar('cotacao_itens', { eq: { cotacao_id: id }, ordem: 'ordem' });
  const envios = await listar('cotacao_envios', {
    eq: { cotacao_id: id },
    select: '*, fornecedores(razao_social, email, whatsapp, contato_nome)',
  });
  const funil = await listar('vw_cotacao_fornecedor_status', { eq: { cotacao_id: id } });
  const ranking = await listar('vw_resultado_cotacao', { eq: { cotacao_id: id } });
  const aprovadas = await listar('cotacoes_aprovadas', {
    eq: { cotacao_id: id },
    select: '*, fornecedores(razao_social)',
  });
  const pedidos = await listar('pedidos_gerados', {
    eq: { cotacao_id: id },
    select: '*, fornecedores(razao_social), pedido_itens(*)',
  });

  const editavel = ctx.admin && cot.status === 'rascunho';

  const acoesAdmin = ctx.admin ? `
    ${editavel ? '<button type="button" id="btn-item">Adicionar item</button>' : ''}
    ${editavel ? '<button type="button" id="btn-importar">Importar lista</button>' : ''}
    ${editavel ? '<button type="button" class="botao-primario" id="btn-finalizar">Finalizar</button>' : ''}
    ${ctx.admin && STATUS_QUE_PERMITE_ENVIO.includes(cot.status) ? '<button type="button" class="botao-primario" id="btn-enviar">Enviar aos fornecedores</button>' : ''}
    ${ctx.admin && STATUS_QUE_PERMITE_APROVAR.includes(cot.status) ? '<button type="button" id="btn-aprovar">Aprovar vencedores</button>' : ''}
    ${ctx.admin && cot.status === 'aprovada' ? '<button type="button" class="botao-primario" id="btn-pedidos">Gerar pedidos</button>' : ''}
    <button type="button" class="botao-perigo" id="btn-excluir">Excluir</button>` : '';

  const envioDoFornecedor = ehFornecedor
    ? envios.find((e) => e.fornecedor_id === ctx.perfil.fornecedor_id)
    : null;

  const botaoResponder = envioDoFornecedor && envioDoFornecedor.status !== 'respondido'
    ? `<div class="destaque" style="margin-top:14px">
         <strong>Você recebeu esta cotação.</strong>
         <p class="sub">Responda pelo link abaixo. Após enviar, não é possível responder de novo.</p>
         <a class="botao botao-primario" target="_blank" rel="noopener"
            href="resposta.html?token=${ui.esc(envioDoFornecedor.token)}">Responder cotação</a>
       </div>`
    : (envioDoFornecedor && envioDoFornecedor.status === 'respondido'
      ? '<div class="destaque" style="margin-top:14px">Resposta registrada. Obrigado!</div>'
      : '');

  const tabelaItens = itens.length ? `
    <div class="tabela-rolagem"><table>
      <thead><tr><th>#</th><th>SKU</th><th>Descrição</th><th class="num">Qtd.</th><th>Un.</th>${editavel ? '<th></th>' : ''}</tr></thead>
      <tbody>
        ${itens.map((i) => `<tr>
          <td>${ui.esc(i.ordem)}</td>
          <td class="mono">${ui.esc(i.sku || '—')}</td>
          <td>${ui.esc(i.descricao)}</td>
          <td class="num">${ui.num(i.quantidade)}</td>
          <td>${ui.esc(i.unidade)}</td>
          ${editavel ? `<td class="acoes"><button type="button" class="botao-pequeno botao-perigo" data-remover-item="${ui.esc(i.id)}">Remover</button></td>` : ''}
        </tr>`).join('')}
      </tbody>
    </table></div>` : ui.vazio('Nenhum item nesta cotação.');

  const linhasFunil = funil.map((f) => `
    <tr>
      <td>${ui.esc(f.fornecedor)}</td>
      <td>${f.recebeu_email ? ui.badge('sim', 'verde') : ui.badge('não', 'cinza')}</td>
      <td>${f.recebeu_whatsapp ? ui.badge('sim', 'verde') : ui.badge('não', 'cinza')}</td>
      <td>${f.respondeu ? ui.badge('respondeu', 'verde') : ui.badge('aguardando', 'amarelo')}</td>
      <td>${ui.dataHoraBR(f.ultimo_envio_em)}</td>
      <td>${ui.dataHoraBR(f.respondido_em)}</td>
    </tr>`).join('');

  const tabelaFunil = funil.length ? `
    <div class="tabela-rolagem"><table>
      <thead><tr><th>Fornecedor</th><th>E-mail</th><th>WhatsApp</th><th>Situação</th><th>Último envio</th><th>Respondeu em</th></tr></thead>
      <tbody>${linhasFunil}</tbody>
    </table></div>` : ui.vazio('Nenhum envio registrado ainda.');

  const agrupado = agruparRanking(ranking);
  const tabelaResultado = agrupado.length ? agrupado.map(([item, ofertas]) => `
    <div class="cartao" style="box-shadow:none">
      <h3>${ui.esc(item.sku || '')} ${ui.esc(item.descricao)}</h3>
      <p class="sub">Quantidade: ${ui.num(item.quantidade)} ${ui.esc(item.unidade)}</p>
      <div class="tabela-rolagem"><table>
        <thead><tr><th>Pos.</th><th>Fornecedor</th><th class="num">Valor unit.</th><th class="num">Total</th></tr></thead>
        <tbody>${ofertas.map((o) => `
          <tr class="${o.posicao === 1 ? 'vencedor' : ''}">
            <td class="${o.posicao === 1 ? 'pos-1' : ''}">${ui.esc(o.posicao)}º</td>
            <td>${ui.esc(o.fornecedor || '—')}</td>
            <td class="num">${ui.brl(o.valor_unitario)}</td>
            <td class="num">${ui.brl(o.valor_total)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`).join('') : ui.vazio('Nenhuma resposta recebida ainda.');

  const tabelaAprovadas = aprovadas.length ? `
    <div class="tabela-rolagem"><table>
      <thead><tr><th>SKU</th><th>Descrição</th><th class="num">Qtd.</th><th>Un.</th><th>Fornecedor</th><th class="num">Custo unit.</th><th class="num">Total</th></tr></thead>
      <tbody>
        ${aprovadas.map((a) => `<tr>
          <td class="mono">${ui.esc(a.sku || '—')}</td>
          <td>${ui.esc(a.descricao)}</td>
          <td class="num">${ui.num(a.quantidade)}</td>
          <td>${ui.esc(a.unidade)}</td>
          <td>${ui.esc(a.fornecedores?.razao_social || '—')}</td>
          <td class="num">${ui.brl(a.valor_de_custo_do_fornecedor)}</td>
          <td class="num">${ui.brl(a.valor_total)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr>
        <th colspan="6">Total aprovado</th>
        <th class="num">${ui.brl(aprovadas.reduce((s, a) => s + Number(a.valor_total || 0), 0))}</th>
      </tr></tfoot>
    </table></div>` : ui.vazio('Nenhuma aprovação registrada.');

  const tabelaPedidos = pedidos.length ? `
    <div class="tabela-rolagem"><table>
      <thead><tr><th>Pedido</th><th>Fornecedor</th><th class="num">Itens</th><th class="num">Total</th><th>Status</th><th>Data</th></tr></thead>
      <tbody>
        ${pedidos.map((p) => `<tr>
          <td class="mono">${ui.esc(p.numero)}</td>
          <td>${ui.esc(p.fornecedores?.razao_social || '—')}</td>
          <td class="num">${(p.pedido_itens || []).length}</td>
          <td class="num">${ui.brl(p.valor_total)}</td>
          <td>${ui.badgeStatus(p.status)}</td>
          <td>${ui.dataBR(p.data_pedido)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>` : ui.vazio('Nenhum pedido gerado.');

  raiz.innerHTML = `
    <div class="cartao">
      <div class="cartao-topo">
        <div>
          <h2>${ui.esc(cot.titulo || 'Sem título')} ${ui.badgeStatus(cot.status)}</h2>
          <p class="sub mono">${ui.esc(cot.codigo)} · criada em ${ui.dataBR(cot.criado_em)}
            ${cot.prazo_resposta ? ` · prazo de resposta ${ui.dataBR(cot.prazo_resposta)}` : ''}</p>
        </div>
        <div class="linha-acoes">${acoesAdmin}</div>
      </div>
      ${cot.observacao ? `<p>${ui.esc(cot.observacao)}</p>` : ''}
      ${botaoResponder}
    </div>

    <div class="cartao">
      <h2>Itens (${itens.length})</h2>
      ${tabelaItens}
    </div>

    <div class="cartao">
      <h2>Envios e respostas</h2>
      ${tabelaFunil}
    </div>

    <div class="cartao">
      <h2>Resultado por menor custo</h2>
      ${tabelaResultado}
    </div>

    <div class="cartao">
      <h2>Cotação aprovada</h2>
      ${tabelaAprovadas}
    </div>

    <div class="cartao">
      <h2>Pedidos gerados</h2>
      ${tabelaPedidos}
      ${pedidos.length ? '<a class="botao" href="#/pedidos">Ver todos os pedidos</a>' : ''}
    </div>`;

  // ---------- ações ----------
  const botao = (sel) => raiz.querySelector(sel);

  if (botao('#btn-item')) botao('#btn-item').addEventListener('click', () => modalNovoItem(cot, ctx));
  if (botao('#btn-importar')) botao('#btn-importar').addEventListener('click', () => modalImportarLista(cot, ctx));

  for (const b of raiz.querySelectorAll('[data-remover-item]')) {
    b.addEventListener('click', async () => {
      if (!window.confirm('Remover este item?')) return;
      try {
        await excluir('cotacao_itens', b.dataset.removerItem);
        ui.toast('Item removido.');
        ctx.recarregar();
      } catch (erro) { ui.toast(erro.message, 'erro'); }
    });
  }

  if (botao('#btn-finalizar')) {
    botao('#btn-finalizar').addEventListener('click', async () => {
      if (!itens.length) return ui.toast('Adicione ao menos um item antes de finalizar.', 'erro');
      try {
        await atualizar('cotacoes', cot.id, {
          status: 'finalizada',
          finalizada_em: new Date().toISOString(),
        });
        ui.toast('Cotação finalizada. Agora você pode enviar aos fornecedores.');
        ctx.recarregar();
      } catch (erro) { ui.toast(erro.message, 'erro'); }
    });
  }

  if (botao('#btn-enviar')) botao('#btn-enviar').addEventListener('click', () => modalEnvio(cot, ctx));
  if (botao('#btn-aprovar')) botao('#btn-aprovar').addEventListener('click', () => modalAprovacao(cot, ctx, agrupado));

  if (botao('#btn-pedidos')) {
    botao('#btn-pedidos').addEventListener('click', async () => {
      try {
        const res = await rpc('fn_gerar_pedidos', { p_cotacao_id: cot.id });
        const numeros = (res.pedidos || []).map((p) => p.numero).join(', ');
        ui.toast(numeros ? `Pedidos gerados: ${numeros}` : 'Nenhum pedido novo.');
        ctx.recarregar();
      } catch (erro) { ui.toast(erro.message, 'erro'); }
    });
  }

  if (botao('#btn-excluir')) {
    botao('#btn-excluir').addEventListener('click', async () => {
      if (!window.confirm(`Excluir a cotação ${cot.codigo}? Esta ação não pode ser desfeita.`)) return;
      try {
        await excluir('cotacoes', cot.id);
        ui.toast('Cotação excluída.');
        ctx.irPara('#/cotacoes');
      } catch (erro) { ui.toast(erro.message, 'erro'); }
    });
  }
}

// ---------- modais ----------

function modalNovoItem(cot, ctx) {
  const { fechar, corpo } = ui.modal({
    titulo: 'Adicionar item',
    corpo: `
      <form id="form-item" class="grade grade-2">
        ${ui.campoTexto('SKU', 'sku', '', { placeholder: 'opcional' })}
        ${ui.campoTexto('Descrição', 'descricao', '', { obrigatorio: true })}
        ${ui.campoTexto('Quantidade', 'quantidade', '1', { tipo: 'number', step: '0.0001', min: '0', obrigatorio: true })}
        ${ui.campoTexto('Unidade', 'unidade', 'un', { obrigatorio: true })}
        <div class="linha-acoes campo-largo">
          <button type="submit" class="botao-primario">Adicionar</button>
          <button type="button" id="cancelar">Cancelar</button>
        </div>
      </form>`,
  });

  corpo.querySelector('#cancelar').addEventListener('click', fechar);
  corpo.querySelector('#form-item').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = ui.dadosDoForm(ev.target);
    try {
      const existentes = await listar('cotacao_itens', { eq: { cotacao_id: cot.id }, ordem: 'ordem' });
      const ordem = existentes.reduce((m, i) => Math.max(m, i.ordem || 0), 0) + 1;
      await criar('cotacao_itens', {
        cotacao_id: cot.id,
        sku: d.sku,
        descricao: d.descricao,
        quantidade: d.quantidade,
        unidade: d.unidade,
        ordem,
      });
      fechar();
      ui.toast('Item adicionado.');
      ctx.recarregar();
    } catch (erro) { ui.toast(erro.message, 'erro'); }
  });
}

async function modalImportarLista(cot, ctx) {
  const linhas = await listar('lista_de_produtos', {});
  const listas = [...new Set(linhas.map((l) => l.lista))].sort();

  if (!listas.length) {
    ui.toast('Nenhuma lista importada. Vá em Listas e envie uma planilha primeiro.', 'erro');
    return;
  }

  const { fechar, corpo } = ui.modal({
    titulo: 'Importar lista para a cotação',
    corpo: `
      <p class="sub">Os itens da lista são copiados para esta cotação e os SKUs são sincronizados na tabela de produtos.</p>
      <form id="form-importar">
        ${ui.campoSelect('Lista', 'lista', listas.map((l) => ({ valor: l, rotulo: l })), listas[0])}
        <div class="linha-acoes">
          <button type="submit" class="botao-primario">Importar</button>
          <button type="button" id="cancelar">Cancelar</button>
        </div>
      </form>`,
  });

  corpo.querySelector('#cancelar').addEventListener('click', fechar);
  corpo.querySelector('#form-importar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const lista = ev.target.lista.value;
    try {
      const res = await rpc('fn_importar_lista_para_cotacao', {
        p_cotacao_id: cot.id,
        p_lista: lista,
      });
      fechar();
      ui.toast(`${res.itens_importados} item(ns) importado(s).`);
      ctx.recarregar();
    } catch (erro) { ui.toast(erro.message, 'erro'); }
  });
}

async function modalEnvio(cot, ctx) {
  const forns = await listar('fornecedores', { eq: { ativo: true }, ordem: 'razao_social' });
  if (!forns.length) {
    ui.toast('Cadastre fornecedores antes de enviar.', 'erro');
    return;
  }

  const { fechar, corpo } = ui.modal({
    titulo: `Enviar ${cot.codigo}`,
    largura: '760px',
    corpo: `
      <p class="sub">Marque os fornecedores e o canal. O sistema gera um link único de resposta para cada um e registra o envio.</p>
      <div class="grade grade-2" style="margin-bottom:14px">
        <label class="campo">
          <span>Como escolher os fornecedores</span>
          <select id="origem">
            <option value="manual">Manual — marco na lista abaixo</option>
            <option value="tabela">Pela tabela produto × fornecedor</option>
          </select>
        </label>
        <div id="cobertura" class="sub" style="align-self:end"></div>
      </div>
      <div class="tabela-rolagem"><table>
        <thead><tr><th></th><th>Fornecedor</th><th>Contato</th><th>E-mail</th><th>WhatsApp</th></tr></thead>
        <tbody>
          ${forns.map((f) => `<tr>
            <td><input type="checkbox" name="forn" value="${ui.esc(f.id)}"></td>
            <td>${ui.esc(f.razao_social)}</td>
            <td>${ui.esc(f.contato_nome || '—')}</td>
            <td>${ui.esc(f.email || '—')}</td>
            <td>${ui.esc(f.whatsapp || '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="grade grade-2" style="margin-top:14px">
        ${ui.campoSelect('Canal', 'canal', [
          { valor: 'email', rotulo: 'E-mail' },
          { valor: 'whatsapp', rotulo: 'WhatsApp' },
        ], 'whatsapp')}
      </div>
      <div class="linha-acoes">
        <button type="button" class="botao-primario" id="preparar">Preparar envios</button>
        <button type="button" id="fechar-modal">Fechar</button>
      </div>
      <div id="saida"></div>`,
  });

  corpo.querySelector('#fechar-modal').addEventListener('click', fechar);

  const origem = corpo.querySelector('#origem');
  const cobertura = corpo.querySelector('#cobertura');

  origem.addEventListener('change', async () => {
    if (origem.value !== 'tabela') {
      cobertura.textContent = '';
      return;
    }
    cobertura.textContent = 'Consultando a tabela de vínculos…';
    try {
      const res = await rpc('fn_fornecedores_da_cotacao', { p_cotacao_id: cot.id });
      const ids = new Set((res.fornecedores || []).map((f) => f.fornecedor_id));
      for (const cb of corpo.querySelectorAll('input[name="forn"]')) cb.checked = ids.has(cb.value);

      const semFornecedor = res.itens_sem_fornecedor || [];
      const comFornecedor = (res.total_itens || 0) - semFornecedor.length;
      let texto = `${(res.fornecedores || []).length} fornecedor(es) marcado(s) — cobrem ${comFornecedor} de ${res.total_itens} item(ns).`;
      if (semFornecedor.length) texto += ` Sem fornecedor cadastrado: ${semFornecedor.join(', ')}.`;
      if (!(res.fornecedores || []).length) texto = 'Nenhum fornecedor vinculado aos itens desta cotação.';
      cobertura.textContent = texto;

      if (!(res.fornecedores || []).length) {
        ui.toast('Nenhum fornecedor vinculado aos itens desta cotação.', 'erro');
      }
    } catch (erro) {
      cobertura.textContent = '';
      ui.toast(erro.message, 'erro');
    }
  });

  corpo.querySelector('#preparar').addEventListener('click', async (ev) => {
    const marcados = [...corpo.querySelectorAll('input[name="forn"]:checked')].map((i) => i.value);
    const canal = corpo.querySelector('select[name="canal"]').value;
    if (!marcados.length) return ui.toast('Selecione ao menos um fornecedor.', 'erro');

    ev.target.disabled = true;
    ev.target.textContent = 'Preparando…';

    try {
      for (const fornecedorId of marcados) {
        await rpc('fn_registrar_envio', {
          p_cotacao_id: cot.id,
          p_fornecedor_id: fornecedorId,
          p_canal: canal,
          p_status: 'enviado',
        });
      }

      const envios = await listar('cotacao_envios', {
        eq: { cotacao_id: cot.id, canal },
        select: '*, fornecedores(razao_social, email, whatsapp, contato_nome)',
      });

      const selecionados = envios.filter((e) => marcados.includes(e.fornecedor_id));
      const mensagem = (e) => {
        const link = ui.linkPublico(e.token);
        return [
          `Olá${e.fornecedores?.contato_nome ? ` ${e.fornecedores.contato_nome}` : ''}!`,
          `Segue a cotação ${cot.codigo}${cot.titulo ? ` — ${cot.titulo}` : ''}.`,
          cot.prazo_resposta ? `Prazo para resposta: ${ui.dataBR(cot.prazo_resposta)}.` : '',
          `Responda pelo link: ${link}`,
        ].filter(Boolean).join('\n');
      };

      corpo.querySelector('#saida').innerHTML = `
        <h3 style="margin-top:18px">Envios registrados</h3>
        <div class="tabela-rolagem"><table>
          <thead><tr><th>Fornecedor</th><th>Link de resposta</th><th>Abrir canal</th></tr></thead>
          <tbody>
            ${selecionados.map((e) => {
              const texto = mensagem(e);
              const wa = ui.linkWhatsapp(e.fornecedores?.whatsapp, texto);
              const em = ui.linkEmail(e.fornecedores?.email, `Cotação ${cot.codigo}`, texto);
              return `<tr>
                <td>${ui.esc(e.fornecedores?.razao_social || '—')}</td>
                <td><button type="button" class="botao-pequeno" data-copiar="${ui.esc(ui.linkPublico(e.token))}">Copiar link</button></td>
                <td class="linha-acoes">
                  ${canal === 'whatsapp'
                    ? (wa ? `<a class="botao botao-pequeno" target="_blank" rel="noopener" href="${ui.esc(wa)}">WhatsApp</a>` : '<span class="sub">sem número</span>')
                    : (em ? `<a class="botao botao-pequeno" target="_blank" rel="noopener" href="${ui.esc(em)}">E-mail</a>` : '<span class="sub">sem e-mail</span>')}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
        <p class="sub">Clique em cada botão para abrir o aplicativo de e-mail/WhatsApp já com a mensagem. O status fica como <em>enviado</em> e vira <em>lido</em> quando o fornecedor abre o link.</p>`;

      for (const b of corpo.querySelectorAll('[data-copiar]')) {
        b.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(b.dataset.copiar);
            ui.toast('Link copiado.');
          } catch (_) {
            window.prompt('Copie o link:', b.dataset.copiar);
          }
        });
      }

      ui.toast('Envios registrados.');
      ctx.recarregar();
    } catch (erro) {
      ui.toast(erro.message, 'erro');
    } finally {
      ev.target.disabled = false;
      ev.target.textContent = 'Preparar envios';
    }
  });
}

function agruparRanking(ranking) {
  const mapa = new Map();
  const ordenado = [...ranking].sort((a, b) => (a.ordem - b.ordem) || (a.posicao - b.posicao));
  for (const r of ordenado) {
    if (!mapa.has(r.cotacao_item_id)) mapa.set(r.cotacao_item_id, []);
    mapa.get(r.cotacao_item_id).push(r);
  }
  return [...mapa.entries()].map(([itemId, ofertas]) => [
    { id: itemId, ...ofertas[0] },
    ofertas,
  ]);
}

function modalAprovacao(cot, ctx, agrupado) {
  if (!agrupado.length) {
    ui.toast('Nenhuma oferta para aprovar.', 'erro');
    return;
  }

  const corpoHtml = agrupado.map(([item, ofertas]) => `
    <div class="cartao" style="box-shadow:none;margin-bottom:12px">
      <h3>${ui.esc(item.sku || '')} ${ui.esc(item.descricao)}</h3>
      <p class="sub">${ui.num(item.quantidade)} ${ui.esc(item.unidade)}</p>
      <table>
        <tbody>
          ${ofertas.map((o, idx) => `<tr>
            <td style="width:28px">
              <input type="radio" name="item-${ui.esc(item.id)}"
                     value="${ui.esc(o.fornecedor_id)}" ${idx === 0 ? 'checked' : ''}>
            </td>
            <td>${ui.esc(o.fornecedor || '—')}</td>
            <td class="num">${ui.brl(o.valor_unitario)}</td>
            <td class="num ${idx === 0 ? 'pos-1' : ''}">${idx === 0 ? 'menor custo' : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('');

  const { fechar, corpo } = ui.modal({
    titulo: 'Aprovar vencedores',
    largura: '760px',
    corpo: `
      <p class="sub">O menor custo de cada item já vem marcado. Troque a seleção se quiser escolher outro fornecedor.</p>
      ${corpoHtml}
      <div class="linha-acoes">
        <button type="button" class="botao-primario" id="aprovar">Aprovar seleção</button>
        <button type="button" id="cancelar">Cancelar</button>
      </div>`,
  });

  corpo.querySelector('#cancelar').addEventListener('click', fechar);
  corpo.querySelector('#aprovar').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    ev.target.textContent = 'Aprovando…';

    const pares = [];
    let automatico = true;
    for (const [item, ofertas] of agrupado) {
      const marcado = corpo.querySelector(`input[name="item-${item.id}"]:checked`);
      if (!marcado) continue;
      pares.push({ cotacao_item_id: item.id, fornecedor_id: marcado.value });
      if (marcado.value !== ofertas[0].fornecedor_id) automatico = false;
    }

    try {
      const res = await rpc('fn_aprovar_cotacao', {
        p_cotacao_id: cot.id,
        p_itens: automatico ? null : pares,
      });
      fechar();
      ui.toast(`Aprovação registrada: ${res.itens_aprovados} item(ns), total ${ui.brl(res.total)}.`);
      ctx.recarregar();
    } catch (erro) {
      ui.toast(erro.message, 'erro');
      ev.target.disabled = false;
      ev.target.textContent = 'Aprovar seleção';
    }
  });
}
