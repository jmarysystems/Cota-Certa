// Cadastros: fornecedores, produtos (com importação de planilha) e listas.
import { sb, listar, criar, atualizar, excluir, rpc, traduzErro } from '../api.js';
import * as ui from '../ui.js';

const normaliza = (s) => String(s ?? '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').trim();

// =====================================================================
// FORNECEDORES
// =====================================================================
export async function fornecedores(raiz, ctx) {
  ctx.setTitulo('Fornecedores');
  const dados = await listar('fornecedores', { ordem: 'razao_social' });

  const linhas = dados.map((f) => `
    <tr>
      <td>
        <strong>${ui.esc(f.razao_social)}</strong>
        ${f.nome_fantasia ? `<div class="sub">${ui.esc(f.nome_fantasia)}</div>` : ''}
      </td>
      <td class="mono">${ui.esc(f.cnpj_cpf || '—')}</td>
      <td>
        ${ui.esc(f.contato_nome || '—')}
        <div class="sub">${ui.esc([f.email, f.whatsapp].filter(Boolean).join(' · ') || '')}</div>
      </td>
      <td>${ui.esc([f.cidade, f.estado].filter(Boolean).join(' / ') || '—')}</td>
      <td>${f.prazo_entrega ? ui.esc(f.prazo_entrega) : '—'}</td>
      <td>${f.ativo ? ui.badge('ativo', 'verde') : ui.badge('inativo', 'cinza')}</td>
      <td class="acoes">
        ${ctx.admin ? `<button type="button" class="botao-pequeno" data-editar="${ui.esc(f.id)}">Editar</button>
        <button type="button" class="botao-pequeno botao-perigo" data-excluir="${ui.esc(f.id)}">Excluir</button>` : ''}
      </td>
    </tr>`).join('');

  raiz.innerHTML = `
    <div class="cartao">
      <div class="cartao-topo">
        <h2>${dados.length} fornecedor(es)</h2>
        ${ctx.admin ? '<button type="button" class="botao-primario" id="novo">Novo fornecedor</button>' : ''}
      </div>
      ${dados.length ? `<div class="tabela-rolagem"><table>
        <thead><tr><th>Fornecedor</th><th>CNPJ/CPF</th><th>Contato</th><th>Cidade/UF</th><th>Prazo</th><th>Situação</th><th></th></tr></thead>
        <tbody>${linhas}</tbody></table></div>` : ui.vazio('Nenhum fornecedor cadastrado.')}
    </div>`;

  const abrir = (fornecedor = {}) => modalFornecedor(fornecedor, ctx);
  const novo = raiz.querySelector('#novo');
  if (novo) novo.addEventListener('click', () => abrir({}));

  for (const b of raiz.querySelectorAll('[data-editar]')) {
    b.addEventListener('click', () => {
      const f = dados.find((d) => d.id === b.dataset.editar);
      abrir(f || {});
    });
  }

  for (const b of raiz.querySelectorAll('[data-excluir]')) {
    b.addEventListener('click', async () => {
      if (!window.confirm('Excluir este fornecedor?')) return;
      try {
        await excluir('fornecedores', b.dataset.excluir);
        ui.toast('Fornecedor excluído.');
        ctx.recarregar();
      } catch (erro) { ui.toast(erro.message, 'erro'); }
    });
  }
}

