// ============================================================
// GUARDIA DE SESIÓN — PROTEGE TODO EL SISTEMA
// ============================================================
// Este script se incluye en TODAS las páginas internas del sistema
// (portada, facturación, pedidos, verificación, historial, reportes
// y administrador). Antes de dejar ver el contenido, exige una sesión
// válida de Supabase Auth; si no existe, redirige a login.html
// recordando a dónde quería ir el usuario (parámetro ?next=).
//
// Quedan FUERA de esta protección, a propósito:
//   - login.html            → tiene que ser accesible sin sesión.
//   - subir-comprobante.html → la abre el CLIENTE final desde el QR,
//                              sin cuenta en el sistema.
//
// AVISO IMPORTANTE (léase también SECURITY.md):
// Esto controla el acceso desde el navegador, pero la clave "anon" de
// Supabase sigue viajando en el código fuente. Si las tablas de Supabase
// no tienen Row Level Security (RLS) activado, alguien podría seguir
// consultando/editando los datos llamando directamente a la API de
// Supabase, sin pasar por esta página. Este login es la puerta de
// entrada de la aplicación, NO reemplaza a RLS.
// ============================================================
(function () {
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("No se pudo cargar la librería de Supabase (supabase-js). Revisa tu conexión a internet.");
    return;
  }

  // Detecta si estamos dentro de assets/pages/ o en la raíz (index.html),
  // para calcular las rutas relativas correctas hacia login.html / index.html.
  const enPaginaInterna = location.pathname.includes("/assets/pages/");
  const RUTA_LOGIN = enPaginaInterna ? "login.html" : "assets/pages/login.html";
  const RUTA_INICIO = enPaginaInterna ? "../../index.html" : "index.html";

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.__authClient = client;
  window.__authRutaInicio = RUTA_INICIO;

  function irALogin() {
    // Evita loops de redirección si ya estamos en login.html
    if (location.pathname.endsWith("login.html")) return;
    const next = encodeURIComponent(location.pathname + location.search);
    window.location.href = `${RUTA_LOGIN}?next=${next}`;
  }

  function mostrarBotonSalir() {
    // Si la página ya trae su propio botón de "Salir" (ej. administrador.html), no dupliques.
    if (document.querySelector(".btn-cerrar-sesion")) return;
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "btn-cerrar-sesion";
    boton.innerHTML = '<i class="fas fa-right-from-bracket"></i> Salir';
    boton.style.cssText =
      "position:fixed;top:14px;right:14px;z-index:9999;display:inline-flex;align-items:center;" +
      "gap:6px;padding:9px 16px;border:none;border-radius:8px;background:var(--rose,#c0527a);" +
      "color:#fff;font-size:.8rem;font-weight:600;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.18);";
    boton.addEventListener("click", cerrarSesion);
    document.body.appendChild(boton);
  }

  client.auth.getSession().then(({ data, error }) => {
    if (error || !data?.session) {
      irALogin();
      return;
    }
    if (document.body) {
      mostrarBotonSalir();
    } else {
      document.addEventListener("DOMContentLoaded", mostrarBotonSalir);
    }
  });

  client.auth.onAuthStateChange((_event, session) => {
    if (!session) irALogin();
  });
})();

function cerrarSesion() {
  window.__authClient?.auth.signOut().finally(() => {
    window.location.href = window.__authRutaInicio || "../../index.html";
  });
}
