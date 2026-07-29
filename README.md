# Documentación del proyecto — Comercial Jenk Cáceres

Sistema web de gestión comercial (facturación, pedidos por WhatsApp, verificación de pagos, reportes y panel administrativo) para un negocio que opera en Venezuela (montos en USD y Bolívares).

## 1. Resumen ejecutivo

Es una aplicación web **sin framework de frontend** (HTML + CSS + JavaScript "vanilla"), desplegada en **Vercel**, con **Supabase** (Postgres + Auth + Storage) como base de datos y backend principal. Además, incluye tres **funciones serverless en Python** (Vercel Functions) que actúan como intermediarias entre el navegador y Supabase para las operaciones sensibles de guardado de facturas.

El sistema cubre el ciclo completo de una venta:

1. Se registra un pedido o una venta (por dos caminos distintos: **Pedidos** o **Facturación**).
2. La factura queda en estado **temporal**, pendiente de verificación de pago.
3. Un encargado la revisa y aprueba en el módulo de **Verificación**, adjuntando el comprobante.
4. La factura pasa a la tabla definitiva y aparece en **Historial**, **Reportes** y el **Panel de Administración** (KPIs, comisiones de vendedores).

## 2. Arquitectura general

```
Navegador (HTML/CSS/JS)
   │
   ├── Llamadas directas a Supabase REST/Auth/Storage
   │     (lectura de facturas, login, KPIs, subida de comprobantes)
   │
   └── Llamadas a /api/* (funciones Python en Vercel)
         ├── /api/precargar-factura   → crea factura TEMPORAL (RPC guardar_factura_temporal)
         ├── /api/gestion-temporales  → lista / edita / aprueba facturas temporales
         │                              (al aprobar, ejecuta RPC guardar_factura_completa)
         └── /api/guardar-factura     → crea una factura DEFINITIVA directamente
                                         (RPC guardar_factura_completa)

Supabase
   ├── Postgres: facturas_temporales, detalles_factura_temporal,
   │             facturas, factura_detalles,
   │             comisiones_config, comisiones_historial, comisiones_pagos
   ├── Auth: sesión del panel de administración
   └── Storage: bucket "comprobantes" (imágenes de pago)
```

**Por qué existen tablas "temporales" y "definitivas":** las ventas no se dan por buenas hasta que alguien confirma el pago. Mientras tanto quedan en `facturas_temporales`; al aprobarse, una función de base de datos (`guardar_factura_completa`) las migra a `facturas` de forma atómica.

## 3. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | HTML5, CSS3, JavaScript ES6+ (sin frameworks ni build step) |
| Íconos / fuentes | Font Awesome, Google Fonts (Inter/Poppins), vía CDN |
| Gráficos | Chart.js (panel de administración) |
| Códigos QR | qrcodejs (módulo de verificación) |
| Backend serverless | Python 3 (`http.server.BaseHTTPRequestHandler`), funciones de Vercel |
| Base de datos / Auth / Storage | Supabase (Postgres + PostgREST + Supabase Auth + Storage) |
| Hosting | Vercel (`vercel.json` define *rewrites* de rutas amigables) |
| Dependencia Python | `requests` (ver `requirements.txt`) |

## 4. Estructura de carpetas

```
├── index.html                 # Portada con accesos a cada módulo
├── vercel.json                # Config de despliegue y rutas amigables
├── requirements.txt           # Dependencias Python del backend
├── api/                       # Funciones serverless (backend)
│   ├── precargar-factura.py
│   ├── guardar-factura.py
│   └── gestion-temporales.py
├── js/                        # Lógica de cada módulo del frontend
│   ├── supabase-config.js     # URL y clave anon de Supabase (config central)
│   ├── auth-guard.js          # Exige sesión en páginas de administración
│   ├── utils.js                # Helpers compartidos (escapeHtml, etc.)
│   ├── facturacion.js
│   ├── pedidos.js
│   ├── verificacion.js
│   ├── facturasRecientes.js
│   ├── reportes.js
│   ├── admin-panel.js
│   └── subir-comprobante.js
└── assets/
    ├── css/                   # Un archivo de estilos por módulo + global.css/main.css
    ├── img/                   # Logo y favicon
    └── pages/                 # Una página HTML por módulo
        ├── facturacion.html
        ├── pedidos.html
        ├── verificacion.html
        ├── historial.html
        ├── administrador.html
        ├── reportes.html
        ├── login.html
        └── subir-comprobante.html
```

## 5. Módulos del frontend

### 5.1 Portada (`index.html`)
Landing con seis tarjetas de acceso a los módulos: Nueva venta, Pedidos, Verificación, Facturas de hoy, Administrador y Reportes.

### 5.2 Facturación (`facturacion.html` + `js/facturacion.js`)
Venta directa en mostrador: se cargan productos, se calcula el total en USD y Bolívares según la tasa del día (consultada a una API externa de tipo de cambio), se capturan los datos del cliente y se envía la factura como **temporal** a `/api/precargar-factura`. Incluye validaciones de formulario, formateo de campos (cédula, teléfono), modales de carga/éxito/error y un bloqueo de "salir sin guardar" (`beforeunload`).

