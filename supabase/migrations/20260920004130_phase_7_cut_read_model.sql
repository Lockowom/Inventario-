-- The Phase 6 RPC keeps its established PostgreSQL composite return type.
-- Phase 7 metadata is exposed through an additive versioned read model instead.
create function public.list_inventory_cuts_v2(
  p_inventory_id uuid,
  p_limit integer default 50,
  p_before_cut_number integer default null
)
returns table(
  id uuid,
  cut_number integer,
  status public.cut_status,
  created_at timestamptz,
  created_by uuid,
  record_count integer,
  first_export_seq bigint,
  last_export_seq bigint,
  request_id uuid,
  file_name text,
  file_hash text,
  generator_version text,
  generation_error text,
  size_bytes bigint
)
language plpgsql stable security definer
set search_path = public, app_private, pg_temp
as $$
begin
  perform app_private.require_active_actor();
  if not app_private.can_manage_inventory(p_inventory_id) then
    raise exception 'Not authorized to list cuts' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'Limit must be between 1 and 100' using errcode = '23514';
  end if;

  return query
    select c.id, c.cut_number, c.status, c.created_at, c.created_by,
      c.record_count, c.first_export_seq, c.last_export_seq, c.request_id,
      c.file_name, c.file_hash, c.generator_version, c.generation_error,
      f.size_bytes
    from public.inventory_cuts c
    left join public.generated_files f
      on f.cut_id = c.id and f.file_type = 'CUT_XLSX'
    where c.inventory_id = p_inventory_id
      and (p_before_cut_number is null or c.cut_number < p_before_cut_number)
    order by c.cut_number desc
    limit p_limit;
end;
$$;

revoke all on function public.list_inventory_cuts_v2(uuid, integer, integer) from public, anon;
grant execute on function public.list_inventory_cuts_v2(uuid, integer, integer) to authenticated;
