// ============================================================
// CONFIGURACIÓN SUPABASE
// (SUPABASE_URL y SUPABASE_ANON_KEY viven en js/supabase-config.js)
// ============================================================
const COL_FECHA = "created_at";

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

// ============================================================
// FORMATEADORES
// ============================================================
function fmtUSD(n) {
  return (
    "$" +
    (Number(n) || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
function fmtBS(n) {
  return (Number(n) || 0).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fmtHora(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" });
}

// ============================================================
// RELOJ
// ============================================================
function tickClock() {
  const clockEl = document.getElementById("clock");
  if (clockEl) {
    clockEl.textContent = new Date().toLocaleString("es-VE", {
      weekday: "long",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
}
tickClock();
setInterval(tickClock, 30000);

// Devuelve la fecha de HOY en hora local (no UTC) como "YYYY-MM-DD"
function hoyLocalISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ============================================================
// FACTURAS DE HOY
// ============================================================
async function buscarFacturasHoy() {
  const statusEl = document.getElementById("status-recientes");
  if (statusEl) {
    statusEl.textContent = "Cargando…";
    statusEl.classList.remove("error");
  }

const ahora = new Date();

const inicio = new Date(
  ahora.getFullYear(),
  ahora.getMonth(),
  ahora.getDate(),
  0, 0, 0
).toISOString();

const fin = new Date(
  ahora.getFullYear(),
  ahora.getMonth(),
  ahora.getDate() + 1,
  0, 0, 0
).toISOString();

const query =
  `${SUPABASE_URL}/rest/v1/facturas` +
  `?select=*` +
  `&order=${COL_FECHA}.desc` +
  `&${COL_FECHA}=gte.${inicio}` +
  `&${COL_FECHA}=lt.${fin}`;
  
  try {
    const res = await fetch(query, { headers });
    if (!res.ok) throw new Error("Error " + res.status + " al consultar facturas de hoy");
    const data = await res.json();
    if (statusEl) statusEl.textContent = `Actualizado ${new Date().toLocaleTimeString("es-VE")}`;
    renderFacturasRecientes(data);
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = "No se pudo cargar: " + err.message;
      statusEl.classList.add("error");
    }
    renderFacturasRecientes([]);
  }
}

function renderFacturasRecientes(facturas) {
  const tbody = document.getElementById("tbody-recientes");
  const empty = document.getElementById("empty-recientes");
  const countLabel = document.getElementById("recientes-count-label");

  if (tbody) tbody.innerHTML = "";
  if (countLabel) countLabel.textContent = `(${facturas.length} registros)`;

  if (!facturas.length) {
    if (empty) empty.style.display = "block";
  } else {
    if (empty) empty.style.display = "none";
    facturas.forEach((f) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(f.id_factura)}</td>
        <td>${fmtHora(f[COL_FECHA])}</td>
        <td>${escapeHtml(f.nombre)} ${escapeHtml(f.apellido)}</td>
        <td>${escapeHtml(f.cedula)}</td>
        <td>${escapeHtml(f.vendedor)}</td>
        <td><span class="tag">${escapeHtml(f.metodo_pago || "-")}</span></td>
        <td class="num">${fmtUSD(f.total_usd)}</td>
        <td class="num">${fmtBS(f.total_bs)}</td>
        <td>
          <button class="btn small ghost" data-accion="ver-detalle" data-id="${escapeHtml(f.id_factura)}">Ver</button>
        </td>`;
      if (tbody) tbody.appendChild(tr);
    });
  }

  window.__facturasRecientes = facturas;
}

// ============================================================
// MODAL DETALLE
// ============================================================
async function verDetalle(idFactura) {
  const factura = (window.__facturasRecientes || []).find((f) => f.id_factura === idFactura);
  const titleEl = document.getElementById("modal-detalle-title");
  const body = document.getElementById("modal-detalle-body");
  const modal = document.getElementById("modal-detalle");

  if (titleEl) titleEl.textContent = "Factura " + idFactura;
  if (body) body.innerHTML = "<p>Cargando productos…</p>";
  if (modal) modal.classList.add("active");

  let productosHtml = "<p>No se pudieron cargar los productos.</p>";
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/factura_detalles?id_factura=eq.${encodeQueryValue(idFactura)}&select=nombre_producto,cantidad,precio_total`, { headers });
    if (res.ok) {
      const productos = await res.json();

      productosHtml = productos.length
        ? productos.map((p) => {
              const nombre = p.nombre_producto || "Producto sin nombre";
              const cant = p.cantidad || 0;
              const total = p.precio_total || 0;

              return `<div class="row">
                <span>${escapeHtml(cant)} × ${escapeHtml(nombre)}</span>
                <span class="num">${fmtUSD(total)}</span>
              </div>`;
            }).join("")
        : "<p>Sin productos registrados en esta factura.</p>";
    }
  } catch (e) {
    console.error("Error al cargar los detalles:", e);
  }

  if (body) {
    // Desglose línea por línea si la factura se pagó con "Pago Combinado"
    // (requiere haber ejecutado supabase/pagos_combinados.sql).
    let pagosCombinadosHtml = '';
    const pagosCombinados = Array.isArray(factura?.pagos_combinados) ? factura.pagos_combinados : [];
    if (factura?.metodo_pago === 'COMB' && pagosCombinados.length > 0) {
      pagosCombinadosHtml = `
        <h4 style="margin:14px 0 6px; font-family:var(--serif);">Desglose del pago combinado</h4>
        ${pagosCombinados.map((p) => {
          const monto = p.moneda === 'USD'
            ? fmtUSD(p.montoUSD ?? p.montoNativo ?? 0)
            : `Bs ${fmtBS(p.montoBs ?? p.montoNativo ?? 0)}`;
          const extra = [p.banco, p.referencia ? `Ref: ${p.referencia}` : ''].filter(Boolean).map(escapeHtml).join(' · ');
          return `<div class="row">
            <span>${escapeHtml(p.metodo || p.codigo || 'Pago')}${extra ? ' (' + extra + ')' : ''}</span>
            <span class="num">${monto}</span>
          </div>`;
        }).join('')}`;
    }

    body.innerHTML = `
      <div class="row"><span>Cliente</span><span>${escapeHtml(factura?.nombre)} ${escapeHtml(factura?.apellido)}</span></div>
      <div class="row"><span>Cédula</span><span>${escapeHtml(factura?.cedula)}</span></div>
      <div class="row"><span>Teléfono</span><span>${escapeHtml(factura?.telefono)}</span></div>
      <div class="row"><span>Vendedor</span><span>${escapeHtml(factura?.vendedor)}</span></div>
      <div class="row"><span>Método de pago</span><span>${escapeHtml(factura?.metodo_pago)}</span></div>
      <div class="row"><span>Referencia</span><span>${escapeHtml(factura?.referencia)}</span></div>
      <div class="row"><span>Banco</span><span>${escapeHtml(factura?.banco)}</span></div>
      <div class="row"><span>Observaciones</span><span>${escapeHtml(factura?.observaciones) || 'N/A'}</span></div>
      ${pagosCombinadosHtml}
      <h4 style="margin:14px 0 6px; font-family:var(--serif);">Productos</h4>
      ${productosHtml}
      <div class="row" style="border-top:2px solid var(--ink); margin-top:8px; font-weight:700;">
        <span>Total</span><span class="num">${fmtUSD(factura?.total_usd)} · Bs ${fmtBS(factura?.total_bs)}</span>
      </div>`;
  }
}
document.getElementById("modal-detalle-close")?.addEventListener("click", () => {
  document.getElementById("modal-detalle").classList.remove("active");
});

document.getElementById("modal-detalle")?.addEventListener("click", (e) => {
  if (e.target.id === "modal-detalle") {
    e.currentTarget.classList.remove("active");
  }
});

document.addEventListener("click", (e) => {
  const btnVer = e.target.closest('[data-accion="ver-detalle"]');
  if (btnVer) verDetalle(btnVer.dataset.id);
});

// ============================================================
// EVENTOS Y ARRANQUE
// ============================================================
document.getElementById("btn-refrescar-recientes")?.addEventListener("click", buscarFacturasHoy);

(async function init() {
  await buscarFacturasHoy();

  // Mantiene el panel de "Facturas de hoy" actualizado sin recargar la página
  setInterval(buscarFacturasHoy, 60000);
})();
