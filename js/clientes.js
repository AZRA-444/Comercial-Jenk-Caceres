// ============================================================
// DIRECTORIO DE CLIENTES: búsqueda y autorrelleno por cédula
// ============================================================
// Se incluye en Facturación y Pedidos, DESPUÉS de supabase-config.js,
// auth-guard.js y utils.js (usa SUPABASE_URL, SUPABASE_ANON_KEY y,
// si está disponible, window.__authClient que crea auth-guard.js).
//
// Lee/escribe la tabla `clientes` (ver supabase/clientes.sql), que se
// precarga una vez con los datos históricos de `facturas` y luego se
// mantiene al día automáticamente cada vez que se confirma una venta
// nueva (ver guardarClienteSiNuevo, llamada desde facturacion.js y
// pedidos.js tras un envío exitoso al backend).
//
// Uso típico en un módulo (ver facturacion.js / pedidos.js):
//
//   activarAutorrellenoCliente({
//     inputCedula: document.getElementById('documentID'),
//     campos: {
//       nombre:   document.getElementById('nameClient'),
//       apellido: document.getElementById('secondNameClient'),
//       telefono: document.getElementById('numberPhone'),
//     },
//   });
// ============================================================

const CLIENTES_TABLA = "clientes";
const CLIENTES_CEDULA_MIN_DIGITOS = 6; // mismo mínimo que usa pedidos.js para validar

// --- Normalización -------------------------------------------------------

/** Deja solo los dígitos de una cédula (quita puntos, espacios, "V-", etc). */
function limpiarCedulaDigitos(valor) {
  return String(valor || "").replace(/\D/g, "");
}

/** Convierte un teléfono guardado en cualquier formato usado por el sistema
 *  (con o sin +58, con o sin guiones) al formato "0412-345-6789" que
 *  esperan los campos de Facturación y Pedidos. */
function formatearTelefonoParaCampo(telefono) {
  let digitos = String(telefono || "").replace(/\D/g, "");
  if (digitos.startsWith("58") && digitos.length === 12) {
    digitos = "0" + digitos.slice(2); // +58xxxxxxxxxx -> 0xxxxxxxxxx
  }
  if (digitos.length > 7) {
    return (
      digitos.slice(0, 4) + "-" + digitos.slice(4, 7) + "-" + digitos.slice(7, 11)
    );
  }
  if (digitos.length > 4) {
    return digitos.slice(0, 4) + "-" + digitos.slice(4);
  }
  return digitos;
}

// --- Acceso a Supabase -----------------------------------------------------

/** Igual patrón que js/notificaciones-admin.js: usa el token de la sesión
 *  activa si está disponible, y si no cae de vuelta a la anon key. */
