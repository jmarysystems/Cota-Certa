// Shell da aplicação: login, layout e roteamento por perfil.
import { sb, sair, perfilAtual, sessao } from './api.js';
import { NOME_SISTEMA } from './config.js';
import * as ui from './ui.js';
import * as cotacoes from './views/cotacoes.js';
import * as cadastros from './views/cadastros.js';
import * as usuarios from './views/usuarios.js';
import * as pedidos from './views/pedidos.js';

const app = document.getElementById('app');
let perfil = null;

const ehAdmin = (p) => !!p && (p.tipo === 'administrador' || p.tipo === 'admin_sistema');

function telaLogin(mensagem = '') {
  app.innerHTML = `
    <div class="tela-login">
      <form class="cartao-login" id="form-login" autocomplete="on">
        <div class="marca"><span class="marca-icone">◫</span>${ui.esc(NOME_SISTEMA)}</div>
        <h1>Entrar</h1>
        <p class="sub">Acesso com CPF/CNPJ e senha.</p>
        ${mensagem ? `<div class="aviso">${ui.esc(mensagem)}</div>` : ''}
        <label class="campo">
          <span>CPF ou CNPJ</span>
          <input name="documento" inputmode="numeric" autocomplete="username" required autofocus>
        </label>
        <label class="campo">
          <span>Senha</span>
          <input name="senha" type="password" autocomplete="current-password" required>
        </label>
        <button class="botao-primario" style="width:100%" type="submit">Entrar</button>
      </form>
    </div>`;

  const form = document.getElementById('form-login');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    botao.textContent = 'Entrando…';
    try {
      const { entrar } = await import('./api.js');
      await entrar(form.documento.value, form.senha.value);
      perfil = await perfilAtual();
      if (!perfil) throw new Error('Login válido, mas sem perfil de usuário cadastrado.');
      if (perfil.ativo === false) throw new Error('Usuário inativo.');
      iniciarApp();
    } catch (erro) {
      await sair();
      telaLogin(erro.message);
    }
  });
}

function itensDeMenu() {
  const admin = ehAdmin(perfil);
  const fornecedor = perfil.tipo === 'fornecedor';
  const itens = [
    ['#/cotacoes', 'Cotações', '▤'],
    ['#/pedidos', 'Pedidos', '▣'],
  ];
  if (!fornecedor) {
    itens.push(['#/fornecedores', 'Fornecedores', '◈']);
    itens.push(['#/produtos', 'Produtos', '◧']);
    itens.push(['#/listas', 'Listas', '☰']);
  }
  if (admin) itens.push(['#/usuarios', 'Usuários', '◉']);
  return itens;
}

function iniciarApp() {
  const menu = itensDeMenu()
    .map(([href, rotulo, icone]) => `<a class="nav-item" data-rota="${href}" href="${href}"><span class="icone">${icone}</span>${ui.esc(rotulo)}</a>`)
    .join('');

  app.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="marca"><span class="marca-icone">◫</span>${ui.esc(NOME_SISTEMA)}</div>
        <nav>${menu}</nav>
        <div class="sidebar-rodape">
          <div class="quem">${ui.esc(perfil.nome)}</div>
          <div class="papel">${ui.esc(ui.TIPOS_USUARIO[perfil.tipo] || perfil.tipo)}</div>
          <button type="button" id="sair">Sair</button>
        </div>
      </aside>
      <div class="conteudo">
        <header class="topbar"><h1 id="titulo">Cotações</h1></header>
        <main id="view"><div class="carregando">Carregando…</div></main>
      </div>
    </div>`;

  document.getElementById('sair').addEventListener('click', async () => {
    await sair();
    perfil = null;
    telaLogin('Você saiu.');
  });

  if (!location.hash) location.hash = '#/cotacoes';
  window.addEventListener('hashchange', navegar);
  navegar();
}

async function navegar() {
  const raiz = document.getElementById('view');
  if (!raiz) return;

  const caminho = (location.hash || '#/cotacoes').replace(/^#\/?/, '');
  const [segmento, id] = caminho.split('/');

  for (const link of document.querySelectorAll('.nav-item')) {
    const rota = link.dataset.rota.replace(/^#\//, '').split('/')[0];
    link.classList.toggle('ativo', rota === segmento);
  }

  const ctx = {
    perfil,
    admin: ehAdmin(perfil),
    id,
    setTitulo: (texto) => {
      document.getElementById('titulo').textContent = texto;
      document.title = `${texto} · ${NOME_SISTEMA}`;
    },
    irPara: (hash) => { location.hash = hash; },
    recarregar: () => navegar(),
  };

  raiz.innerHTML = '<div class="carregando">Carregando…</div>';

  try {
    if (segmento === 'pedidos') return await pedidos.lista(raiz, ctx);
    if (segmento === 'fornecedores') return await cadastros.fornecedores(raiz, ctx);
    if (segmento === 'produtos') return await cadastros.produtos(raiz, ctx);
    if (segmento === 'listas') return await cadastros.listas(raiz, ctx);
    if (segmento === 'usuarios') return await usuarios.lista(raiz, ctx);
    if (segmento === 'cotacoes') {
      if (id === 'nova') return await cotacoes.nova(raiz, ctx);
      if (id) return await cotacoes.detalhe(raiz, ctx);
      return await cotacoes.lista(raiz, ctx);
    }
    ctx.irPara('#/cotacoes');
  } catch (erro) {
    raiz.innerHTML = `<div class="cartao"><h2>Não foi possível carregar</h2>
      <p class="sub">${ui.esc(erro.message)}</p>
      <button type="button" id="tentar">Tentar de novo</button></div>`;
    const b = document.getElementById('tentar');
    if (b) b.onclick = navegar;
  }
}

// Encerra a sessão se o token expirar em outra aba.
sb.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_OUT' && perfil) {
    perfil = null;
    telaLogin('Sessão encerrada. Entre novamente.');
  }
});

(async function iniciar() {
  try {
    const s = await sessao();
    if (!s) return telaLogin();
    perfil = await perfilAtual();
    if (!perfil) {
      await sair();
      return telaLogin('Sua conta não tem perfil cadastrado. Fale com o administrador.');
    }
    iniciarApp();
  } catch (erro) {
    telaLogin(erro.message);
  }
})();
