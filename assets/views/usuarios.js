// Usuários: perfis de acesso (Administrador do Sistema, Administrador, Leitura, Fornecedor).
import { listar, criar, atualizar, excluir, criarLogin, rpc } from '../api.js';
import * as ui from '../ui.js';

export async function lista(raiz, ctx) {
  ctx.setTitulo('Usuários');
  if (!ctx.admin) {
    raiz.innerHTML = ui.vazio('Apenas administradores acessam esta área.');
    return;
  }

  const [usuarios, fornecedores] = await Promise.all([
    listar('usuarios', { select: '*, fornecedores(razao_social)', ordem: 'nome' }),
    listar('fornecedores', { ordem: 'razao_social' }),
  ]);

  const linhas = usuarios.map((u) => `
    <tr>
      <td><strong>${ui.esc(u.nome)}</strong></td>
      <td class="mono">${ui.esc(u.cpf_cnpj)}</td>
      <td>${ui.badge(ui.TIPOS_USUARIO[u.tipo] || u.tipo,
        u.tipo === 'admin_sistema' ? 'verde' : u.tipo === 'administrador' ? 'azul' : u.tipo === 'leitura' ? 'cinza' : 'amarelo')}</td>
      <td>${ui.esc(u.fornecedores?.razao_social || '—')}</td>
      <td>${u.ativo ? ui.badge('ativo', 'verde') : ui.badge('inativo', 'cinza')}</td>
      <td class="acoes">
        <button type="button" class="botao-pequeno" data-editar="${ui.esc(u.id)}">Editar</button>
        ${u.tipo === 'admin_sistema'
          ? '<span class="sub" title="O Administrador do Sistema não pode ser excluído">protegido</span>'
          : `<button type="button" class="botao-pequeno botao-perigo" data-excluir="${ui.esc(u.id)}">Excluir</button>`}
      </td>
    </tr>`).join('');

  raiz.innerHTML = `
    <div class="cartao">
      <div class="cartao-topo">
        <h2>${usuarios.length} usuário(s)</h2>
        <button type="button" class="botao-primario" id="novo">Novo usuário</button>
      </div>
      <div class="tabela-rolagem"><table>
        <thead><tr><th>Nome</th><th>CPF/CNPJ (login)</th><th>Perfil</th><th>Fornecedor</th><th>Situação</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>
      <p class="sub" style="margin-top:12px">O <strong>Administrador do Sistema</strong> é único não pode ser excluído nem ter o perfil alterado — a regra é aplicada pelo próprio banco.</p>
    </div>`;

  raiz.querySelector('#novo').addEventListener('click', () => modalNovo(fornecedores, ctx));

  for (const b of raiz.querySelectorAll('[data-editar]')) {
    b.addEventListener('click', () => {
      const u = usuarios.find((x) => x.id === b.dataset.editar);
      modalEditar(u, fornecedores, ctx);
    });
  }

  for (const b of raiz.querySelectorAll('[data-excluir]')) {
    b.addEventListener('click', async () => {
      if (!window.confirm('Excluir este usuário? O login continuará existindo no Supabase Auth.')) return;
      try {
        await excluir('usuarios', b.dataset.excluir);
        ui.toast('Perfil excluído.');
        ctx.recarregar();
      } catch (erro) { ui.toast(erro.message, 'erro'); }
    });
  }
}

function opcoesFornecedor(fornecedores) {
  return fornecedores.map((f) => ({ valor: f.id, rotulo: f.razao_social }));
}

