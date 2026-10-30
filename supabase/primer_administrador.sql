-- =====================================================================
-- Crear el PRIMER administrador general (solo una vez).
-- 1. En Supabase: Authentication → Users → "Add user" → "Send invitation"
--    con el correo de Mauro. (Los demás usuarios se invitan desde la app.)
-- 2. Cambia el correo abajo y ejecuta este script en SQL Editor.
-- =====================================================================
insert into public.perfiles (id, nombre, correo, rol, ve_todo)
select id, 'Mauro', email, 'admin', true
from auth.users
where email = 'contacto@safebsomigration.com'   -- ← correo del administrador
on conflict (id) do update set rol = 'admin', ve_todo = true, activo = true;
