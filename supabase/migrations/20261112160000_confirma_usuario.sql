-- =====================================================================
-- Confirmação de novos usuários sem depender da configuração de e-mail
--
-- O projeto está com "Confirm email" ligado no GoTrue, então um usuário
-- criado pelo app (signUp) nasce sem confirmação e não consegue entrar.
-- Esta função, restrita a administradores, marca o login como confirmado.
-- =====================================================================
begin;

create or replace function public.fn_confirmar_usuario(p_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
begin
  perform public.fn_exige_admin();

  update auth.users
     set email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = p_auth_user_id
   returning email into v_email;

  if not found then
    raise exception 'Usuário de login não encontrado.' using errcode = 'P0002';
  end if;

  update auth.identities
     set identity_data = jsonb_set(coalesce(identity_data, '{}'::jsonb),
                                   '{email_verified}', 'true')
   where user_id = p_auth_user_id;

  return jsonb_build_object('auth_user_id', p_auth_user_id,
                            'email', v_email, 'confirmado', true);
end
$$;

revoke execute on function public.fn_confirmar_usuario(uuid) from public;
grant execute on function public.fn_confirmar_usuario(uuid) to authenticated, service_role;

commit;
