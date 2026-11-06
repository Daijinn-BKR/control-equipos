-- Control de Equipos · Omega Eléctrica
-- CUENTAS DE CLIENTE (solo lectura, cada cliente ve únicamente sus equipos)
--
-- Pegar completo en Supabase → SQL Editor → Run. Se ejecuta DESPUÉS de schema.sql.
-- Se puede ejecutar más de una vez sin problema.
--
-- IMPORTANTE: ejecútalo ANTES de crear usuarios de clientes. La primera vez, todos
-- los usuarios que ya existen quedan como "personal" (acceso completo, como hasta ahora).
-- Desde ese momento, un usuario sin perfil NO ve nada (más seguro que lo contrario).

-- ============ PERFILES ============
-- rol 'personal' = trabaja en Omega (ve y modifica todo)
-- rol 'cliente'  = solo ve los equipos cuyo campo "cliente" coincide con perfiles.cliente
create table if not exists perfiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  rol        text not null check (rol in ('personal', 'cliente')),
  cliente    text,
  creado_en  timestamptz not null default now(),
  constraint cliente_requerido check (rol <> 'cliente' or nullif(btrim(cliente), '') is not null)
);
alter table perfiles enable row level security;

-- Cada usuario puede leer solo su propio perfil. Nadie puede crear ni cambiar perfiles
-- desde la app: se hacen desde el SQL Editor (ver alta-cliente.sql).
drop policy if exists "perfil_propio" on perfiles;
create policy "perfil_propio" on perfiles
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on perfiles from anon, authenticated;

-- Existentes: la primera vez, todos los usuarios actuales pasan a "personal".
do $$ begin
  if not exists (select 1 from perfiles) then
    insert into perfiles (user_id, rol) select id, 'personal' from auth.users;
  end if;
end $$;

-- ============ FUNCIONES AUXILIARES ============
-- Comparan nombres sin importar mayúsculas ni espacios de más ("Condominio  X" = "condominio x").
create or replace function norm_cliente(t text) returns text
language sql immutable as $$
  select lower(btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g')))
$$;

create or replace function es_personal() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where user_id = auth.uid() and rol = 'personal')
$$;

-- Nombre (normalizado) del cliente del usuario actual; null si no es cliente.
create or replace function cliente_actual() returns text
language sql stable security definer set search_path = public as $$
  select norm_cliente(cliente) from perfiles where user_id = auth.uid() and rol = 'cliente'
$$;

-- ¿El equipo pertenece al cliente del usuario actual?
create or replace function equipo_visible(eid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from equipos e
    where e.id = eid
      and cliente_actual() is not null
      and norm_cliente(e.cliente) = cliente_actual()
  )
$$;

revoke execute on function es_personal(), cliente_actual(), equipo_visible(text) from public, anon;
grant  execute on function es_personal(), cliente_actual(), equipo_visible(text) to authenticated;

-- ============ POLÍTICAS: personal modifica todo, cliente solo mira lo suyo ============
drop policy if exists "equipos_autenticados" on equipos;
drop policy if exists "equipos_personal" on equipos;
create policy "equipos_personal" on equipos
  for all to authenticated using (es_personal()) with check (es_personal());
drop policy if exists "equipos_cliente_ver" on equipos;
create policy "equipos_cliente_ver" on equipos
  for select to authenticated
  using (cliente_actual() is not null and norm_cliente(cliente) = cliente_actual());

drop policy if exists "fotos_autenticados" on fotos_equipo;
drop policy if exists "fotos_personal" on fotos_equipo;
create policy "fotos_personal" on fotos_equipo
  for all to authenticated using (es_personal()) with check (es_personal());
drop policy if exists "fotos_cliente_ver" on fotos_equipo;
create policy "fotos_cliente_ver" on fotos_equipo
  for select to authenticated using (equipo_visible(equipo_id));

drop policy if exists "videos_autenticados" on videos_equipo;
drop policy if exists "videos_personal" on videos_equipo;
create policy "videos_personal" on videos_equipo
  for all to authenticated using (es_personal()) with check (es_personal());
drop policy if exists "videos_cliente_ver" on videos_equipo;
create policy "videos_cliente_ver" on videos_equipo
  for select to authenticated using (equipo_visible(equipo_id));

-- ============ ARCHIVOS (fotos y videos) ============
-- Los archivos se guardan como "<id del equipo>/<archivo>": el cliente solo puede ver
-- los de sus equipos; subir, cambiar y borrar es solo del personal.
drop policy if exists "equipos_archivos_leer" on storage.objects;
create policy "equipos_archivos_leer" on storage.objects
  for select to authenticated
  using (bucket_id = 'equipos' and (es_personal() or equipo_visible((storage.foldername(name))[1])));

drop policy if exists "equipos_archivos_subir" on storage.objects;
create policy "equipos_archivos_subir" on storage.objects
  for insert to authenticated with check (bucket_id = 'equipos' and es_personal());

drop policy if exists "equipos_archivos_cambiar" on storage.objects;
create policy "equipos_archivos_cambiar" on storage.objects
  for update to authenticated using (bucket_id = 'equipos' and es_personal());

drop policy if exists "equipos_archivos_borrar" on storage.objects;
create policy "equipos_archivos_borrar" on storage.objects
  for delete to authenticated using (bucket_id = 'equipos' and es_personal());
