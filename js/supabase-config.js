// ============================================================
// CONFIGURACIÓN CENTRAL DE SUPABASE
// ============================================================
// Antes esta URL y esta clave estaban copiadas y pegadas en cuatro
// archivos distintos (admin-panel.js, facturasRecientes.js,
// generarFactura.js). Tenerla en un solo lugar evita que se actualice
// en unos archivos y en otros no.
//
// IMPORTANTE (seguridad):
// La "anon key" está pensada para ser pública (viaja al navegador de
// cualquier visitante), pero eso SOLO es seguro si en Supabase tienes
// activado Row Level Security (RLS) con políticas que limiten lo que el
// rol "anon" puede leer/escribir. Revisa el archivo SECURITY.md incluido
// en este proyecto: hoy en día, si RLS no está activo, cualquiera con esta
// clave (visible en el código fuente del navegador) puede leer o modificar
// facturas, comisiones y datos de clientes directamente contra la API de
// Supabase, sin pasar por esta página. El login que se agregó al panel de
// administración mejora el acceso casual, pero NO reemplaza a RLS.
// ============================================================
const SUPABASE_URL = "https://etfdwjbgrbxfuoltpgqa.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0ZmR3amJncmJ4ZnVvbHRwZ3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3OTg0NDQsImV4cCI6MjA5ODM3NDQ0NH0.Ap4HsuDjA43fKlTA8DP_ljwIn6vnE_pEw1LiMmFngvU";
