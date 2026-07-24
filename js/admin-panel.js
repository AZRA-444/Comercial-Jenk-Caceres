// ============================================================
// CONFIGURACIÓN SUPABASE
// (SUPABASE_URL y SUPABASE_ANON_KEY ahora viven en js/supabase-config.js,
// que debe cargarse ANTES que este archivo, para no repetir la clave en
// cada script y facilitar rotarla si hace falta)
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
function fmtFecha(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("es-VE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }) +
    " " +
    d.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
  );
}

function formatDoc(input) {
  let valor = input.value.replace(/\D/g, "");
  if (!valor) {
    input.value = "";
    return;
  }
  input.value = new Intl.NumberFormat("es-VE").format(parseInt(valor, 10));
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

// ============================================================
// TABS
// ============================================================
document.querySelectorAll(".ledger-tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".ledger-tabs button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    const panel = document.getElementById("panel-" + btn.dataset.panel);
    if (panel) panel.classList.add("active");
  });
});

// ============================================================
// FILTROS & PETICIONES
// ============================================================
function primerDiaDelMes(mesStr) {
  return mesStr + "-01T00:00:00";
}
function primerDiaSiguienteMes(mesStr) {
  const [y, m] = mesStr.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return next + "-01T00:00:00";
}

// Función auxiliar para restar un mes a un string 'YYYY-MM'
function obtenerMesAnterior(mesString) {
  const [year, month] = mesString.split("-").map(Number);
  const fecha = new Date(year, month - 2, 1); 
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

async function buscarFacturas() {
  const mes = document.getElementById("f-mes")?.value;
  const dia = document.getElementById("f-dia")?.value;
  const cedula = document.getElementById("f-cedula")?.value.trim() || "";
  const vendedor = document.getElementById("f-vendedor")?.value.trim() || "";
  const idFactura = document.getElementById("f-id")?.value.trim() || "";
  const metodo = document.getElementById("f-metodo")?.value || "";

  const statusEl = document.getElementById("status-ventas");
  if (statusEl) {
    statusEl.textContent = "Cargando…";
    statusEl.classList.remove("error");
  }

  let query = `${SUPABASE_URL}/rest/v1/facturas?select=*&order=${COL_FECHA}.desc`;

  if (dia) {
    const start = dia + "T00:00:00";
    const d = new Date(dia + "T00:00:00");
    d.setDate(d.getDate() + 1);
    const end = d.toISOString().slice(0, 19);
    query += `&${COL_FECHA}=gte.${start}&${COL_FECHA}=lt.${end}`;
  } else if (mes) {
    query += `&${COL_FECHA}=gte.${primerDiaDelMes(mes)}&${COL_FECHA}=lt.${primerDiaSiguienteMes(mes)}`;
  }
  
  if (cedula) query += `&cedula=eq.${encodeURIComponent(cedula)}`;
  if (vendedor) query += `&vendedor=ilike.*${encodeURIComponent(vendedor)}*`;
  if (idFactura) query += `&id_factura=ilike.*${encodeQueryValue(idFactura)}*`;
  if (metodo) query += `&metodo_pago=eq.${encodeURIComponent(metodo)}`;

  try {
    const res = await fetch(query, { headers });
    if (!res.ok) throw new Error("Error " + res.status + " al consultar facturas");
    const data = await res.json();
    if (statusEl) statusEl.textContent = `Actualizado ${new Date().toLocaleTimeString("es-VE")}`;
    renderVentas(data);
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = "No se pudo cargar: " + err.message;
      statusEl.classList.add("error");
    }
    renderVentas([]);
  }
}