### 5.3 Pedidos (`pedidos.html` + `js/pedidos.js`)
Pensado para ventas gestionadas por WhatsApp: permite manejar varios pedidos en paralelo (barra lateral), calcular totales con tasa del día, generar una vista previa del mensaje al estilo burbuja de WhatsApp y **abrir WhatsApp con el mensaje ya redactado** (`wa.me` con el texto codificado). También envía la factura como temporal al mismo endpoint que Facturación. Tiene persistencia local (borrador y cola de "pendientes por enviar" en `localStorage`) para no perder datos si falla la conexión, con reintento manual.

### 5.4 Verificación de pagos (`verificacion.html` + `js/verificacion.js`)
**Módulo pensado para** revisar las facturas temporales, ver el comprobante de pago (subido por el cliente vía QR desde su celular) y aprobarlas o rechazarlas, generando además una nota de entrega imprimible.


### 5.5 Subir comprobante (`subir-comprobante.html` + `js/subir-comprobante.js`)
Página **móvil**, pensada para abrirse escaneando un QR generado desde Verificación. El cliente selecciona/fotografía su comprobante, la imagen se comprime en el navegador y se sube **directo al bucket de Supabase Storage** (`comprobantes`, ruta `qr/{id_factura}-{token}.ext`), sin pasar por el backend. La pantalla de verificación debería detectar el archivo por sondeo (polling).

### 5.6 Facturas de hoy (`historial.html` + `js/facturasRecientes.js`)
Lista las facturas ya definitivas creadas en el día (consulta directa a Supabase, tabla `facturas` + `factura_detalles`) con opción de ver el detalle de cada una.

### 5.7 Panel de administración (`administrador.html` + `js/admin-panel.js`)
Requiere sesión (protegido por `auth-guard.js`). Muestra KPIs y gráficos (Chart.js) de ventas por rango de fechas, detalle de facturas, y un módulo de **comisiones**: cálculo por vendedor y registro de pagos de comisión (tablas `comisiones_config`, `comisiones_historial`, `comisiones_pagos`).

### 5.8 Reportes (`reportes.html` + `js/reportes.js`)
Cierre de caja, reporte de ventas por rango de fechas, reporte de comisiones y reimpresión de facturas, todo con una plantilla imprimible (ticket y hoja tamaño carta) vía un iframe oculto.

### 5.9 Login (`login.html`)
Inicio de sesión contra Supabase Auth, requerido para entrar a las páginas de administración.

## 6. Backend (funciones serverless en `api/`)

Las tres funciones están escritas como manejadores HTTP puros (`BaseHTTPRequestHandler`) en vez de un framework, validan el tamaño y forma del cuerpo de la solicitud, sanean/limitan la longitud de cada campo, y hablan con Supabase usando la **clave secreta** (`SUPABASE_SECRET_KEY`, variable de entorno del servidor — nunca expuesta al navegador) en vez de la clave anónima.

| Endpoint | Método | Función |
|---|---|---|
| `/api/precargar-factura` | POST | Valida una factura (cliente, productos, tasa) y la guarda como **temporal** vía la función de base de datos `guardar_factura_temporal`. Usado por **Facturación** y **Pedidos**. |
| `/api/gestion-temporales` | GET / POST / PATCH | Consulta y edita facturas temporales pendientes; al aprobarlas, sube el comprobante a Storage y ejecuta `guardar_factura_completa` para migrarlas a la tabla definitiva. Pensado para el módulo de **Verificación**. |
| `/api/guardar-factura` | POST | Crea una factura **definitiva** directamente (con comprobante incluido), ejecutando `guardar_factura_completa` sin pasar por el estado temporal. |


Todas las funciones comparten patrones de seguridad: límite de tamaño de solicitud, `Retry`/backoff en las llamadas a Supabase, validación de tipos de imagen permitidos para comprobantes (jpg/png/webp/heic ≤ 5 MB), y una lista blanca de métodos de pago (`PM`, `PVD`, `PVC`, `ED`, `EBS`, `OTROS`).

## 7. Base de datos (Supabase)

Tablas/recursos detectados por uso en el código (no hay un archivo de esquema en el repo):

- `facturas_temporales` / `detalles_factura_temporal` — facturas pendientes de verificar.
- `facturas` / `factura_detalles` — facturas definitivas.
- `comisiones_config`, `comisiones_historial`, `comisiones_pagos` — configuración y pagos de comisiones por vendedor.
- Funciones RPC (Postgres): `guardar_factura_temporal`, `guardar_factura_completa`.
- Storage bucket: `comprobantes`.
- Supabase Auth: sesión para las páginas de administración.

## 8. Configuración y despliegue

- **`vercel.json`**: activa `cleanUrls` y define dos *rewrites* (`/factura/:id → /factura.html?id=:id` y `/home → /index.html`). Nota: no existe `factura.html` en el repo actual, por lo que esa ruta de reescritura quedaría sin efecto hasta que se cree esa página.
- **`requirements.txt`**: única dependencia Python, `requests==2.31.0`.
- **Variables de entorno esperadas por el backend**: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `FRONTEND_DOMAIN`.
- **Config del frontend**: `js/supabase-config.js` centraliza `SUPABASE_URL` y la `anon key` pública (antes duplicada en varios archivos).
