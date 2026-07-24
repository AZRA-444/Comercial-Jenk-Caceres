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
        """
        Al hacer una petición GET a este archivo en Vercel, 
        automáticamente consultará las facturas temporales.
        """
        self._consultar_temporales()

    def do_PATCH(self):
        """
        Al hacer una petición PATCH a este archivo en Vercel, 
        automáticamente editará la factura temporal.
        """
        self._editar_temporal()
        
    def do_POST(self):
        """
        Opcional: Por si tu frontend tiene problemas enviando PATCH, 
        puedes usar POST como alternativa para editar.
        """
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
        if nuevo_estado == "aprobado":
            headers_supabase = {
                "apikey": KEY_SUPABASE,
                "Authorization": f"Bearer {KEY_SUPABASE}",
                "Content-Type": "application/json",
            }

            try:
                # 1. Consultar la factura temporal completa con sus detalles
                url_get_temp = f"{URL_SUPABASE}/rest/v1/facturas_temporales?id_factura=eq.{id_factura}&select=*,detalles_factura_temporal(*)"
                res_temp = session.get(url_get_temp, headers=headers_supabase, timeout=10)
                
                if res_temp.status_code != 200 or not res_temp.json():
                    self._responder(404, {"status": "error", "message": "No se encontró la factura temporal a aprobar"})
                    return

                factura_temp = res_temp.json()[0]
                detalles = factura_temp.pop("detalles_factura_temporal", [])

                # Cambiamos el estado a aprobado para la tabla definitiva
                factura_temp["estado"] = "aprobado"

                factura_temp = res_temp.json()[0]
                detalles = factura_temp.pop("detalles_factura_temporal", [])

                # Limpiamos los campos que no existen en la tabla definitiva 'facturas'
                factura_temp.pop("creado_en", None)
                factura_temp.pop("estado", None) # <-- Eliminamos el estado para evitar el error de columna inexistente

                # 2. Insertar en la tabla definitiva 'facturas'
                url_insert_factura = f"{URL_SUPABASE}/rest/v1/facturas"
                res_ins_fac = session.post(url_insert_factura, json=factura_temp, headers={**headers_supabase, "Prefer": "return=minimal"}, timeout=10)
               
                if res_ins_fac.status_code not in (200, 201, 204):
                    self._responder(502, {"status": "error", "message": f"Error al migrar a la tabla facturas: {res_ins_fac.text}"})
                    return

                # 3. Insertar los detalles en la tabla definitiva 'factura_detalles' (si existen)
                if detalles:
                    # Opcional: Limpiamos campos internos o de relación si Supabase los genera automáticamente
                    for det in detalles:
                        det.pop("id", None) # Eliminar ID autoincremental temporal si lo hubiera
                        
                    url_insert_detalles = f"{URL_SUPABASE}/rest/v1/factura_detalles"
                    res_ins_det = session.post(url_insert_detalles, json=detalles, headers={**headers_supabase, "Prefer": "return=minimal"}, timeout=10)
                    
                    if res_ins_det.status_code not in (200, 201, 204):
                        self._responder(502, {"status": "error", "message": f"Error al migrar los detalles: {res_ins_det.text}"})
                        return

                # 4. Eliminar el registro de las tablas temporales (la cascada de Supabase suele borrar los detalles temporales, o los borramos explícitamente)
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
