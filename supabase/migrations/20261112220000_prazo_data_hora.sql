-- =====================================================================
-- Prazo de resposta com data e hora + bloqueio automático
-- =====================================================================
begin;

-- A coluna era `date`; passa a guardar o instante limite.
alter table public.cotacoes
  alter column prazo_resposta type timestamptz
  using ((prazo_resposta::timestamp + time '23:59:59') at time zone 'America/Sao_Paulo');

comment on column public.cotacoes.prazo_resposta is
  'Data e hora limite para o fornecedor responder (fuso de referência: America/Sao_Paulo)';

-- ---------------------------------------------------------------------
-- Link público: informa se o prazo já encerrou
-- ---------------------------------------------------------------------
create or replace function public.fn_cotacao_publica(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_out jsonb;
begin
  select jsonb_build_object(
           'cotacao', jsonb_build_object(
               'id', c.id, 'codigo', c.codigo, 'titulo', c.titulo,
               'observacao', c.observacao, 'status', c.status,
               'prazo_resposta', c.prazo_resposta,
               'prazo_encerrado', (c.prazo_resposta is not null and now() > c.prazo_resposta)),
           'fornecedor', jsonb_build_object(
               'id', f.id, 'nome', f.razao_social, 'contato', f.contato_nome,
               'email', f.email, 'whatsapp', f.whatsapp),
           'itens', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'cotacao_item_id', i.id, 'ordem', i.ordem, 'sku', i.sku,
                        'descricao', i.descricao, 'quantidade', i.quantidade,
                        'unidade', i.unidade) order by i.ordem)
                 from public.cotacao_itens i where i.cotacao_id = c.id), '[]'::jsonb),
           'ja_respondido', (e.status = 'respondido')
         )
    into v_out
    from public.cotacao_envios e
    join public.cotacoes c on c.id = e.cotacao_id
    left join public.fornecedores f on f.id = e.fornecedor_id
   where e.token = p_token;

  if v_out is null then
    raise exception 'Link inválido ou expirado.' using errcode = 'P0002';
  end if;

  update public.cotacao_envios
     set status = 'lido'
   where token = p_token and status = 'enviado';

  return v_out;
end
$$;

-- ---------------------------------------------------------------------
-- Resposta: recusa depois do prazo
-- ---------------------------------------------------------------------
create or replace function public.fn_responder_cotacao(
  p_token uuid,
  p_empresa text,
  p_itens jsonb,
  p_prazo_entrega text default null,
  p_pagamento text default null,
  p_validade text default null,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_envio record;
  v_prazo timestamptz;
  v_resposta_id uuid;
  v_total numeric := 0;
  v_itens int := 0;
begin
  select * into v_envio from public.cotacao_envios where token = p_token;
  if not found then
    raise exception 'Link inválido ou expirado.' using errcode = 'P0002';
  end if;
  if v_envio.status = 'respondido' then
    raise exception 'Esta cotação já foi respondida.' using errcode = 'P0001';
  end if;

  select c.prazo_resposta into v_prazo
    from public.cotacoes c
   where c.id = v_envio.cotacao_id;

  if v_prazo is not null and now() > v_prazo then
    raise exception 'O prazo para responder esta cotação encerrou em %.',
      to_char(v_prazo at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
      using errcode = 'P0001';
  end if;

  insert into public.cotacao_respostas
    (cotacao_id, fornecedor_id, empresa, prazo_entrega, pagamento, validade, observacao, total, itens)
  values
    (v_envio.cotacao_id, v_envio.fornecedor_id, coalesce(p_empresa, ''), p_prazo_entrega,
     p_pagamento, p_validade, p_observacao, 0, coalesce(p_itens, '[]'::jsonb))
  returning id into v_resposta_id;

  insert into public.cotacao_respostas_itens
    (resposta_id, cotacao_item_id, sku, descricao, quantidade, unidade,
     valor_unitario, disponivel, observacao)
  select v_resposta_id,
         (e->>'cotacao_item_id')::uuid,
         e->>'sku',
         coalesce(e->>'descricao', ''),
         coalesce((e->>'quantidade')::numeric, 0),
         coalesce(nullif(e->>'unidade', ''), 'un'),
         (e->>'valor_unitario')::numeric,
         coalesce((e->>'disponivel')::boolean, true),
         e->>'observacao'
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e;

  get diagnostics v_itens = row_count;

  select coalesce(sum(valor_total), 0) into v_total
    from public.cotacao_respostas_itens where resposta_id = v_resposta_id;

  update public.cotacao_respostas set total = v_total where id = v_resposta_id;

  update public.cotacao_envios
     set status = 'respondido', respondido_em = now()
   where id = v_envio.id;

  update public.cotacoes
     set status = 'em_analise', atualizado_em = now()
   where id = v_envio.cotacao_id and status in ('finalizada', 'enviada');

  return jsonb_build_object('resposta_id', v_resposta_id, 'total', v_total, 'itens', v_itens);
end
$$;

commit;