function modalNovo(fornecedores, ctx) {
  const tipos = Object.entries(ui.TIPOS_USUARIO)
    .filter(([v]) => v !== 'admin_sistema')
    .map(([valor, rotulo]) => ({ valor, rotulo }));

  const { fechar, corpo } = ui.modal({
    titulo: 'Novo usuário',
    corpo: `
      <form id="form-usuario" class="grade grade-2">
        ${ui.campoTexto('Nome', 'nome', '', { obrigatorio: true })}
        ${ui.campoTexto('CPF/CNPJ (login)', 'cpf_cnpj', '', { obrigatorio: true })}
        ${ui.campoSelect('Perfil', 'tipo', tipos, 'leitura', { obrigatorio: true })}
        ${ui.campoSelect('Fornecedor', 'fornecedor_id', opcoesFornecedor(fornecedores), '', { vazio: '—' })}
        ${ui.campoTexto('Senha inicial', 'senha', '', { tipo: 'password', obrigatorio: true, placeholder: 'mínimo 6 caracteres' })}
        <div class="linha-acoes campo-largo">
          <button type="submit" class="botao-primario">Criar usuário</button>
          <button type="button" id="cancelar">Cancelar</button>
        </div>
      </form>
      <div class="aviso" style="margin-top:12px">
        O login é criado no Supabase Auth com a identidade
        <span class="mono">&lt;CPF&gt;@cotacao.app</span> e já sai confirmado —
        o usuário entra direto com o CPF e a senha informados aqui.
      </div>`,
  });

  corpo.querySelector('#cancelar').addEventListener('click', fechar);
  corpo.querySelector('#form-usuario').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = ui.dadosDoForm(ev.target);
    const botao = ev.target.querySelector('button[type="submit"]');
    botao.disabled = true;
    botao.textContent = 'Criando…';
    try {
      const user = await criarLogin(d.cpf_cnpj, d.senha);
      // O projeto mantém "Confirm email" ligado: sem isto o usuário não entra.
      try {
        await rpc('fn_confirmar_usuario', { p_auth_user_id: user.id });
      } catch (erroConfirmacao) {
        console.warn('Não foi possível confirmar o e-mail:', erroConfirmacao.message);
      }
      await criar('usuarios', {
        auth_user_id: user.id,
        nome: d.nome,
        cpf_cnpj: String(d.cpf_cnpj).replace(/\D/g, ''),
        tipo: d.tipo,
        fornecedor_id: d.fornecedor_id,
        ativo: true,
      });
      fechar();
      ui.toast('Usuário criado. Comunique o CPF e a senha a ele.');
      ctx.recarregar();
    } catch (erro) {
      ui.toast(erro.message, 'erro');
      botao.disabled = false;
      botao.textContent = 'Criar usuário';
    }
  });
}

function modalEditar(u, fornecedores, ctx) {
  const somentePerfil = u.tipo === 'admin_sistema';

  const { fechar, corpo } = ui.modal({
    titulo: `Editar ${u.nome}`,
    corpo: `
      <form id="form-usuario" class="grade grade-2">
        ${ui.campoTexto('Nome', 'nome', u.nome, { obrigatorio: true })}
        ${ui.campoTexto('CPF/CNPJ', 'cpf_cnpj', u.cpf_cnpj, { obrigatorio: true })}
        ${ui.campoSelect('Perfil', 'tipo',
          Object.entries(ui.TIPOS_USUARIO)
            .filter(([v]) => !somentePerfil || v === 'admin_sistema')
            .map(([valor, rotulo]) => ({ valor, rotulo })),
          u.tipo, { obrigatorio: true })}
        ${ui.campoSelect('Fornecedor', 'fornecedor_id', opcoesFornecedor(fornecedores), u.fornecedor_id, { vazio: '—' })}
        <label class="campo">
          <span>Situação</span>
          <select name="ativo">
            <option value="true" ${u.ativo ? 'selected' : ''}>Ativo</option>
            <option value="false" ${!u.ativo ? 'selected' : ''}>Inativo</option>
          </select>
        </label>
        <div class="linha-acoes campo-largo">
          <button type="submit" class="botao-primario">Salvar</button>
          <button type="button" id="cancelar">Cancelar</button>
        </div>
      </form>`,
  });

  corpo.querySelector('#cancelar').addEventListener('click', fechar);
  corpo.querySelector('#form-usuario').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = ui.dadosDoForm(ev.target);
    try {
      await atualizar('usuarios', u.id, {
        nome: d.nome,
        cpf_cnpj: String(d.cpf_cnpj).replace(/\D/g, ''),
        tipo: d.tipo,
        fornecedor_id: d.fornecedor_id,
        ativo: d.ativo === 'true',
      });
      fechar();
      ui.toast('Usuário atualizado.');
      ctx.recarregar();
    } catch (erro) { ui.toast(erro.message, 'erro'); }
  });
}
