// Produtos por fornecedor: quem fornece qual SKU, com importação por arquivo.
import { listar, criar, atualizar, excluir, rpc, traduzErro } from '../api.js';
import * as ui from '../ui.js';

const normaliza = (s) => String(s ?? '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').trim();

export async function lista(raiz, ctx) {
  ctx.setTitulo('Produtos por fornecedor');

  const [vinculos, fornecedores, produtos] = await Promise.all([
    listar('produto_por_fornecedor', {
      select: 'id, produto_id, fornecedor_id, produtos(sku, descricao, unidade), fornecedores(razao_social)',
    }),
    listar('fornecedores', { ordem: 'razao_social' }),
    listar('produtos', { ordem: 'sku' }),
  ]);

  vinculos.sort((a, b) => {
    const fa = (a.fornecedores?.razao_social || '').localeCompare(b.fornecedores?.razao_social || '');
    if (fa !== 0) return fa;
    return (a.produtos?.sku || '').localeCompare(b.produtos?.sku || '');
  });

  const linhas = vinculos.map((v) => {
    const busca = normaliza(`${v.fornecedores?.razao_social} ${v.produtos?.sku} ${v.produtos?.descricao}`);
    return `
      <tr data-busca="${ui.esc(busca)}">
        <td>${ui.esc(v.fornecedores?.razao_social || '—')}</td>
        <td class="mono">${ui.esc(v.produtos?.sku || '—')}</td>
        <td>${ui.esc(v.produtos?.descricao || '—')}</td>
        <td>${ui.esc(v.produtos?.unidade || '—')}</td>
        <td class="acoes">
          ${ctx.admin ? `<button type="button" class="botao-pequeno" data-editar="${ui.esc(v.id)}">Editar</button>
          <button type="button" class="botao-pequeno botao-perigo" data-excluir="${ui.esc(v.id)}">Excluir</button>` : ''}
        </td>
      </tr>`;
  }).join('');

  raiz.innerHTML = `
    <div class="cartao">
      <div class="cartao-topo">
        <h2>${vinculos.length} vínculo(s)</h2>
        <div class="linha-acoes">
          ${ctx.admin ? '<button type="button" id="importar">Importar arquivo</button>' : ''}
          ${ctx.admin ? '<button type="button" class="botao-primario" id="novo">Novo vínculo</button>' : ''}
        </div>
      </div>
      <label class="campo" style="max-width:340px">
        <span>Filtrar por fornecedor, SKU ou descrição</span>
        <input type="search" id="filtro" placeholder="digite para filtrar…">
      </label>
      ${vinculos.length ? `<div class="tabela-rolagem"><table id="tabela-vinculos">
        <thead><tr><th>Fornecedor</th><th>SKU</th><th>Descrição</th><th>Un.</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>` : ui.vazio('Nenhum vínculo cadastrado. Importe um arquivo ou crie manualmente.')}
    </div>`;

  const filtro = raiz.querySelector('#filtro');
  if (filtro) {
    filtro.addEventListener('input', () => {
      const termo = normaliza(filtro.value);
      for (const tr of raiz.querySelectorAll('#tabela-vinculos tbody tr')) {
        tr.hidden = termo !== '' && !tr.dataset.busca.includes(termo);
      }
    });
  }

  const novo = raiz.querySelector('#novo');
  if (novo) novo.addEventListener('click', () => modalVinculo(null, { fornecedores, produtos }, ctx));

  const importar = raiz.querySelector('#importar');
  if (importar) importar.addEventListener('click', () => modalImportar(ctx));

  for (const b of raiz.querySelectorAll('[data-editar]')) {
    b.addEventListener('click', () => {
      const v = vinculos.find((x) => x.id === b.dataset.editar);
      modalVinculo(v, { fornecedores, produtos }, ctx);
    });
  }

  for (const b of raiz.querySelectorAll('[data-excluir]')) {
    b.addEventListener('click', async () => {
      if (!window.confirm('Remover este vínculo?')) return;
      try {
        await excluir('produto_por_fornecedor', b.dataset.excluir);
        ui.toast('Vínculo removido.');
        ctx.recarregar();
      } catch (erro) { ui.toast(erro.message, 'erro'); }
    });
  }
}

function modalVinculo(v, { fornecedores, produtos }, ctx) {
  if (!fornecedores.length) {
    ui.toast('Cadastre um fornecedor antes de criar vínculos.', 'erro');
    return;
  }
  if (!produtos.length) {
    ui.toast('Cadastre ou importe produtos antes de criar vínculos.', 'erro');
    return;
  }

  const editando = !!v;
  const opcoesFornecedor = fornecedores.map((f) => ({ valor: f.id, rotulo: f.razao_social }));
  const opcoesProduto = produtos.map((p) => ({
    valor: p.id,
    rotulo: `${p.sku} — ${p.descricao}`,
  }));

  const { fechar, corpo } = ui.modal({
    titulo: editando ? 'Editar vínculo' : 'Novo vínculo',
    corpo: `
      <form id="form-vinculo">
        ${ui.campoSelect('Fornecedor', 'fornecedor_id', opcoesFornecedor,
          v?.fornecedor_id, { obrigatorio: true, vazio: '—' })}
        ${ui.campoSelect('Produto', 'produto_id', opcoesProduto,
          v?.produto_id, { obrigatorio: true, vazio: '—' })}
        <div class="linha-acoes">
          <button type="submit" class="botao-primario">${editando ? 'Salvar' : 'Adicionar'}</button>
          <button type="button" id="cancelar">Cancelar</button>
        </div>
      </form>`,
  });

  corpo.querySelector('#cancelar').addEventListener('click', fechar);
  corpo.querySelector('#form-vinculo').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = ui.dadosDoForm(ev.target);
    try {
      if (editando) await atualizar('produto_por_fornecedor', v.id, d);
      else await criar('produto_por_fornecedor', d);
      fechar();
      ui.toast(editando ? 'Vínculo atualizado.' : 'Vínculo criado.');
      ctx.recarregar();
    } catch (erro) {
      ui.toast(erro.message, 'erro');
    }
  });
}

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
