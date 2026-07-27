from http.server import BaseHTTPRequestHandler
import base64
import json
import os
import re
import time
from urllib.parse import quote
import requests
from requests.adapters import HTTPAdapter, Retry

BUCKET_COMPROBANTES = "comprobantes"
EXTENSIONES_PERMITIDAS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
}
MAX_BYTES_COMPROBANTE = 5 * 1024 * 1024  # 5MB

MAX_BYTES_SOLICITUD = int(MAX_BYTES_COMPROBANTE * 1.5) + (256 * 1024)
MAX_PRODUCTOS_POR_FACTURA = 300
METODOS_PAGO_VALIDOS = {"PM", "PVD", "PVC", "ED", "EBS", "OTROS"}

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


def subir_comprobante(comprobante_base64, comprobante_tipo, id_factura):
    """Decodifica el base64 recibido y lo sube a Supabase Storage."""
    extension = EXTENSIONES_PERMITIDAS.get(comprobante_tipo)
    if not extension:
        return None, f"Tipo de imagen no soportado: {comprobante_tipo}"

    try:
        binario = base64.b64decode(comprobante_base64, validate=True)
    except Exception:
        return None, "El comprobante no es un base64 válido"

    if len(binario) > MAX_BYTES_COMPROBANTE:
        return None, "El comprobante supera el tamaño máximo permitido (5MB)"

    path = f"{id_factura}-{int(time.time())}.{extension}"
    url_subida = f"{URL_SUPABASE}/storage/v1/object/{BUCKET_COMPROBANTES}/{path}"

    headers = {
        "apikey": KEY_SUPABASE,
        "Authorization": f"Bearer {KEY_SUPABASE}",
        "Content-Type": comprobante_tipo,
        "x-upsert": "false",
    }

    try:
        res = session.post(url_subida, headers=headers, data=binario, timeout=15)
    except requests.exceptions.RequestException as e:
        return None, f"No se pudo conectar con Supabase Storage: {e}"

    if res.status_code not in (200, 201):
        return None, f"No se pudo subir el comprobante: {res.text}"

    return path, None


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

        # === 2. Subida del comprobante ===
        comprobante_path = None
        comprobante_base64 = factura_data.get("comprobante_base64")
        comprobante_tipo = factura_data.get("comprobante_tipo")

        if comprobante_base64 and comprobante_tipo:
            comprobante_path, error_comprobante = subir_comprobante(
                comprobante_base64,
                comprobante_tipo,
                factura_data.get("id_factura"),
            )
            if error_comprobante:
                self._responder(400, {"status": "error", "message": error_comprobante})
                return

        # === 3. Estructura de cabecera con tasa_cambio incluida ===
        p_factura = {
            "comprobante_path": comprobante_path,
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

        # === 4. Respuesta exitosa al cliente ===
        self._responder(200, {
            "status": "success",
            "message": "Factura guardada exitosamente.",
            "id_factura": p_factura["id_factura"]
        })