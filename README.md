# COMERCIAL JENK CÁCERES
## Documentación Técnica y Funcional del Sistema

*Sistema web de gestión comercial: facturación, pedidos, verificación de pagos, reportes y panel administrativo*

Versión del documento: 1.0
Generado a partir del repositorio: `Comercial-Jenk-Caceres-main`

---

## Tabla de contenido

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Flujo de trabajo del negocio](#2-flujo-de-trabajo-del-negocio)
3. [Arquitectura general del sistema](#3-arquitectura-general-del-sistema)
4. [Stack tecnológico](#4-stack-tecnológico)
5. [Estructura de carpetas del repositorio](#5-estructura-de-carpetas-del-repositorio)
6. [Módulos del frontend](#6-módulos-del-frontend)
7. [Backend — funciones serverless (api/)](#7-backend--funciones-serverless-api)
8. [Base de datos (Supabase)](#8-base-de-datos-supabase)
9. [Seguridad](#9-seguridad)
10. [Configuración y despliegue](#10-configuración-y-despliegue)
11. [Anexo — Resumen de todos los archivos](#11-anexo--resumen-de-todos-los-archivos)

---

## 1. Resumen ejecutivo

Comercial Jenk Cáceres es una aplicación web de gestión comercial para un negocio que opera en Venezuela, con montos manejados simultáneamente en **dólares (USD)** y **bolívares (Bs)**. Cubre el ciclo completo de una venta: creación del pedido o factura, verificación del pago, migración a factura definitiva, y consulta posterior en historial, reportes y panel administrativo.

El proyecto está construido **sin frameworks de frontend** (HTML, CSS y JavaScript "vanilla"), se despliega en **Vercel**, y usa **Supabase** (Postgres + Auth + Storage) como base de datos, autenticación y almacenamiento de archivos. Tres funciones serverless en **Python** actúan como intermediarias entre el navegador y Supabase para las operaciones más sensibles (guardar y aprobar facturas).

### 1.1 Idea central del negocio

El sistema resuelve un problema concreto: una venta no se puede dar por buena hasta que alguien confirma que el pago realmente llegó. Por eso existen dos grandes estados para cada factura:

- **Temporal / pendiente** — la venta se registró (por Facturación o por Pedidos) pero el pago aún no fue verificado.
- **Definitiva / aprobada** — un encargado revisó el comprobante de pago y la factura ya cuenta como una venta real, visible en Historial, Reportes y el Panel de Administración.

Esta separación evita que ventas no confirmadas contaminen los reportes de caja, las comisiones de vendedores y las estadísticas del negocio.

---

## 2. Flujo de trabajo del negocio

Esta sección describe el proceso end-to-end tal como lo vive el personal del negocio, independientemente de la tecnología usada por debajo.

### 2.1 Diagrama general del proceso

```
  ① ORIGEN DE LA VENTA
     ┌───────────────┐        ┌───────────────┐
     │  Facturación   │        │    Pedidos     │
     │ (venta directa │        │ (ventas por    │
     │  de mostrador) │        │   WhatsApp)    │
     └───────┬────────┘        └───────┬────────┘
             └───────────┬──────────────┘
                         ▼
        ② Factura queda en estado TEMPORAL
           (tabla facturas_temporales)
                         │
                         ▼
        ③ Cliente sube su comprobante de pago
           (foto vía QR desde su celular, o
            adjuntado manualmente por el verificador)
                         │
                         ▼
        ④ VERIFICACIÓN: un encargado revisa,
           edita si hace falta y aprueba o rechaza
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        Aprobada:              Rechazada:
   pasa a tablas               se descarta
   DEFINITIVAS                 (no se factura)
  (facturas / factura_detalles)
              │
              ▼
  ⑤ Disponible en Historial, Reportes
     y Panel de Administración (KPIs, comisiones)
```

### 2.2 Paso a paso detallado

**Paso 1 — Registrar la venta**

Existen dos caminos posibles, según cómo llega el cliente:

- **Facturación (venta de mostrador).** El vendedor atiende al cliente en persona: agrega productos, el sistema calcula el total en USD y su equivalente en bolívares según la tasa del día, se capturan los datos del cliente (nombre, cédula, teléfono) y se confirma la venta.
- **Pedidos (venta gestionada por WhatsApp).** Pensado para atender varios pedidos en paralelo desde una barra lateral. El vendedor arma el pedido, el sistema genera una vista previa del mensaje al estilo de una burbuja de WhatsApp, y permite abrir WhatsApp con el mensaje ya redactado para enviarlo al cliente. Si falla la conexión al guardar, el pedido queda en una cola local para reintentarlo más tarde sin perder la información.

En ambos casos, al confirmar, la venta se guarda como factura **temporal** — todavía no cuenta como una venta cerrada.

**Paso 2 — El cliente paga y sube su comprobante**

El módulo de Verificación puede generar un código QR para esa factura. El cliente lo escanea con su propio celular, lo que abre una página simple (sin necesidad de iniciar sesión) donde selecciona o fotografía el comprobante de su pago (transferencia, pago móvil, etc.). La imagen se comprime automáticamente en el navegador del cliente y se sube directo al almacenamiento de archivos, sin pasar por ningún encargado.

**Paso 3 — Verificación y aprobación**

El encargado de caja/verificación abre el módulo de Verificación, ve la lista de facturas pendientes, revisa el comprobante (ya sea el que subió el cliente por QR o uno que el propio encargado adjunte manualmente), puede corregir productos, montos, método de pago o datos del banco, y decide:

- **Aprobar:** la factura se migra a las tablas definitivas y queda lista para imprimir su nota de entrega.
- **Rechazar:** la factura queda descartada y no se convierte en una venta.

**Paso 4 — Consulta y control posterior**

- **Facturas de hoy (Historial):** lista rápida de todo lo vendido y aprobado en el día.
- **Reportes:** cierre de caja, ventas por rango de fechas, reporte de comisiones y reimpresión de facturas (ticket o tamaño carta).
- **Panel de administración:** KPIs y gráficos de ventas, detalle de cada factura, y cálculo/pago de comisiones por vendedor.

### 2.3 Roles del negocio

| Rol | Qué puede hacer | Páginas restringidas |
|---|---|---|
| Personal (por defecto) | Facturación, Pedidos, Verificación, Historial | No puede entrar a Administrador ni Reportes |
| Admin | Todo lo anterior, más Panel de Administración y Reportes | Acceso completo |

Los roles se asignan manualmente por un administrador desde el panel de Supabase — nunca desde el navegador — como medida de seguridad.

---

## 3. Arquitectura general del sistema

La aplicación combina tres piezas: el navegador (frontend estático), un backend serverless mínimo en Python, y Supabase como plataforma de datos.

```
Navegador (HTML / CSS / JS, sin build step)
   │
   ├── Llamadas DIRECTAS a Supabase (REST / Auth / Storage)
   │      · Login (Supabase Auth)
   │      · Lectura de facturas (Historial, Reportes, Panel admin)
   │      · Subida de comprobantes desde el QR del cliente
   │      · Lectura/edición de comisiones
   │
   └── Llamadas a /api/*  (funciones Python en Vercel)
          ├── POST /api/precargar-factura
          │     → crea factura TEMPORAL
          │        (RPC guardar_factura_temporal)
          ├── GET/POST/PATCH /api/gestion-temporales
          │     → lista, edita y aprueba facturas temporales
          │        (al aprobar → RPC guardar_factura_completa)
          └── POST /api/guardar-factura
                → crea una factura DEFINITIVA directa
                   (RPC guardar_factura_completa)

Supabase
   ├── Postgres
   │     · facturas_temporales / detalles_factura_temporal
   │     · facturas / factura_detalles
   │     · comisiones_config / comisiones_historial / comisiones_pagos
   │     · perfiles (rol de cada usuario: admin | personal)
   │     · Funciones RPC: guardar_factura_temporal, guardar_factura_completa
   ├── Auth (sesión del panel administrativo)
   └── Storage → bucket "comprobantes" (imágenes de pago)
```

### 3.1 Por qué existen tablas temporales y definitivas

Las ventas no se dan por buenas hasta que alguien confirma el pago. Mientras eso ocurre, quedan en `facturas_temporales`; al aprobarse, la función de base de datos `guardar_factura_completa` las migra a `facturas` de forma atómica (todo o nada), evitando dejar una factura a medio migrar si algo falla a mitad de camino.

### 3.2 Dos claves de Supabase, dos niveles de confianza

| Clave | Dónde vive | Nivel de confianza |
|---|---|---|
| `anon key` (pública) | `js/supabase-config.js` — viaja al navegador de cualquier visitante | Baja: debe protegerse con Row Level Security (RLS) en Supabase |
| `SUPABASE_SECRET_KEY` (de servicio) | Variables de entorno del servidor en Vercel — nunca en el frontend | Alta: usada solo por las funciones `api/*.py` |

---

## 4. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | HTML5, CSS3, JavaScript ES6+ (sin frameworks ni build step) |
| Íconos / fuentes | Font Awesome y Google Fonts (Inter/Poppins), vía CDN |
| Gráficos | Chart.js (Panel de administración) |
| Códigos QR | qrcodejs (módulo de Verificación) |
| Backend serverless | Python 3, `http.server.BaseHTTPRequestHandler` (funciones de Vercel) |
| Base de datos / Auth / Storage | Supabase (Postgres + PostgREST + Supabase Auth + Storage) |
| Hosting | Vercel (`vercel.json` define *rewrites* de rutas amigables) |
| Dependencia Python | `requests==2.31.0` |
| Tasa de cambio | API pública `open.er-api.com` (tipo de cambio USD del día) |

---

## 5. Estructura de carpetas del repositorio

```
Comercial-Jenk-Caceres-main/
├── index.html                 # Portada con accesos a cada módulo
├── SECURITY.md                # Modelo de seguridad (login + RLS)
├── vercel.json                # Config de despliegue y rutas amigables
├── requirements.txt           # Dependencias Python del backend
├── api/                       # Funciones serverless (backend)
│   ├── precargar-factura.py
│   ├── guardar-factura.py
│   └── gestion-temporales.py
├── js/                        # Lógica de cada módulo del frontend
│   ├── supabase-config.js     # URL y clave anon (config central)
│   ├── auth-guard.js          # Exige sesión + control de roles
│   ├── utils.js                # Helpers compartidos (escapeHtml, etc.)
│   ├── facturacion.js
│   ├── pedidos.js
│   ├── verificacion.js
│   ├── facturasRecientes.js
│   ├── reportes.js
│   ├── admin-panel.js
│   └── subir-comprobante.js
└── assets/
    ├── css/                   # Un archivo de estilos por módulo
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

---

## 6. Módulos del frontend

### 6.1 Portada
**Archivos:** `index.html`

Landing con seis tarjetas de acceso a los módulos: Nueva venta, Pedidos, Verificación, Facturas de hoy, Administrador y Reportes. Las tarjetas de Administrador y Reportes se ocultan automáticamente si el usuario no tiene rol admin (atributo `data-admin-only`, controlado por `auth-guard.js`).

### 6.2 Facturación
**Archivos:** `assets/pages/facturacion.html` + `js/facturacion.js`

Venta directa de mostrador. Flujo típico:

- Se cargan los productos y se calcula el total en USD y en bolívares según la tasa del día (consultada a la API `open.er-api.com` y guardada en `localStorage` como respaldo).
- Se capturan los datos del cliente (nombre, cédula, teléfono) con formateo automático de campos.
- Validaciones de formulario y modales de carga / éxito / error.
- Bloqueo de "salir sin guardar" (evento `beforeunload`) para no perder una venta a medio capturar.
- Al confirmar, la factura se envía como TEMPORAL a `POST /api/precargar-factura`.

### 6.3 Pedidos
**Archivos:** `assets/pages/pedidos.html` + `js/pedidos.js`

Pensado para ventas gestionadas por WhatsApp, permitiendo atender varios pedidos en paralelo.

- Barra lateral para manejar múltiples pedidos abiertos a la vez, cada uno con su propio cliente, productos y tasa de cambio.
- Genera una vista previa del mensaje al estilo burbuja de WhatsApp y abre WhatsApp (`wa.me`) con el mensaje ya redactado.
- Persistencia local: guarda un borrador de cada pedido y una cola de "pendientes por enviar" en `localStorage`, con reintento manual si falla la conexión al guardar (mismo endpoint que Facturación: `/api/precargar-factura`).

### 6.4 Verificación de pagos
**Archivos:** `assets/pages/verificacion.html` + `js/verificacion.js`

Módulo central del control de pagos: revisa las facturas temporales pendientes (`GET /api/gestion-temporales`), permite editar productos y totales, generar un QR para que el cliente suba su comprobante desde el celular, y aprobar o rechazar cada factura.

- Genera un código QR apuntando a `subir-comprobante.html` para esa factura específica.
- Sondea (polling) el bucket de Storage para detectar cuándo el cliente ya subió su comprobante.
- Permite adjuntar manualmente un comprobante si el cliente no usó el QR (con compresión de imagen en el navegador antes de enviarla).
- Al aprobar, envía `PATCH`/`POST` a `/api/gestion-temporales` con `estado="aprobado"`, lo que dispara la migración a tablas definitivas en el backend.
- Genera una nota de entrega imprimible tras la aprobación.

### 6.5 Subir comprobante
**Archivos:** `assets/pages/subir-comprobante.html` + `js/subir-comprobante.js`

Página pública y sin sesión, pensada para abrirse escaneando el QR generado desde Verificación, directamente desde el celular del cliente final.

- El cliente selecciona o fotografía su comprobante de pago.
- La imagen se comprime en el propio navegador antes de subirla.
- Se sube directo al bucket `comprobantes` de Supabase Storage, en la ruta `qr/{id_factura}-{token}.ext`, usando la anon key — sin pasar por el backend en Python.

### 6.6 Facturas de hoy (Historial)
**Archivos:** `assets/pages/historial.html` + `js/facturasRecientes.js`

Lista las facturas ya definitivas creadas en el día en curso, consultando directamente a Supabase (tablas `facturas` + `factura_detalles`), con opción de ver el detalle de productos de cada una.

### 6.7 Panel de administración
**Archivos:** `assets/pages/administrador.html` + `js/admin-panel.js`

Página protegida (requiere sesión y rol admin, vía `auth-guard.js`). Es el centro de control gerencial del sistema.

- KPIs y gráficos (Chart.js) de ventas por rango de fechas.
- Detalle de cada factura, incluyendo la vista del comprobante de pago subido.
- Módulo de comisiones: cálculo por vendedor según un porcentaje configurable (tabla `comisiones_config`), registro y marcado de pagos realizados (`comisiones_pagos`, `comisiones_historial`).

### 6.8 Reportes
**Archivos:** `assets/pages/reportes.html` + `js/reportes.js`

Cierre de caja del día, reporte de ventas por rango de fechas, reporte de comisiones y reimpresión de facturas.

- Todo el material imprimible (ticket térmico y hoja tamaño carta) se genera con plantillas HTML propias, impresas a través de un iframe oculto.
- El cierre de caja agrupa las ventas del día por método de pago y calcula totales en USD y bolívares.

### 6.9 Login
**Archivos:** `assets/pages/login.html` + `js/auth-guard.js`

Inicio de sesión contra Supabase Auth. `auth-guard.js` se incluye en TODAS las páginas internas del sistema (portada, facturación, pedidos, verificación, historial, reportes y administrador): sin sesión válida, redirige aquí automáticamente y, tras iniciar sesión, regresa a la página que se quería ver (parámetro `?next=`). Quedan públicas, a propósito, solo `login.html` y `subir-comprobante.html`.

---

## 7. Backend — funciones serverless (api/)

Las tres funciones están escritas como manejadores HTTP puros (`http.server.BaseHTTPRequestHandler`) en lugar de un framework como Flask o FastAPI. Todas comparten patrones comunes de seguridad y robustez:

- Validan el tamaño del cuerpo de la solicitud (`Content-Length`) antes de leerlo, para evitar solicitudes desproporcionadas.
- Sanean y limitan la longitud máxima de cada campo de texto (nombre, cédula, teléfono, observaciones, etc.).
- Usan una sesión de `requests` con reintentos automáticos (backoff) ante errores 502/503/504 de Supabase.
- Hablan con Supabase usando la clave secreta (`SUPABASE_SECRET_KEY`), nunca la anon key, y nunca exponen esa clave al navegador.
- Validan una lista blanca de métodos de pago: `PM`, `PVD`, `PVC`, `ED`, `EBS`, `OTROS`.
- Validan el tipo y tamaño de las imágenes de comprobante: jpg, png, webp o heic, máximo 5 MB.

### 7.1 Tabla de endpoints

| Endpoint | Método | Función |
|---|---|---|
| `/api/precargar-factura` | POST | Valida una factura (cliente, productos, tasa) y la guarda como TEMPORAL vía la función de base de datos `guardar_factura_temporal`. Usado por Facturación y Pedidos. |
| `/api/gestion-temporales` | GET / POST / PATCH | GET: lista facturas temporales pendientes. PATCH/POST: edita campos de una factura temporal, o -si `estado="aprobado"`- la migra a tablas definitivas ejecutando `guardar_factura_completa`. Usado por Verificación. |
| `/api/guardar-factura` | POST | Crea una factura DEFINITIVA directamente (incluyendo comprobante), ejecutando `guardar_factura_completa` sin pasar por el estado temporal. |

### 7.2 POST /api/precargar-factura

Recibe los datos de la venta (cliente, productos, tasa de cambio, totales en USD/Bs) y los valida exhaustivamente antes de tocar la base de datos:

- `id_factura` debe respetar el patrón `^[A-Za-z0-9-]{1,64}$`.
- Cada producto debe tener nombre, cantidad > 0, precio unitario ≥ 0 y precio total ≥ 0; máximo 50 productos por factura.
- `subtotal_usd`, `total_usd`, `subtotal_bs`, `total_bs` y `tasa_cambio` deben ser numéricos y mayores a 0.

Si todo es válido, calcula una fecha de expiración de 1 hora para la factura temporal y llama a la función RPC `guardar_factura_temporal` en Supabase, enviando la cabecera (`p_factura`) y el detalle de productos (`p_detalles`) en una sola petición.

### 7.3 GET / POST / PATCH /api/gestion-temporales

**GET:** consulta en Supabase todas las facturas en estado `"pendiente"` (`facturas_temporales`), incluyendo sus detalles anidados.

**PATCH/POST — edición simple de campos:** si el cuerpo no trae `estado="aprobado"`, se interpreta como una edición normal (por ejemplo, corregir un dato) y se aplica un PATCH directo sobre `facturas_temporales`.

**PATCH/POST — aprobación (`estado="aprobado"`):** este es el flujo más complejo de todo el backend. Sigue estos pasos internamente:

1. Consulta la factura temporal original para recuperar los datos del cliente que el formulario de aprobación no permite editar (nombre, apellido, cédula, teléfono, vendedor).
2. Valida los productos editados que llegan en el cuerpo de la petición (pueden diferir de los originales si el verificador los corrigió en pantalla).
3. Valida el método de pago elegido (lista blanca) y la longitud de campos como referencia, banco y observaciones.
4. Valida que los totales recalculados (`subtotal_usd`, `descuento_usd`, `total_usd`, `total_bs`) sean numéricos.
5. Resuelve el comprobante de pago de tres formas posibles: (a) subido en base64 directamente en esta petición, (b) ya subido antes por el cliente vía QR -en cuyo caso se verifica que el archivo exista de verdad en Storage antes de confiar en su ruta-, o (c) ausente, lo cual solo se permite si el método de pago no es de los que exigen comprobante (`PM` u `OTROS`).
6. Determina la tasa de cambio final: la que envíe el verificador, o la de la factura temporal, o -si ninguna existe- la deriva dividiendo `total_bs` entre `total_usd`.
7. Arma la factura definitiva combinando los datos fijos del cliente con los datos editados, y llama a la RPC `guardar_factura_completa` (misma función que usa `/api/guardar-factura`), insertando cabecera y detalle de forma atómica.
8. Solo si la migración fue exitosa, elimina el registro y los detalles de la tabla temporal — así nunca queda una factura duplicada ni a medio migrar.

### 7.4 POST /api/guardar-factura

Crea una factura definitiva directamente, sin pasar por el estado temporal (por ejemplo, para registrar una venta ya cerrada y pagada de una vez). Valida los mismos campos que `precargar-factura.py`, además del método de pago, y si recibe `comprobante_base64` + `comprobante_tipo`, lo decodifica, valida su tamaño (≤5 MB) y tipo, y lo sube al bucket `comprobantes` antes de llamar a `guardar_factura_completa`.

---

## 8. Base de datos (Supabase)

No existe un archivo de esquema SQL completo en el repositorio; las siguientes tablas y funciones se identifican por su uso en el código.

### 8.1 Tablas

| Tabla | Propósito |
|---|---|
| `facturas_temporales` | Cabecera de facturas pendientes de verificación de pago. |
| `detalles_factura_temporal` | Productos de cada factura temporal. |
| `facturas` | Cabecera de facturas definitivas (ya aprobadas). |
| `factura_detalles` | Productos de cada factura definitiva. |
| `comisiones_config` | Configuración de porcentaje de comisión por vendedor. |
| `comisiones_historial` | Historial de comisiones calculadas/pagadas. |
| `comisiones_pagos` | Registro de pagos de comisión realizados (por vendedor y mes). |
| `perfiles` | Una fila por usuario de Supabase Auth, con su rol (`admin` \| `personal`). |

### 8.2 Funciones RPC (Postgres)

- `guardar_factura_temporal(p_factura, p_detalles)` — inserta la cabecera y el detalle de una venta en las tablas temporales.
- `guardar_factura_completa(p_factura, p_detalles)` — inserta la cabecera y el detalle de una venta en las tablas definitivas, de forma atómica. La usan tanto la aprobación de una factura temporal como la creación directa de una factura definitiva.

### 8.3 Storage

**Bucket `comprobantes`:** almacena las imágenes de los comprobantes de pago. Los archivos subidos por el cliente final vía QR siguen la ruta `qr/{id_factura}-{token}.ext`; los subidos por un verificador desde el backend se guardan como `{id_factura}-{timestamp}.ext`.

### 8.4 Auth

Supabase Auth gestiona la sesión del personal que usa el sistema (login por correo y contraseña). No existe registro público: los usuarios se crean a mano desde el panel de Supabase.

---

## 9. Seguridad

El modelo de seguridad del sistema se apoya en dos capas independientes que no deben confundirse.

### 9.1 Capa 1 — Login en el navegador

`login.html` + `js/auth-guard.js` exigen un correo/contraseña válido (Supabase Auth) para poder ver las páginas del sistema. Esto evita que alguien sin relación con el negocio entre por curiosidad o adivine la URL. `auth-guard.js` además lee el rol del usuario desde la tabla `perfiles` y oculta o bloquea el acceso a Administrador y Reportes si el rol no es admin.

### 9.2 Capa 2 — Row Level Security (RLS) en Supabase

Este es el control **real**. La `anon key` visible en `js/supabase-config.js` está pensada para ser pública: viaja al navegador de cualquier visitante, haya iniciado sesión o no. Si alguien copia esa clave desde las herramientas de desarrollador y hace peticiones directas a la API de Supabase, **el login de la capa 1 no lo detiene en absoluto**. Solo RLS, activado tabla por tabla en el panel de Supabase, puede bloquear ese acceso.

> **Conclusión:** el login mejora el acceso desde el navegador, pero si RLS no está activo en Supabase, los datos (facturas, cédulas, teléfonos, comisiones) siguen expuestos a quien tenga la anon key.

### 9.3 Checklist pendiente en el panel de Supabase

- Desactivar el registro público (self sign-up) en Authentication → Providers.
- Activar **Enable RLS** en cada tabla sensible (`facturas`, `factura_detalles`, `facturas_temporales`, `detalles_factura_temporal`, `comisiones_config`, `comisiones_historial`, `comisiones_pagos`) y agregar políticas que solo permitan acceso a usuarios autenticados.
- En el bucket `comprobantes`: no restringir todo a "solo autenticados" (rompería la subida sin login vía QR); en su lugar, limitar el `INSERT` del rol `anon` a la ruta `qr/*` y a los tipos/tamaños ya validados, sin dar `SELECT`/`DELETE` públicos sobre el bucket completo.
- Si se quiere que el rol también aplique a nivel de base de datos (por ejemplo, que solo un admin pueda leer `comisiones_historial` aunque alguien use la anon key directamente), agregar políticas RLS que consulten la tabla `perfiles`.

### 9.4 Páginas protegidas vs. públicas

| Página | Requiere sesión |
|---|---|
| `index.html` | Sí |
| `facturacion.html` | Sí |
| `pedidos.html` | Sí |
| `verificacion.html` | Sí |
| `historial.html` | Sí |
| `reportes.html` | Sí (además, solo rol admin) |
| `administrador.html` | Sí (además, solo rol admin) |
| `login.html` | No — es la puerta de entrada |
| `subir-comprobante.html` | No — la abre el cliente final desde un QR, sin cuenta |

### 9.5 Las funciones serverless ya están bien encaminadas

Las tres funciones en `api/*.py` usan `SUPABASE_SECRET_KEY` (clave de servicio) como variable de entorno en Vercel, nunca copiada al frontend. Es importante verificar en Vercel (Project → Settings → Environment Variables) que `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y `FRONTEND_DOMAIN` estén definidas únicamente ahí.

### 9.6 Cómo crear el primer usuario

Desde Supabase → Authentication → Users → Add user, se crea el correo y contraseña del personal que administrará el sistema, y se comparten por un canal seguro. No existe formulario de auto-registro, por diseño.

---

## 10. Configuración y despliegue

### 10.1 vercel.json

Activa `cleanUrls` y define dos *rewrites* de rutas amigables:

- `/factura/:id → /factura.html?id=:id` (nota: actualmente no existe `factura.html` en el repositorio, por lo que esta ruta queda sin efecto hasta que se cree esa página).
- `/home → /index.html`

### 10.2 Variables de entorno esperadas por el backend

| Variable | Uso |
|---|---|
| `SUPABASE_URL` | URL base del proyecto de Supabase, usada por las tres funciones en `api/`. |
| `SUPABASE_SECRET_KEY` | Clave de servicio de Supabase; nunca debe copiarse al frontend. |
| `FRONTEND_DOMAIN` | Dominio del frontend desplegado (con valor por defecto en `guardar-factura.py`). |

### 10.3 Dependencias

`requirements.txt` declara una única dependencia Python: `requests==2.31.0`, usada para todas las llamadas HTTP hacia la API REST y Storage de Supabase.

### 10.4 Configuración del frontend

`js/supabase-config.js` centraliza la `SUPABASE_URL` y la anon key pública, evitando que estuvieran duplicadas en varios archivos como ocurría antes.

---

## 11. Anexo — Resumen de todos los archivos

### 11.1 Frontend (JavaScript)

| Archivo | Responsabilidad |
|---|---|
| `js/supabase-config.js` | Configuración central: URL y anon key de Supabase. |
| `js/utils.js` | Helpers compartidos: `escapeHtml` (previene XSS al insertar datos dinámicos) y `encodeQueryValue`. |
| `js/auth-guard.js` | Exige sesión válida en todas las páginas internas; controla acceso por rol (admin/personal). |
| `js/facturacion.js` | Lógica del módulo de Facturación (venta de mostrador). |
| `js/pedidos.js` | Lógica del módulo de Pedidos (ventas por WhatsApp, múltiples pedidos en paralelo). |
| `js/verificacion.js` | Lógica del módulo de Verificación: revisión, edición, QR y aprobación/rechazo de pagos. |
| `js/subir-comprobante.js` | Página móvil pública para que el cliente suba su comprobante vía QR. |
| `js/facturasRecientes.js` | Lógica de Historial (facturas definitivas del día). |
| `js/admin-panel.js` | Lógica del Panel de administración: KPIs, gráficos y comisiones. |
| `js/reportes.js` | Lógica de Reportes: cierre de caja, ventas, comisiones e impresión. |

### 11.2 Backend (Python)

| Archivo | Responsabilidad |
|---|---|
| `api/precargar-factura.py` | Crea facturas temporales, validando exhaustivamente cliente, productos y montos. |
| `api/gestion-temporales.py` | Lista, edita y aprueba/migra facturas temporales a las tablas definitivas. |
| `api/guardar-factura.py` | Crea facturas definitivas directamente, incluyendo subida de comprobante. |

### 11.3 Estilos (CSS)

Cada módulo tiene su propia hoja de estilos en `assets/css/` (`facturacion.css`, `pedidos.css`, `verificacion.css`, `reportes.css`, `admin-panel.css`, `subir-comprobante.css`), además de `global.css` y `main.css` con estilos y variables compartidas (colores, tipografía, sombras).
