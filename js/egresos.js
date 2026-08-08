// ============================================================
// EGRESOS.JS — Módulo de registro y consulta de egresos
// Depende de: supabase-config.js, utils.js, admin-panel.js
// Tabla Supabase requerida: egresos
// ============================================================

// ── Estado del módulo ──────────────────────────────────────
let __egresosActuales = [];
let __modoEdicionEgreso = null; // null = nuevo, id = edición
let chartEgCategoria = null;
let chartEgDias = null;

// ── Etiquetas legibles por tipo ────────────────────────────
const TIPO_LABELS = {
  compra:         "Compra / Mercancía",
  gasto_empresa:  "Gasto Empresa",
  gasto_personal: "Gasto Personal",
  servicio:       "Servicio / Factura",
  nomina:         "Nómina / Comisión",
  otro:           "Otro",
};

const TIPO_COLORS = {
  compra:         "#f59e0b",
  gasto_empresa:  "#3b82f6",
  gasto_personal: "#c0527a",
  servicio:       "#8b5cf6",
  nomina:         "#10b981",
  otro:           "#7a6670",
};

// ── Helpers ────────────────────────────────────────────────
function tipoLabel(tipo) {
  return TIPO_LABELS[tipo] || tipo || "Otro";
}

function statusEg(msg, esError = false) {
  const el = document.getElementById("status-egresos");
  if (!el) return;
  el.textContent = msg;
  el.style.color = esError ? "var(--danger)" : "var(--muted)";
}

// ── Consulta principal ──────────────────────────────────────
async function buscarEgresos() {
  const mes  = document.getElementById("eg-mes")?.value;
  const tipo = document.getElementById("eg-tipo")?.value;
  const desc = document.getElementById("eg-desc")?.value.trim();

  statusEg("Cargando egresos…");

  let query = `${SUPABASE_URL}/rest/v1/egresos?select=*&order=fecha.desc`;

  if (mes) {
    const inicio = mes + "-01";
    const [y, m] = mes.split("-").map(Number);
    const sig = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    query += `&fecha=gte.${inicio}&fecha=lt.${sig}`;
  }
  if (tipo) query += `&tipo=eq.${encodeQueryValue(tipo)}`;
  if (desc) query += `&descripcion=ilike.*${encodeQueryValue(desc)}*`;

  try {
    const res = await fetch(query, { headers });
    if (!res.ok) throw new Error("Error " + res.status);
    const data = await res.json();
    __egresosActuales = data;
    renderEgresos(data);
    statusEg(`Actualizado ${new Date().toLocaleTimeString("es-VE")}`);
  } catch (err) {
    statusEg("No se pudo cargar: " + err.message, true);
    renderEgresos([]);
  }
}

// ── Render tabla + KPIs + gráficas ──────────────────────────
function renderEgresos(egresos) {
  const tbody = document.getElementById("tbody-egresos");
  const empty = document.getElementById("empty-egresos");
  const countLabel = document.getElementById("eg-count-label");

  if (tbody) tbody.innerHTML = "";
  if (countLabel) countLabel.textContent = `(${egresos.length} registros)`;

  // Acumuladores por tipo
  const totales = { compra: 0, gasto_empresa: 0, gasto_personal: 0, nomina: 0, otro: 0, servicio: 0 };
  let totalGeneral = 0;

  if (!egresos.length) {
    if (empty) empty.style.display = "block";
  } else {
    if (empty) empty.style.display = "none";

    egresos.forEach((eg) => {
      const monto = Number(eg.monto_usd) || 0;
      const montoBS = Number(eg.monto_bs) || 0;
      const tipo = eg.tipo || "otro";

      totalGeneral += monto;
      if (totales.hasOwnProperty(tipo)) totales[tipo] += monto;
      else totales.otro += monto;

      const tr = document.createElement("tr");
      const colorTipo = TIPO_COLORS[tipo] || "#7a6670";
      tr.innerHTML = `
        <td>${eg.fecha ? eg.fecha.slice(0, 10) : "-"}</td>
        <td>
          <span class="tag-tipo" style="background:${colorTipo}22;color:${colorTipo};padding:3px 10px;border-radius:20px;font-size:.7rem;font-weight:600;">
            ${escapeHtml(tipoLabel(tipo))}
          </span>
        </td>
        <td class="text-wrap">${escapeHtml(eg.descripcion || "")}</td>
        <td>${escapeHtml(eg.proveedor || "—")}</td>
        <td class="num">${fmtUSD(monto)}</td>
        <td class="num">${montoBS > 0 ? fmtBS(montoBS) : "—"}</td>
        <td>${escapeHtml(eg.metodo_pago || "—")}</td>
        <td class="text-center">
          <button class="btn small ghost" data-eg-accion="editar" data-eg-id="${escapeHtml(String(eg.id))}">
            <i class="fas fa-pen-to-square"></i>
          </button>
          <button class="btn small ghost" data-eg-accion="eliminar" data-eg-id="${escapeHtml(String(eg.id))}"
                  style="color:var(--danger);border-color:var(--danger);margin-left:4px;">
            <i class="fas fa-trash"></i>
          </button>
        </td>`;
      if (tbody) tbody.appendChild(tr);
    });
  }

  // KPIs
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("kpi-eg-total",    fmtUSD(totalGeneral));
  set("kpi-eg-compras",  fmtUSD(totales.compra));
  set("kpi-eg-empresa",  fmtUSD(totales.gasto_empresa + totales.servicio));
  set("kpi-eg-personal", fmtUSD(totales.gasto_personal));
  set("kpi-eg-nomina",   fmtUSD(totales.nomina));

  renderEgresosCharts(egresos, totales);
}

