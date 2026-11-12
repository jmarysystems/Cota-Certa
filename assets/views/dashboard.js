// Dashboard: economia gerada pelas cotações aprovadas (por mês e por fornecedor).
import { listar } from '../api.js';
import * as ui from '../ui.js';

const nomeDoMes = (referencia) => {
  const [ano, mes] = String(referencia).split('-').map(Number);
  const texto = new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long', year: 'numeric',
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

const barra = (valor, maximo, classe = '') => {
  const pct = maximo > 0 ? Math.max(2, Math.round((valor / maximo) * 100)) : 0;
  return `<div class="barra ${classe}"><div style="width:${pct}%"></div></div>`;
};

export async function render(raiz, ctx) {
  ctx.setTitulo('Dashboard');

  const linhas = await listar('resultados_das_cotacoes', {
    select: '*, fornecedores(razao_social)',
    ordem: 'referencia',
    asc: false,
  });

  if (!linhas.length) {
    raiz.innerHTML = `
      <div class="cartao">
        <h2>Dashboard</h2>
        ${ui.vazio('Nenhuma cotação aprovada ainda. A economia aparece aqui depois da primeira aprovação.')}
      </div>`;
    return;
  }

  // ---------- agregações ----------
  const porMes = new Map();
  const porFornecedor = new Map();
  let economiaTotal = 0;
  let valorAprovadoTotal = 0;
  const cotacoes = new Set();

  for (const l of linhas) {
    const economia = Number(l.economia_total || 0);
    const aprovado = Number(l.quantidade || 0) * Number(l.valor_aprovado || 0);

    economiaTotal += economia;
    valorAprovadoTotal += aprovado;
    cotacoes.add(l.cotacao_id);

    const mes = String(l.referencia).slice(0, 7);
    if (!porMes.has(mes)) porMes.set(mes, { economia: 0, itens: 0, cotacoes: new Set() });
    const m = porMes.get(mes);
    m.economia += economia;
    m.itens += 1;
    m.cotacoes.add(l.cotacao_id);

    if (!porFornecedor.has(l.fornecedor_id)) {
      porFornecedor.set(l.fornecedor_id, {
        nome: l.fornecedores?.razao_social || '—',
        economia: 0,
        itens: 0,
        aprovado: 0,
      });
    }
    const f = porFornecedor.get(l.fornecedor_id);
    f.economia += economia;
    f.itens += 1;
    f.aprovado += aprovado;
  }

  const mesAtual = new Date().toISOString().slice(0, 7);
  const economiaMes = porMes.get(mesAtual)?.economia || 0;
  const percentual = valorAprovadoTotal > 0 ? (economiaTotal / valorAprovadoTotal) * 100 : 0;

  const meses = [...porMes.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const fornecedores = [...porFornecedor.values()].sort((a, b) => b.economia - a.economia);

  const maxMes = Math.max(...meses.map(([, v]) => v.economia), 0);
  const maxForn = Math.max(...fornecedores.map((f) => f.economia), 0);

  raiz.innerHTML = `
    <div class="kpis">
      <div class="kpi">
        <div class="rotulo">Economia total</div>
        <div class="valor" style="color:var(--verde)">${ui.brl(economiaTotal)}</div>
        <div class="detalhe">${linhas.length} item(ns) aprovado(s) · ${cotacoes.size} cotação(ões)</div>
      </div>
      <div class="kpi">
        <div class="rotulo">Economia no mês</div>
        <div class="valor">${ui.brl(economiaMes)}</div>
        <div class="detalhe">${nomeDoMes(`${mesAtual}-01`)}</div>
      </div>
      <div class="kpi">
        <div class="rotulo">Valor aprovado</div>
        <div class="valor">${ui.brl(valorAprovadoTotal)}</div>
        <div class="detalhe">soma dos itens aprovados</div>
      </div>
      <div class="kpi">
        <div class="rotulo">Ganho sobre o aprovado</div>
        <div class="valor">${percentual.toFixed(1)}%</div>
        <div class="detalhe">economia ÷ valor aprovado</div>
      </div>
    </div>

    <div class="cartao">
      <div class="cartao-topo">
        <h2>Economia por mês</h2>
      </div>
      <div class="tabela-rolagem"><table>
        <thead><tr>
          <th>Mês</th><th class="num">Economia</th><th class="num">Itens</th>
          <th class="num">Cotações</th><th></th>
        </tr></thead>
        <tbody>
          ${meses.map(([mes, v]) => `<tr>
            <td><strong>${ui.esc(nomeDoMes(`${mes}-01`))}</strong></td>
            <td class="num">${ui.brl(v.economia)}</td>
            <td class="num">${v.itens}</td>
            <td class="num">${v.cotacoes.size}</td>
            <td class="barra-cel">${barra(v.economia, maxMes, 'verde')}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <th>Total</th>
          <th class="num">${ui.brl(economiaTotal)}</th>
          <th class="num">${linhas.length}</th>
          <th class="num">${cotacoes.size}</th>
          <th></th>
        </tr></tfoot>
      </table></div>
    </div>

    <div class="cartao">
      <div class="cartao-topo">
        <h2>Economia por fornecedor</h2>
      </div>
      <div class="tabela-rolagem"><table>
        <thead><tr>
          <th>Fornecedor</th><th class="num">Economia</th><th class="num">Itens</th>
          <th class="num">Valor aprovado</th><th></th>
        </tr></thead>
        <tbody>
          ${fornecedores.map((f) => `<tr>
            <td>${ui.esc(f.nome)}</td>
            <td class="num">${ui.brl(f.economia)}</td>
            <td class="num">${f.itens}</td>
            <td class="num">${ui.brl(f.aprovado)}</td>
            <td class="barra-cel">${barra(f.economia, maxForn)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <p class="sub" style="margin-top:12px">
        Economia = diferença entre a maior oferta recebida e o valor aprovado de cada item,
        multiplicada pela quantidade. Só entram cotações já aprovadas.
      </p>
    </div>`;
}
