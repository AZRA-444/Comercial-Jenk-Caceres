// ============================================================
// GUARDIA DE SESIÓN Y ROLES — PROTEGE TODO EL SISTEMA
// ============================================================
// Este script se incluye en TODAS las páginas internas del sistema
// (portada, facturación, pedidos, verificación, historial, reportes
// y administrador). Antes de dejar ver el contenido, exige una sesión
// válida de Supabase Auth; si no existe, redirige a login.html
// recordando a dónde quería ir el usuario (parámetro ?next=).
//
// Además, a partir de esta versión, lee el ROL del usuario desde la
// tabla `perfiles` (ver migración SQL en supabase/perfiles.sql) y:
//   - Si la página actual está en PAGINAS_SOLO_ADMIN y el usuario NO
//     es admin, lo devuelve a la portada con un aviso.
//   - Oculta en el DOM cualquier elemento marcado con
//     [data-admin-only] cuando el usuario no es admin (úsalo en
//     index.html para esconder las tarjetas de Administrador/Reportes,
//     o en cualquier botón/acción que quieras limitar).
//
// Queda FUERA de esta protección, a propósito:
//   - login.html → tiene que ser accesible sin sesión.
//
// AVISO IMPORTANTE (léase también SECURITY.md):
// Esto controla el acceso desde el navegador, pero la clave "anon" de
// Supabase sigue viajando en el código fuente. Ocultar un botón o
// redirigir fuera de una página NO impide que alguien con la anon key
// llame directamente a la API de Supabase. El control real de "quién
// puede leer/escribir qué" tiene que vivir en RLS (Row Level Security),
// tabla por tabla, usando el rol guardado en `perfiles`. Este login
// (y el chequeo de rol) es la puerta de entrada de la aplicación, NO
// reemplaza a RLS.
// ============================================================
(function () {
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("No se pudo cargar la librería de Supabase (supabase-js). Revisa tu conexión a internet.");
    return;
  }

  // Páginas que solo puede ver el rol "admin". Se comparan por el
  // nombre de archivo, así que funcionan sin importar desde dónde se
  // incluya este script.
  const PAGINAS_SOLO_ADMIN = ["administrador.html", "reportes.html"];

  // Detecta si estamos dentro de assets/pages/ o en la raíz (index.html),
  // para calcular las rutas relativas correctas hacia login.html / index.html.
  const enPaginaInterna = location.pathname.includes("/assets/pages/");
  const RUTA_LOGIN = enPaginaInterna ? "login.html" : "assets/pages/login.html";
  const RUTA_INICIO = enPaginaInterna ? "../../index.html" : "index.html";

  const paginaActual = location.pathname.split("/").pop();
  const esPaginaSoloAdmin = PAGINAS_SOLO_ADMIN.includes(paginaActual);

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.__authClient = client;
  window.__authRutaInicio = RUTA_INICIO;
  window.__authRole = null; // se rellena tras validar la sesión

  function irALogin() {
    // Evita loops de redirección si ya estamos en login.html
    if (location.pathname.endsWith("login.html")) return;
    const next = encodeURIComponent(location.pathname + location.search);
    window.location.href = `${RUTA_LOGIN}?next=${next}`;
  }

  function irASinPermiso() {
    window.location.href = `${RUTA_INICIO}?motivo=sin_permiso`;
  }

  function mostrarBotonSalir() {
    // El botón de cerrar sesión solo se muestra en el index (portada).
    // Las páginas internas tienen su propio botón "Volver" y no necesitan
    // el botón de salir para evitar confusión al usuario.
    if (enPaginaInterna) return;

    // Si la página ya trae su propio botón de "Salir", no dupliques.
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

  function mostrarAvisoSinPermiso() {
    const params = new URLSearchParams(location.search);
    if (params.get("motivo") !== "sin_permiso") return;

    const aviso = document.createElement("div");
    aviso.textContent = "No tienes permiso para ver esa sección. Habla con un administrador si crees que es un error.";
    aviso.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:9998;padding:12px 20px;text-align:center;" +
      "background:#fdecef;color:#8a2035;font-size:.85rem;font-weight:600;" +
      "border-bottom:1px solid #f3c1cd;";
    document.body.prepend(aviso);
    setTimeout(() => aviso.remove(), 6000);

    // Limpia el parámetro de la URL para que no reaparezca al refrescar.
    params.delete("motivo");
    const queryLimpio = params.toString();
    history.replaceState(null, "", location.pathname + (queryLimpio ? `?${queryLimpio}` : ""));
  }

  // Oculta cualquier elemento marcado como solo-admin cuando el usuario
  // que inició sesión no tiene ese rol (ej. tarjetas de la portada).
  function aplicarVisibilidadPorRol(esAdmin) {
    if (esAdmin) return;
    document.querySelectorAll("[data-admin-only]").forEach((el) => {
      el.style.display = "none";
    });
  }

  async function obtenerRol(userId) {
    const { data, error } = await client
      .from("perfiles")
      .select("rol")
      .eq("id", userId)
      .single();

    if (error || !data) {
      // Sin fila en `perfiles` (o la tabla no existe todavía): se trata
      // como personal normal por seguridad (acceso mínimo por defecto).
      // Ver supabase/perfiles.sql para crear la tabla y asignar el rol.
      console.warn("No se pudo leer el rol del usuario en `perfiles`; se asume 'personal'.", error);
      return "personal";
    }
    return data.rol;
  }

  function alListo(fn) {
    if (document.body) fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  client.auth.getSession().then(async ({ data, error }) => {
    if (error || !data?.session) {
      irALogin();
      return;
    }

    const rol = await obtenerRol(data.session.user.id);
    window.__authRole = rol;
    const esAdmin = rol === "admin";

    if (esPaginaSoloAdmin && !esAdmin) {
      irASinPermiso();
      return;
    }

    alListo(() => {
      mostrarBotonSalir();
      aplicarVisibilidadPorRol(esAdmin);
      mostrarAvisoSinPermiso();
    });
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
