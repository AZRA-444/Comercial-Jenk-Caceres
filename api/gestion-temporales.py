from http.server import BaseHTTPRequestHandler
import json
import os
import re
import requests
from requests.adapters import HTTPAdapter, Retry

# Configuración básica.
MAX_BYTES_SOLICITUD = 512 * 1024  # 512 KB (ediciones normales de campos y aprobación)

# Métodos de pago que el sistema realmente sabe procesar; igual que en
# guardar-factura.py, cualquier otro valor se rechaza en vez de guardarse
# "tal cual" en la tabla definitiva.
# TRANSF = Transferencia bancaria (standalone). COMB = Pago Combinado, cuyas
# líneas individuales llegan en "pagos_combinados" (ver _validar_pagos_combinados).
METODOS_PAGO_VALIDOS = {"PM", "PVD", "PVC", "ED", "EBS", "TRANSF", "COMB", "OTROS"}

# Sub-métodos que pueden aparecer dentro de una línea de Pago Combinado.
SUBMETODOS_COMBINABLES = {"PM", "TRANSF", "PVD", "PVC", "ED", "EBS"}
MAX_LINEAS_PAGO_COMBINADO = 20

MAX_PRODUCTOS_POR_FACTURA = 150
LONGITUD_MAXIMA_NOMBRE_PRODUCTO = 120
LONGITUDES_MAXIMAS = {
    "referencia": 40,
    "banco": 40,
    "observaciones": 500,
}

ID_FACTURA_REGEX = re.compile(r"^[A-Za-z0-9\-]{1,64}$")

URL_SUPABASE = os.environ.get("SUPABASE_URL", "")
KEY_SUPABASE = os.environ.get("SUPABASE_SECRET_KEY", "")

# Sesión con reintentos para evitar fallos de red
session = requests.Session()
retries = Retry(
    total=3,
    backoff_factor=0.5,
    status_forcelist=[502, 503, 504],
    allowed_methods=["GET", "POST", "PATCH"],
)
session.mount("https://", HTTPAdapter(max_retries=retries))


def _validar_productos_editados(productos):
    """Valida la lista de productos editados que llega al aprobar una factura.
    Devuelve un mensaje de error (str) o None si todo está bien."""
    if not isinstance(productos, list) or not productos:
        return "La factura no puede aprobarse sin productos"
    if len(productos) > MAX_PRODUCTOS_POR_FACTURA:
        return f"La factura no puede tener más de {MAX_PRODUCTOS_POR_FACTURA} productos"

    for i, p in enumerate(productos):
        if not isinstance(p, dict):
            return f"Producto #{i+1}: formato inválido"

        nombre = p.get("nombre") or p.get("nombre_producto")
        cantidad = p.get("cantidad")
        precio_unitario = p.get("precioUnitario") if p.get("precioUnitario") is not None else p.get("precio_unitario")
        precio_total = p.get("precioTotal") if p.get("precioTotal") is not None else p.get("precio_total")

        if not nombre:
            return f"Producto #{i+1}: falta el nombre"
        if len(str(nombre)) > LONGITUD_MAXIMA_NOMBRE_PRODUCTO:
            return f"Producto #{i+1}: el nombre supera los {LONGITUD_MAXIMA_NOMBRE_PRODUCTO} caracteres permitidos"

        try:
            if float(cantidad) <= 0:
                raise ValueError
        except (TypeError, ValueError):
            return f"Producto #{i+1} ({nombre}): cantidad inválida"

        try:
            if float(precio_unitario) < 0:
                raise ValueError
        except (TypeError, ValueError):
            return f"Producto #{i+1} ({nombre}): precio unitario inválido"

        try:
            if float(precio_total) < 0:
                raise ValueError
        except (TypeError, ValueError):
            return f"Producto #{i+1} ({nombre}): precio total inválido"

    return None


