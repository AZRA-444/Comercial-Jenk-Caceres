// ============================================================
// PANEL DE NOTIFICACIONES (solo sysAdmin)
// ============================================================
// Publica, edita, activa/desactiva y borra los anuncios que luego
// ve todo el personal en la campanita (js/campanita.js). Escribe
// directamente contra la tabla `notificaciones` en Supabase; la
// política RLS "Solo sysAdmin gestiona notificaciones" es la que
// realmente impide que alguien sin ese rol pueda insertar/editar/
// borrar, aunque tenga la anon key.
//
// auth-guard.js ya bloquea el acceso a esta página si el rol no es
// sysAdmin (ver PAGINAS_SOLO_SYSADMIN); este script espera su evento
// "cjc:rol-listo" antes de tocar la base de datos.
// ============================================================

const ICONOS_TIPO_ADMIN = {
  novedad: { label: "Novedad", badge: "badge-rose" },
  mejora: { label: "Mejora", badge: "badge-success" },
  aviso: { label: "Aviso", badge: "badge-amber" },
  urgente: { label: "Urgente", badge: "badge-danger" },
};

let notifEnEdicion = null;

function tickClockNotif() {
  const el = document.getElementById("clock");
  if (!el) return;
  el.textContent = new Date().toLocaleString("es-VE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

async function headersAutenticados() {
  let token = SUPABASE_ANON_KEY;
  try {
    const { data } = await window.__authClient.auth.getSession();
    if (data && data.session && data.session.access_token) {
      token = data.session.access_token;
    }
  } catch (e) {
    console.warn("No se pudo obtener el token de sesión:", e);
  }
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function mostrarStatus(msg, esError) {
  const el = document.getElementById("notifStatusMsg");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = esError ? "var(--danger)" : "var(--muted)";
}

function fmtFechaNotif(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("es-VE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

async function cargarTabla() {
  const tbody = document.getElementById("tablaNotificaciones");
  tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Cargando…</td></tr>';

  const headers = await headersAutenticados();
  const url = `${SUPABASE_URL}/rest/v1/notificaciones?select=*&order=created_at.desc&limit=100`;

  let notificaciones = [];
  try {
    const res = await fetch(url, { headers });
    if (res.ok) notificaciones = await res.json();
  } catch (e) {
    console.error(e);
  }

  if (!notificaciones.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Todavía no has publicado ninguna notificación.</td></tr>';
    return;
  }

  tbody.innerHTML = notificaciones
    .map((n) => {
      const tipoInfo = ICONOS_TIPO_ADMIN[n.tipo] || ICONOS_TIPO_ADMIN.novedad;
      return `
        <tr>
          <td class="text-wrap">
            <strong>${escapeHtml(n.titulo)}</strong><br/>
            <span style="color:var(--muted);font-size:.8rem;">${escapeHtml(n.mensaje)}</span>
          </td>
          <td><span class="badge ${tipoInfo.badge}">${tipoInfo.label}</span></td>
          <td>${fmtFechaNotif(n.created_at)}</td>
          <td class="text-center">
            <span class="badge ${n.activa ? "badge-success" : "badge-muted"}">${n.activa ? "Activa" : "Oculta"}</span>
          </td>
          <td class="text-center" style="white-space:nowrap;">
            <button type="button" class="btn-secondary btn-sm" onclick="editarNotificacion('${n.id}')" title="Editar">
              <i class="fas fa-pen"></i>
            </button>
            <button type="button" class="btn-secondary btn-sm" onclick="alternarActiva('${n.id}', ${n.activa})" title="${n.activa ? "Ocultar" : "Reactivar"}">
              <i class="fas ${n.activa ? "fa-eye-slash" : "fa-eye"}"></i>
            </button>
            <button type="button" class="btn-danger btn-sm" onclick="borrarNotificacion('${n.id}')" title="Borrar">
              <i class="fas fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  window.__notificacionesCache = notificaciones;
}

function editarNotificacion(id) {
  const n = (window.__notificacionesCache || []).find((x) => x.id === id);
  if (!n) return;
  notifEnEdicion = id;
  document.getElementById("notifId").value = id;
  document.getElementById("notifTitulo").value = n.titulo;
  document.getElementById("notifMensaje").value = n.mensaje;
  document.getElementById("notifTipo").value = n.tipo;
  document.getElementById("btnGuardarNotif").innerHTML = '<i class="fas fa-check"></i> Guardar cambios';
  document.getElementById("btnCancelarEdicion").style.display = "inline-flex";
  document.getElementById("notifTitulo").scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelarEdicion() {
  notifEnEdicion = null;
  document.getElementById("formNotificacion").reset();
  document.getElementById("notifId").value = "";
  document.getElementById("btnGuardarNotif").innerHTML = '<i class="fas fa-paper-plane"></i> Publicar';
  document.getElementById("btnCancelarEdicion").style.display = "none";
  mostrarStatus("");
}

async function alternarActiva(id, activaActual) {
  const headers = await headersAutenticados();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/notificaciones?id=eq.${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ activa: !activaActual }),
    });
    if (!res.ok) throw new Error(await res.text());
    cargarTabla();
  } catch (e) {
    alert("No se pudo actualizar el estado: " + e.message);
  }
}

async function borrarNotificacion(id) {
  if (!confirm("¿Borrar esta notificación? Ya no se podrá ver en la campanita de nadie.")) return;
  const headers = await headersAutenticados();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/notificaciones?id=eq.${id}`, {
      method: "DELETE",
      headers,
    });
    if (!res.ok) throw new Error(await res.text());
    cargarTabla();
  } catch (e) {
    alert("No se pudo borrar: " + e.message);
  }
}

async function enviarFormulario(ev) {
  ev.preventDefault();
  const titulo = document.getElementById("notifTitulo").value.trim();
  const mensaje = document.getElementById("notifMensaje").value.trim();
  const tipo = document.getElementById("notifTipo").value;

  if (!titulo || !mensaje) {
    mostrarStatus("Completa el título y el mensaje.", true);
    return;
  }

  const btn = document.getElementById("btnGuardarNotif");
  btn.disabled = true;
  mostrarStatus("Guardando…");

  const headers = await headersAutenticados();

  try {
    let res;
    if (notifEnEdicion) {
      res = await fetch(`${SUPABASE_URL}/rest/v1/notificaciones?id=eq.${notifEnEdicion}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ titulo, mensaje, tipo }),
      });
    } else {
      const { data } = await window.__authClient.auth.getSession();
      res = await fetch(`${SUPABASE_URL}/rest/v1/notificaciones`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          titulo,
          mensaje,
          tipo,
          creado_por: data?.session?.user?.id || null,
        }),
      });
    }

    if (!res.ok) throw new Error(await res.text());

    mostrarStatus(notifEnEdicion ? "Notificación actualizada." : "Notificación publicada.");
    cancelarEdicion();
    cargarTabla();
  } catch (e) {
    console.error(e);
    mostrarStatus("No se pudo guardar: revisa la consola.", true);
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener("cjc:rol-listo", () => {
  cargarTabla();
  tickClockNotif();
  setInterval(tickClockNotif, 30000);
});

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("formNotificacion").addEventListener("submit", enviarFormulario);
  document.getElementById("btnCancelarEdicion").addEventListener("click", cancelarEdicion);
});
