// Produtos por fornecedor: lista por fornecedor e edição dos itens de cada um.
import { listar, buscar, criar, excluir, excluirOnde, rpc } from '../api.js';
import * as ui from '../ui.js';

const normaliza = (s) => String(s ?? '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').trim();

// =====================================================================
// Lista: um fornecedor por linha, com a quantidade de produtos vinculados
// =====================================================================
export async function lista(raiz, ctx) {
  ctx.setTitulo('Produtos por fornecedor');

  const [fornecedores, links] = await Promise.all([
    listar('fornecedores', { ordem: 'razao_social' }),
    listar('produto_por_fornecedor', { select: 'id, fornecedor_id' }),
  ]);

  const contagem = new Map();
  for (const l of links) contagem.set(l.fornecedor_id, (contagem.get(l.fornecedor_id) || 0) + 1);

  const linhas = fornecedores.map((f) => {
    const qtd = contagem.get(f.id) || 0;
    const busca = normaliza(`${f.razao_social} ${f.nome_fantasia} ${f.cnpj_cpf} ${f.contato_nome}`);
    return `
      <tr data-busca="${ui.esc(busca)}">
        <td>
          <strong>${ui.esc(f.razao_social)}</strong>
          ${f.nome_fantasia ? `<div class="sub">${ui.esc(f.nome_fantasia)}</div>` : ''}
        </td>
        <td class="mono">${ui.esc(f.cnpj_cpf || '—')}</td>
        <td>
          ${ui.esc(f.contato_nome || '—')}
          <div class="sub">${ui.esc([f.email, f.whatsapp].filter(Boolean).join(' · ') || '')}</div>
        </td>
        <td class="num">${qtd}</td>
        <td>${f.ativo ? ui.badge('ativo', 'verde') : ui.badge('inativo', 'cinza')}</td>
        <td class="acoes">
          <a class="botao botao-pequeno" href="#/vinculos/${ui.esc(f.id)}">Editar</a>
          ${ctx.admin ? `<button type="button" class="botao-pequeno botao-perigo" data-excluir="${ui.esc(f.id)}"
             ${qtd === 0 ? 'disabled title="Sem itens para excluir"' : ''}>Excluir</button>` : ''}
        </td>
      </tr>`;
  }).join('');

  raiz.innerHTML = `
    <div class="cartao">
      <div class="cartao-topo">
        <h2>${fornecedores.length} fornecedor(es)</h2>
        ${ctx.admin ? '<button type="button" id="importar">Importar arquivo</button>' : ''}
      </div>
      <label class="campo" style="max-width:340px">
        <span>Filtrar por fornecedor, CNPJ ou contato</span>
        <input type="search" id="filtro" placeholder="digite para filtrar…">
      </label>
      ${fornecedores.length ? `<div class="tabela-rolagem"><table id="tabela-fornecedores">
        <thead><tr>
          <th>Fornecedor</th><th>CNPJ/CPF</th><th>Contato</th>
          <th class="num">Itens</th><th>Situação</th><th></th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>` : ui.vazio('Nenhum fornecedor cadastrado.')}
      <p class="sub" style="margin-top:12px">Clique em <strong>Editar</strong> para ver, incluir ou excluir os produtos de cada fornecedor.</p>
    </div>`;

  const filtro = raiz.querySelector('#filtro');
  if (filtro) {
    filtro.addEventListener('input', () => {
      const termo = normaliza(filtro.value);
      for (const tr of raiz.querySelectorAll('#tabela-fornecedores tbody tr')) {
        tr.hidden = termo !== '' && !tr.dataset.busca.includes(termo);
      }
    });
  }

  const importar = raiz.querySelector('#importar');
  if (importar) importar.addEventListener('click', () => modalImportar(ctx));

  for (const b of raiz.querySelectorAll('[data-excluir]')) {
    b.addEventListener('click', async () => {
      const f = fornecedores.find((x) => x.id === b.dataset.excluir);
      const qtd = contagem.get(f.id) || 0;
      if (!qtd) return;
      if (!window.confirm(`Excluir os ${qtd} item(ns) de "${f.razao_social}"?\n\nOs produtos e o fornecedor continuam cadastrados — só os vínculos são removidos.`)) return;
      try {
        await excluirOnde('produto_por_fornecedor', { fornecedor_id: f.id });
        ui.toast(`${qtd} vínculo(s) removido(s).`);
        ctx.recarregar();
      } catch (erro) { ui.toast(erro.message, 'erro'); }
    });
  }
}

