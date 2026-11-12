// Configuração pública do projeto Supabase.
// A chave abaixo é a chave publicável (equivalente à anon key): pode ficar no
// front-end. Toda a proteção real vem do RLS no banco.
export const SUPABASE_URL = 'https://cowbpaaaguylhlvnlaac.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_8IV6XloDeBJEn8UfAe5Tfg_nuGkZ7n5';

// Login por CPF/CNPJ: o Supabase Auth exige e-mail, então o documento vira
// "<digitos>@cotacao.app". O domínio precisa ter formato de e-mail válido
// (o GoTrue rejeita .local/.test/.invalid), mas não recebe mensagem nenhuma
// quando "Confirm email" está desligado no painel. Troque pelo seu domínio
// quando tiver um.
export const LOGIN_DOMAIN = 'cotacao.app';

export const NOME_SISTEMA = 'Cotação';
