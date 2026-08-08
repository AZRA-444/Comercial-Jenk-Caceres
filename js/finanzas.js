// ============================================================
// FINANZAS.JS — Módulo de dashboard financiero
// Depende de: supabase-config.js, utils.js, admin-panel.js, egresos.js
// ============================================================

// ── Instancias de gráficas ──────────────────────────────────
let chartFinComparativa = null;
let chartFinDonut       = null;
let chartFinFlujo       = null;
let chartFinHistorico   = null;

// ── Paleta consistente ──────────────────────────────────────
const FIN_COLORS = {
  ingreso:        "#10b981",
  egreso:         "#ef4444",
  neta:           "#3b82f6",
  compra:         "#f59e0b",
  gasto_empresa:  "#3b82f6",
  gasto_personal: "#c0527a",
  servicio:       "#8b5cf6",
  nomina:         "#10b981",
  otro:           "#7a6670",
};

// ── Helper status ───────────────────────────────────────────
function statusFin(msg, esError = false) {
  const el = document.getElementById("status-finanzas");
  if (!el) return;
  el.textContent = msg;
  el.style.color = esError ? "var(--danger)" : "var(--muted)";
}

// ── Consulta facturas del mes ───────────────────────────────
async function fetchFacturasMes(mes) {
  const inicio = mes + "-01T00:00:00";
  const [y, m] = mes.split("-").map(Number);
  const sig = m === 12
    ? `${y + 1}-01-01T00:00:00`
    : `${y}-${String(m + 1).padStart(2, "0")}-01T00:00:00`;

  const query = `${SUPABASE_URL}/rest/v1/facturas?select=total_usd,total_bs,created_at&created_at=gte.${inicio}&created_at=lt.${sig}`;
  const res = await fetch(query, { headers });
  if (!res.ok) throw new Error("Error facturas " + res.status);
  return res.json();
}

// ── Consulta egresos del mes (6 meses hacia atrás) ──────────
async function fetchEgresosMes(mes) {
  const inicio = mes + "-01";
  const [y, m] = mes.split("-").map(Number);
  const sig = m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const query = `${SUPABASE_URL}/rest/v1/egresos?select=tipo,monto_usd,fecha&fecha=gte.${inicio}&fecha=lt.${sig}`;
  const res = await fetch(query, { headers });
  if (!res.ok) throw new Error("Error egresos " + res.status);
  return res.json();
}

// ── Últimos 6 meses ─────────────────────────────────────────
function ultimos6Meses(mesBase) {
  const meses = [];
  const [y, m] = mesBase.split("-").map(Number);
  for (let i = 5; i >= 0; i--) {
    let mm = m - i;
    let yy = y;
    while (mm <= 0) { mm += 12; yy--; }
    meses.push(`${yy}-${String(mm).padStart(2, "0")}`);
  }
  return meses;
}

function mesLabel(mesStr) {
  const [y, m] = mesStr.split("-").map(Number);
  const fecha = new Date(y, m - 1, 1);
  return fecha.toLocaleDateString("es-VE", { month: "short", year: "2-digit" });
}

