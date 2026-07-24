# Seguridad — Acción pendiente importante (no se puede resolver solo con código)

## Lo que se corrigió en esta pasada
- Se agregó un login (Supabase Auth) delante de `administrador.html` e
  `historial.html`, para que ya no sean accesibles con solo conocer la URL.
- Se eliminó el XSS almacenado: todos los campos que vienen de la base de
  datos (nombre, apellido, vendedor, referencia, banco, nombre de producto,
  etc.) ahora se escapan antes de insertarse en el HTML.

## Lo que sigue pendiente y por qué es importante
El sistema usa la **clave "anon" de Supabase** directamente desde el
navegador (en `js/supabase-config.js`) para leer y escribir en las tablas
`facturas`, `factura_detalles`, `comisiones_pagos` y `comisiones_config`.

Esa clave es pública por diseño — cualquiera puede verla abriendo el código
fuente de cualquiera de estas páginas —, y eso **solo es seguro si Supabase
tiene Row Level Security (RLS) activado con políticas que restrinjan lo que
el rol `anon` puede hacer**.

Si RLS no está activo (o está activo pero permite todo al rol `anon`), el
login que se agregó en esta pasada **no es suficiente**: cualquiera podría
seguir consultando o modificando facturas, cédulas, teléfonos y comisiones
llamando directamente a la API REST de Supabase con esa clave, sin pasar
nunca por `administrador.html`. El login mejora la experiencia y evita el
acceso casual, pero no reemplaza una política de acceso a nivel de base de
datos.

## Qué revisar / hacer en Supabase (fuera del alcance de este repositorio)
1. **Activar RLS** en `facturas`, `factura_detalles`, `comisiones_pagos` y
   `comisiones_config` (Supabase → Table Editor → ⋮ → Enable RLS).
2. Crear políticas que:
   - Permitan `INSERT` al rol `anon` únicamente a través de la función RPC
     `guardar_factura_completa` que ya usa el backend (que corre con la
     clave *service role*, no la anon), y no directamente sobre la tabla.
   - Nieguen `SELECT`/`UPDATE`/`DELETE` al rol `anon` sobre estas tablas.
   - Permitan `SELECT`/`UPDATE` solo al rol `authenticated` (es decir, a
     quien haya iniciado sesión con Supabase Auth, como ahora exige el
     panel de administración).
3. Crear en Supabase Auth el o los usuarios que podrán entrar al panel
   (Authentication → Users → Add user), con su correo y contraseña.
4. Si se agrega el campo `observaciones` (ver `CAMBIOS.md`), actualizar la
   función `guardar_factura_completa` para que lo reciba y lo guarde, y
   agregar la columna `observaciones` a la tabla `facturas` si no existe.

Sin el paso 1 y 2, este sistema seguirá exponiendo datos de clientes
(cédulas, teléfonos, historial de compras) a cualquiera que inspeccione el
código fuente del sitio, sin importar cuántos logins se agreguen en el
frontend.
