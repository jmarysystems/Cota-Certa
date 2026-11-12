-- =====================================================================
-- Correção: permitir promover o PRIMEIRO Administrador do Sistema
--
-- A versão anterior recusava qualquer promoção para 'admin_sistema', o que
-- impedia a criação do primeiro. A unicidade já é garantida pelo índice
-- usuarios_um_admin_sistema; aqui só bloqueamos quando já existe outro.
-- =====================================================================
begin;

create or replace function public.fn_protege_admin_sistema()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.tipo = 'admin_sistema' then
      raise exception 'O Administrador do Sistema não pode ser excluído.' using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.tipo = 'admin_sistema' and new.tipo <> 'admin_sistema' then
    raise exception 'O Administrador do Sistema não pode ter o perfil alterado.' using errcode = '42501';
  end if;

  if old.tipo <> 'admin_sistema' and new.tipo = 'admin_sistema' then
    if exists (select 1 from public.usuarios u
                where u.tipo = 'admin_sistema' and u.id <> new.id) then
      raise exception 'Já existe um Administrador do Sistema.' using errcode = '42501';
    end if;
  end if;

  return new;
end
$$;

commit;
