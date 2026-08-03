# Seguridad del sistema — Comercial Jenk Cáceres

Este documento explica cómo funciona el control de acceso de la aplicación y,
sobre todo, qué debes configurar **en Supabase** para que sea real y no solo
una puerta de entrada bonita.

## 1. Dos capas distintas (no confundirlas)

1. **Login en el navegador** (`login.html` + `js/auth-guard.js`)
   Exige un correo/contraseña válido (Supabase Auth) para poder *ver* las
   páginas del sistema (portada, facturación, pedidos, verificación,
   historial, reportes, administrador). Esto evita que alguien que no
   trabaja en el negocio entre por curiosidad o adivine la URL.

2. **Row Level Security — RLS** (se configura en el panel de Supabase, no en
   este repositorio)
   Es el control **real**. La `anon key` que ves en `js/supabase-config.js`
   está pensada para ser pública — viaja al navegador de cualquier
   visitante, la vea o no la página de login. Si un desconocido abre las
   herramientas de desarrollador, copia esa clave y hace sus propias
   peticiones directas a la API de Supabase (`https://<tu-proyecto>.supabase.co/rest/v1/...`),
   **el login del paso 1 no lo detiene en absoluto**. Solo RLS puede
   bloquear eso, tabla por tabla.

**Conclusión:** el login que se agregó mejora el acceso desde el navegador,
pero si RLS no está activo en Supabase, los datos (facturas, cédulas,
teléfonos, comisiones) siguen expuestos a quien tenga la anon key.

## 2. Qué revisar/activar en Supabase (pendiente, fuera de este repo)

En el panel de Supabase → **Authentication → Providers**:
- Desactiva el **registro público** (self sign-up), si está disponible para
  tu plan. Los usuarios del panel deben crearse a mano desde
  **Authentication → Users → Add user**, no desde `login.html` (esta página
  intencionalmente no tiene un formulario de registro).

En **Table Editor / Database → tu tabla → RLS**, para cada tabla sensible
(`facturas`, `factura_detalles`, `facturas_temporales`,
`detalles_factura_temporal`, `comisiones_config`, `comisiones_historial`,
`comisiones_pagos`):
- Activa **Enable RLS**.
- Agrega una política que solo permita acceso a usuarios autenticados, por
  ejemplo:
  ```sql
  create policy "Solo usuarios autenticados"
  on public.facturas
  for select using (auth.role() = 'authenticated');
  ```
  Repite (con `for select`, `for insert`, `for update`, `for delete` según
  corresponda) para cada tabla y cada operación que el frontend necesite.

En **Storage → bucket `comprobantes` → Policies**:
- **Cambio importante respecto a versiones anteriores:** el flujo que
  permitía a un cliente final subir su comprobante sin sesión (vía un
  código QR, desde `subir-comprobante.html`) fue eliminado del sistema.
  Ya no existe ninguna pantalla que necesite escribir en este bucket sin
  autenticación.
- En consecuencia, ya puedes restringir este bucket a **solo usuarios
  autenticados** (tanto lectura como escritura), sin excepciones para el
  rol `anon`. Si en tu proyecto de Supabase quedó una política antigua
  que permitía `INSERT` público en la ruta `qr/*`, revísala y elimínala —
  ya no cumple ninguna función y solo amplía la superficie de riesgo.
- Este bucket hoy solo se usa en modo lectura, desde el Panel de
  administración, para mostrar comprobantes de facturas antiguas que ya
  los tenían guardados de antes del cambio.

## 3. Las funciones serverless (`api/*.py`) ya están bien encaminadas

Usan `SUPABASE_SECRET_KEY` (clave de servicio), configurada como variable de
entorno en Vercel — nunca debe copiarse al frontend. Verifica en el panel de
Vercel (**Project → Settings → Environment Variables**) que `SUPABASE_URL` y
`SUPABASE_SECRET_KEY` estén definidas solo ahí. (`FRONTEND_DOMAIN` también
aparece declarada en el código con un valor por defecto, pero no se usa
actualmente para nada sensible.)

## 4. Páginas protegidas vs. públicas

| Página | Requiere sesión |
|---|---|
| `index.html` | Sí |
| `assets/pages/facturacion.html` | Sí |
| `assets/pages/pedidos.html` | Sí |
| `assets/pages/verificacion.html` | Sí |
| `assets/pages/historial.html` | Sí |
| `assets/pages/reportes.html` | Sí |
| `assets/pages/administrador.html` | Sí |
| `assets/pages/login.html` | No (es la puerta de entrada) |

## 5. Roles: admin vs. personal

Además del login, el sistema distingue dos roles guardados en la tabla
`public.perfiles` (una fila por usuario, ver `supabase/perfiles.sql`):

- **`admin`** → puede ver `administrador.html` y `reportes.html`.
- **`personal`** (por defecto) → todo lo demás (facturación, pedidos,
  verificación, historial), pero NO esas dos páginas; si intenta abrir
  la URL directamente, `js/auth-guard.js` lo redirige a la portada con
  un aviso, y las tarjetas correspondientes se ocultan solas en
  `index.html` (atributo `data-admin-only`).

**Esto sigue siendo control del lado del navegador.** La fila de
`perfiles` tiene RLS activado (solo cada usuario puede leer su propio
rol), pero eso NO limita por sí solo lo que se puede leer/escribir en
`facturas`, `comisiones_*`, etc. Si quieres que esas tablas también
respeten el rol (por ejemplo, que solo un admin pueda leer
`comisiones_historial` aunque alguien use la anon key directamente),
agrega políticas RLS que consulten `perfiles`, por ejemplo:

```sql
create policy "Solo admin lee comisiones"
on public.comisiones_historial
for select
using (
  exists (
    select 1 from public.perfiles
    where perfiles.id = auth.uid() and perfiles.rol = 'admin'
  )
);
```

Para asignar o cambiar el rol de alguien: Supabase → **Table Editor →
perfiles**, columna `rol` (`admin` o `personal`). Los roles nunca se
asignan desde el navegador, a propósito.

## 6. Cómo crear el primer usuario

Ve a Supabase → **Authentication → Users → Add user**, crea el correo y
contraseña del personal que administrará el sistema, y compártelos por un
canal seguro (no por chat abierto). No hay formulario de auto-registro por
diseño.
