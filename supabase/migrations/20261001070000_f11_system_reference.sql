-- F11 versioned system-reference snapshot. This is evidence, not an inventory adjustment.
create table public.inventory_system_reference_items(
 id uuid primary key default gen_random_uuid(),
 inventory_id uuid not null references public.inventories(id) on delete restrict,
 codigo text not null,
 reference_type public.master_control_type not null,
 reference_value text,
 quantity integer not null check(quantity>=0),
 created_at timestamptz not null default now(),
 unique(inventory_id,codigo,reference_type,reference_value),
 foreign key(inventory_id,codigo) references public.inventory_master_items(inventory_id,codigo) on delete restrict,
 check((reference_type='SERIAL' and reference_value is not null and quantity in (0,1)) or (reference_type='PARTIDA' and reference_value is not null) or reference_type='LEGACY')
);
create table public.inventory_system_reference_metadata(
 inventory_id uuid primary key references public.inventories(id) on delete restrict,
 reference_version integer not null check(reference_version>0),
 row_count integer not null check(row_count>0),
 source text not null check(length(btrim(source))>0),
 import_identifier text,
 fingerprint text not null check(fingerprint~'^[A-Fa-f0-9]{64}$'),
 imported_by uuid not null references public.profiles(user_id) on delete restrict,
 imported_at timestamptz not null default now()
);
alter table public.inventory_system_reference_items enable row level security;
alter table public.inventory_system_reference_metadata enable row level security;
create policy system_reference_items_manager_read on public.inventory_system_reference_items for select to authenticated using(app_private.can_manage_inventory(inventory_id));
create policy system_reference_metadata_manager_read on public.inventory_system_reference_metadata for select to authenticated using(app_private.can_manage_inventory(inventory_id));
revoke insert,update,delete on public.inventory_system_reference_items,public.inventory_system_reference_metadata from authenticated;
grant select on public.inventory_system_reference_items,public.inventory_system_reference_metadata to authenticated;

create function app_private.system_reference_fingerprint(p_inventory_id uuid) returns text language sql stable security definer set search_path=public,pg_temp as $$
 select encode(extensions.digest(coalesce((select string_agg(codigo||E'\x1f'||reference_type::text||E'\x1f'||coalesce(reference_value,'')||E'\x1f'||quantity::text,E'\x1e' order by codigo,reference_type,reference_value nulls first) from public.inventory_system_reference_items where inventory_id=p_inventory_id),''),'sha256'),'hex')
$$;
revoke all on function app_private.system_reference_fingerprint(uuid) from public,anon,authenticated;

create function public.import_inventory_system_reference(p_inventory_id uuid,p_items jsonb,p_source text,p_import_identifier text default null)
returns table(reference_version integer,row_count integer,fingerprint text)
language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare actor uuid:=app_private.require_active_actor(); src text:=nullif(btrim(p_source),'');
begin
 if not app_private.can_manage_inventory(p_inventory_id) then raise exception 'Not authorized to import system reference' using errcode='42501'; end if;
 if src is null then raise exception 'System reference source is required' using errcode='23514'; end if;
 if not exists(select 1 from public.inventories where id=p_inventory_id and status in('BORRADOR','PREPARADO')) then raise exception 'System reference import is only allowed in BORRADOR or PREPARADO' using errcode='23514'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'System reference requires at least one row' using errcode='23514'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where nullif(upper(btrim(x->>'codigo')),'') is null or (x->>'quantity') is null or (x->>'quantity')::integer<0) then raise exception 'Invalid system reference row' using errcode='23514'; end if;
 delete from public.inventory_system_reference_items where inventory_id=p_inventory_id;
 insert into public.inventory_system_reference_items(inventory_id,codigo,reference_type,reference_value,quantity)
 select p_inventory_id,upper(btrim(x->>'codigo')),m.control_type,nullif(btrim(x->>'reference_value'),''),(x->>'quantity')::integer
 from jsonb_array_elements(p_items) x join public.inventory_master_items m on m.inventory_id=p_inventory_id and m.codigo=upper(btrim(x->>'codigo'));
 if (select count(*) from public.inventory_system_reference_items where inventory_id=p_inventory_id)<>jsonb_array_length(p_items) then raise exception 'Every system reference row must match the inventory master and be unique' using errcode='23514'; end if;
 if exists(select 1 from public.inventory_system_reference_items where inventory_id=p_inventory_id and ((reference_type='SERIAL' and (reference_value is null or quantity not in(0,1))) or (reference_type='PARTIDA' and reference_value is null))) then raise exception 'System reference control fields do not match master type' using errcode='23514'; end if;
 insert into public.inventory_system_reference_metadata(inventory_id,reference_version,row_count,source,import_identifier,fingerprint,imported_by)
 values(p_inventory_id,1,jsonb_array_length(p_items),src,nullif(btrim(p_import_identifier),''),app_private.system_reference_fingerprint(p_inventory_id),actor)
 on conflict(inventory_id) do update set reference_version=public.inventory_system_reference_metadata.reference_version+1,row_count=excluded.row_count,source=excluded.source,import_identifier=excluded.import_identifier,fingerprint=excluded.fingerprint,imported_by=excluded.imported_by,imported_at=now()
 returning inventory_system_reference_metadata.reference_version,inventory_system_reference_metadata.row_count,inventory_system_reference_metadata.fingerprint into reference_version,row_count,fingerprint;
 insert into public.audit_events(inventory_id,actor_user_id,event_type,entity_type,entity_id,payload)
 values(p_inventory_id,actor,'MASTER_IMPORTED','inventory_system_reference',p_inventory_id,jsonb_build_object('reference_version',reference_version,'row_count',row_count,'source',src,'import_identifier',nullif(btrim(p_import_identifier),''),'fingerprint',fingerprint));
 return next;
end $$;
revoke all on function public.import_inventory_system_reference(uuid,jsonb,text,text) from public,anon;
grant execute on function public.import_inventory_system_reference(uuid,jsonb,text,text) to authenticated;
