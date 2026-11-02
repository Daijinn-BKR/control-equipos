-- Control de Equipos · Omega Eléctrica
-- Pegar completo en Supabase → SQL Editor → Run (se puede ejecutar más de una vez)

-- ============ TABLAS ============
create table if not exists equipos (
  id                 text primary key default substr(md5(gen_random_uuid()::text), 1, 8),
  cliente            text,
  tipo_motor         text,
  tipo_voltaje       text,
  tipo_mantenimiento text,
  encargados         text,
  -- Mediciones entre bornes
  t_u numeric, t_v numeric, t_w numeric,
  u_v numeric, u_w numeric, v_w numeric,
  u_x numeric, v_y numeric, w_z numeric,
  rodamientos        text,
  sello              text,
  reten              text,
  placa_bornera      text,
  proceso            text,
  notas              text,
  estado             text default 'Pendiente',
  creado_en          timestamptz not null default now(),
  creado_por         uuid default auth.uid() references auth.users(id) on delete set null,
  actualizado_en     timestamptz not null default now()
);

create table if not exists fotos_equipo (
  id         uuid primary key default gen_random_uuid(),
  equipo_id  text not null references equipos(id) on delete cascade,
  ruta       text not null unique,            -- ruta del archivo en Storage
  creado_en  timestamptz not null default now(),
  creado_por uuid default auth.uid() references auth.users(id) on delete set null
);
create index if not exists fotos_equipo_equipo_idx on fotos_equipo(equipo_id);

create table if not exists videos_equipo (
  id         uuid primary key default gen_random_uuid(),
  equipo_id  text not null references equipos(id) on delete cascade,
  ruta       text not null unique,
  creado_en  timestamptz not null default now(),
  creado_por uuid default auth.uid() references auth.users(id) on delete set null
);
create index if not exists videos_equipo_equipo_idx on videos_equipo(equipo_id);

-- Fecha de última modificación automática
create or replace function marcar_actualizado() returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists equipos_actualizado on equipos;
create trigger equipos_actualizado before update on equipos
  for each row execute function marcar_actualizado();

-- ============ SEGURIDAD ============
-- Solo usuarios con sesión iniciada pueden ver y modificar.
alter table equipos       enable row level security;
alter table fotos_equipo  enable row level security;
alter table videos_equipo enable row level security;

drop policy if exists "equipos_autenticados" on equipos;
create policy "equipos_autenticados" on equipos
  for all to authenticated using (true) with check (true);

drop policy if exists "fotos_autenticados" on fotos_equipo;
create policy "fotos_autenticados" on fotos_equipo
  for all to authenticated using (true) with check (true);

drop policy if exists "videos_autenticados" on videos_equipo;
create policy "videos_autenticados" on videos_equipo
  for all to authenticated using (true) with check (true);

-- ============ ARCHIVOS (fotos y videos) ============
-- Bucket privado; límite de 50 MB por archivo (máximo del plan gratis).
insert into storage.buckets (id, name, public, file_size_limit)
values ('equipos', 'equipos', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "equipos_archivos_leer" on storage.objects;
create policy "equipos_archivos_leer" on storage.objects
  for select to authenticated using (bucket_id = 'equipos');

drop policy if exists "equipos_archivos_subir" on storage.objects;
create policy "equipos_archivos_subir" on storage.objects
  for insert to authenticated with check (bucket_id = 'equipos');

drop policy if exists "equipos_archivos_cambiar" on storage.objects;
create policy "equipos_archivos_cambiar" on storage.objects
  for update to authenticated using (bucket_id = 'equipos');

drop policy if exists "equipos_archivos_borrar" on storage.objects;
create policy "equipos_archivos_borrar" on storage.objects
  for delete to authenticated using (bucket_id = 'equipos');

-- ============ TIEMPO REAL ============
-- Los cambios aparecen al instante en todos los dispositivos.
do $$ begin
  alter publication supabase_realtime add table equipos;
exception when duplicate_object then null; end $$;
