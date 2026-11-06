-- Control de Equipos · Omega Eléctrica
-- ALTA DE UNA CUENTA DE CLIENTE (alternativa por SQL)
--
-- Normalmente no hace falta: en la app, pantalla "Cuentas de clientes", se asigna con un clic.
--
-- 1) Supabase → Authentication → Users → Add user → correo y contraseña del cliente
--    (marcar "Auto confirm user").
-- 2) Cambia los dos valores de abajo y ejecuta esto en SQL Editor → Run.
--
-- El nombre del cliente debe ser el mismo que se escribe en el campo "Cliente" de los
-- equipos (no importan mayúsculas ni espacios de más, pero sí las letras y tildes).

insert into perfiles (user_id, rol, cliente)
select id, 'cliente', 'Condominio X'            -- ← nombre del cliente
from auth.users
where email = 'correo@del-cliente.cl'           -- ← correo con el que creaste el usuario
on conflict (user_id) do update set rol = 'cliente', cliente = excluded.cliente;

-- Comprobar: debe mostrar una fila con el correo y el cliente.
select u.email, p.rol, p.cliente
from perfiles p join auth.users u on u.id = p.user_id
order by p.rol, u.email;

-- ------------------------------------------------------------------------------
-- Para dar acceso completo a una persona nueva de Omega (personal), en vez de cliente:
--
-- insert into perfiles (user_id, rol)
-- select id, 'personal' from auth.users where email = 'correo@omega.cl'
-- on conflict (user_id) do update set rol = 'personal', cliente = null;
--
-- Para quitarle el acceso a un cliente (sin borrar el usuario):
--
-- delete from perfiles where user_id = (select id from auth.users where email = 'correo@del-cliente.cl');
-- ------------------------------------------------------------------------------
