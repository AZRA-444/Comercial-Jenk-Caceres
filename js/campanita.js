// ============================================================
// CAMPANITA DE NOTIFICACIONES
// ============================================================
// Se incluye en TODAS las páginas protegidas del sistema, después de
// auth-guard.js y utils.js (el orden exacto no importa siempre que
// ambos ya estén en la página; este script espera el evento
// "cjc:rol-listo" que dispara auth-guard.js cuando ya sabe el rol).
//
// Qué hace:
//   - Dibuja un botón de campana fijo en pantalla (arriba a la
//     izquierda, para no chocar con el botón "Salir" del portal ni
//     con los botones "Volver" de cada módulo).
//   - Lee las notificaciones ACTIVAS de la tabla `notificaciones` en
//     Supabase (lectura pública para cualquier usuario autenticado,
//     ver supabase/notificaciones.sql) y las muestra en un desplegable.
//   - Marca cuántas no se han visto usando localStorage (por
//     navegador/dispositivo, no por usuario) y limpia el contador al
//     abrir el desplegable.
//   - Si el usuario es sysAdmin, agrega un acceso directo al panel de
//     gestión (assets/pages/notificaciones.html).
//
// Las notificaciones las publica el sysAdmin desde ese panel; este
// script NUNCA escribe en la tabla, solo lee.
// ============================================================
(function () {
  const LS_ULTIMA_VISTA = "cjc_notif_ultima_vista";
  const LIMITE_NOTIFICACIONES = 20;

  const ICONOS_TIPO = {
    novedad: "fa-sparkles",
    mejora: "fa-arrow-up",
    aviso: "fa-circle-info",
    urgente: "fa-triangle-exclamation",
  };
  const COLOR_TIPO = {
    novedad: "#c0527a",
    mejora: "#2d7d52",
    aviso: "#b5700d",
    urgente: "#c0392b",
  };

  function yaExiste() {
    return !!document.getElementById("campanita-btn");
  }

  function inyectarEstilos() {
    if (document.getElementById("campanita-estilos")) return;
    const style = document.createElement("style");
    style.id = "campanita-estilos";
    style.textContent = `
      #campanita-btn {
        position: fixed; top: 14px; left: 14px; z-index: 9999;
        width: 40px; height: 40px; border: none; border-radius: 10px;
        background: #fff; color: #8c3357; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 10px rgba(0,0,0,.14);
        font-size: 1rem; transition: transform .15s ease, box-shadow .15s ease;
      }
      #campanita-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,.18); }
      #campanita-badge {
        position: absolute; top: -4px; right: -4px;
        min-width: 17px; height: 17px; padding: 0 4px;
        border-radius: 999px; background: #c0392b; color: #fff;
        font-size: .65rem; font-weight: 700; line-height: 17px; text-align: center;
        box-shadow: 0 0 0 2px #fff;
      }
      #campanita-panel {
        position: fixed; top: 60px; left: 14px; z-index: 9999;
        width: min(360px, calc(100vw - 28px)); max-height: min(480px, calc(100vh - 90px));
        background: #fff; border-radius: 14px; overflow: hidden;
        box-shadow: 0 8px 32px rgba(26,18,24,.18);
        display: none; flex-direction: column;
        font-family: 'Inter', sans-serif;
      }
      #campanita-panel.abierto { display: flex; }
      #campanita-panel header {
        padding: 14px 16px; border-bottom: 1px solid #e0d4da;
        display: flex; align-items: center; justify-content: space-between;
      }
      #campanita-panel header h3 { font-size: .9rem; font-weight: 700; color: #1a1218; margin: 0; }
      #campanita-panel .campanita-lista { overflow-y: auto; flex: 1; }
      .campanita-item { padding: 12px 16px; border-bottom: 1px solid #f2e8ee; display: flex; gap: 10px; }
      .campanita-item:last-child { border-bottom: none; }
      .campanita-item .ico {
        width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center; font-size: .8rem; color: #fff;
      }
      .campanita-item .cont { min-width: 0; }
      .campanita-item .titulo { font-size: .82rem; font-weight: 600; color: #1a1218; margin-bottom: 2px; }
      .campanita-item .msg { font-size: .78rem; color: #7a6670; line-height: 1.4; word-break: break-word; }
      .campanita-item .fecha { font-size: .68rem; color: #9e8b96; margin-top: 4px; }
      #campanita-panel .campanita-vacio { padding: 28px 16px; text-align: center; color: #9e8b96; font-size: .8rem; }
      #campanita-panel footer {
        padding: 10px 16px; border-top: 1px solid #e0d4da; text-align: center;
      }
      #campanita-panel footer a { font-size: .78rem; font-weight: 600; color: #8c3357; text-decoration: none; }
      #campanita-panel footer a:hover { text-decoration: underline; }
    `;
    document.head.appendChild(style);
  }

  function construirBoton() {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.id = "campanita-btn";
    boton.setAttribute("aria-label", "Notificaciones del sistema");
    boton.innerHTML = '<i class="fas fa-bell"></i><span id="campanita-badge" style="display:none;"></span>';
    document.body.appendChild(boton);
    return boton;
  }

  function construirPanel() {
    const panel = document.createElement("div");
    panel.id = "campanita-panel";
    panel.innerHTML = `
      <header>
        <h3>Notificaciones</h3>
      </header>
      <div class="campanita-lista"></div>
    `;
    document.body.appendChild(panel);
    return panel;
  }

  function formatearFecha(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const ahoraMs = Date.now() - d.getTime();
    const minutos = Math.floor(ahoraMs / 60000);
    if (minutos < 1) return "justo ahora";
    if (minutos < 60) return `hace ${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `hace ${horas} h`;
    const dias = Math.floor(horas / 24);
    if (dias < 7) return `hace ${dias} d`;
    return d.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  // Las políticas RLS de `notificaciones` exigen un usuario autenticado
  // real (auth.role() = 'authenticated'), así que hay que mandar el
  // access_token de la sesión de Supabase Auth como Authorization, no
  // la anon key sola (la anon key llega como rol "anon", no "authenticated").
  async function obtenerHeadersAutenticados() {
    let token = SUPABASE_ANON_KEY;
    try {
      const { data } = await window.__authClient.auth.getSession();
      if (data && data.session && data.session.access_token) {
        token = data.session.access_token;
      }
    } catch (e) {
      // Si falla, se intenta igual con la anon key (la lectura
      // simplemente devolverá 0 resultados por RLS).
    }
    return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };
  }

  async function cargarNotificaciones() {
    const headers = await obtenerHeadersAutenticados();
    const url =
      `${SUPABASE_URL}/rest/v1/notificaciones` +
      `?activa=eq.true&select=id,titulo,mensaje,tipo,created_at` +
      `&order=created_at.desc&limit=${LIMITE_NOTIFICACIONES}`;

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.warn("No se pudieron cargar las notificaciones:", e);
      return [];
    }
  }

  function renderLista(panel, notificaciones) {
    const cont = panel.querySelector(".campanita-lista");
    if (!notificaciones.length) {
      cont.innerHTML = '<div class="campanita-vacio">No hay notificaciones por ahora.</div>';
      return;
    }
    const esc = typeof escapeHtml === "function" ? escapeHtml : (v) => v;
    cont.innerHTML = notificaciones
      .map((n) => {
        const tipo = ICONOS_TIPO[n.tipo] ? n.tipo : "novedad";
        return `
          <div class="campanita-item">
            <div class="ico" style="background:${COLOR_TIPO[tipo]}"><i class="fas ${ICONOS_TIPO[tipo]}"></i></div>
            <div class="cont">
              <div class="titulo">${esc(n.titulo)}</div>
              <div class="msg">${esc(n.mensaje)}</div>
              <div class="fecha">${formatearFecha(n.created_at)}</div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function agregarAccesoSysAdmin(panel) {
    if (panel.querySelector("footer")) return;
    const enPaginaInterna = location.pathname.includes("/assets/pages/");
    const href = enPaginaInterna ? "notificaciones.html" : "assets/pages/notificaciones.html";
    const footer = document.createElement("footer");
    footer.innerHTML = `<a href="${href}"><i class="fas fa-gear"></i> Gestionar notificaciones</a>`;
    panel.appendChild(footer);
  }

  function actualizarBadge(boton, cantidadNoLeidas) {
    const badge = boton.querySelector("#campanita-badge");
    if (cantidadNoLeidas > 0) {
      badge.textContent = cantidadNoLeidas > 9 ? "9+" : String(cantidadNoLeidas);
      badge.style.display = "block";
    } else {
      badge.style.display = "none";
    }
  }

  async function iniciar() {
    if (yaExiste()) return;
    // Sin config de Supabase no hay nada que consultar.
    if (typeof SUPABASE_URL === "undefined" || typeof SUPABASE_ANON_KEY === "undefined") return;

    inyectarEstilos();
    const boton = construirBoton();
    const panel = construirPanel();

    const notificaciones = await cargarNotificaciones();
    const ultimaVista = localStorage.getItem(LS_ULTIMA_VISTA);
    const noLeidas = ultimaVista
      ? notificaciones.filter((n) => new Date(n.created_at) > new Date(ultimaVista))
      : notificaciones;

    renderLista(panel, notificaciones);
    if (window.__authIsSysAdmin) agregarAccesoSysAdmin(panel);
    actualizarBadge(boton, noLeidas.length);

    boton.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const abierto = panel.classList.toggle("abierto");
      if (abierto && notificaciones.length) {
        localStorage.setItem(LS_ULTIMA_VISTA, notificaciones[0].created_at);
        actualizarBadge(boton, 0);
      }
    });

    document.addEventListener("click", (ev) => {
      if (!panel.contains(ev.target) && ev.target !== boton) {
        panel.classList.remove("abierto");
      }
    });
  }

  // auth-guard.js dispara este evento cuando ya validó sesión y rol.
  // Si por algún motivo ya se disparó antes de que este script cargara
  // (no debería pasar con el orden de <script> recomendado), el timeout
  // de respaldo igual la inicializa.
  document.addEventListener("cjc:rol-listo", iniciar, { once: true });
  setTimeout(() => {
    if (!yaExiste() && window.__authClient) iniciar();
  }, 2500);
})();
