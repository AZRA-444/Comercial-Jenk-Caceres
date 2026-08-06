from http.server import BaseHTTPRequestHandler
import json
import os
import re
import requests
from requests.adapters import HTTPAdapter, Retry

MAX_BYTES_SOLICITUD = 512 * 1024  # 512 KB
MAX_PRODUCTOS_POR_FACTURA = 150
# TRANSF = Transferencia bancaria (standalone). COMB = Pago Combinado, cuyas
# líneas individuales llegan en "pagos_combinados" (ver _validar_pagos_combinados).
METODOS_PAGO_VALIDOS = {"PM", "PVD", "PVC", "ED", "EBS", "TRANSF", "COMB", "OTROS"}
SUBMETODOS_COMBINABLES = {"PM", "TRANSF", "PVD", "PVC", "ED", "EBS"}
MAX_LINEAS_PAGO_COMBINADO = 20

ID_FACTURA_REGEX = re.compile(r"^[A-Za-z0-9\-]{1,64}$")

LONGITUDES_MAXIMAS = {
    "nombre": 80,
    "apellido": 80,
    "cedula": 20,
    "telefono": 20,
    "vendedor": 80,
    "referencia": 40,
    "banco": 40,
    "observaciones": 500,
}
LONGITUD_MAXIMA_NOMBRE_PRODUCTO = 120

URL_SUPABASE = os.environ.get("SUPABASE_URL", "")
KEY_SUPABASE = os.environ.get("SUPABASE_SECRET_KEY", "")
FRONTEND_DOMAIN = os.environ.get("FRONTEND_DOMAIN", "https://sistema-de-facturacion-cjc.vercel.app")

session = requests.Session()
retries = Retry(
    total=3,
    backoff_factor=0.5,
    status_forcelist=[502, 503, 504],
    allowed_methods=["POST"],
)
session.mount("https://", HTTPAdapter(max_retries=retries))


def validar_factura(data):
    """Valida los datos mínimos antes de tocar la base de datos."""
    if not isinstance(data, dict):
        return "El cuerpo de la solicitud debe ser un objeto JSON"

    id_factura = data.get("id_factura")
    if not id_factura:
        return "Falta id_factura"
    if not ID_FACTURA_REGEX.match(str(id_factura)):
        return "id_factura tiene un formato inválido"

    if not data.get("nombre"):
        return "Falta el nombre del cliente"

    for campo, longitud in LONGITUDES_MAXIMAS.items():
        valor = data.get(campo)
        if valor is not None and len(str(valor)) > longitud:
            return f"El campo {campo} supera la longitud máxima permitida ({longitud} caracteres)"

    metodo_pago = data.get("metodo_pago")
    if metodo_pago is not None and metodo_pago not in METODOS_PAGO_VALIDOS:
        return f"Método de pago no reconocido: {metodo_pago}"

    if metodo_pago == "COMB":
        error_comb = _validar_pagos_combinados(
            data.get("pagos_combinados"), data.get("total_usd"), data.get("tasa_cambio", 1.0)
        )
        if error_comb:
            return error_comb
    elif metodo_pago == "TRANSF":
        if not str(data.get("banco") or "").strip():
            return "Para Transferencia Bancaria se requiere indicar el banco"
        if not str(data.get("referencia") or "").strip():
            return "Para Transferencia Bancaria se requiere el número de referencia"

    productos = data.get("productos", [])
    if not isinstance(productos, list) or not productos:
        return "La factura no tiene productos"
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
            cantidad_num = float(cantidad)
        except (TypeError, ValueError):
            return f"Producto #{i+1} ({nombre}): cantidad inválida"
        if cantidad_num <= 0:
            return f"Producto #{i+1} ({nombre}): cantidad inválida"

        try:
            precio_unitario_num = float(precio_unitario)
        except (TypeError, ValueError):
            return f"Producto #{i+1} ({nombre}): precio unitario inválido"
        if precio_unitario_num < 0:
            return f"Producto #{i+1} ({nombre}): precio unitario inválido"

        try:
            precio_total_num = float(precio_total)
        except (TypeError, ValueError):
            return f"Producto #{i+1} ({nombre}): precio total inválido"
        if precio_total_num < 0:
            return f"Producto #{i+1} ({nombre}): precio total inválido"

    for campo in ("subtotal_usd", "total_usd", "subtotal_bs", "total_bs"):
        valor = data.get(campo)
        if valor is None:
            return f"Falta el campo {campo}"
        try:
            float(valor)
        except (TypeError, ValueError):
            return f"El campo {campo} debe ser numérico"

    # Validar tasa_cambio si viene en la solicitud
    tasa = data.get("tasa_cambio")
    if tasa is not None:
        try:
            if float(tasa) <= 0:
                return "La tasa de cambio debe ser mayor a cero"
        except (TypeError, ValueError):
            return "La tasa de cambio debe ser un número válido"

    return None