function renderVentas(facturas) {
  const tbody = document.getElementById("tbody-ventas");
  const empty = document.getElementById("empty-ventas");
  const countLabel = document.getElementById("ventas-count-label");
  
  if (tbody) tbody.innerHTML = "";
  if (countLabel) countLabel.textContent = `(${facturas.length} registros)`;

  if (!facturas.length) {
    if (empty) empty.style.display = "block";
  } else {
    if (empty) empty.style.display = "none";
    facturas.forEach((f) => {
      const subtotal = (Number(f.total_usd) || 0) + (Number(f.descuento_usd) || 0);
      const tr = document.createElement("tr");
      // Todos los campos de texto se escapan antes de insertarse en el DOM:
      // vienen de la base de datos y, en última instancia, de lo que un
      // usuario haya escrito (o de una llamada directa a la API), así que
      // no se puede confiar en que no contengan HTML/JS.
      tr.innerHTML = `
        <td>${escapeHtml(f.id_factura)}</td>
        <td>${fmtFecha(f[COL_FECHA])}</td>
        <td>${escapeHtml(f.nombre)} ${escapeHtml(f.apellido)}</td>
        <td>${escapeHtml(f.cedula)}</td>
        <td>${escapeHtml(f.vendedor)}</td>
        <td><span class="tag">${escapeHtml(f.metodo_pago || "-")}</span></td>
        <td class="num">${fmtUSD(subtotal)}</td>
        <td class="num">${fmtUSD(f.descuento_usd)}</td>
        <td class="num">${fmtUSD(f.total_usd)}</td>
        <td class="num">${fmtBS(f.total_bs)}</td>
        <td>
          <button class="btn small ghost" data-accion="ver-detalle" data-id="${escapeHtml(f.id_factura)}">Ver</button>
        </td>`;
      if (tbody) tbody.appendChild(tr);
    });
  }

  renderKPIs(facturas);
  renderCharts(facturas);
  window.__facturasActuales = facturas;
}

function renderKPIs(facturas) {
  const totalUSD = facturas.reduce((s, f) => s + (Number(f.total_usd) || 0), 0);
  const totalBS = facturas.reduce((s, f) => s + (Number(f.total_bs) || 0), 0);
  const totalDesc = facturas.reduce((s, f) => s + (Number(f.descuento_usd) || 0), 0);

  const elUsd = document.getElementById("kpi-usd");
  const elBs = document.getElementById("kpi-bs");
  const elCount = document.getElementById("kpi-count");
  const elAvg = document.getElementById("kpi-avg");
  const elDesc = document.getElementById("kpi-desc");

  if (elUsd) elUsd.textContent = fmtUSD(totalUSD);
  if (elBs) elBs.textContent = fmtBS(totalBS);
  if (elCount) elCount.textContent = facturas.length;
  if (elAvg) elAvg.textContent = fmtUSD(facturas.length ? totalUSD / facturas.length : 0);
  if (elDesc) elDesc.textContent = fmtUSD(totalDesc);
}

// ============================================================
// DIAGNÓSTICO EN CONSOLA PARA LAS GRÁFICAS
// ============================================================
let chartDias = null;
let chartVendedores = null;
let chartMetodos = null;