// =====================================================================
// Detalhe: os itens de um fornecedor
// =====================================================================
export async function detalhe(raiz, ctx) {
  const fornecedor = await buscar('fornecedores', ctx.id);
  if (!fornecedor) {
    raiz.innerHTML = ui.vazio('Fornecedor não encontrado.');
    return;
  }
  ctx.setTitulo(`Itens de ${fornecedor.razao_social}`);

  const [links, produtos] = await Promise.all([
    listar('produto_por_fornecedor', {
      eq: { fornecedor_id: fornecedor.id },
      select: 'id, produto_id, produtos(sku, descricao, unidade)',
    }),
    listar('produtos', { ordem: 'sku' }),
  ]);

  links.sort((a, b) => (a.produtos?.sku || '').localeCompare(b.produtos?.sku || ''));

  const jaVinculados = new Set(links.map((l) => l.produto_id));
  const disponiveis = produtos.filter((p) => !jaVinculados.has(p.id));

  const linhas = links.map((l) => `
    <tr>
      <td class="mono">${ui.esc(l.produtos?.sku || '—')}</td>
      <td>${ui.esc(l.produtos?.descricao || '—')}</td>
      <td>${ui.esc(l.produtos?.unidade || '—')}</td>
      <td class="acoes">
        ${ctx.admin ? `<button type="button" class="botao-pequeno botao-perigo" data-excluir-item="${ui.esc(l.id)}">Excluir</button>` : ''}
      </td>
    </tr>`).join('');

  raiz.innerHTML = `
    <div class="cartao">
      <div class="cartao-topo">
        <div>
          <h2>${ui.esc(fornecedor.razao_social)}</h2>
          <p class="sub">
            ${ui.esc(fornecedor.cnpj_cpf || 'sem CNPJ/CPF')}
            ${fornecedor.contato_nome ? ` · ${ui.esc(fornecedor.contato_nome)}` : ''}
            ${fornecedor.email ? ` · ${ui.esc(fornecedor.email)}` : ''}
            ${fornecedor.whatsapp ? ` · ${ui.esc(fornecedor.whatsapp)}` : ''}
            · ${links.length} item(ns)
          </p>
        </div>
        <div class="linha-acoes">
          <a class="botao" href="#/vinculos">Voltar</a>
          ${ctx.admin && disponiveis.length ? '<button type="button" class="botao-primario" id="adicionar">Adicionar produto</button>' : ''}
        </div>
      </div>

      ${links.length ? `<div class="tabela-rolagem"><table>
        <thead><tr><th>SKU</th><th>Descrição</th><th>Unidade</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>` : ui.vazio('Este fornecedor ainda não tem produtos vinculados.')}

      ${ctx.admin && !disponiveis.length && produtos.length
        ? '<p class="sub" style="margin-top:12px">Todos os produtos cadastrados já estão vinculados a este fornecedor.</p>'
        : ''}
    </div>`;

  const adicionar = raiz.querySelector('#adicionar');
  if (adicionar) {
    adicionar.addEventListener('click', () => modalAdicionar(disponiveis, fornecedor, ctx));
  }

  for (const b of raiz.querySelectorAll('[data-excluir-item]')) {
    b.addEventListener('click', async () => {
      const link = links.find((l) => l.id === b.dataset.excluirItem);
      const nome = link?.produtos?.sku ? `${link.produtos.sku} — ${link.produtos.descricao}` : 'este item';
      if (!window.confirm(`Excluir ${nome} da lista deste fornecedor?`)) return;
      try {
        await excluir('produto_por_fornecedor', b.dataset.excluirItem);
        ui.toast('Item removido.');
        ctx.recarregar();
      } catch (erro) { ui.toast(erro.message, 'erro'); }
    });
  }
}

function modalAdicionar(disponiveis, fornecedor, ctx) {
  const opcoes = disponiveis.map((p) => ({ valor: p.id, rotulo: `${p.sku} — ${p.descricao}` }));

  const { fechar, corpo } = ui.modal({
    titulo: `Adicionar produto — ${fornecedor.razao_social}`,
    corpo: `
      <form id="form-adicionar">
        ${ui.campoSelect('Produto', 'produto_id', opcoes, '', { obrigatorio: true, vazio: '—' })}
        <div class="linha-acoes">
          <button type="submit" class="botao-primario">Adicionar</button>
          <button type="button" id="cancelar">Cancelar</button>
        </div>
      </form>
      <p class="sub" style="margin-top:10px">Para cadastrar um produto novo, use a tela <strong>Produtos</strong>.</p>`,
  });

  corpo.querySelector('#cancelar').addEventListener('click', fechar);
  corpo.querySelector('#form-adicionar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = ui.dadosDoForm(ev.target);
    try {
      await criar('produto_por_fornecedor', {
        produto_id: d.produto_id,
        fornecedor_id: fornecedor.id,
      });
      fechar();
      ui.toast('Produto vinculado.');
      ctx.recarregar();
    } catch (erro) { ui.toast(erro.message, 'erro'); }
  });
}

