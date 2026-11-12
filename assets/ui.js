// Helpers de interface: escape, formatação, toast, modal.

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

export const brl = (v) =>
  v === null || v === undefined || v === ''
    ? '—'
    : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const num = (v, casas = 2) =>
  v === null || v === undefined || v === ''
    ? '—'
    : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

export function dataBR(v) {
  if (!v) return '—';
  const s = String(v);
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

export function dataHoraBR(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export const STATUS_COTACAO = {
  rascunho: 'Rascunho',
  finalizada: 'Finalizada',
  enviada: 'Enviada',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  cancelada: 'Cancelada',
};

export const STATUS_PEDIDO = {
  gerado: 'Gerado',
  enviado: 'Enviado',
  confirmado: 'Confirmado',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

export const TIPOS_USUARIO = {
  admin_sistema: 'Administrador do Sistema',
  administrador: 'Administrador',
  leitura: 'Leitura',
  fornecedor: 'Fornecedor',
};

export const TIPOS_PAGAMENTO = {
  dinheiro: 'Dinheiro',
  a_vista: 'À vista',
  boleto: 'Boleto',
  pix: 'Pix',
  transferencia: 'Transferência',
  cartao: 'Cartão',
};

export const badge = (texto, cor = 'neutro') =>
  `<span class="badge badge-${esc(cor)}">${esc(texto)}</span>`;

export function badgeStatus(status) {
  const cores = {
    rascunho: 'cinza', finalizada: 'azul', enviada: 'amarelo', em_analise: 'laranja',
    aprovada: 'verde', cancelada: 'vermelho', gerado: 'azul', confirmado: 'amarelo',
    entregue: 'verde',
  };
  const rotulo = STATUS_COTACAO[status] || STATUS_PEDIDO[status] || status;
  return badge(rotulo, cores[status] || 'neutro');
}

export function toast(mensagem, tipo = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.textContent = mensagem;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('sair'), 3600);
  setTimeout(() => el.remove(), 4200);
}

export function modal({ titulo, corpo, largura = '560px' }) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:${esc(largura)}">
      <header class="modal-topo">
        <h2>${esc(titulo)}</h2>
        <button type="button" class="fechar" aria-label="Fechar">&times;</button>
      </header>
      <div class="modal-corpo">${corpo}</div>
    </div>`;
  const fechar = () => overlay.remove();
  overlay.querySelector('.fechar').addEventListener('click', fechar);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });
  document.addEventListener('keydown', function escuta(e) {
    if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', escuta); }
  });
  document.body.appendChild(overlay);
  return { overlay, fechar, corpo: overlay.querySelector('.modal-corpo') };
}

export const vazio = (msg = 'Nenhum registro encontrado.') =>
  `<p class="vazio">${esc(msg)}</p>`;

export function campoTexto(rotulo, nome, valor = '', opcoes = {}) {
  const obrig = opcoes.obrigatorio ? 'required' : '';
  const tipo = opcoes.tipo || 'text';
  return `
    <label class="campo">
      <span>${esc(rotulo)}${opcoes.obrigatorio ? ' *' : ''}</span>
      <input type="${esc(tipo)}" name="${esc(nome)}" value="${esc(valor ?? '')}"
             ${obrig} ${opcoes.placeholder ? `placeholder="${esc(opcoes.placeholder)}"` : ''}
             ${opcoes.step ? `step="${esc(opcoes.step)}"` : ''}
             ${opcoes.min !== undefined ? `min="${esc(opcoes.min)}"` : ''}>
    </label>`;
}

export function campoSelect(rotulo, nome, opcoes, valorAtual, extra = {}) {
  const opts = opcoes
    .map((o) => `<option value="${esc(o.valor)}" ${String(o.valor) === String(valorAtual ?? '') ? 'selected' : ''}>${esc(o.rotulo)}</option>`)
    .join('');
  return `
    <label class="campo">
      <span>${esc(rotulo)}${extra.obrigatorio ? ' *' : ''}</span>
      <select name="${esc(nome)}" ${extra.obrigatorio ? 'required' : ''}>
        ${extra.vazio ? `<option value="">${esc(extra.vazio)}</option>` : ''}
        ${opts}
      </select>
    </label>`;
}

export function campoArea(rotulo, nome, valor = '') {
  return `
    <label class="campo campo-largo">
      <span>${esc(rotulo)}</span>
      <textarea name="${esc(nome)}" rows="3">${esc(valor ?? '')}</textarea>
    </label>`;
}

// Link público de resposta: preserva o subdiretório (ex.: /Cota-o/ no GitHub Pages).
export function linkPublico(token) {
  const dir = location.pathname.replace(/[^/]*$/, '');
  return `${location.origin}${dir}resposta.html?token=${token}`;
}

export function linkWhatsapp(telefone, texto) {
  let d = String(telefone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 11) d = `55${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

export function linkEmail(email, assunto, texto) {
  if (!email) return null;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(texto)}`;
}

export function dadosDoForm(form) {
  const dados = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    let v = el.value?.trim?.() ?? el.value;
    if (el.type === 'number') v = v === '' ? null : Number(v);
    if (el.type === 'checkbox') v = el.checked;
    dados[el.name] = v === '' ? null : v;
  }
  return dados;
}