function modalFornecedor(f, ctx) {
  const editando = !!f.id;
  const pagamentos = Object.entries(ui.TIPOS_PAGAMENTO).map(([valor, rotulo]) => ({ valor, rotulo }));

  const { fechar, corpo } = ui.modal({
    titulo: editando ? 'Editar fornecedor' : 'Novo fornecedor',
    largura: '760px',
    corpo: `
      <form id="form-fornecedor" class="grade grade-2">
        ${ui.campoTexto('Razão social', 'razao_social', f.razao_social, { obrigatorio: true })}
        ${ui.campoTexto('Nome fantasia', 'nome_fantasia', f.nome_fantasia)}
        ${ui.campoTexto('CNPJ/CPF', 'cnpj_cpf', f.cnpj_cpf)}
        ${ui.campoTexto('Contato (nome)', 'contato_nome', f.contato_nome)}
        ${ui.campoTexto('E-mail', 'email', f.email, { tipo: 'email' })}
        ${ui.campoTexto('WhatsApp', 'whatsapp', f.whatsapp, { placeholder: '11 99999-0000' })}
        ${ui.campoTexto('País', 'pais', f.pais || 'Brasil')}
        ${ui.campoTexto('Estado', 'estado', f.estado)}
        ${ui.campoTexto('Cidade', 'cidade', f.cidade)}
        ${ui.campoTexto('Bairro', 'bairro', f.bairro)}
        ${ui.campoTexto('CEP', 'cep', f.cep)}
        ${ui.campoTexto('Número', 'numero', f.numero)}
        ${ui.campoTexto('Prazo de entrega', 'prazo_entrega', f.prazo_entrega, { placeholder: '5 dias úteis' })}
        ${ui.campoSelect('Tipo de pagamento', 'tipo_pagamento', pagamentos, f.tipo_pagamento, { vazio: '—' })}
        ${ui.campoTexto('Prazo de pagamento (dias)', 'prazo_pagamento_dias', f.prazo_pagamento_dias, { tipo: 'number', min: '0' })}
        ${ui.campoArea('Observações', 'observacoes', f.observacoes)}
        <div class="linha-acoes campo-largo">
          <button type="submit" class="botao-primario">${editando ? 'Salvar' : 'Cadastrar'}</button>
          <button type="button" id="cancelar">Cancelar</button>
        </div>
      </form>`,
  });

  corpo.querySelector('#cancelar').addEventListener('click', fechar);
  corpo.querySelector('#form-fornecedor').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = ui.dadosDoForm(ev.target);
    try {
      if (editando) await atualizar('fornecedores', f.id, d);
      else await criar('fornecedores', d);
      fechar();
      ui.toast(editando ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.');
      ctx.recarregar();
    } catch (erro) { ui.toast(erro.message, 'erro'); }
  });
}

// =====================================================================
// PRODUTOS
// =====================================================================
export async function produtos(raiz, ctx) {
  ctx.setTitulo('Produtos');
  const dados = await listar('produtos', { ordem: 'sku' });

  const linhas = dados.map((p) => `
    <tr>
      <td class="mono">${ui.esc(p.sku)}</td>
      <td>${ui.esc(p.descricao)}</td>
      <td>${ui.esc(p.unidade)}</td>
      <td class="sub">${ui.esc(p.origem || 'manual')}</td>
      <td class="acoes">
        ${ctx.admin ? `<button type="button" class="botao-pequeno" data-editar="${ui.esc(p.id)}">Editar</button>
        <button type="button" class="botao-pequeno botao-perigo" data-excluir="${ui.esc(p.id)}">Excluir</button>` : ''}
      </td>
    </tr>`).join('');

  raiz.innerHTML = `
    <div class="cartao">
      <div class="cartao-topo">
        <h2>${dados.length} produto(s)</h2>
        <div class="linha-acoes">
          ${ctx.admin ? '<button type="button" id="importar">Importar planilha</button>' : ''}
          ${ctx.admin ? '<button type="button" class="botao-primario" id="novo">Novo produto</button>' : ''}
        </div>
      </div>
      ${dados.length ? `<div class="tabela-rolagem"><table>
        <thead><tr><th>SKU</th><th>Descrição</th><th>Unidade</th><th>Origem</th><th></th></tr></thead>
        <tbody>${linhas}</tbody></table></div>` : ui.vazio('Nenhum produto cadastrado. Importe uma planilha ou cadastre manualmente.')}
    </div>`;

  const novo = raiz.querySelector('#novo');
  if (novo) novo.addEventListener('click', () => modalProduto({}, ctx));

  const importar = raiz.querySelector('#importar');
  if (importar) importar.addEventListener('click', () => modalImportarPlanilha(ctx));

  for (const b of raiz.querySelectorAll('[data-editar]')) {
    b.addEventListener('click', () => {
      const p = dados.find((d) => d.id === b.dataset.editar);
      modalProduto(p || {}, ctx);
    });
  }

  for (const b of raiz.querySelectorAll('[data-excluir]')) {
    b.addEventListener('click', async () => {
      if (!window.confirm('Excluir este produto?')) return;
      try {
        await excluir('produtos', b.dataset.excluir);
        ui.toast('Produto excluído.');
        ctx.recarregar();
      } catch (erro) { ui.toast(erro.message, 'erro'); }
    });
  }
}