// ── Cálculo principal ───────────────────────────────────────
async function calcularFinanzas() {
  const mes = document.getElementById("fin-mes")?.value;
  if (!mes) { statusFin("Selecciona un mes.", true); return; }

  statusFin("Cargando datos financieros…");

  try {
    // Datos del mes seleccionado
    const [facturas, egresos] = await Promise.all([
      fetchFacturasMes(mes),
      fetchEgresosMes(mes),
    ]);

    // ── Totales de ingresos ──
    const ingresosBrutos = facturas.reduce((s, f) => s + (Number(f.total_usd) || 0), 0);

    // ── Totales de egresos por tipo ──
    const totEg = { compra: 0, gasto_empresa: 0, gasto_personal: 0, servicio: 0, nomina: 0, otro: 0 };
    egresos.forEach((eg) => {
      const tipo = eg.tipo || "otro";
      const monto = Number(eg.monto_usd) || 0;
      if (totEg.hasOwnProperty(tipo)) totEg[tipo] += monto;
      else totEg.otro += monto;
    });
    const totalEgresos = Object.values(totEg).reduce((s, v) => s + v, 0);

    // ── Ganancia neta y ahorro ──
    const gananciaNeta = ingresosBrutos - totalEgresos;
    const margen = ingresosBrutos > 0 ? ((gananciaNeta / ingresosBrutos) * 100).toFixed(1) : 0;

    // ── Ahorro acumulado: sumamos ganancias netas de todos los meses disponibles ──
    // Simplificado: se usa la ganancia neta del mes actual como referencia de ahorro
    // (en producción real podría mantenerse un saldo en tabla aparte)
    const ahorro = gananciaNeta > 0 ? gananciaNeta : 0;

    // ── Actualizar KPIs ──
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("fin-ingresos",     fmtUSD(ingresosBrutos));
    set("fin-ingresos-sub", `${facturas.length} factura${facturas.length !== 1 ? "s" : ""}`);
    set("fin-egresos",      fmtUSD(totalEgresos));
    set("fin-egresos-sub",  `${egresos.length} registro${egresos.length !== 1 ? "s" : ""}`);
    set("fin-neta",         fmtUSD(gananciaNeta));
    set("fin-margen",       `${margen}% de margen`);
    set("fin-compras",      fmtUSD(totEg.compra));
    set("fin-gasto-emp",    fmtUSD(totEg.gasto_empresa + totEg.servicio));
    set("fin-gasto-per",    fmtUSD(totEg.gasto_personal));
    set("fin-nomina",       fmtUSD(totEg.nomina));
    set("fin-ahorro",       fmtUSD(ahorro));
    set("fin-ahorro-sub",   gananciaNeta >= 0 ? "Resultado positivo ✓" : "Resultado negativo ⚠");

    // Color dinámico en ganancia neta
    const netaEl = document.getElementById("fin-neta");
    if (netaEl) {
      netaEl.style.color = gananciaNeta >= 0 ? "var(--success)" : "var(--danger)";
    }
    const ahorroEl = document.getElementById("fin-ahorro");
    if (ahorroEl) {
      ahorroEl.style.color = ahorro > 0 ? "var(--success)" : "var(--muted)";
    }

    // ── Gráficas del mes ──
    renderFinChartComparativa(facturas, egresos);
    renderFinChartDonut(totEg);
    renderFinChartFlujo(facturas, egresos, mes);

    // ── Histórico 6 meses ──
    await renderFinHistorico(mes);

    // ── Tabla detalle ──
    renderTablaFinanzas(ingresosBrutos, totEg, gananciaNeta, ahorro);

    statusFin(`Datos del mes ${mesLabel(mes)} cargados · ${new Date().toLocaleTimeString("es-VE")}`);
  } catch (err) {
    console.error(err);
    statusFin("No se pudo calcular: " + err.message, true);
  }
}

// ── Gráfica 1: Ingresos vs Egresos por día ──────────────────
function renderFinChartComparativa(facturas, egresos) {
  const ChartLib = window.Chart;
  if (!ChartLib) return;

  const porDiaIng = {};
  const porDiaEg  = {};

  facturas.forEach((f) => {
    const dia = (f.created_at || "").slice(0, 10);
    if (dia) porDiaIng[dia] = (porDiaIng[dia] || 0) + (Number(f.total_usd) || 0);
  });
  egresos.forEach((eg) => {
    const dia = (eg.fecha || "").slice(0, 10);
    if (dia) porDiaEg[dia] = (porDiaEg[dia] || 0) + (Number(eg.monto_usd) || 0);
  });

  const allDias = [...new Set([...Object.keys(porDiaIng), ...Object.keys(porDiaEg)])].sort();

  const canvas = document.getElementById("chart-fin-comparativa");
  if (!canvas) return;
  if (chartFinComparativa) chartFinComparativa.destroy();

  chartFinComparativa = new ChartLib(canvas, {
    type: "bar",
    data: {
      labels: allDias,
      datasets: [
        {
          label: "Ingresos $",
          data: allDias.map((d) => porDiaIng[d] || 0),
          backgroundColor: "rgba(16,185,129,.75)",
          borderRadius: 5,
          order: 2,
        },
        {
          label: "Egresos $",
          data: allDias.map((d) => porDiaEg[d] || 0),
          backgroundColor: "rgba(239,68,68,.7)",
          borderRadius: 5,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "top", labels: { color: "#7a6670", usePointStyle: true, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
          },
        },
      },
      scales: {
        y: { grid: { color: "rgba(0,0,0,.06)" }, ticks: { color: "#7a6670" } },
        x: { grid: { display: false }, ticks: { color: "#7a6670", maxTicksLimit: 15 } },
      },
    },
  });
}