def _validar_pagos_combinados(pagos, total_usd, tasa_cambio):
    """Misma validación que usa api/gestion-temporales.py para las líneas de
    un Pago Combinado, replicada aquí porque este endpoint (creación directa
    de factura definitiva) también acepta metodo_pago == 'COMB'."""
    if not isinstance(pagos, list) or not pagos:
        return "El Pago Combinado debe incluir al menos un método de pago"
    if len(pagos) > MAX_LINEAS_PAGO_COMBINADO:
        return f"El Pago Combinado no puede tener más de {MAX_LINEAS_PAGO_COMBINADO} líneas"

    try:
        tasa = float(tasa_cambio) if tasa_cambio else 1.0
    except (TypeError, ValueError):
        tasa = 1.0

    suma_usd = 0.0
    for i, p in enumerate(pagos):
        etiqueta = f"Pago combinado #{i + 1}"
        if not isinstance(p, dict):
            return f"{etiqueta}: formato inválido"

        codigo = p.get("codigo")
        if codigo not in SUBMETODOS_COMBINABLES:
            return f"{etiqueta}: método '{codigo}' no reconocido"

        moneda = p.get("moneda") or ("USD" if codigo in ("ED", "PVC") else "BS")
        if moneda not in ("USD", "BS"):
            return f"{etiqueta}: moneda inválida"

        try:
            monto_nativo = float(p.get("montoNativo", p.get("monto")))
            if monto_nativo <= 0:
                raise ValueError
        except (TypeError, ValueError):
            return f"{etiqueta}: monto inválido"

        if codigo in ("PM", "TRANSF"):
            if not str(p.get("banco") or "").strip():
                return f"{etiqueta}: falta el banco"
            ref = str(p.get("referencia") or "").strip()
            ref_min = 4 if codigo == "PM" else 1
            if len(ref) < ref_min:
                return f"{etiqueta}: falta el número de referencia"

        for campo in ("banco", "referencia"):
            valor = p.get(campo)
            if valor and len(str(valor)) > LONGITUDES_MAXIMAS.get(campo, 40):
                return f"{etiqueta}: el campo '{campo}' supera la longitud máxima permitida"

        suma_usd += monto_nativo if moneda == "USD" else (monto_nativo / tasa if tasa else monto_nativo)

    try:
        total_usd_num = float(total_usd)
    except (TypeError, ValueError):
        total_usd_num = 0.0

    if suma_usd < (total_usd_num - 0.01):
        faltante = total_usd_num - suma_usd
        return (
            f"El Pago Combinado ingresado (${suma_usd:.2f}) no cubre el total de la factura "
            f"(${total_usd_num:.2f}). Faltan ${faltante:.2f}"
        )

    return None


class handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def _responder(self, status_code, payload):
        self.send_response(status_code)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode('utf-8'))

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
        except ValueError:
            self._responder(400, {"status": "error", "message": "Content-Length inválido"})
            return

        if content_length <= 0:
            self._responder(400, {"status": "error", "message": "Solicitud vacía"})
            return

        if content_length > MAX_BYTES_SOLICITUD:
            self._responder(413, {"status": "error", "message": "La solicitud supera el tamaño máximo permitido"})
            return

        try:
            post_data = self.rfile.read(content_length)
            factura_data = json.loads(post_data.decode('utf-8'))
        except (json.JSONDecodeError, ValueError, UnicodeDecodeError):
            self._responder(400, {"status": "error", "message": "JSON inválido en la solicitud"})
            return

        try:
            self._procesar_factura(factura_data)
        except Exception as e:
            print(f"❌ Error inesperado al procesar la factura: {e}")
            self._responder(500, {
                "status": "error",
                "message": "Ocurrió un error inesperado al procesar la factura. Intenta de nuevo.",
            })

    def _procesar_factura(self, factura_data):
        # === 1. Validación previa ===
        error_validacion = validar_factura(factura_data)
        if error_validacion:
            self._responder(400, {"status": "error", "message": error_validacion})
            return

        # === 2. Estructura de cabecera con tasa_cambio incluida ===
        p_factura = {
            "id_factura": factura_data.get("id_factura"),
            "nombre": factura_data.get("nombre"),
            "apellido": factura_data.get("apellido", ""),
            "cedula": factura_data.get("cedula", ""),
            "telefono": factura_data.get("telefono"),
            "vendedor": factura_data.get("vendedor", "Cajero General"),
            "subtotal_usd": factura_data.get("subtotal_usd"),
            "descuento_usd": factura_data.get("descuento_usd", 0),
            "total_usd": factura_data.get("total_usd"),
            "subtotal_bs": factura_data.get("subtotal_bs"),
            "descuento_bs": factura_data.get("descuento_bs", 0),
            "total_bs": factura_data.get("total_bs"),
            "tasa_cambio": factura_data.get("tasa_cambio", 1.0),
            "metodo_pago": factura_data.get("metodo_pago"),
            "referencia": factura_data.get("referencia"),
            "banco": factura_data.get("banco"),
            "observaciones": factura_data.get("observaciones", ""),
            # Detalle estructurado del Pago Combinado (lista vacía para el resto
            # de métodos). Requiere la columna jsonb `pagos_combinados` en la
            # tabla `facturas` — ver supabase/pagos_combinados.sql.
            "pagos_combinados": factura_data.get("pagos_combinados") or [] if factura_data.get("metodo_pago") == "COMB" else [],
        }

        p_detalles = [
            {
                "nombre_producto": p.get("nombre") or p.get("nombre_producto"),
                "cantidad": p.get("cantidad"),
                "precio_unitario": p.get("precioUnitario") if p.get("precioUnitario") is not None else p.get("precio_unitario"),
                "precio_total": p.get("precioTotal") if p.get("precioTotal") is not None else p.get("precio_total"),
            }
            for p in factura_data.get("productos", [])
        ]

        headers_supabase = {
            "apikey": KEY_SUPABASE,
            "Authorization": f"Bearer {KEY_SUPABASE}",
            "Content-Type": "application/json",
        }

        url_rpc = f"{URL_SUPABASE}/rest/v1/rpc/guardar_factura_completa"

        try:
            res = session.post(
                url_rpc,
                json={"p_factura": p_factura, "p_detalles": p_detalles},
                headers=headers_supabase,
                timeout=15,
            )
        except requests.exceptions.RequestException as e:
            self._responder(502, {"status": "error", "message": f"No se pudo conectar con la base de datos: {e}"})
            return

        if res.status_code not in (200, 204):
            print(f"⚠️ Falló guardar_factura_completa: {res.status_code} {res.text}")
            self._responder(502, {
                "status": "error",
                "message": f"No se pudo guardar la factura: {res.text}",
            })
            return

        # === 3. Respuesta exitosa al cliente ===
        self._responder(200, {
            "status": "success",
            "message": "Factura guardada exitosamente.",
            "id_factura": p_factura["id_factura"]
        })