# Resumen de la revisión — bugs encontrados y corregidos

## 🔴 Seguridad

1. **Panel de administración sin autenticación.** `administrador.html` e
   `historial.html` mostraban todas las facturas (nombre, cédula, teléfono,
   comisiones) a cualquiera que tuviera la URL. Se agregó un login con
   Supabase Auth (`assets/pages/login.html`, `js/auth-guard.js`) que exige
   sesión iniciada para ver estas páginas. **Importante:** lee
   `SECURITY.md`, falta un paso en Supabase (RLS) para que la protección
   sea completa.

2. **XSS almacenado.** Nombre de producto, nombre/apellido de cliente,
   vendedor, referencia y banco se insertaban con `innerHTML` sin escapar
   en el panel de administración, el historial y la factura pública. Como
   el backend no sanitiza esos campos (y la API es alcanzable directamente,
   sin pasar por el frontend), alguien podía guardar una factura con HTML/JS
   en el nombre del producto y ejecutarlo en el navegador de quien viera esa
   factura o el panel de administración. Se agregó `escapeHtml()` en
   `js/utils.js` y se aplicó en `admin-panel.js`, `facturasRecientes.js`,
   `generarFactura.js` y `facturacion.js`.

3. **`onclick="fn('${valorDelUsuario}')"` en HTML generado dinámicamente.**
   Se reemplazó por `data-*` attributes + delegación de eventos, para que un
   valor con comillas no pudiera romper el atributo HTML e inyectar código.

4. **Backend sin límite de tamaño de solicitud.** Un `Content-Length` enorme
   se leía completo en memoria antes de validar nada. Ahora se corta antes
   de leer si supera el límite esperado.

5. **Excepciones no controladas en el backend → error 500 sin JSON.** Si
   `cantidad` o los precios de un producto no eran números, `float(...)`
   lanzaba una excepción sin capturar y el servidor moría a medio
   procesar, sin responder JSON (el frontend mostraba "el servidor no
   devolvió una respuesta JSON válida"). Ahora todo el flujo de guardado
   está envuelto en manejo de errores y cada conversión numérica válida su
   propio try/except con mensaje claro.

6. **Sin límites de longitud ni lista blanca de métodos de pago** en el
   backend: cualquier texto arbitrariamente largo se guardaba tal cual, y
   `metodo_pago` no se validaba contra los valores reales que la UI
   soporta. Se agregaron longitudes máximas y una lista blanca de métodos.

7. **`id_factura` sin formato validado.** Se usa para construir la ruta del
   comprobante en Supabase Storage y para filtrar consultas; sin validar,
   un valor con "/" o caracteres especiales podía alterar esa ruta. Ahora
   se exige un patrón `[A-Za-z0-9-]`.

8. **Falta de `encodeURIComponent`/escape al construir URLs de consulta**
   con `id_factura` (en `generarFactura.js`, `admin-panel.js`,
   `facturasRecientes.js`) y al construir el link de WhatsApp en el backend.

## 🟠 Bugs funcionales

9. **Mensaje de error copiado y pegado mal.** Al elegir el método de pago
   "OTROS" y no adjuntar comprobante, la alerta decía *"Para Pago Móvil..."*
   en vez de *"Para el método 'OTROS'..."*.

10. **Las "Observaciones" del formulario de pago nunca se guardaban.** Se
    pedían en el formulario (métodos ED y OTROS) pero no se incluían en los
    datos enviados al backend: se perdían en silencio. Ahora se envían como
    `observaciones` (ver nota en `SECURITY.md`/`CAMBIOS` sobre actualizar la
    función `guardar_factura_completa` en Supabase para que las guarde).

11. **`vercel.json` con un rewrite roto.** `/factura/:token` redirigía a
    `/factura.html?token=:token`, pero el código de `generarFactura.js` (y el
    link que genera el backend) siempre usó el parámetro `id`, nunca
    `token`. Esa URL "bonita" nunca funcionó. Se corrigió a `/factura/:id` →
    `/factura.html?id=:id`.

## 🟡 Mantenibilidad

12. **La URL y la clave de Supabase estaban copiadas y pegadas en cuatro
    archivos** (`admin-panel.js`, `facturasRecientes.js`,
    `generarFactura.js`). Se centralizaron en `js/supabase-config.js`.

## Pendiente que requiere acceso a Supabase (no se puede hacer desde el código)
- Activar Row Level Security y crear las políticas descritas en
  `SECURITY.md`.
- Crear el usuario administrador en Supabase Auth para poder iniciar sesión
  en el nuevo login.
- Si se quiere conservar el campo `observaciones`, actualizar la función
  `guardar_factura_completa` y la tabla `facturas` para que lo acepten.

## Actualización — comprobante que fallaba solo en algunos celulares
Las fotos que toma la cámara de un celular pesan varios MB. Al convertirlas
a base64 (~33% más pesado) y sumarlas al resto del JSON de la factura, era
fácil superar el límite de tamaño de solicitud de las funciones serverless
(en Vercel, ~4.5MB en el plan gratuito). Cuando eso ocurre, Vercel corta la
petición **antes** de que la función en Python llegue a ejecutarse — por
eso no aparecía ningún error en los logs del servidor, solo en los
celulares con cámaras de mayor resolución.

Se agregó `comprimirImagenComprobante()` en `js/facturacion.js`: redimensiona
la foto a un ancho máximo razonable y la recomprime como JPEG en el propio
navegador antes de convertirla a base64 y enviarla. Así el tamaño real del
comprobante ya no depende de la cámara del dispositivo. Si el navegador no
puede procesar el formato (caso raro), se sigue con el archivo original tal
cual funcionaba antes.