function modalProduto(p, ctx) {
  const editando = !!p.id;
  const { fechar, corpo } = ui.modal({
    titulo: editando ? 'Editar produto' : 'Novo produto',
    corpo: `
      <form id="form-produto" class="grade grade-2">
        ${ui.campoTexto('SKU', 'sku', p.sku, { obrigatorio: true })}
        ${ui.campoTexto('Unidade', 'unidade', p.unidade || 'un', { obrigatorio: true })}
        ${ui.campoTexto('Descrição', 'descricao', p.descricao, { obrigatorio: true })}
        <div class="linha-acoes campo-largo">
          <button type="submit" class="botao-primario">${editando ? 'Salvar' : 'Cadastrar'}</button>
          <button type="button" id="cancelar">Cancelar</button>
        </div>
      </form>`,
  });

  corpo.querySelector('#cancelar').addEventListener('click', fechar);
  corpo.querySelector('#form-produto').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = ui.dadosDoForm(ev.target);
    try {
      if (editando) await atualizar('produtos', p.id, d);
      else await criar('produtos', { ...d, origem: 'manual' });
      fechar();
      ui.toast(editando ? 'Produto atualizado.' : 'Produto cadastrado.');
      ctx.recarregar();
    } catch (erro) { ui.toast(erro.message, 'erro'); }
  });
}

// =====================================================================
// IMPORTAÇÃO DE PLANILHA
// =====================================================================
async function modalImportarPlanilha(ctx) {
  const { fechar, corpo } = ui.modal({
    titulo: 'Importar planilha',
    largura: '640px',
    corpo: `
      <p class="sub">A planilha precisa de colunas <strong>SKU</strong>, <strong>Descrição</strong>,
      <strong>Quantidade</strong> e <strong>Unidade</strong>. Aceita .xlsx, .xls e .csv.</p>
      <form id="form-planilha">
        ${ui.campoTexto('Nome da lista', 'lista', '', { obrigatorio: true, placeholder: 'Ex.: Lista elétrica — obra 12' })}
        <label class="campo">
          <span>Arquivo *</span>
          <input type="file" name="arquivo" accept=".xlsx,.xls,.csv" required>
        </label>
        <div class="linha-acoes">
          <button type="submit" class="botao-primario">Importar</button>
          <button type="button" id="cancelar">Cancelar</button>
        </div>
      </form>
      <div id="progresso" class="sub"></div>`,
  });

  corpo.querySelector('#cancelar').addEventListener('click', fechar);

  corpo.querySelector('#form-planilha').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const botao = form.querySelector('button[type="submit"]');
    const progresso = corpo.querySelector('#progresso');
    const nomeLista = form.lista.value.trim();
    const arquivo = form.arquivo.files[0];
    if (!arquivo) return;

    botao.disabled = true;
    botao.textContent = 'Lendo…';

    try {
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      const wb = XLSX.read(bytes, { type: 'array' });
      const aba = wb.Sheets[wb.SheetNames[0]];
      const bruto = XLSX.utils.sheet_to_json(aba, { defval: '' });

      if (!bruto.length) throw new Error('A planilha está vazia.');

      const mapaColunas = {};
      for (const chave of Object.keys(bruto[0])) {
        const n = normaliza(chave);
        if (['sku', 'codigo', 'cod', 'codigo sku'].includes(n)) mapaColunas.sku = chave;
        else if (n.startsWith('descri') || n === 'produto' || n === 'item') mapaColunas.descricao = chave;
        else if (['quantidade', 'qtd', 'qtde', 'qde'].includes(n)) mapaColunas.quantidade = chave;
        else if (['unidade', 'un', 'und', 'um'].includes(n)) mapaColunas.unidade = chave;
      }

      if (mapaColunas.descricao === undefined) {
        throw new Error('Não encontrei a coluna "Descrição" na planilha.');
      }

      const registros = bruto.map((linha, indice) => ({
        lista: nomeLista,
        sku: String(linha[mapaColunas.sku] ?? '').trim() || null,
        descricao: String(linha[mapaColunas.descricao] ?? '').trim(),
        quantidade: Number(String(linha[mapaColunas.quantidade] ?? '0').replace(',', '.')) || 0,
        unidade: String(linha[mapaColunas.unidade] ?? 'un').trim() || 'un',
        ordem: indice + 1,
      })).filter((r) => r.descricao);

      if (!registros.length) throw new Error('Nenhuma linha válida encontrada.');

      progresso.textContent = `Gravando ${registros.length} linha(s)…`;
      botao.textContent = 'Gravando…';

      for (let i = 0; i < registros.length; i += 200) {
        const lote = registros.slice(i, i + 200);
        const { error } = await sb.from('lista_de_produtos').insert(lote);
        if (error) throw new Error(traduzErro(error));
      }

      progresso.textContent = 'Sincronizando SKUs na tabela de produtos…';
      const res = await rpc('importar_skus_da_lista', { p_lista: nomeLista });

      fechar();
      ui.toast(`${registros.length} item(ns) na lista; ${res.inseridos} SKU(s) novo(s), ${res.atualizados} atualizado(s).`);
      ctx.recarregar();
    } catch (erro) {
      ui.toast(erro.message, 'erro');
      progresso.textContent = '';
      botao.disabled = false;
      botao.textContent = 'Importar';
    }
  });
}

