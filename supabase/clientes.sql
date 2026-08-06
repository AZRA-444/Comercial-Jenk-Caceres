-- ============================================================
-- DIRECTORIO DE CLIENTES (tabla `clientes`)
-- ============================================================
-- Qué resuelve: hasta ahora los datos de cada cliente (nombre,
-- apellido, cédula, teléfono) solo vivían repetidos dentro de cada
-- factura. Esta tabla centraliza un registro por cédula para poder
-- autorrellenar Facturación y Pedidos con solo escribir la cédula
-- (ver js/clientes.js).
--
-- Cómo ejecutar: pegar TODO este archivo en Supabase → SQL Editor →
-- New query → Run. Es seguro volver a ejecutarlo (usa "if not
-- exists" / "on conflict do nothing"), no duplica datos ni borra
-- clientes ya guardados.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabla
-- ------------------------------------------------------------
create table if not exists public.clientes (
  id          uuid primary key default gen_random_uuid(),
  cedula      text not null unique,   -- normalizada: solo dígitos, sin puntos ni "V-"
  nombre      text not null,
  apellido    text not null default '',
  telefono    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_clientes_cedula on public.clientes (cedula);

-- Mantiene updated_at al día en cada UPDATE (por ejemplo, cuando
-- guardarClienteSiNuevo() actualiza el teléfono de un cliente ya
-- existente tras una nueva venta).
create or replace function public.clientes_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_clientes_updated_at on public.clientes;
create trigger trg_clientes_updated_at
before update on public.clientes
for each row execute function public.clientes_set_updated_at();

-- ------------------------------------------------------------
-- 2. Seguridad (RLS)
-- ------------------------------------------------------------
-- Mismo criterio que el resto del sistema (ver SECURITY.md): solo
-- personal con sesión iniciada (rol "authenticated" del JWT) puede
-- leer o escribir en el directorio de clientes.
alter table public.clientes enable row level security;

drop policy if exists "clientes_select_auth" on public.clientes;
create policy "clientes_select_auth"
  on public.clientes for select
  to authenticated
  using (true);

drop policy if exists "clientes_insert_auth" on public.clientes;
create policy "clientes_insert_auth"
  on public.clientes for insert
  to authenticated
  with check (true);

drop policy if exists "clientes_update_auth" on public.clientes;
create policy "clientes_update_auth"
  on public.clientes for update
  to authenticated
  using (true)
  with check (true);

-- ------------------------------------------------------------
-- 3. Migración inicial: precargar clientes desde facturas ya
--    existentes (definitivas y las que sigan pendientes en
--    Verificación al momento de ejecutar este script).
-- ------------------------------------------------------------
-- Por cada cédula se conserva el dato más reciente (por fecha de
-- creación de la factura). "on conflict do nothing" hace que se
-- pueda reejecutar sin duplicar ni pisar clientes ya cargados.
insert into public.clientes (cedula, nombre, apellido, telefono, created_at, updated_at)
select
  datos.cedula_normalizada,
  datos.nombre,
  datos.apellido,
  datos.telefono,
  now(),
  now()
from (
  select distinct on (regexp_replace(f.cedula, '\D', '', 'g'))
    regexp_replace(f.cedula, '\D', '', 'g') as cedula_normalizada,
    f.nombre,
    f.apellido,
    f.telefono,
    f.created_at
  from (
    select cedula, nombre, apellido, telefono, created_at from public.facturas
    union all
    select cedula, nombre, apellido, telefono, created_at from public.facturas_temporales
  ) f
  where f.cedula is not null
    and length(regexp_replace(f.cedula, '\D', '', 'g')) >= 6
    and coalesce(nullif(trim(f.nombre), ''), '') <> ''
  order by regexp_replace(f.cedula, '\D', '', 'g'), f.created_at desc
) datos
on conflict (cedula) do nothing;

-- ------------------------------------------------------------
-- 4. Verificación rápida (opcional, solo lectura)
-- ------------------------------------------------------------
-- select count(*) as total_clientes_migrados from public.clientes;