async function _clientesHeadersAutenticados() {
  let token = SUPABASE_ANON_KEY;
  try {
    if (window.__authClient) {
      const { data } = await window.__authClient.auth.getSession();
      if (data?.session?.access_token) {
        token = data.session.access_token;
      }
    }
  } catch (e) {
    console.warn("No se pudo obtener el token de sesión (clientes):", e);
  }
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/** Busca un cliente por cédula. Devuelve el registro ({nombre, apellido,
 *  cedula, telefono}) o null si no existe o si algo falla. Nunca lanza. */
async function buscarClientePorCedula(cedula) {
  const digitos = limpiarCedulaDigitos(cedula);
  if (digitos.length < CLIENTES_CEDULA_MIN_DIGITOS) return null;

  try {
    const headers = await _clientesHeadersAutenticados();
    const url =
      `${SUPABASE_URL}/rest/v1/${CLIENTES_TABLA}` +
      `?cedula=eq.${encodeQueryValue(digitos)}` +
      `&select=nombre,apellido,cedula,telefono&limit=1`;

    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;

    const filas = await resp.json();
    return Array.isArray(filas) && filas[0] ? filas[0] : null;
  } catch (e) {
    console.warn("Error buscando cliente por cédula:", e);
    return null;
  }
}

/** Crea o actualiza (upsert por cédula) un cliente en el directorio.
 *  Pensada para llamarse "en segundo plano" justo después de que una
 *  venta se registró con éxito: si esta llamada falla, no afecta la
 *  venta ya guardada, solo significa que el directorio no quedó al día. */
async function guardarClienteSiNuevo(cliente) {
  const digitos = limpiarCedulaDigitos(cliente?.cedula);
  const nombre = String(cliente?.nombre || "").trim();
  if (!digitos || digitos.length < CLIENTES_CEDULA_MIN_DIGITOS || !nombre) return;

  try {
    const headers = await _clientesHeadersAutenticados();
    headers["Prefer"] = "resolution=merge-duplicates";

    await fetch(`${SUPABASE_URL}/rest/v1/${CLIENTES_TABLA}?on_conflict=cedula`, {
      method: "POST",
      headers,
      body: JSON.stringify([
        {
          cedula: digitos,
          nombre,
          apellido: String(cliente?.apellido || "").trim(),
          telefono: String(cliente?.telefono || "").trim(),
        },
      ]),
    });
  } catch (e) {
    console.warn("No se pudo actualizar el directorio de clientes:", e);
  }
}

// --- Enganche a un formulario (input de cédula + campos a autorrellenar) --

function _inyectarEstilosClientes() {
  if (document.getElementById("estilos-cliente-lookup")) return;
  const style = document.createElement("style");
  style.id = "estilos-cliente-lookup";
  style.textContent = `
    .cliente-lookup-status {
      display: block;
      font-size: .78rem;
      margin-top: 4px;
      min-height: 1em;
    }
    .cliente-lookup-status.encontrado    { color: var(--success, #2d7d52); }
    .cliente-lookup-status.buscando      { color: var(--muted, #7a6670); }
    .cliente-lookup-status.no-encontrado { color: var(--muted, #7a6670); }
  `;
  document.head.appendChild(style);
}

/**
 * Engancha un input de cédula: mientras el usuario escribe, busca (con un
 * pequeño debounce) un cliente ya registrado y, si lo encuentra,
 * autorrellena los campos indicados.
 *
 * @param {Object} opts
 * @param {HTMLInputElement} opts.inputCedula  Input de cédula (ej. #documentID, #pedCedula)
 * @param {Object} opts.campos                 { nombre, apellido, telefono } -> inputs a autorrellenar
 * @param {Function} [opts.onEncontrado]       callback(cliente) tras autorrellenar (ej. sincronizar estado)
 * @param {number} [opts.debounceMs]
 */
function activarAutorrellenoCliente({
  inputCedula,
  campos = {},
  onEncontrado,
  debounceMs = 450,
}) {
  if (!inputCedula) return;
  _inyectarEstilosClientes();

  let statusEl = inputCedula.parentElement?.querySelector(".cliente-lookup-status");
  if (!statusEl) {
    statusEl = document.createElement("small");
    statusEl.className = "cliente-lookup-status";
    inputCedula.insertAdjacentElement("afterend", statusEl);
  }

  const setStatus = (texto, clase) => {
    statusEl.textContent = texto;
    statusEl.className = `cliente-lookup-status ${clase || ""}`.trim();
  };

  let timer = null;
  let ultimaBusqueda = "";

  inputCedula.addEventListener("input", () => {
    const digitos = limpiarCedulaDigitos(inputCedula.value);
    clearTimeout(timer);

    if (digitos.length < CLIENTES_CEDULA_MIN_DIGITOS) {
      setStatus("");
      ultimaBusqueda = "";
      return;
    }

    setStatus("Buscando cliente…", "buscando");

    timer = setTimeout(async () => {
      if (digitos === ultimaBusqueda) return;
      ultimaBusqueda = digitos;

      const cliente = await buscarClientePorCedula(digitos);

      // El usuario pudo seguir escribiendo mientras se resolvía la búsqueda.
      if (limpiarCedulaDigitos(inputCedula.value) !== digitos) return;

      if (!cliente) {
        setStatus("Cliente no registrado, se guardará como nuevo.", "no-encontrado");
        return;
      }

      if (campos.nombre) campos.nombre.value = cliente.nombre || "";
      if (campos.apellido) campos.apellido.value = cliente.apellido || "";
      if (campos.telefono && cliente.telefono) {
        campos.telefono.value = formatearTelefonoParaCampo(cliente.telefono);
      }

      setStatus("✓ Cliente encontrado, datos autorrellenados.", "encontrado");
      onEncontrado?.(cliente);
    }, debounceMs);
  });
}