// =====================================================================
// Importação por arquivo
// =====================================================================
async function modalImportar(ctx) {
  const { fechar, corpo } = ui.modal({
    titulo: 'Importar produtos por fornecedor',
    largura: '620px',
    corpo: `
      <p class="sub">
        A planilha precisa das colunas <strong>SKU</strong> e <strong>Fornecedor</strong>
        (razão social ou nome fantasia); aceita também <strong>CNPJ</strong> no lugar do nome.
        <strong>Descrição</strong> e <strong>Unidade</strong> são opcionais — servem para criar o
        produto quando o SKU ainda não existe.
      </p>
      <form id="form-importar">
        <label class="campo">
          <span>Arquivo (.xlsx, .xls, .csv) *</span>
          <input type="file" name="arquivo" accept=".xlsx,.xls,.csv" required>
        </label>
        <div class="linha-acoes">
          <button type="submit" class="botao-primario">Importar</button>
          <button type="button" id="cancelar">Cancelar</button>
        </div>
      </form>
      <div id="resultado"></div>`,
  });

  corpo.querySelector('#cancelar').addEventListener('click', fechar);

  corpo.querySelector('#form-importar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const botao = form.querySelector('button[type="submit"]');
    const arquivo = form.arquivo.files[0];
    if (!arquivo) return;

    botao.disabled = true;
    botao.textContent = 'Lendo…';

    try {
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      const wb = XLSX.read(bytes, { type: 'array' });
      const bruto = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

      if (!bruto.length) throw new Error('A planilha está vazia.');

      const mapa = {};
      for (const chave of Object.keys(bruto[0])) {
        const n = normaliza(chave);
        if (['sku', 'codigo', 'cod'].includes(n)) mapa.sku = chave;
        else if (n.startsWith('descri') || n === 'produto' || n === 'item') mapa.descricao = chave;
        else if (['unidade', 'un', 'und', 'um'].includes(n)) mapa.unidade = chave;
        else if (['fornecedor', 'razao social', 'nome fantasia', 'nome'].includes(n)) mapa.fornecedor = chave;
        else if (['cnpj', 'cnpj/cpf', 'cpf/cnpj', 'documento', 'cnpj cpf'].includes(n)) mapa.cnpj = chave;
      }

      if (mapa.sku === undefined) throw new Error('Não encontrei a coluna "SKU".');
      if (mapa.fornecedor === undefined && mapa.cnpj === undefined) {
        throw new Error('Não encontrei a coluna "Fornecedor" (ou "CNPJ").');
      }

      const linhas = bruto.map((l) => ({
        sku: String(l[mapa.sku] ?? '').trim() || null,
        descricao: mapa.descricao ? String(l[mapa.descricao] ?? '').trim() || null : null,
        unidade: mapa.unidade ? String(l[mapa.unidade] ?? '').trim() || null : null,
        fornecedor: mapa.fornecedor ? String(l[mapa.fornecedor] ?? '').trim() || null : null,
        cnpj: mapa.cnpj ? String(l[mapa.cnpj] ?? '').trim() || null : null,
      }));

      botao.textContent = 'Importando…';
      const res = await rpc('fn_importar_produtos_por_fornecedor', { p_linhas: linhas });

      const naoEncontrados = res.sem_fornecedor || [];
      corpo.querySelector('#resultado').innerHTML = `
        <div class="cartao" style="box-shadow:none;margin-top:16px">
          <h3>Resultado</h3>
          <p><strong>${res.vinculados}</strong> vínculo(s) criado(s) ·
             <strong>${res.produtos_criados}</strong> produto(s) novo(s)
             ${res.linhas_ignoradas ? ` · ${res.linhas_ignoradas} linha(s) ignorada(s)` : ''}</p>
          ${naoEncontrados.length ? `
            <div class="aviso">
              Fornecedor não encontrado para: ${ui.esc(naoEncontrados.join(', '))}.
              Cadastre esses fornecedores e importe de novo — nada foi perdido.
            </div>` : ''}
        </div>`;
      botao.hidden = true;
      ui.toast('Importação concluída.');
      ctx.recarregar();
    } catch (erro) {
      ui.toast(erro.message, 'erro');
      botao.disabled = false;
      botao.textContent = 'Importar';
    }
  });
}
