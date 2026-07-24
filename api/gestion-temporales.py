from http.server import BaseHTTPRequestHandler
import json
import os
import requests
from requests.adapters import HTTPAdapter, Retry

# Configuración básica
MAX_BYTES_SOLICITUD = 512 * 1024  # 512 KB

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
        """Consulta las facturas temporales pendientes."""
        self._consultar_temporales()

    def do_PATCH(self):
        """Edita la factura temporal."""
        self._editar_temporal()
        
    def do_POST(self):
        """Alternativa POST para editar."""
        self._editar_temporal()

    # --- LÓGICA DE LAS ACCIONES ---

    def _consultar_temporales(self):
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

        # Eliminamos el id_factura del cuerpo para no alterar la llave primaria
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
            res = session.patch(
                url_supabase_patch,
                json=body_data,
                headers=headers_supabase,
                timeout=10
            )
            
            if res.status_code in (200, 204):
                # Validamos de manera segura si hay contenido antes de parsear JSON
                response_data = None
                if res.status_code == 200 and res.text:
                    try:
                        response_data = res.json()
                    except json.JSONDecodeError:
                        response_data = None

                self._responder(200, {
                    "status": "success", 
                    "message": "Factura temporal actualizada correctamente",
                    "data": response_data
                })
            else:
                self._responder(502, {"status": "error", "message": f"Error al actualizar: {res.text}"})
                
        except Exception as e:
            self._responder(500, {"status": "error", "message": f"Error interno: {str(e)}"})
