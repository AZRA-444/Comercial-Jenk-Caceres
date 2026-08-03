# COMERCIAL JENK CÁCERES
## Documentación Técnica y Funcional del Sistema

*Sistema web de gestión comercial: facturación, pedidos, verificación de pagos, reportes y panel administrativo*

Versión del documento: 1.1

---

## Tabla de contenido

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Novedades de la versión 1.1](#2-novedades-de-la-versión-11)
3. [Flujo de trabajo del negocio](#3-flujo-de-trabajo-del-negocio)
4. [Arquitectura general del sistema](#4-arquitectura-general-del-sistema)
5. [Stack tecnológico](#5-stack-tecnológico)
6. [Estructura de carpetas del repositorio](#6-estructura-de-carpetas-del-repositorio)
7. [Módulos del frontend](#7-módulos-del-frontend)
8. [Backend — funciones serverless (api/)](#8-backend--funciones-serverless-api)
9. [Base de datos (Supabase)](#9-base-de-datos-supabase)
10. [Seguridad](#10-seguridad)
11. [Configuración y despliegue](#11-configuración-y-despliegue)
12. [Anexo — Resumen de todos los archivos](#12-anexo--resumen-de-todos-los-archivos)

---

## 1. Resumen ejecutivo

Comercial Jenk Cáceres es una aplicación web de gestión comercial para un negocio que opera en Venezuela, con montos manejados simultáneamente en **dólares (USD)** y **bolívares (Bs)**. Cubre el ciclo completo de una venta: creación del pedido o factura, confirmación del pago, migración a factura definitiva, y consulta posterior en historial, reportes y panel administrativo.

El proyecto está construido **sin frameworks de frontend** (HTML, CSS y JavaScript "vanilla"), se despliega en **Vercel**, y usa **Supabase** (Postgres + Auth + Storage) como base de datos, autenticación y almacenamiento de archivos. Tres funciones serverless en **Python** actúan como intermediarias entre el navegador y Supabase para las operaciones más sensibles (guardar y aprobar facturas).

### 1.1 Idea central del negocio

El sistema resuelve un problema concreto: una venta no se puede dar por buena hasta que alguien confirma que el pago realmente llegó. Por eso existen dos grandes estados para cada factura:

- **Temporal / pendiente** — la venta se registró (por Facturación o por Pedidos) pero el pago aún no fue confirmado.
- **Definitiva / aprobada** — un encargado de Verificación revisó los productos y completó en pantalla los datos del pago (método, banco/referencia o monto recibido y vuelto según corresponda); la factura ya cuenta como una venta real, visible en Historial, Reportes y el Panel de Administración.

Esta separación evita que ventas no confirmadas contaminen los reportes de caja, las comisiones de vendedores y las estadísticas del negocio.

---

## 2. Novedades de la versión 1.1

Esta versión documenta cambios reales encontrados en el código actual del repositorio frente a lo descrito en la versión 1.0 del documento. El cambio más importante es la eliminación completa del flujo de comprobante de pago por QR.

### 2.1 Se eliminó el flujo de comprobante de pago por QR

En la v1.0, el módulo de Verificación generaba un código QR que el cliente escaneaba desde su celular para subir una foto de su comprobante de pago (transferencia, pago móvil, etc.), sin necesidad de iniciar sesión. Esa funcionalidad **ya no existe** en el código actual:

- La página `assets/pages/subir-comprobante.html` y el script `js/subir-comprobante.js` **fueron eliminados del repositorio**.
- `js/verificacion.js` ya no contiene ninguna lógica de generación de QR, subida de imágenes, compresión en el navegador ni sondeo (polling) del bucket de Storage.
- Las tres funciones del backend (`api/precargar-factura.py`, `api/gestion-temporales.py`, `api/guardar-factura.py`) ya no reciben, validan ni suben ningún archivo de comprobante (`comprobante_base64` / `comprobante_tipo` desaparecieron por completo del código).

**En su lugar**, la aprobación de una factura en Verificación ahora se basa en una **confirmación manual de los datos del pago**, capturados en un formulario que cambia según el método elegido:

| Método de pago | Qué pide el formulario |
|---|---|
| `PM` (Pago Móvil) | Banco destino (selección) y número de referencia (mínimo 4 dígitos) |
| `PVD` / `PVC` (Punto de venta USD / Bs) | Solo confirma el monto a cobrar; sin campos adicionales |
| `ED` (Efectivo dólares) | Monto recibido en $ y cálculo automático del vuelto a entregar |
| `EBS` (Efectivo bolívares) | Monto recibido en Bs y cálculo automático del vuelto a entregar |
| `OTROS` | Observaciones obligatorias, detallando el caso |

El sistema ya no exige ni ofrece adjuntar una imagen del comprobante para aprobar una factura, sin importar el método de pago.

> **Limpieza de residuos completada:** se retiró de `assets/pages/verificacion.html` el `<script>` de la librería `qrcodejs` (ya no se usaba) y se actualizó el comentario de `js/auth-guard.js` que todavía mencionaba `subir-comprobante.html`.

### 2.2 El bucket de Storage `comprobantes` queda en modo "solo lectura heredada"

El bucket `comprobantes` de Supabase Storage sigue existiendo y `js/admin-panel.js` todavía intenta mostrar la imagen guardada en `factura.comprobante_path` al ver el detalle de una factura — pero **ya no hay ninguna pantalla del sistema que escriba archivos nuevos ahí**. En la práctica, esto solo mostrará algo para facturas antiguas que ya tenían un comprobante asociado desde antes de este cambio; toda factura nueva se aprueba sin imagen.

### 2.3 Tope de productos por factura unificado en 150

Las tres funciones del backend (`api/precargar-factura.py`, `api/gestion-temporales.py` y `api/guardar-factura.py`) ahora comparten el mismo límite: `MAX_PRODUCTOS_POR_FACTURA = 150`. Antes este valor era inconsistente entre endpoints (50 en `precargar-factura.py`, 300 en los otros dos); con este ajuste una factura admite hasta 150 productos en cualquier etapa del flujo (registro inicial, aprobación en Verificación o creación directa).

### 2.4 Nuevo límite de longitud para el nombre de producto

Las tres funciones del backend ahora validan que el nombre de cada producto no supere **120 caracteres**, algo que la v1.0 no exigía explícitamente.

### 2.5 Otros ajustes menores detectados

- `api/precargar-factura.py` acepta solicitudes de hasta 1 MB (`MAX_BYTES_SOLICITUD`); `api/guardar-factura.py` y `api/gestion-temporales.py` mantienen el tope en 512 KB — coherente con que ya no viajan imágenes en base64 dentro del cuerpo de ninguna de las tres.
- `api/guardar-factura.py` sigue declarando la variable de entorno `FRONTEND_DOMAIN`, pero no se encontró ningún uso real de esa variable en el código (queda declarada con valor por defecto, sin efecto visible).

---

## 3. Flujo de trabajo del negocio

Esta sección describe el proceso end-to-end tal como lo vive el personal del negocio, independientemente de la tecnología usada por debajo.

### 3.1 Diagrama general del proceso

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
        ③ VERIFICACIÓN: un encargado revisa los
           productos, corrige lo necesario y
           completa en pantalla los datos del
           pago (método, banco/referencia, o
           monto recibido y vuelto)
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        Aprobada:              Rechazada:
   pasa a tablas               se descarta
   DEFINITIVAS                 (no se factura)
  (facturas / factura_detalles)
              │
              ▼
  ④ Disponible en Historial, Reportes
     y Panel de Administración (KPIs, comisiones)
```

### 3.2 Paso a paso detallado

**Paso 1 — Registrar la venta**

Existen dos caminos posibles, según cómo llega el cliente:

- **Facturación (venta de mostrador).** El vendedor atiende al cliente en persona: agrega productos, el sistema calcula el total en USD y su equivalente en bolívares según la tasa del día, se capturan los datos del cliente (nombre, cédula, teléfono) y se confirma la venta.
- **Pedidos (venta gestionada por WhatsApp).** Pensado para atender varios pedidos en paralelo desde una barra lateral. El vendedor arma el pedido, el sistema genera una vista previa del mensaje al estilo de una burbuja de WhatsApp, y permite abrir WhatsApp con el mensaje ya redactado para enviarlo al cliente. Si falla la conexión al guardar, el pedido queda en una cola local para reintentarlo más tarde sin perder la información.

En ambos casos, al confirmar, la venta se guarda como factura **temporal** — todavía no cuenta como una venta cerrada.

**Paso 2 — Verificación y aprobación**

El encargado de caja/verificación abre el módulo de Verificación, ve la lista de facturas pendientes, revisa y puede corregir los productos y montos, selecciona el método de pago y completa los datos que ese método requiera (banco y referencia para Pago Móvil, monto recibido y vuelto para efectivo, observaciones para "Otros"), y decide:

- **Aprobar:** la factura se migra a las tablas definitivas y se genera automáticamente una nota de entrega imprimible (formato ticket térmico), con opción de reimprimir cuantas veces sea necesario si se traba el papel o falla la impresora.
- **Rechazar:** la factura queda descartada y no se convierte en una venta.

**Paso 3 — Consulta y control posterior**

- **Facturas de hoy (Historial):** lista rápida de todo lo vendido y aprobado en el día.
- **Reportes:** cierre de caja, ventas por rango de fechas, reporte de comisiones y reimpresión de facturas (ticket o tamaño carta).
- **Panel de administración:** KPIs y gráficos de ventas, detalle de cada factura, y cálculo/pago de comisiones por vendedor.

### 3.3 Roles del negocio

| Rol | Qué puede hacer | Páginas restringidas |
|---|---|---|
| Personal (por defecto) | Facturación, Pedidos, Verificación, Historial | No puede entrar a Administrador ni Reportes |
| Admin | Todo lo anterior, más Panel de Administración y Reportes | Acceso completo |

Los roles se asignan manualmente por un administrador desde el panel de Supabase — nunca desde el navegador — como medida de seguridad.

---

## 4. Arquitectura general del sistema

La aplicación combina tres piezas: el navegador (frontend estático), un backend serverless mínimo en Python, y Supabase como plataforma de datos.

```
Navegador (HTML / CSS / JS, sin build step)
   │
   ├── Llamadas DIRECTAS a Supabase (REST / Auth / Storage)
   │      · Login (Supabase Auth)
   │      · Lectura de facturas (Historial, Reportes, Panel admin)
   │      · Lectura de imagen de comprobante heredada (Panel admin,
   │        solo si la factura ya la tenía de antes)
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
   └── Storage → bucket "comprobantes" (heredado: sin escritura activa
         desde ninguna pantalla del sistema; solo lectura de imágenes
         antiguas desde el Panel de administración)
```

### 4.1 Por qué existen tablas temporales y definitivas

Las ventas no se dan por buenas hasta que alguien confirma el pago. Mientras eso ocurre, quedan en `facturas_temporales`; al aprobarse, la función de base de datos `guardar_factura_completa` las migra a `facturas` de forma atómica (todo o nada), evitando dejar una factura a medio migrar si algo falla a mitad de camino.

### 4.2 Dos claves de Supabase, dos niveles de confianza

| Clave | Dónde vive | Nivel de confianza |
|---|---|---|
| `anon key` (pública) | `js/supabase-config.js` — viaja al navegador de cualquier visitante | Baja: debe protegerse con Row Level Security (RLS) en Supabase |
| `SUPABASE_SECRET_KEY` (de servicio) | Variables de entorno del servidor en Vercel — nunca en el frontend | Alta: usada solo por las funciones `api/*.py` |

---

## 5. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | HTML5, CSS3, JavaScript ES6+ (sin frameworks ni build step) |
| Íconos / fuentes | Font Awesome y Google Fonts (Inter/Poppins), vía CDN |
| Gráficos | Chart.js (Panel de administración) |
| Backend serverless | Python 3, `http.server.BaseHTTPRequestHandler` (funciones de Vercel) |
| Base de datos / Auth / Storage | Supabase (Postgres + PostgREST + Supabase Auth + Storage) |
| Hosting | Vercel (`vercel.json` define *rewrites* de rutas amigables) |
| Dependencia Python | `requests==2.31.0` |
| Tasa de cambio | API pública `open.er-api.com` (tipo de cambio USD del día) |

---

## 6. Estructura de carpetas del repositorio

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
│   └── admin-panel.js
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
        └── login.html
```

---

## 7. Módulos del frontend

### 7.1 Portada
**Archivos:** `index.html`

Landing con seis tarjetas de acceso a los módulos: Nueva venta, Pedidos, Verificación, Facturas de hoy, Administrador y Reportes. Las tarjetas de Administrador y Reportes se ocultan automáticamente si el usuario no tiene rol admin (atributo `data-admin-only`, controlado por `auth-guard.js`).

### 7.2 Facturación
**Archivos:** `assets/pages/facturacion.html` + `js/facturacion.js`

Venta directa de mostrador. Flujo típico:

- Se cargan los productos y se calcula el total en USD y en bolívares según la tasa del día (consultada a la API `open.er-api.com` y guardada en `localStorage` como respaldo).
- Se capturan los datos del cliente (nombre, cédula, teléfono) con formateo automático de campos.
- Validaciones de formulario y modales de carga / éxito / error.
- Bloqueo de "salir sin guardar" (evento `beforeunload`) para no perder una venta a medio capturar.
- Al confirmar, la factura se envía como TEMPORAL a `POST /api/precargar-factura`.

### 7.3 Pedidos
**Archivos:** `assets/pages/pedidos.html` + `js/pedidos.js`

Pensado para ventas gestionadas por WhatsApp, permitiendo atender varios pedidos en paralelo.

- Barra lateral para manejar múltiples pedidos abiertos a la vez, cada uno con su propio cliente, productos y tasa de cambio.
- Genera una vista previa del mensaje al estilo burbuja de WhatsApp y abre WhatsApp (`wa.me`) con el mensaje ya redactado.
- Persistencia local: guarda un borrador de cada pedido y una cola de "pendientes por enviar" en `localStorage`, con reintento manual si falla la conexión al guardar (mismo endpoint que Facturación: `/api/precargar-factura`).

### 7.4 Verificación de pagos
**Archivos:** `assets/pages/verificacion.html` + `js/verificacion.js`

Módulo central del control de pagos: revisa las facturas temporales pendientes (`GET /api/gestion-temporales`), permite editar productos y totales, y aprobar o rechazar cada factura confirmando manualmente los datos del pago.

- Formulario dinámico según el método de pago elegido — ver la tabla en [2.1](#21-se-eliminó-el-flujo-de-comprobante-de-pago-por-qr).
- Para efectivo (`ED`/`EBS`), calcula el vuelto a entregar automáticamente a partir del monto recibido.
- Al aprobar, envía `PATCH`/`POST` a `/api/gestion-temporales` con `estado="aprobado"`, lo que dispara la migración a tablas definitivas en el backend.
- Genera automáticamente una nota de entrega imprimible (ticket térmico) tras la aprobación, con opción de imprimir copias adicionales o reimprimir más tarde si falla la impresora; el usuario decide cuándo continuar con la siguiente factura (no hay recarga automática de la lista).

### 7.5 Facturas de hoy (Historial)
**Archivos:** `assets/pages/historial.html` + `js/facturasRecientes.js`

Lista las facturas ya definitivas creadas en el día en curso, consultando directamente a Supabase (tablas `facturas` + `factura_detalles`), con opción de ver el detalle de productos de cada una.

### 7.6 Panel de administración
**Archivos:** `assets/pages/administrador.html` + `js/admin-panel.js`

Página protegida (requiere sesión y rol admin, vía `auth-guard.js`). Es el centro de control gerencial del sistema.

- KPIs y gráficos (Chart.js) de ventas por rango de fechas.
- Detalle de cada factura; si la factura tiene un `comprobante_path` guardado (facturas antiguas, previas a la eliminación del flujo de QR), muestra la imagen alojada en el bucket `comprobantes`. Para facturas nuevas normalmente no habrá nada que mostrar.
- Módulo de comisiones: cálculo por vendedor según un porcentaje configurable (tabla `comisiones_config`), registro y marcado de pagos realizados (`comisiones_pagos`, `comisiones_historial`).

### 7.7 Reportes
**Archivos:** `assets/pages/reportes.html` + `js/reportes.js`

Cierre de caja del día, reporte de ventas por rango de fechas, reporte de comisiones y reimpresión de facturas.

- Todo el material imprimible (ticket térmico y hoja tamaño carta) se genera con plantillas HTML propias, impresas a través de un iframe oculto.
- El cierre de caja agrupa las ventas del día por método de pago y calcula totales en USD y bolívares.

### 7.8 Login
**Archivos:** `assets/pages/login.html` + `js/auth-guard.js`

Inicio de sesión contra Supabase Auth. `auth-guard.js` se incluye en TODAS las páginas internas del sistema (portada, facturación, pedidos, verificación, historial, reportes y administrador): sin sesión válida, redirige aquí automáticamente y, tras iniciar sesión, regresa a la página que se quería ver (parámetro `?next=`). Queda pública, a propósito, solo `login.html`.

---

## 8. Backend — funciones serverless (api/)

Las tres funciones están escritas como manejadores HTTP puros (`http.server.BaseHTTPRequestHandler`) en lugar de un framework como Flask o FastAPI. Todas comparten patrones comunes de seguridad y robustez:

- Validan el tamaño del cuerpo de la solicitud (`Content-Length`) antes de leerlo, para evitar solicitudes desproporcionadas.
- Sanean y limitan la longitud máxima de cada campo de texto (nombre, cédula, teléfono, observaciones, etc.) y del nombre de cada producto (máximo 120 caracteres).
- Usan una sesión de `requests` con reintentos automáticos (backoff) ante errores 502/503/504 de Supabase.
- Hablan con Supabase usando la clave secreta (`SUPABASE_SECRET_KEY`), nunca la anon key, y nunca exponen esa clave al navegador.
- Validan una lista blanca de métodos de pago: `PM`, `PVD`, `PVC`, `ED`, `EBS`, `OTROS`.

### 8.1 Tabla de endpoints

| Endpoint | Método | Función | Tope de solicitud | Tope de productos |
|---|---|---|---|---|
| `/api/precargar-factura` | POST | Valida una factura (cliente, productos, tasa) y la guarda como TEMPORAL vía la función de base de datos `guardar_factura_temporal`. Usado por Facturación y Pedidos. | 1 MB | 150 |
| `/api/gestion-temporales` | GET / POST / PATCH | GET: lista facturas temporales pendientes. PATCH/POST: edita campos de una factura temporal, o -si `estado="aprobado"`- la migra a tablas definitivas ejecutando `guardar_factura_completa`. Usado por Verificación. | 512 KB | 150 |
| `/api/guardar-factura` | POST | Crea una factura DEFINITIVA directamente, ejecutando `guardar_factura_completa` sin pasar por el estado temporal. | 512 KB | 150 |

### 8.2 POST /api/precargar-factura

Recibe los datos de la venta (cliente, productos, tasa de cambio, totales en USD/Bs) y los valida exhaustivamente antes de tocar la base de datos:

- `id_factura` debe respetar el patrón `^[A-Za-z0-9-]{1,64}$`.
- Cada producto debe tener nombre (máximo 120 caracteres), cantidad > 0, precio unitario ≥ 0 y precio total ≥ 0; máximo 150 productos por factura.
- `subtotal_usd`, `total_usd`, `subtotal_bs`, `total_bs` y `tasa_cambio` deben ser numéricos y mayores a 0.
- Campos de texto del cliente con longitud máxima: nombre y apellido (80), cédula y teléfono (20), vendedor (80), referencia y banco (40), observaciones (500).

Si todo es válido, calcula una fecha de expiración de 1 hora para la factura temporal y llama a la función RPC `guardar_factura_temporal` en Supabase, enviando la cabecera (`p_factura`) y el detalle de productos (`p_detalles`) en una sola petición.

### 8.3 GET / POST / PATCH /api/gestion-temporales

**GET:** consulta en Supabase todas las facturas en estado `"pendiente"` (`facturas_temporales`), incluyendo sus detalles anidados.

**PATCH/POST — edición simple de campos:** si el cuerpo no trae `estado="aprobado"`, se interpreta como una edición normal (por ejemplo, corregir un dato) y se aplica un PATCH directo sobre `facturas_temporales`.

**PATCH/POST — aprobación (`estado="aprobado"`):** sigue estos pasos internamente:

1. Consulta la factura temporal original para recuperar los datos del cliente que el formulario de aprobación no permite editar (nombre, apellido, cédula, teléfono, vendedor).
2. Valida los productos editados que llegan en el cuerpo de la petición (pueden diferir de los originales si el verificador los corrigió en pantalla; hasta 150 productos, 120 caracteres por nombre).
3. Valida el método de pago elegido (lista blanca) y la longitud de campos como referencia, banco y observaciones.
4. Valida que los totales recalculados (`subtotal_usd`, `descuento_usd`, `total_usd`, `total_bs`) sean numéricos.
5. Determina la tasa de cambio final: la que envíe el verificador, o la de la factura temporal, o -si ninguna existe- la deriva dividiendo `total_bs` entre `total_usd`.
6. Arma la factura definitiva combinando los datos fijos del cliente con los datos editados, y llama a la RPC `guardar_factura_completa` (misma función que usa `/api/guardar-factura`), insertando cabecera y detalle de forma atómica.
7. Solo si la migración fue exitosa, elimina el registro y los detalles de la tabla temporal — así nunca queda una factura duplicada ni a medio migrar.

### 8.4 POST /api/guardar-factura

Crea una factura definitiva directamente, sin pasar por el estado temporal (por ejemplo, para registrar una venta ya cerrada de una vez). Valida los mismos campos que `precargar-factura.py` (con el mismo tope de 150 productos), además del método de pago, y llama a `guardar_factura_completa`. Ya no acepta ni procesa ningún archivo de comprobante.

---

## 9. Base de datos (Supabase)

No existe un archivo de esquema SQL completo en el repositorio; las siguientes tablas y funciones se identifican por su uso en el código.

### 9.1 Tablas

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

### 9.2 Funciones RPC (Postgres)

- `guardar_factura_temporal(p_factura, p_detalles)` — inserta la cabecera y el detalle de una venta en las tablas temporales.
- `guardar_factura_completa(p_factura, p_detalles)` — inserta la cabecera y el detalle de una venta en las tablas definitivas, de forma atómica. La usan tanto la aprobación de una factura temporal como la creación directa de una factura definitiva.

### 9.3 Storage

**Bucket `comprobantes`:** almacena imágenes de comprobantes de pago **de facturas anteriores a la eliminación del flujo de QR** (ver [2.2](#22-el-bucket-de-storage-comprobantes-queda-en-modo-solo-lectura-heredada)). Ninguna pantalla actual del sistema escribe archivos nuevos en este bucket; solo el Panel de administración lo lee, y únicamente si la factura consultada ya tenía un `comprobante_path` guardado de antes.

### 9.4 Auth

Supabase Auth gestiona la sesión del personal que usa el sistema (login por correo y contraseña). No existe registro público: los usuarios se crean a mano desde el panel de Supabase.

---

## 10. Seguridad

El modelo de seguridad del sistema se apoya en dos capas independientes que no deben confundirse.

### 10.1 Capa 1 — Login en el navegador

`login.html` + `js/auth-guard.js` exigen un correo/contraseña válido (Supabase Auth) para poder ver las páginas del sistema. Esto evita que alguien sin relación con el negocio entre por curiosidad o adivine la URL. `auth-guard.js` además lee el rol del usuario desde la tabla `perfiles` y oculta o bloquea el acceso a Administrador y Reportes si el rol no es admin.

### 10.2 Capa 2 — Row Level Security (RLS) en Supabase

Este es el control **real**. La `anon key` visible en `js/supabase-config.js` está pensada para ser pública: viaja al navegador de cualquier visitante, haya iniciado sesión o no. Si alguien copia esa clave desde las herramientas de desarrollador y hace peticiones directas a la API de Supabase, **el login de la capa 1 no lo detiene en absoluto**. Solo RLS, activado tabla por tabla en el panel de Supabase, puede bloquear ese acceso.

> **Conclusión:** el login mejora el acceso desde el navegador, pero si RLS no está activo en Supabase, los datos (facturas, cédulas, teléfonos, comisiones) siguen expuestos a quien tenga la anon key.

### 10.3 Checklist pendiente en el panel de Supabase

- Desactivar el registro público (self sign-up) en Authentication → Providers.
- Activar **Enable RLS** en cada tabla sensible (`facturas`, `factura_detalles`, `facturas_temporales`, `detalles_factura_temporal`, `comisiones_config`, `comisiones_historial`, `comisiones_pagos`) y agregar políticas que solo permitan acceso a usuarios autenticados.
- En el bucket `comprobantes`: a diferencia de la versión anterior, **ya no hay ninguna pantalla que necesite escribir ahí sin sesión** (el flujo de QR fue eliminado — ver sección 2). Esto simplifica la política de seguridad: ya puede restringirse el bucket completo a usuarios autenticados, sin necesidad de dejar una ruta abierta al rol `anon`.
- Si se quiere que el rol también aplique a nivel de base de datos (por ejemplo, que solo un admin pueda leer `comisiones_historial` aunque alguien use la anon key directamente), agregar políticas RLS que consulten la tabla `perfiles`.

### 10.4 Páginas protegidas vs. públicas

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

### 10.5 Las funciones serverless ya están bien encaminadas

Las tres funciones en `api/*.py` usan `SUPABASE_SECRET_KEY` (clave de servicio) como variable de entorno en Vercel, nunca copiada al frontend. Es importante verificar en Vercel (Project → Settings → Environment Variables) que `SUPABASE_URL` y `SUPABASE_SECRET_KEY` estén definidas únicamente ahí.

### 10.6 Cómo crear el primer usuario

Desde Supabase → Authentication → Users → Add user, se crea el correo y contraseña del personal que administrará el sistema, y se comparten por un canal seguro. No existe formulario de auto-registro, por diseño.

---

## 11. Configuración y despliegue

### 11.1 vercel.json

Activa `cleanUrls` y define dos *rewrites* de rutas amigables:

- `/factura/:id → /factura.html?id=:id` (nota: actualmente no existe `factura.html` en el repositorio, por lo que esta ruta queda sin efecto hasta que se cree esa página).
- `/home → /index.html`

### 11.2 Variables de entorno esperadas por el backend

| Variable | Uso |
|---|---|
| `SUPABASE_URL` | URL base del proyecto de Supabase, usada por las tres funciones en `api/`. |
| `SUPABASE_SECRET_KEY` | Clave de servicio de Supabase; nunca debe copiarse al frontend. |
| `FRONTEND_DOMAIN` | Declarada en `guardar-factura.py` con valor por defecto, pero sin ningún uso activo detectado en el código actual. |

### 11.3 Dependencias

`requirements.txt` declara una única dependencia Python: `requests==2.31.0`, usada para todas las llamadas HTTP hacia la API REST de Supabase.

### 11.4 Configuración del frontend

`js/supabase-config.js` centraliza la `SUPABASE_URL` y la anon key pública, evitando que estuvieran duplicadas en varios archivos.

---

## 12. Anexo — Resumen de todos los archivos

### 12.1 Frontend (JavaScript)

| Archivo | Responsabilidad |
|---|---|
| `js/supabase-config.js` | Configuración central: URL y anon key de Supabase. |
| `js/utils.js` | Helpers compartidos: `escapeHtml` (previene XSS al insertar datos dinámicos) y `encodeQueryValue`. |
| `js/auth-guard.js` | Exige sesión válida en todas las páginas internas; controla acceso por rol (admin/personal). |
| `js/facturacion.js` | Lógica del módulo de Facturación (venta de mostrador). |
| `js/pedidos.js` | Lógica del módulo de Pedidos (ventas por WhatsApp, múltiples pedidos en paralelo). |
| `js/verificacion.js` | Lógica del módulo de Verificación: revisión, edición, confirmación manual del pago, aprobación/rechazo y nota de entrega imprimible. |
| `js/facturasRecientes.js` | Lógica de Historial (facturas definitivas del día). |
| `js/admin-panel.js` | Lógica del Panel de administración: KPIs, gráficos y comisiones. |
| `js/reportes.js` | Lógica de Reportes: cierre de caja, ventas, comisiones e impresión. |

### 12.2 Backend (Python)

| Archivo | Responsabilidad |
|---|---|
| `api/precargar-factura.py` | Crea facturas temporales, validando exhaustivamente cliente, productos y montos. |
| `api/gestion-temporales.py` | Lista, edita y aprueba/migra facturas temporales a las tablas definitivas. |
| `api/guardar-factura.py` | Crea facturas definitivas directamente. |

### 12.3 Estilos (CSS)

Cada módulo tiene su propia hoja de estilos en `assets/css/` (`facturacion.css`, `pedidos.css`, `verificacion.css`, `reportes.css`, `admin-panel.css`), además de `global.css` y `main.css` con estilos y variables compartidas (colores, tipografía, sombras).