// ── Gráficas egresos ────────────────────────────────────────
function renderEgresosCharts(egresos, totales) {
  const ChartLib = window.Chart;
  if (!ChartLib) return;

  // Donut por categoría
  const canvaCat = document.getElementById("chart-eg-categoria");
  if (canvaCat) {
    if (chartEgCategoria) chartEgCategoria.destroy();
    const cats = Object.entries(totales).filter(([, v]) => v > 0);
    chartEgCategoria = new ChartLib(canvaCat, {
      type: "doughnut",
      data: {
        labels: cats.map(([k]) => tipoLabel(k)),
        datasets: [{
          data: cats.map(([, v]) => v),
          backgroundColor: cats.map(([k]) => TIPO_COLORS[k] || "#7a6670"),
          borderWidth: 0,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "65%",
        plugins: {
          legend: {
            display: true, position: "bottom",
            labels: { color: "#7a6670", font: { size: 11 }, padding: 12, usePointStyle: true }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.label}: $${ctx.parsed.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
            }
          }
        }
      }
    });
  }

  // Barras por día
  const canvaDias = document.getElementById("chart-eg-dias");
  if (canvaDias) {
    if (chartEgDias) chartEgDias.destroy();
    const porDia = {};
    egresos.forEach((eg) => {
      const dia = eg.fecha ? eg.fecha.slice(0, 10) : "S/F";
      porDia[dia] = (porDia[dia] || 0) + (Number(eg.monto_usd) || 0);
    });
    const diasLabels = Object.keys(porDia).sort();
    chartEgDias = new ChartLib(canvaDias, {
      type: "bar",
      data: {
        labels: diasLabels,
        datasets: [{
          label: "Egresos $",
          data: diasLabels.map(d => porDia[d]),
          backgroundColor: "#f59e0b",
          borderRadius: 5,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: "rgba(0,0,0,.06)" }, ticks: { color: "#7a6670" } },
          x: { grid: { display: false }, ticks: { color: "#7a6670" } }
        }
      }
    });
  }
}

// ── Modal nuevo/editar egreso ────────────────────────────────
function abrirModalEgreso(id = null) {
  __modoEdicionEgreso = id;
  const titleEl = document.getElementById("modal-egreso-title");
  const modal   = document.getElementById("modal-egreso");

  // Resetear formulario
  ["eg-f-tipo", "eg-f-desc", "eg-f-proveedor", "eg-f-fecha",
   "eg-f-monto", "eg-f-monto-bs", "eg-f-metodo", "eg-f-obs"].forEach((fid) => {
    const el = document.getElementById(fid);
    if (el) el.value = el.tagName === "SELECT" ? el.options[0]?.value || "" : "";
  });

  // Fecha por defecto: hoy
  const hoyEl = document.getElementById("eg-f-fecha");
  if (hoyEl) hoyEl.value = new Date().toISOString().slice(0, 10);

  const statusForm = document.getElementById("status-egreso-form");
  if (statusForm) statusForm.textContent = "";

  if (id) {
    // Modo edición: rellenar con datos existentes
    const eg = __egresosActuales.find((e) => String(e.id) === String(id));
    if (eg) {
      if (titleEl) titleEl.textContent = "Editar Egreso";
      const fill = (fid, val) => { const el = document.getElementById(fid); if (el) el.value = val ?? ""; };
      fill("eg-f-tipo",     eg.tipo);
      fill("eg-f-desc",     eg.descripcion);
      fill("eg-f-proveedor",eg.proveedor);
      fill("eg-f-fecha",    eg.fecha ? eg.fecha.slice(0, 10) : "");
      fill("eg-f-monto",    eg.monto_usd);
      fill("eg-f-monto-bs", eg.monto_bs || "");
      fill("eg-f-metodo",   eg.metodo_pago);
      fill("eg-f-obs",      eg.observaciones);
    }
  } else {
    if (titleEl) titleEl.textContent = "Nuevo Egreso";
  }

  if (modal) modal.classList.add("active");
}