def _validar_pagos_combinados(pagos, total_usd, tasa_cambio):
    """Valida la lista de líneas de un Pago Combinado (metodo_pago == 'COMB').
    Cada línea representa un pago individual (ej. un Pago Móvil, una
    Transferencia Bancaria, un monto en Efectivo, etc.) y varias líneas
    pueden compartir el mismo código de método (ej. dos Pagos Móviles de
    teléfonos distintos).

    Devuelve (mensaje_de_error | None, suma_total_en_usd).
    """
    if not isinstance(pagos, list) or not pagos:
        return "El Pago Combinado debe incluir al menos un método de pago", 0.0
    if len(pagos) > MAX_LINEAS_PAGO_COMBINADO:
        return f"El Pago Combinado no puede tener más de {MAX_LINEAS_PAGO_COMBINADO} líneas", 0.0

    tasa = float(tasa_cambio) if tasa_cambio else 1.0
    suma_usd = 0.0

    for i, p in enumerate(pagos):
        etiqueta = f"Pago combinado #{i + 1}"
        if not isinstance(p, dict):
            return f"{etiqueta}: formato inválido", 0.0

        codigo = p.get("codigo")
        if codigo not in SUBMETODOS_COMBINABLES:
            return f"{etiqueta}: método '{codigo}' no reconocido", 0.0

        moneda = p.get("moneda") or ("USD" if codigo in ("ED", "PVC") else "BS")
        if moneda not in ("USD", "BS"):
            return f"{etiqueta}: moneda inválida", 0.0

        monto_nativo = p.get("montoNativo", p.get("monto"))
        try:
            monto_nativo = float(monto_nativo)
            if monto_nativo <= 0:
                raise ValueError
        except (TypeError, ValueError):
            return f"{etiqueta}: monto inválido", 0.0

        # Pago Móvil y Transferencia Bancaria requieren banco + referencia,
        # igual que cuando se seleccionan como método de pago único.
        if codigo in ("PM", "TRANSF"):
            if not str(p.get("banco") or "").strip():
                return f"{etiqueta}: falta el banco", 0.0
            ref = str(p.get("referencia") or "").strip()
            ref_min = 4 if codigo == "PM" else 1
            if len(ref) < ref_min:
                return f"{etiqueta}: falta el número de referencia", 0.0

        for campo in ("banco", "referencia"):
            valor = p.get(campo)
            if valor and len(str(valor)) > LONGITUDES_MAXIMAS.get(campo, 40):
                return f"{etiqueta}: el campo '{campo}' supera la longitud máxima permitida", 0.0

        suma_usd += monto_nativo if moneda == "USD" else (monto_nativo / tasa if tasa else monto_nativo)

    if suma_usd < (float(total_usd) - 0.01):
        faltante = float(total_usd) - suma_usd
        return (
            f"El Pago Combinado ingresado (${suma_usd:.2f}) no cubre el total de la factura "
            f"(${float(total_usd):.2f}). Faltan ${faltante:.2f}",
            suma_usd,
        )

    return None, suma_usd


class handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        """Manejo de CORS para Vercel."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def _responder(self, status_code, payload):
        """Función auxiliar para enviar respuestas JSON estándar."""
        self.send_response(status_code)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode('utf-8'))

    def do_GET(self):
        """Consulta automáticamente las facturas temporales pendientes."""
        self._consultar_temporales()

    def do_PATCH(self):
        """Edita o aprueba la factura temporal."""
        self._editar_temporal()
        
    def do_POST(self):
        """Alternativa para editar/aprobar."""
        self._editar_temporal()

    # --- LÓGICA DE LAS ACCIONES ---

    def _consultar_temporales(self):
        """Consulta en Supabase las facturas en estado 'pendiente'."""
        url_supabase_get = f"{URL_SUPABASE}/rest/v1/facturas_temporales?estado=eq.pendiente&select=*,detalles_factura_temporal(*)"
        headers_supabase = {
            "apikey": KEY_SUPABASE,
            "Authorization": f"Bearer {KEY_SUPABASE}",
        }
        
        try:
            res = session.get(url_supabase_get, headers=headers_supabase, timeout=10)
            if res.status_code == 200:
                self._responder(200, {"status": "success", "data": res.json()})
            else:
                self._responder(502, {"status": "error", "message": f"Error al consultar DB: {res.text}"})
        except Exception as e:
            self._responder(500, {"status": "error", "message": f"Error interno: {str(e)}"})

    def _editar_temporal(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length <= 0 or content_length > MAX_BYTES_SOLICITUD:
                self._responder(400, {"status": "error", "message": "Cuerpo de solicitud inválido o muy grande"})
                return

            post_data = self.rfile.read(content_length)
            body_data = json.loads(post_data.decode('utf-8'))
        except Exception:
            self._responder(400, {"status": "error", "message": "JSON inválido"})
            return

        id_factura = body_data.get("id_factura")
        if not id_factura:
            self._responder(400, {"status": "error", "message": "Se requiere el 'id_factura' para editar"})
            return

        nuevo_estado = body_data.get("estado")

        # CASO ESPECIAL: Si se está aprobando, migramos a las tablas definitivas
        # aplicando lo que el verificador haya editado en el formulario de
        # aprobación (productos, totales recalculados y método de pago).
        # Estos datos NO viven en facturas_temporales: llegan únicamente en
        # el body de esta misma petición (ver verificacion.js).
        if nuevo_estado == "aprobado":
            headers_supabase = {
                "apikey": KEY_SUPABASE,
                "Authorization": f"Bearer {KEY_SUPABASE}",
                "Content-Type": "application/json",
            }

            if not ID_FACTURA_REGEX.match(str(id_factura)):
                self._responder(400, {"status": "error", "message": "id_factura tiene un formato inválido"})
                return

            try:
                # 1. Consultar la factura temporal SOLO para los datos del cliente
                #    que el formulario de aprobación no permite editar (nombre,
                #    apellido, cédula, teléfono, vendedor, tasa de cambio).
                url_get_temp = f"{URL_SUPABASE}/rest/v1/facturas_temporales?id_factura=eq.{id_factura}&select=*"
                res_temp = session.get(url_get_temp, headers=headers_supabase, timeout=10)

                if res_temp.status_code != 200 or not res_temp.json():
                    self._responder(404, {"status": "error", "message": "No se encontró la factura temporal a aprobar"})
                    return

                factura_temp = res_temp.json()[0]

                # 2. Validar los productos editados (llegan en el body, no en la
                #    tabla temporal: son la copia editable que el verificador
                #    pudo modificar en pantalla).
                productos = body_data.get("productos")
                error_productos = _validar_productos_editados(productos)
                if error_productos:
                    self._responder(400, {"status": "error", "message": error_productos})
                    return

                # 3. Validar el método de pago elegido en el formulario de aprobación
                metodo_pago = body_data.get("metodo_pago")
                if metodo_pago not in METODOS_PAGO_VALIDOS:
                    self._responder(400, {"status": "error", "message": f"Método de pago no reconocido: {metodo_pago}"})
                    return

                for campo, longitud in LONGITUDES_MAXIMAS.items():
                    valor = body_data.get(campo)
                    if valor is not None and len(str(valor)) > longitud:
                        self._responder(400, {"status": "error", "message": f"El campo {campo} supera la longitud máxima permitida ({longitud} caracteres)"})
                        return

                # 4. Validar los totales recalculados que envía el verificador
                try:
                    subtotal_usd = float(body_data.get("subtotal_usd"))
                    descuento_usd = float(body_data.get("descuento_usd", 0))
                    total_usd = float(body_data.get("total_usd"))
                    total_bs = float(body_data.get("total_bs"))
                except (TypeError, ValueError):
                    self._responder(400, {"status": "error", "message": "Los totales recalculados deben ser numéricos"})
                    return

                # 5. Obtener la tasa de cambio:
                #    Acepta si el verificador la actualizó en el body, o la toma de la temporal.
                #    Si no existe en ninguna, la deriva de total_bs / total_usd.
                tasa_cambio_raw = body_data.get("tasa_cambio") or factura_temp.get("tasa_cambio")
                
                try:
                    tasa_cambio = float(tasa_cambio_raw) if tasa_cambio_raw is not None else (total_bs / total_usd if total_usd > 0 else 1.0)
                except (TypeError, ValueError):
                    tasa_cambio = (total_bs / total_usd) if total_usd > 0 else 1.0

                tasa_cambio = float(tasa_cambio)

                subtotal_bs = round(subtotal_usd * tasa_cambio, 2)
                descuento_bs = round(descuento_usd * tasa_cambio, 2)

                # 5b. Validaciones específicas de Pago Combinado / Transferencia Bancaria.
                #     Se hacen aquí (y no en el paso 3) porque necesitan total_usd y
                #     tasa_cambio ya calculados para poder sumar las líneas y compararlas
                #     contra el total real de la factura.
                pagos_combinados = body_data.get("pagos_combinados") or []

                if metodo_pago == "COMB":
                    error_comb, _suma_cubierta = _validar_pagos_combinados(pagos_combinados, total_usd, tasa_cambio)
                    if error_comb:
                        self._responder(400, {"status": "error", "message": error_comb})
                        return
                elif metodo_pago == "TRANSF":
                    if not str(body_data.get("banco") or "").strip() or body_data.get("banco") == "N/A":
                        self._responder(400, {"status": "error", "message": "Para Transferencia Bancaria se requiere indicar el banco"})
                        return
                    if not str(body_data.get("referencia") or "").strip() or body_data.get("referencia") == "N/A":
                        self._responder(400, {"status": "error", "message": "Para Transferencia Bancaria se requiere el número de referencia"})
                        return
                    pagos_combinados = []  # no aplica fuera de Pago Combinado
                else:
                    pagos_combinados = []  # no aplica a métodos que no son COMB

                # 6. Armar la factura definitiva combinando lo fijo con lo editado.
                p_factura = {
                    "id_factura": id_factura,
                    "nombre": factura_temp.get("nombre"),
                    "apellido": factura_temp.get("apellido", ""),
                    "cedula": factura_temp.get("cedula", ""),
                    "telefono": factura_temp.get("telefono"),
                    "vendedor": factura_temp.get("vendedor", "Cajero General"),
                    "tasa_cambio": tasa_cambio,  # <--- SE AGREGA ESTE CAMPO PARA LA TABLA DEFINITIVA
                    "subtotal_usd": subtotal_usd,
                    "descuento_usd": descuento_usd,
                    "total_usd": total_usd,
                    "subtotal_bs": subtotal_bs,
                    "descuento_bs": descuento_bs,
                    "total_bs": total_bs,
                    "metodo_pago": metodo_pago,
                    "referencia": body_data.get("referencia", "N/A"),
                    "banco": body_data.get("banco", "N/A"),
                    "observaciones": body_data.get("observaciones", ""),
                    # Detalle estructurado de cada línea del Pago Combinado (lista vacía
                    # para el resto de métodos). Requiere la columna jsonb
                    # `pagos_combinados` en la tabla `facturas` — ver supabase/pagos_combinados.sql.
                    "pagos_combinados": pagos_combinados,
                }

                p_detalles = [
                    {
                        "nombre_producto": p.get("nombre") or p.get("nombre_producto"),
                        "cantidad": p.get("cantidad"),
                        "precio_unitario": p.get("precioUnitario") if p.get("precioUnitario") is not None else p.get("precio_unitario"),
                        "precio_total": p.get("precioTotal") if p.get("precioTotal") is not None else p.get("precio_total"),
                    }
                    for p in productos
                ]

                # 7. Insertar cabecera + detalles atómicamente vía la misma RPC
                #    que usa guardar-factura.py, para no dejar nunca una factura
                #    a medio migrar si algo falla a mitad de camino.
                url_rpc = f"{URL_SUPABASE}/rest/v1/rpc/guardar_factura_completa"
                res_rpc = session.post(
                    url_rpc,
                    json={"p_factura": p_factura, "p_detalles": p_detalles},
                    headers=headers_supabase,
                    timeout=15,
                )

                if res_rpc.status_code not in (200, 204):
                    self._responder(502, {"status": "error", "message": f"No se pudo migrar la factura a las tablas definitivas: {res_rpc.text}"})
                    return

                # 8. Solo si la migración fue exitosa se elimina el registro temporal
                url_del_detalles = f"{URL_SUPABASE}/rest/v1/detalles_factura_temporal?id_factura=eq.{id_factura}"
                session.delete(url_del_detalles, headers=headers_supabase, timeout=10)

                url_del_factura = f"{URL_SUPABASE}/rest/v1/facturas_temporales?id_factura=eq.{id_factura}"
                session.delete(url_del_factura, headers=headers_supabase, timeout=10)

                self._responder(200, {
                    "status": "success",
                    "message": "Factura aprobada y migrada exitosamente a tablas definitivas"
                })
                return

            except Exception as e:
                self._responder(500, {"status": "error", "message": f"Error interno durante la migración: {str(e)}"})
                return

        # FLUJO NORMAL PARA OTROS CAMPOS (si no es aprobación directa)
        if "id_factura" in body_data:
            del body_data["id_factura"]

        if not body_data:
            self._responder(400, {"status": "error", "message": "No se enviaron campos para actualizar"})
            return

        url_supabase_patch = f"{URL_SUPABASE}/rest/v1/facturas_temporales?id_factura=eq.{id_factura}"
        headers_supabase = {
            "apikey": KEY_SUPABASE,
            "Authorization": f"Bearer {KEY_SUPABASE}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }

        try:
            res = session.patch(url_supabase_patch, json=body_data, headers=headers_supabase, timeout=10)
            if res.status_code in (200, 204):
                response_data = res.json() if (res.status_code == 200 and res.text) else None
                self._responder(200, {
                    "status": "success", 
                    "message": "Factura temporal actualizada correctamente",
                    "data": response_data
                })
            else:
                self._responder(502, {"status": "error", "message": f"Error al actualizar: {res.text}"})
        except Exception as e:
            self._responder(500, {"status": "error", "message": f"Error interno: {str(e)}"})
