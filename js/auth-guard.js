// ============================================================
// GUARDIA DE SESIÓN PARA PÁGINAS DE ADMINISTRACIÓN
// ============================================================
// Antes de este archivo, cualquiera que conociera la URL de
// administrador.html o historial.html podía ver todas las facturas,
// cédulas, teléfonos y comisiones sin iniciar sesión. Este script exige
// una sesión válida de Supabase Auth antes de dejar ver la página.
//
// AVISO IMPORTANTE (léase también SECURITY.md):
// Esto mejora el acceso desde el navegador, pero la clave "anon" de
// Supabase sigue viajando en el código fuente. Si las tablas de Supabase
// no tienen Row Level Security (RLS) activado, alguien podría seguir
// consultando/editando los datos llamando directamente a la API de
// Supabase, sin pasar por esta página. Este login es un control de UX,
// no un reemplazo de RLS.
// ============================================================
(function () {
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("No se pudo cargar la librería de Supabase (supabase-js). Revisa tu conexión a internet.");
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.__authClient = client;

  function irALogin() {
    // Evita loops de redirección si ya estamos en login.html
    if (!location.pathname.endsWith("login.html")) {
      window.location.href = "login.html";
    }
  }

  client.auth.getSession().then(({ data, error }) => {
    if (error || !data?.session) {
      irALogin();
    }
  });

  client.auth.onAuthStateChange((_event, session) => {
    if (!session) irALogin();
  });
})();

function cerrarSesion() {
  window.__authClient?.auth.signOut().finally(() => {
    window.location.href = "login.html";
  });
}