// =====================================================================
// LISTAS
// =====================================================================
export async function listas(raiz, ctx) {
  ctx.setTitulo('Listas');
  const linhas = await listar('lista_de_produtos', {});

  const porLista = new Map();
  for (const l of linhas) {
    if (!porLista.has(l.lista)) porLista.set(l.lista, []);
    porLista.get(l.lista).push(l);
  }

  const blocos = [...porLista.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([nome, itens]) => `
    <tr>
      <td><strong>${ui.esc(nome)}</strong></td>
      <td class="num">${itens.length}</td>
      <td>${itens.length ? ui.dataBR(itens[0].criado_em) : '—'}</td>
      <td class="num">${itens.filter((i) => i.produto_id).length}</td>
      <td class="acoes">
        ${ctx.admin ? `<button type="button" class="botao-pequeno" data-importar="${ui.esc(nome)}">Sincronizar SKUs</button>` : ''}
      </td>
    </tr>`).join('');

  raiz.innerHTML = `
    <div class="cartao">
      <div class="cartao-topo">
        <h2>${porLista.size} lista(s)</h2>
        ${ctx.admin ? '<button type="button" class="botao-primario" id="importar">Importar planilha</button>' : ''}
      </div>
      ${porLista.size ? `<div class="tabela-rolagem"><table>
        <thead><tr><th>Lista</th><th class="num">Itens</th><th>Criada em</th><th class="num">SKUs vinculados</th><th></th></tr></thead>
        <tbody>${blocos}</tbody></table></div>` : ui.vazio('Nenhuma lista importada.')}
    </div>`;

  const b = raiz.querySelector('#importar');
  if (b) b.addEventListener('click', () => modalImportarPlanilha(ctx));

  for (const botao of raiz.querySelectorAll('[data-importar]')) {
    botao.addEventListener('click', async () => {
      try {
        const res = await rpc('importar_skus_da_lista', { p_lista: botao.dataset.importar });
        ui.toast(`SKUs: ${res.inseridos} novo(s), ${res.atualizados} atualizado(s).`);
        ctx.recarregar();
      } catch (erro) { ui.toast(erro.message, 'erro'); }
    });
  }
}