async function guardarEgreso() {
  const statusForm = document.getElementById("status-egreso-form");
  const tipo    = document.getElementById("eg-f-tipo")?.value;
  const desc    = document.getElementById("eg-f-desc")?.value.trim();
  const fecha   = document.getElementById("eg-f-fecha")?.value;
  const monto   = parseFloat(document.getElementById("eg-f-monto")?.value);

  if (!tipo || !desc || !fecha || isNaN(monto) || monto <= 0) {
    if (statusForm) {
      statusForm.textContent = "Completa los campos obligatorios (tipo, descripción, fecha y monto).";
      statusForm.style.color = "var(--danger)";
    }
    return;
  }

  if (statusForm) {
    statusForm.textContent = "Guardando…";
    statusForm.style.color = "var(--muted)";
  }

  const payload = {
    tipo,
    descripcion: desc,
    proveedor:   document.getElementById("eg-f-proveedor")?.value.trim() || null,
    fecha,
    monto_usd:   monto,
    monto_bs:    parseFloat(document.getElementById("eg-f-monto-bs")?.value) || null,
    metodo_pago: document.getElementById("eg-f-metodo")?.value || null,
    observaciones: document.getElementById("eg-f-obs")?.value.trim() || null,
  };

  try {
    let res;
    if (__modoEdicionEgreso) {
      // PUT (actualizar)
      res = await fetch(
        `${SUPABASE_URL}/rest/v1/egresos?id=eq.${encodeQueryValue(__modoEdicionEgreso)}`,
        { method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" }, body: JSON.stringify(payload) }
      );
    } else {
      // POST (insertar)
      res = await fetch(
        `${SUPABASE_URL}/rest/v1/egresos`,
        { method: "POST", headers: { ...headers, "Prefer": "return=minimal" }, body: JSON.stringify(payload) }
      );
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error ${res.status}: ${errText}`);
    }

    document.getElementById("modal-egreso")?.classList.remove("active");
    await buscarEgresos();
  } catch (err) {
    if (statusForm) {
      statusForm.textContent = "No se pudo guardar: " + err.message;
      statusForm.style.color = "var(--danger)";
    }
  }
}

async function eliminarEgreso(id) {
  if (!confirm("¿Confirmas que deseas eliminar este egreso? Esta acción no se puede deshacer.")) return;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/egresos?id=eq.${encodeQueryValue(id)}`,
      { method: "DELETE", headers }
    );
    if (!res.ok) throw new Error("Error " + res.status);
    await buscarEgresos();
  } catch (err) {
    alert("No se pudo eliminar: " + err.message);
  }
}

// ── Exportar datos para módulo de Finanzas ──────────────────
window.__getEgresosMes = async function (mes) {
  let query = `${SUPABASE_URL}/rest/v1/egresos?select=tipo,monto_usd,fecha`;
  if (mes) {
    const inicio = mes + "-01";
    const [y, m] = mes.split("-").map(Number);
    const sig = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    query += `&fecha=gte.${inicio}&fecha=lt.${sig}`;
  }
  const res = await fetch(query, { headers });
  if (!res.ok) return [];
  return res.json();
};

// ── Eventos ─────────────────────────────────────────────────
// Botones del panel de egresos
document.getElementById("btn-buscar-eg")?.addEventListener("click", buscarEgresos);

document.getElementById("btn-limpiar-eg")?.addEventListener("click", () => {
  ["eg-mes", "eg-tipo", "eg-desc"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = el.tagName === "SELECT" ? "" : "";
  });
  buscarEgresos();
});

document.getElementById("btn-nuevo-egreso")?.addEventListener("click", () => abrirModalEgreso());
document.getElementById("modal-egreso-close")?.addEventListener("click", () => {
  document.getElementById("modal-egreso")?.classList.remove("active");
});
document.getElementById("eg-cancelar")?.addEventListener("click", () => {
  document.getElementById("modal-egreso")?.classList.remove("active");
});
document.getElementById("eg-guardar")?.addEventListener("click", guardarEgreso);

// Cerrar al hacer clic fuera
document.getElementById("modal-egreso")?.addEventListener("click", (e) => {
  if (e.target.id === "modal-egreso") e.currentTarget.classList.remove("active");
});

// Delegación para botones de editar/eliminar en tabla
document.addEventListener("click", (e) => {
  const btnEditar = e.target.closest('[data-eg-accion="editar"]');
  if (btnEditar) { abrirModalEgreso(btnEditar.dataset.egId); return; }

  const btnEliminar = e.target.closest('[data-eg-accion="eliminar"]');
  if (btnEliminar) { eliminarEgreso(btnEliminar.dataset.egId); }
});

// ── Arranque ─────────────────────────────────────────────────
(function initEgresos() {
  const hoy = new Date();
  const mesActual = hoy.toISOString().slice(0, 7);
  const egMes = document.getElementById("eg-mes");
  if (egMes) egMes.value = mesActual;
  // No cargar automáticamente; se carga al activar la pestaña
})();