// ── Gráfica 2: Donut de distribución de egresos ─────────────
function renderFinChartDonut(totEg) {
  const ChartLib = window.Chart;
  if (!ChartLib) return;

  const canvas = document.getElementById("chart-fin-donut");
  if (!canvas) return;
  if (chartFinDonut) chartFinDonut.destroy();

  const cats = [
    { key: "compra",         label: "Compras" },
    { key: "gasto_empresa",  label: "Gasto Empresa" },
    { key: "gasto_personal", label: "Gasto Personal" },
    { key: "servicio",       label: "Servicios" },
    { key: "nomina",         label: "Nómina" },
    { key: "otro",           label: "Otros" },
  ].filter(({ key }) => totEg[key] > 0);

  chartFinDonut = new ChartLib(canvas, {
    type: "doughnut",
    data: {
      labels: cats.map((c) => c.label),
      datasets: [{
        data: cats.map(({ key }) => totEg[key]),
        backgroundColor: cats.map(({ key }) => FIN_COLORS[key] || "#7a6670"),
        borderWidth: 2,
        borderColor: "#fff",
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: {
          display: true, position: "bottom",
          labels: { color: "#7a6670", font: { size: 11 }, padding: 10, usePointStyle: true },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: $${ctx.parsed.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
          },
        },
      },
    },
  });
}

// ── Gráfica 3: Flujo de caja acumulado ──────────────────────
function renderFinChartFlujo(facturas, egresos, mes) {
  const ChartLib = window.Chart;
  if (!ChartLib) return;

  const canvas = document.getElementById("chart-fin-flujo");
  if (!canvas) return;
  if (chartFinFlujo) chartFinFlujo.destroy();

  // Construir todos los días del mes
  const [y, m] = mes.split("-").map(Number);
  const diasEnMes = new Date(y, m, 0).getDate();
  const dias = [];
  for (let d = 1; d <= diasEnMes; d++) {
    dias.push(`${mes}-${String(d).padStart(2, "0")}`);
  }

  // Mapa por día
  const ingDia = {}, egDia = {};
  facturas.forEach((f) => {
    const dia = (f.created_at || "").slice(0, 10);
    if (dia) ingDia[dia] = (ingDia[dia] || 0) + (Number(f.total_usd) || 0);
  });
  egresos.forEach((eg) => {
    const dia = (eg.fecha || "").slice(0, 10);
    if (dia) egDia[dia] = (egDia[dia] || 0) + (Number(eg.monto_usd) || 0);
  });

  // Flujo acumulado
  let acum = 0;
  const flujoData = dias.map((d) => {
    acum += (ingDia[d] || 0) - (egDia[d] || 0);
    return acum;
  });

  chartFinFlujo = new ChartLib(canvas, {
    type: "line",
    data: {
      labels: dias.map((d) => d.slice(8)), // solo el número de día
      datasets: [{
        label: "Flujo acumulado $",
        data: flujoData,
        borderColor: flujoData[flujoData.length - 1] >= 0 ? "#10b981" : "#ef4444",
        backgroundColor: flujoData[flujoData.length - 1] >= 0
          ? "rgba(16,185,129,.1)"
          : "rgba(239,68,68,.1)",
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointRadius: 2,
        pointHoverRadius: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` Flujo: $${ctx.parsed.y.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
          },
        },
      },
      scales: {
        y: {
          grid: { color: "rgba(0,0,0,.06)" },
          ticks: { color: "#7a6670", callback: (v) => "$" + v.toLocaleString("en-US") },
        },
        x: { grid: { display: false }, ticks: { color: "#7a6670" } },
      },
    },
  });
}

// ── Gráfica 4: Histórico 6 meses ────────────────────────────
async function renderFinHistorico(mesBase) {
  const ChartLib = window.Chart;
  if (!ChartLib) return;

  const canvas = document.getElementById("chart-fin-historico");
  if (!canvas) return;
  if (chartFinHistorico) chartFinHistorico.destroy();

  const meses = ultimos6Meses(mesBase);

  // Fetch paralelo para todos los meses
  const results = await Promise.all(
    meses.map(async (mes) => {
      try {
        const [facts, egs] = await Promise.all([
          fetchFacturasMes(mes),
          fetchEgresosMes(mes),
        ]);
        const ingresos  = facts.reduce((s, f) => s + (Number(f.total_usd) || 0), 0);
        const egresos   = egs.reduce((s, eg) => s + (Number(eg.monto_usd) || 0), 0);
        return { mes, ingresos, egresos, neta: ingresos - egresos };
      } catch {
        return { mes, ingresos: 0, egresos: 0, neta: 0 };
      }
    })
  );

  chartFinHistorico = new ChartLib(canvas, {
    type: "bar",
    data: {
      labels: results.map((r) => mesLabel(r.mes)),
      datasets: [
        {
          label: "Ingresos $",
          data: results.map((r) => r.ingresos),
          backgroundColor: "rgba(16,185,129,.75)",
          borderRadius: 6,
          order: 3,
        },
        {
          label: "Egresos $",
          data: results.map((r) => r.egresos),
          backgroundColor: "rgba(239,68,68,.7)",
          borderRadius: 6,
          order: 2,
        },
        {
          label: "Ganancia neta $",
          data: results.map((r) => r.neta),
          type: "line",
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59,130,246,.1)",
          borderWidth: 2.5,
          fill: false,
          tension: 0.35,
          pointRadius: 4,
          pointBackgroundColor: "#3b82f6",
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true, position: "top",
          labels: { color: "#7a6670", usePointStyle: true, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
          },
        },
      },
      scales: {
        y: {
          grid: { color: "rgba(0,0,0,.06)" },
          ticks: { color: "#7a6670", callback: (v) => "$" + v.toLocaleString("en-US") },
        },
        x: { grid: { display: false }, ticks: { color: "#7a6670" } },
      },
    },
  });
}

// ── Tabla de detalle financiero ──────────────────────────────
function renderTablaFinanzas(ingresos, totEg, neta, ahorro) {
  const tbody = document.getElementById("tbody-finanzas");
  if (!tbody) return;
  tbody.innerHTML = "";

  const filas = [
    { concepto: "Ingresos brutos (ventas)",    monto: ingresos,                    obs: "Total de facturas emitidas en el mes",      clase: "fila-ingreso" },
    { concepto: "— Compras / Mercancía",        monto: -totEg.compra,              obs: "Costo de reposición de inventario",          clase: "" },
    { concepto: "— Gastos de empresa",          monto: -(totEg.gasto_empresa + totEg.servicio), obs: "Operativos, servicios y facturas", clase: "" },
    { concepto: "— Gastos personales",          monto: -totEg.gasto_personal,      obs: "Retiros y gastos de uso personal",           clase: "" },
    { concepto: "— Nómina / Comisiones",        monto: -totEg.nomina,              obs: "Pagos a vendedores y personal",              clase: "" },
    { concepto: "— Otros egresos",              monto: -totEg.otro,                obs: "Egresos sin categoría específica",           clase: "" },
    { concepto: "Ganancia neta",                monto: neta,                        obs: "Ingresos menos todos los egresos",          clase: neta >= 0 ? "fila-positivo" : "fila-negativo" },
    { concepto: "Ahorro en caja (estimado)",    monto: ahorro,                      obs: "Disponible si el resultado es positivo",    clase: ahorro > 0 ? "fila-positivo" : "" },
  ];

  filas.forEach(({ concepto, monto, obs, clase }) => {
    if (Math.abs(monto) < 0.001 && !["Ingresos brutos (ventas)", "Ganancia neta", "Ahorro en caja (estimado)"].includes(concepto)) return;

    const pct = ingresos > 0 ? ((Math.abs(monto) / ingresos) * 100).toFixed(1) + "%" : "—";
    const tr = document.createElement("tr");
    if (clase) tr.classList.add(clase);
    tr.innerHTML = `
      <td style="font-weight:${clase ? "600" : "400"}">${escapeHtml(concepto)}</td>
      <td class="num" style="color:${monto >= 0 ? "var(--success)" : "var(--danger)"}; font-weight:${clase ? "700" : "500"}">
        ${monto >= 0 ? "" : "−"}${fmtUSD(Math.abs(monto))}
      </td>
      <td class="num" style="color:var(--muted)">${pct}</td>
      <td style="color:var(--muted-2);font-size:.8rem">${escapeHtml(obs)}</td>`;
    tbody.appendChild(tr);
  });
}

// ── Eventos ─────────────────────────────────────────────────
document.getElementById("btn-calcular-fin")?.addEventListener("click", calcularFinanzas);

// ── Cargar datos al activar la pestaña ──────────────────────
// Observamos cuándo el panel se hace visible (clase "active") en vez de
// duplicar el listener de click, porque admin-panel.js ya lo maneja.
(function observarPaneles() {
  const panelFin = document.getElementById("panel-finanzas");
  const panelEg  = document.getElementById("panel-egresos");

  const obs = new MutationObserver((mutations) => {
    mutations.forEach(({ target, attributeName }) => {
      if (attributeName !== "class") return;

      if (target === panelFin && target.classList.contains("active")) {
        const mes = document.getElementById("fin-mes")?.value;
        if (mes) calcularFinanzas();
      }

      if (target === panelEg && target.classList.contains("active")) {
        // buscarEgresos está definida en egresos.js, cargado antes
        if (typeof buscarEgresos === "function") buscarEgresos();
      }
    });
  });

  if (panelFin) obs.observe(panelFin, { attributes: true });
  if (panelEg)  obs.observe(panelEg,  { attributes: true });
})();

// ── Arranque ─────────────────────────────────────────────────
(function initFinanzas() {
  const hoy = new Date();
  const mesActual = hoy.toISOString().slice(0, 7);
  const finMes = document.getElementById("fin-mes");
  if (finMes) finMes.value = mesActual;
})();
