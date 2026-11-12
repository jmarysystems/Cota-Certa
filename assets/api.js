// Camada de acesso a dados (Supabase REST/Auth/RPC).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_KEY, LOGIN_DOMAIN } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const TRADUCOES = [
  ['Invalid login credentials', 'CPF/CNPJ ou senha inválidos.'],
  ['Email not confirmed', 'Este login ainda não foi confirmado.'],
  ['User already registered', 'Já existe um usuário com este CPF/CNPJ.'],
  ['Password should be at least', 'A senha precisa ter pelo menos 6 caracteres.'],
  ['row-level security', 'Seu perfil não tem permissão para esta ação.'],
  ['duplicate key value', 'Já existe um registro com este valor.'],
  ['Link inválido ou expirado', 'Link inválido ou expirado.'],
  ['já foi respondida', 'Esta cotação já foi respondida.'],
];

export function traduzErro(erro) {
  const msg = typeof erro === 'string' ? erro : (erro && erro.message) || String(erro);
  for (const [en, pt] of TRADUCOES) {
    if (msg.toLowerCase().includes(en.toLowerCase())) return pt;
  }
  return msg;
}

export const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
export const emailDoLogin = (doc) => `${soDigitos(doc)}@${LOGIN_DOMAIN}`;

export async function entrar(documentoOuEmail, senha) {
  const entrada = String(documentoOuEmail ?? '').trim();
  // Aceita CPF/CNPJ (vira <digitos>@dominio) ou um e-mail completo.
  const email = entrada.includes('@') ? entrada.toLowerCase() : emailDoLogin(entrada);
  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password: senha,
  });
  if (error) throw new Error(traduzErro(error));
  return data.user;
}

export async function sair() {
  await sb.auth.signOut();
}

export async function sessao() {
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

export async function perfilAtual() {
  const s = await sessao();
  if (!s) return null;
  const { data, error } = await sb
    .from('usuarios')
    .select('*')
    .eq('auth_user_id', s.user.id)
    .maybeSingle();
  if (error) throw new Error(traduzErro(error));
  return data;
}

export async function listar(tabela, opcoes = {}) {
  let q = sb.from(tabela).select(opcoes.select || '*');
  for (const [campo, valor] of Object.entries(opcoes.eq || {})) {
    q = q.eq(campo, valor);
  }
  if (opcoes.ordem) q = q.order(opcoes.ordem, { ascending: opcoes.asc !== false });
  if (opcoes.limite) q = q.limit(opcoes.limite);
  const { data, error } = await q;
  if (error) throw new Error(traduzErro(error));
  return data || [];
}

export async function buscar(tabela, id) {
  const { data, error } = await sb.from(tabela).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(traduzErro(error));
  return data;
}

export async function criar(tabela, dados) {
  const { data, error } = await sb.from(tabela).insert(dados).select();
  if (error) throw new Error(traduzErro(error));
  return Array.isArray(data) ? data[0] : data;
}

export async function atualizar(tabela, id, dados) {
  const { data, error } = await sb.from(tabela).update(dados).eq('id', id).select();
  if (error) throw new Error(traduzErro(error));
  return Array.isArray(data) ? data[0] : data;
}

export async function excluir(tabela, id) {
  const { error } = await sb.from(tabela).delete().eq('id', id);
  if (error) throw new Error(traduzErro(error));
}

// Exclui vários registros por filtro (ex.: todos os vínculos de um fornecedor).
export async function excluirOnde(tabela, filtro) {
  let q = sb.from(tabela).delete();
  for (const [campo, valor] of Object.entries(filtro)) q = q.eq(campo, valor);
  const { error } = await q;
  if (error) throw new Error(traduzErro(error));
}

export async function rpc(nome, args = {}) {
  const { data, error } = await sb.rpc(nome, args);
  if (error) throw new Error(traduzErro(error));
  return data;
}

// Cria um usuário de login sem derrubar a sessão do administrador logado.
// Usa um cliente separado, sem persistência.
let _clienteCadastro = null;
export function clienteCadastro() {
  if (!_clienteCadastro) {
    _clienteCadastro = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'cadastro-temp' },
    });
  }
  return _clienteCadastro;
}

export async function criarLogin(documento, senha) {
  const cli = clienteCadastro();
  const { data, error } = await cli.auth.signUp({
    email: emailDoLogin(documento),
    password: senha,
  });
  if (error) throw new Error(traduzErro(error));
  if (!data.user) throw new Error('O Supabase não retornou o usuário criado.');
  try { await cli.auth.signOut(); } catch (_) { /* ignora */ }
  return data.user;
}
