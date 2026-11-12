// Interpreta a resposta de um fornecedor escrita em texto livre
// (mensagem de WhatsApp, e-mail, bilhete digitado).
//
// Formatos aceitos, uma linha por item:
//   77 = 56,00
//   77: R$ 56,00
//   SKU-002 - 12.50
//   543 7,00
//   66 indisponível
//   (também aceita vários itens separados por ";" na mesma linha)

const MOEDA = /R\$|BRL/gi;

export const normalizarChave = (v) => String(v ?? '').trim().toUpperCase();

const INDISPONIVEL = /\b(indispon\w*|sem\s+estoque|sem\s+stock|nao\s+tenho|não\s+tenho|não\s+forneco|nao\s+forneco)\b/i;

/** Converte "1.234,56", "56,00", "56.00" ou "56" em número. */
export function paraNumero(trecho) {
  let s = String(trecho ?? '').replace(/[^\d.,]/g, '');
  if (!s) return null;

  const temVirgula = s.includes(',');
  const temPonto = s.includes('.');

  if (temVirgula && temPonto) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    s = s.replace(',', '.');
  } else if (temPonto) {
    const partes = s.split('.');
    if (partes.length > 2) {
      s = partes.join('');
    } else if (partes[1].length === 3) {
      // 1.234 / 56.000 -> separador de milhar
      s = partes.join('');
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} texto  mensagem recebida
 * @param {Array<{cotacao_item_id:string, sku?:string, ean?:string, descricao?:string}>} itens
 * @returns {{linhas:Array, naoEncontrados:string[], total:number}}
 */
export function interpretarResposta(texto, itens) {
  const porSku = new Map();
  const porEan = new Map();
  for (const item of itens) {
    const sku = normalizarChave(item.sku);
    const ean = normalizarChave(item.ean);
    if (sku) porSku.set(sku, item);
    if (ean) porEan.set(ean, item);
  }

  const linhas = [];
  const naoEncontrados = [];
  const usados = new Set();

  const pedacos = String(texto ?? '')
    .replace(MOEDA, ' ')
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const pedaco of pedacos) {
    // separa a chave (SKU/EAN) do restante
    const m = pedaco.match(/^([A-Za-z0-9][A-Za-z0-9._/-]*)\s*(?:=|:|-|–|—|\s)\s*(.*)$/);
    if (!m) {
      naoEncontrados.push(pedaco);
      continue;
    }

    const chave = normalizarChave(m[1]);
    const resto = (m[2] || '').trim();
    const item = porSku.get(chave) || porEan.get(chave);

    if (!item) {
      naoEncontrados.push(pedaco);
      continue;
    }
    if (usados.has(item.cotacao_item_id)) {
      naoEncontrados.push(pedaco);
      continue;
    }

    let disponivel = true;
    let valor = null;

    if (INDISPONIVEL.test(resto)) {
      disponivel = false;
    } else {
      const numero = resto.match(/\d[\d.,]*/);
      valor = numero ? paraNumero(numero[0]) : null;
      if (valor === null) {
        naoEncontrados.push(pedaco);
        continue;
      }
    }

    usados.add(item.cotacao_item_id);
    linhas.push({
      item,
      bruto: pedaco,
      valor: disponivel ? valor : 0,
      disponivel,
    });
  }

  const total = linhas.reduce((soma, l) => {
    if (!l.disponivel) return soma;
    return soma + Number(l.item.quantidade || 0) * Number(l.valor || 0);
  }, 0);

  return { linhas, naoEncontrados, total };
}