function renderCharts(facturas) {
  console.log("📊 renderCharts se ejecutó. Facturas recibidas:", facturas);

  const canvasDias = document.getElementById("chart-dias");
  const canvasVendedores = document.getElementById("chart-vendedores");
  const canvasMetodos = document.getElementById("chart-metodos");

  const ChartLib = window.Chart || Chart; 
  if (!ChartLib) {
    console.error("❌ ERROR CRÍTICO: Chart.js no se cargó correctamente en el JS global.");
    return;
  }

  [canvasDias, canvasVendedores, canvasMetodos].forEach(canvas => {
    if (canvas && canvas.parentElement) {
      canvas.parentElement.style.position = "relative";
      canvas.parentElement.style.height = "240px";
      canvas.parentElement.style.width = "100%";
      canvas.parentElement.style.display = "block"; 
    }
  });

  const porDia = {};
  const porVendedor = {};
  const porMetodo = {};

  facturas.forEach((f) => {
    const rawFecha = f.fecha || f.created_at;
    const fecha = rawFecha ? rawFecha.slice(0, 10) : "S/F";
    
    porDia[fecha] = (porDia[fecha] || 0) + (Number(f.total_usd) || 0);

    const v = f.vendedor ? f.vendedor.trim() : "Sin asignar";
    porVendedor[v] = (porVendedor[v] || 0) + (Number(f.total_usd) || 0);

    const m = f.metodo_pago || "Otro";
    porMetodo[m] = (porMetodo[m] || 0) + 1;
  });

  console.log("Datos procesados listos para graficar:", { porDia, porVendedor, porMetodo });

  const diasLabels = Object.keys(porDia).sort();
  const vendLabels = Object.keys(porVendedor).sort((a, b) => porVendedor[b] - porVendedor[a]).slice(0, 5);
  const metLabels = Object.keys(porMetodo);

  const primaryColor = "#3b82f6";
  const palette = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

  if (canvasDias) {
    if (chartDias) chartDias.destroy();
    chartDias = new ChartLib(canvasDias, {
      type: "bar",
      data: {
        labels: diasLabels,
        datasets: [{ data: diasLabels.map(d => porDia[d]), backgroundColor: primaryColor, borderRadius: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  if (canvasVendedores) {
    if (chartVendedores) chartVendedores.destroy();
    chartVendedores = new ChartLib(canvasVendedores, {
      type: "bar",
      data: {
        labels: vendLabels,
        datasets: [{ data: vendLabels.map(v => porVendedor[v]), backgroundColor: palette, borderRadius: 4 }]
      },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  if (canvasMetodos) {
    if (chartMetodos) chartMetodos.destroy();
    chartMetodos = new ChartLib(canvasMetodos, {
      type: "doughnut",
      data: {
        labels: metLabels,
        datasets: [{ data: metLabels.map(m => porMetodo[m]), backgroundColor: palette, borderWidth: 0 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: "bottom", labels: { color: "#ffffff", font: { size: 11 } } }
        }
      }
    });
  }
  console.log("✅ Gráficas instanciadas correctamente sin caídas.");
}

// ============================================================
// MODAL DETALLE
// ============================================================
async function verDetalle(idFactura) {
  const factura = (window.__facturasActuales || []).find((f) => f.id_factura === idFactura);
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
    body.innerHTML = `
      <div class="row"><span>Cliente</span><span>${escapeHtml(factura?.nombre)} ${escapeHtml(factura?.apellido)}</span></div>
      <div class="row"><span>Cédula</span><span>${escapeHtml(factura?.cedula)}</span></div>
      <div class="row"><span>Teléfono</span><span>${escapeHtml(factura?.telefono)}</span></div>
      <div class="row"><span>Vendedor</span><span>${escapeHtml(factura?.vendedor)}</span></div>
      <div class="row"><span>Método de pago</span><span>${escapeHtml(factura?.metodo_pago)}</span></div>
      <div class="row"><span>Referencia</span><span>${escapeHtml(factura?.referencia)}</span></div>
      <div class="row"><span>Banco</span><span>${escapeHtml(factura?.banco)}</span></div>
      <h4 style="margin:14px 0 6px; font-family:var(--serif);">Productos</h4>
      ${productosHtml}
      <div class="row" style="border-top:2px solid var(--ink); margin-top:8px; font-weight:700;">
        <span>Total</span><span class="num">${fmtUSD(factura?.total_usd)} · Bs ${fmtBS(factura?.total_bs)}</span>
      </div>
      <h4 style="margin:14px 0 6px; font-family:var(--serif);">Comprobante de Pago</h4>
      <div id="comprobante-container">
        <p>Cargando comprobante…</p>
      </div>`;
  }

  await mostrarComprobante(factura?.comprobante_path);
}

// ============================================================
// COMPROBANTE DE PAGO (imagen alojada en Supabase Storage)
// ============================================================
function mostrarComprobante(comprobantePath) {
  const container = document.getElementById("comprobante-container");
  if (!container) return;

  if (!comprobantePath) {
    container.innerHTML = "<p>No se adjuntó comprobante de pago para esta factura.</p>";
    return;
  }

  const url = `${SUPABASE_URL}/storage/v1/object/public/comprobantes/${encodeQueryValue(comprobantePath)}`;

  container.innerHTML = `
    <a href="${url}" target="_blank" rel="noopener noreferrer">
      <img src="${url}" alt="Comprobante de pago" style="max-width:100%; max-height:400px; border-radius:8px; display:block; margin-top:6px; cursor: zoom-in;" onerror="this.parentElement.parentElement.innerHTML='<p>No se pudo cargar la imagen del comprobante.</p>'" />
    </a>`;
}
// ============================================================
// COMISIONES — Sincronizado con Supabase y Ajustado a Mes Anterior
// ============================================================
const COMISION_PORCENTAJE = 0.01;

async function calcularComisiones() {
  const mesSeleccionado = document.getElementById("c-mes")?.value; 
  const statusEl = document.getElementById("status-comisiones");
  
  if (!mesSeleccionado) {
    if (statusEl) statusEl.textContent = "Selecciona un mes.";
    return;
  }

  if (statusEl) {
    statusEl.textContent = "Calculando comisiones del mes anterior…";
    statusEl.classList.remove("error");
  }

  const mesVentas = obtenerMesAnterior(mesSeleccionado);

  const queryFacturas = `${SUPABASE_URL}/rest/v1/facturas?select=vendedor,total_usd&${COL_FECHA}=gte.${primerDiaDelMes(mesVentas)}&${COL_FECHA}=lt.${primerDiaSiguienteMes(mesVentas)}`;
  const queryPagos = `${SUPABASE_URL}/rest/v1/comisiones_pagos?select=vendedor,pagado&mes=eq.${mesSeleccionado}`;
  const queryConfig = `${SUPABASE_URL}/rest/v1/comisiones_config?select=vendedor,porcentaje,activo`;

  try {
    const [resFacturas, resPagos, resConfig] = await Promise.all([
      fetch(queryFacturas, { headers }),
      fetch(queryPagos, { headers }),
      fetch(queryConfig, { headers })
    ]);

    if (!resFacturas.ok) throw new Error("Error en ventas: " + resFacturas.status);
    if (!resPagos.ok) throw new Error("Error en pagos: " + resPagos.status);
    if (!resConfig.ok) throw new Error("Error en configuración de comisiones: " + resConfig.status);

    const facturasData = await resFacturas.json();
    const pagosData = await resPagos.json();
    const configData = await resConfig.json();

    const mapaPagos = {};
    pagosData.forEach(p => {
      if (p.vendedor) mapaPagos[p.vendedor.trim()] = p.pagado;
    });

    // Porcentaje por vendedor (tabla comisiones_config). Si el vendedor no
    // tiene fila, o está inactivo, se usa el 1% por defecto (COMISION_PORCENTAJE).
    const mapaConfig = {};
    configData.forEach(c => {
      if (c.vendedor) mapaConfig[c.vendedor.trim()] = c;
    });

    const porVendedor = {};
    facturasData.forEach((f) => {
      const v = f.vendedor ? f.vendedor.trim() : "Sin asignar";
      if (!porVendedor[v]) {
        const cfg = mapaConfig[v];
        const porcentaje = (cfg && cfg.activo !== false) ? Number(cfg.porcentaje) : COMISION_PORCENTAJE;
        porVendedor[v] = { 
          ventas: 0, 
          total: 0,
          porcentaje,
          pagado: mapaPagos[v] !== undefined ? mapaPagos[v] : false 
        };
      }
      porVendedor[v].ventas += 1;
      porVendedor[v].total += Number(f.total_usd) || 0;
    });

    if (statusEl) {
      statusEl.textContent = `Mostrando comisiones acumuladas de [${mesVentas}]. Actualizado a las ${new Date().toLocaleTimeString("es-VE")}`;
    }

    renderComisiones(porVendedor, mesSeleccionado, mesVentas);
  } catch (err) {
    console.error(err);
    if (statusEl) {
      statusEl.textContent = "No se pudo calcular: " + err.message;
      statusEl.classList.add("error");
    }
  }
}

function renderComisiones(porVendedor, mesSeleccionado, mesVentas) {
  const tbody = document.getElementById("tbody-comisiones");
  const empty = document.getElementById("empty-comisiones");
  
  if (tbody) tbody.innerHTML = "";

  const vendedores = Object.keys(porVendedor);
  if (!vendedores.length) {
    if (empty) empty.style.display = "block";
    if (document.getElementById("kpi-com-total")) document.getElementById("kpi-com-total").textContent = fmtUSD(0);
    if (document.getElementById("kpi-com-vend")) document.getElementById("kpi-com-vend").textContent = 0;
    if (document.getElementById("kpi-com-pend")) document.getElementById("kpi-com-pend").textContent = fmtUSD(0);
    return;
  }
  if (empty) empty.style.display = "none";

  let totalComisiones = 0, pendiente = 0;

  vendedores
    .sort((a, b) => porVendedor[b].total - porVendedor[a].total)
    .forEach((v) => {
      const datos = porVendedor[v];
      const comision = datos.total * datos.porcentaje;
      totalComisiones += comision;
      
      const isPagada = datos.pagado;
      if (!isPagada) pendiente += comision;

      const tr = document.createElement("tr");
      // Se usan data-attributes (en vez de construir el onclick con texto
      // interpolado) para que un nombre de vendedor con comillas u otros
      // caracteres especiales no pueda romper el HTML generado.
      tr.innerHTML = `
        <td>${escapeHtml(v)}</td>
        <td class="num">${datos.ventas}</td>
        <td class="num">${fmtUSD(datos.total)}</td>
        <td class="num">${fmtUSD(comision)}</td>
        <td><span class="tag ${isPagada ? "" : "pend"}">${isPagada ? "Pagada" : "Pendiente"}</span></td>
        <td>
          <button class="btn small ${isPagada ? "ghost" : ""}" data-accion="toggle-pago"
                  data-vendedor="${escapeHtml(v)}"
                  data-mes="${escapeHtml(mesSeleccionado)}"
                  data-pagada="${isPagada}"
                  data-comision="${comision}"
                  data-mes-ventas="${escapeHtml(mesVentas)}"
                  data-total="${datos.total}"
                  data-porcentaje="${datos.porcentaje}">
            ${isPagada ? "Marcar pendiente" : "Marcar pagada"}
          </button>
        </td>`;
      if (tbody) tbody.appendChild(tr);
    });

  if (document.getElementById("kpi-com-total")) document.getElementById("kpi-com-total").textContent = fmtUSD(totalComisiones);
  if (document.getElementById("kpi-com-vend")) document.getElementById("kpi-com-vend").textContent = vendedores.length;
  if (document.getElementById("kpi-com-pend")) document.getElementById("kpi-com-pend").textContent = fmtUSD(pendiente);
}

async function togglePago(vendedor, mesSeleccionado, estadoActual, montoCalculado, mesVentas, totalVentas, porcentaje) {
  const statusEl = document.getElementById("status-comisiones");
  if (statusEl) statusEl.textContent = "Actualizando registro en Supabase…";

  const nuevoEstado = !estadoActual;
  const fechaPago = nuevoEstado ? new Date().toISOString() : null;
  const montoFinal = nuevoEstado ? Number(montoCalculado).toFixed(2) : 0.00;

  const payload = {
    vendedor: vendedor,
    mes: mesSeleccionado,
    mes_ventas: mesVentas,
    total_ventas: Number(Number(totalVentas).toFixed(2)),
    porcentaje: Number(porcentaje),
    monto_comision: Number(Number(montoCalculado).toFixed(2)),
    pagado: nuevoEstado,
    fecha_pago: fechaPago,
    monto_pagado: Number(montoFinal)
  };

  try {
    // on_conflict=vendedor,mes es necesario: es la restricción única real
    // (uq_comisiones_pagos_vendedor_mes). Sin este parámetro, PostgREST
    // intenta el merge sobre la primary key (id, siempre nueva) y termina
    // insertando duplicados en vez de actualizar el registro existente.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/comisiones_pagos?on_conflict=vendedor,mes`, {
      method: "POST",
      headers: {
        ...headers,
        "Prefer": "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error("Error en Supabase: " + res.status);

    const rows = await res.json();
    const comisionId = rows && rows[0] ? rows[0].id : null;

    // Auditoría en comisiones_historial (best-effort: si falla, no rompe el flujo).
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/comisiones_historial`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          comision_id: comisionId,
          vendedor: vendedor,
          mes: mesSeleccionado,
          accion: nuevoEstado ? "marcada_pagada" : "marcada_pendiente",
          monto: Number(montoFinal)
        })
      });
    } catch (histErr) {
      console.warn("No se pudo registrar el historial de comisiones:", histErr);
    }

    await calcularComisiones();
  } catch (err) {
    console.error(err);
    if (statusEl) {
      statusEl.textContent = "Error al cambiar estado: " + err.message;
      statusEl.classList.add("error");
    }
  }
}

// ============================================================
// DELEGACIÓN DE EVENTOS PARA BOTONES GENERADOS DINÁMICAMENTE
// (reemplaza los onclick="..." que se armaban interpolando datos de
// usuario dentro del HTML, lo cual era riesgoso si esos datos contenían
// comillas u otros caracteres especiales)
// ============================================================
document.addEventListener("click", (e) => {
  const btnVer = e.target.closest('[data-accion="ver-detalle"]');
  if (btnVer) {
    verDetalle(btnVer.dataset.id);
    return;
  }

  const btnToggle = e.target.closest('[data-accion="toggle-pago"]');
  if (btnToggle) {
    const d = btnToggle.dataset;
    togglePago(
      d.vendedor,
      d.mes,
      d.pagada === "true",
      Number(d.comision),
      d.mesVentas,
      Number(d.total),
      Number(d.porcentaje),
    );
  }
});

// ============================================================
// EVENTOS Y ARRANQUE
// ============================================================
document.getElementById("modal-detalle-close")?.addEventListener("click", () => {
  document.getElementById("modal-detalle")?.classList.remove("active");
});

// Cerrar también al hacer click fuera del cuadro del modal (en el fondo oscuro)
document.getElementById("modal-detalle")?.addEventListener("click", (e) => {
  if (e.target.id === "modal-detalle") {
    e.currentTarget.classList.remove("active");
  }
});

document.getElementById("btn-buscar")?.addEventListener("click", buscarFacturas);
document.getElementById("btn-limpiar")?.addEventListener("click", () => {
  ["f-mes", "f-dia", "f-cedula", "f-vendedor", "f-id"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const elMetodo = document.getElementById("f-metodo");
  if (elMetodo) elMetodo.value = "";
  buscarFacturas();
});
document.getElementById("btn-buscar-com")?.addEventListener("click", calcularComisiones);

(async function init() {
  const hoy = new Date();
  const mesActual = hoy.toISOString().slice(0, 7);
  
  const fMes = document.getElementById("f-mes");
  const cMes = document.getElementById("c-mes");
  
  if (fMes) fMes.value = mesActual;
  if (cMes) cMes.value = mesActual;
  
  await buscarFacturas();
  await calcularComisiones();
})();
