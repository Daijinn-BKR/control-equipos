-- Control de Equipos · Omega Eléctrica
-- APARTADO DE BOBINADO (solo personal de Omega)
--
-- Pegar completo en Supabase → SQL Editor → Run. Se ejecuta DESPUÉS de clientes.sql
-- (usa la función es_personal()). Se puede ejecutar más de una vez sin problema.
--
-- Los clientes NO ven ni pueden modificar nada de esta tabla; tampoco quien no ha iniciado sesión.

create table if not exists bobinados (
  id             text primary key default substr(md5(gen_random_uuid()::text), 1, 8),
  encargado      text,
  tipo_motor     text,
  volt           text,
  kw             numeric,
  rpm            numeric,
  fecha          date not null default current_date,
  cliente        text,
  creado_en      timestamptz not null default now(),
  creado_por     uuid default auth.uid() references auth.users(id) on delete set null,
  actualizado_en timestamptz not null default now()
);

drop trigger if exists bobinados_actualizado on bobinados;
create trigger bobinados_actualizado before update on bobinados
  for each row execute function marcar_actualizado();

alter table bobinados enable row level security;
drop policy if exists "bobinados_personal" on bobinados;
create policy "bobinados_personal" on bobinados
  for all to authenticated using (es_personal()) with check (es_personal());
revoke all on bobinados from anon;

-- Que Supabase reconozca la tabla nueva de inmediato.
notify pgrst, 'reload schema';
