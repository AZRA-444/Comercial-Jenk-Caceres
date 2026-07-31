// ============================================================
// MÓDULO DE REPORTES — Comercial Jenk Cáceres
// Cierre de caja, reimpresión de facturas, reporte de ventas por
// rango de fechas y reporte de comisiones. Todo se consulta
// directamente contra Supabase (igual que administrador.html e
// historial.html) y se imprime con el mismo mecanismo de iframe
// oculto que ya usa js/verificacion.js para las notas de entrega.
// ============================================================
const COL_FECHA = "created_at";
const NOMBRE_EMPRESA = "Comercial Jenk Cáceres";

const NOMBRES_METODO = {
  PM: "Pago Móvil",
  PVD: "Punto Débito",
  PVC: "Punto Crédito",
  ED: "Efectivo Divisa",
  EBS: "Efectivo Bolívares",
  OTROS: "Otros",
};
const ORDEN_METODOS = ["PM", "PVD", "PVC", "ED", "EBS", "OTROS"];

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
    d.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
  );
}
function fmtFechaLarga(fechaISO) {
  // fechaISO tipo "YYYY-MM-DD"
  const d = new Date(fechaISO + "T00:00:00");
  return d.toLocaleDateString("es-VE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}
function nombreMetodo(codigo) {
  return NOMBRES_METODO[codigo] || codigo || "Sin especificar";
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

// Fecha de HOY en hora local como "YYYY-MM-DD"
function hoyLocalISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function usuarioActualEmail() {
  try {
    const { data } = await window.__authClient.auth.getSession();
    return data?.session?.user?.email || "Sistema";
  } catch {
    return "Sistema";
  }
}

// ============================================================
// TABS
// ============================================================
const tabsCargados = { caja: false, facturas: false, ventas: false, comisiones: false };

document.querySelectorAll(".ledger-tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".ledger-tabs button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    const key = btn.dataset.panel;
    const panel = document.getElementById("panel-" + key);
    if (panel) panel.classList.add("active");

    if (!tabsCargados[key]) {
      tabsCargados[key] = true;
      if (key === "ventas") generarReporteVentas();
      if (key === "comisiones") generarReporteComisiones();
    }
  });
});

// ============================================================
// IMPRESIÓN (iframe oculto — mismo patrón que verificacion.js)
// ============================================================
function imprimirDocumento(html) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  let yaDisparado = false;
  const dispararImpresion = () => {
    if (yaDisparado) return;
    yaDisparado = true;
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.warn("No se pudo abrir el diálogo de impresión:", e);
      alert("No se pudo abrir el diálogo de impresión (¿hay una impresora conectada?).");
    }
    const limpiar = () => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); };
    if (iframe.contentWindow) iframe.contentWindow.onafterprint = limpiar;
    setTimeout(limpiar, 6000);
  };

  iframe.onload = dispararImpresion;
  setTimeout(dispararImpresion, 800);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
}

// Plantilla base para reportes en tamaño ticket.
// Impresora térmica: Roccia RC-5801, rollo de 58mm (~48-50mm imprimibles).
const ANCHO_TICKET_MM = 58;
function plantillaTicket(tituloDoc, contenidoHTML) {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>${escapeHtml(tituloDoc)}</title>
        <style>
          @page { size: ${ANCHO_TICKET_MM}mm auto; margin: 1.5mm; }
          * { box-sizing: border-box; }
          body { width: ${ANCHO_TICKET_MM}mm; font-family: 'Courier New', monospace; font-size: 9.5px; color: #000; margin: 0; }
          .doc { padding: 2px 1px; }
          .doc-tag { text-align: center; font-weight: bold; font-size: 10.5px; border: 1px solid #000; padding: 2px 0; margin-bottom: 5px; }
          .doc-header { text-align: center; margin-bottom: 5px; }
          .doc-empresa { font-weight: bold; font-size: 11px; margin: 0; }
          .doc-datos p { margin: 1px 0; word-break: break-word; }
          .doc-tabla { width: 100%; border-collapse: collapse; margin: 5px 0; }
          .doc-tabla th, .doc-tabla td { text-align: left; padding: 1px; font-size: 8.5px; overflow-wrap: break-word; }
          .der { text-align: right; }
          .doc-totales p { display: flex; justify-content: space-between; margin: 1px 0; }
          .doc-total-final { font-weight: bold; font-size: 10.5px; border-top: 1px dashed #000; padding-top: 2px; }
          .doc-sep { border-top: 1px dashed #000; margin: 6px 0; }
          .doc-firma { margin-top: 12px; font-size: 8.5px; text-align: center; }
        </style>
      </head>
      <body>${contenidoHTML}</body>
    </html>`;
}

// Plantilla base para reportes en tamaño carta (A4), pensados para
// archivar o entregar a contabilidad.
function plantillaA4(tituloDoc, subtitulo, contenidoHTML) {
  const generado = new Date().toLocaleString("es-VE");
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>${escapeHtml(tituloDoc)}</title>
        <style>
          @page { size: A4; margin: 16mm; }
          * { box-sizing: border-box; }
          body { font-family: 'Helvetica', Arial, sans-serif; color: #1a1218; margin: 0; font-size: 12px; }
          .rep-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1a1218; padding-bottom: 10px; margin-bottom: 18px; }
          .rep-header h1 { font-size: 18px; margin: 0 0 2px; }
          .rep-header p { margin: 0; color: #555; font-size: 11px; }
          .rep-meta { text-align: right; font-size: 11px; color: #555; }
          table.rep-tabla { width: 100%; border-collapse: collapse; margin-top: 10px; }
          table.rep-tabla th, table.rep-tabla td { border-bottom: 1px solid #ddd; padding: 6px 8px; text-align: left; font-size: 11px; }
          table.rep-tabla th { background: #f2e8ee; text-transform: uppercase; font-size: 9.5px; letter-spacing: .4px; color: #555; }
          table.rep-tabla td.num, table.rep-tabla th.num { text-align: right; font-variant-numeric: tabular-nums; }
          .rep-kpis { display: flex; gap: 14px; margin: 14px 0; flex-wrap: wrap; }
          .rep-kpi { border: 1px solid #ddd; border-radius: 6px; padding: 8px 14px; min-width: 120px; }
          .rep-kpi .label { font-size: 9.5px; text-transform: uppercase; color: #777; margin-bottom: 3px; }
          .rep-kpi .value { font-size: 15px; font-weight: 700; }
          tfoot td { font-weight: 700; border-top: 2px solid #1a1218; }
          .rep-footer { margin-top: 26px; font-size: 9.5px; color: #888; text-align: right; }
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        </style>
      </head>
      <body>
        <div class="rep-header">
          <div>
            <h1>${NOMBRE_EMPRESA}</h1>
            <p>${escapeHtml(tituloDoc)}</p>
          </div>
          <div class="rep-meta">
            <div>${escapeHtml(subtitulo)}</div>
          </div>
        </div>
        ${contenidoHTML}
        <div class="rep-footer">Generado el ${generado}</div>
      </body>
    </html>`;
}

// ============================================================
// PANEL 1 — CIERRE DE CAJA
// ============================================================
let cierreCajaActual = null;

async function generarCierreCaja() {
  const fecha = document.getElementById("cc-fecha")?.value || hoyLocalISO();
  const statusEl = document.getElementById("status-cc");
  if (statusEl) { statusEl.textContent = "Cargando…"; statusEl.classList.remove("error"); }

  const start = fecha + "T00:00:00";
  const d = new Date(fecha + "T00:00:00");
  d.setDate(d.getDate() + 1);
  const end = d.toISOString().slice(0, 19);

  const query = `${SUPABASE_URL}/rest/v1/facturas?select=*&order=${COL_FECHA}.asc&${COL_FECHA}=gte.${start}&${COL_FECHA}=lt.${end}`;

  try {
    const res = await fetch(query, { headers });
    if (!res.ok) throw new Error("Error " + res.status + " al consultar facturas");
    const facturas = await res.json();
    if (statusEl) statusEl.textContent = `Actualizado ${new Date().toLocaleTimeString("es-VE")}`;
    cierreCajaActual = construirCierreCaja(fecha, facturas);
    renderCierreCaja(cierreCajaActual);
  } catch (err) {
    if (statusEl) { statusEl.textContent = "No se pudo cargar: " + err.message; statusEl.classList.add("error"); }
    cierreCajaActual = construirCierreCaja(fecha, []);
    renderCierreCaja(cierreCajaActual);
  }
}

function construirCierreCaja(fecha, facturas) {
  const porMetodo = {};
  const porVendedor = {};
  let totalUSD = 0, totalBs = 0, totalDescuento = 0;

  facturas.forEach((f) => {
    const usd = Number(f.total_usd) || 0;
    const bs = Number(f.total_bs) || 0;
    const desc = Number(f.descuento_usd) || 0;
    const metodo = f.metodo_pago || "OTROS";
    const vendedor = f.vendedor ? f.vendedor.trim() : "Sin asignar";

    if (!porMetodo[metodo]) porMetodo[metodo] = { count: 0, usd: 0, bs: 0 };
    porMetodo[metodo].count += 1;
    porMetodo[metodo].usd += usd;
    porMetodo[metodo].bs += bs;

    if (!porVendedor[vendedor]) porVendedor[vendedor] = { count: 0, usd: 0 };
    porVendedor[vendedor].count += 1;
    porVendedor[vendedor].usd += usd;

    totalUSD += usd;
    totalBs += bs;
    totalDescuento += desc;
  });

  return { fecha, facturas, porMetodo, porVendedor, totalUSD, totalBs, totalDescuento };
}

function renderCierreCaja(cc) {
  const kpiUsd = document.getElementById("cc-kpi-usd");
  const kpiBs = document.getElementById("cc-kpi-bs");
  const kpiCount = document.getElementById("cc-kpi-count");
  const kpiDesc = document.getElementById("cc-kpi-desc");
  if (kpiUsd) kpiUsd.textContent = fmtUSD(cc.totalUSD);
  if (kpiBs) kpiBs.textContent = fmtBS(cc.totalBs);
  if (kpiCount) kpiCount.textContent = cc.facturas.length;
  if (kpiDesc) kpiDesc.textContent = fmtUSD(cc.totalDescuento);

  // Tabla por método
  const tbodyMetodos = document.getElementById("tbody-cc-metodos");
  const emptyMetodos = document.getElementById("empty-cc-metodos");
  if (tbodyMetodos) tbodyMetodos.innerHTML = "";
  const metodosUsados = Object.keys(cc.porMetodo);
  if (!metodosUsados.length) {
    if (emptyMetodos) emptyMetodos.style.display = "block";
  } else {
    if (emptyMetodos) emptyMetodos.style.display = "none";
    ORDEN_METODOS.concat(metodosUsados.filter((m) => !ORDEN_METODOS.includes(m)))
      .filter((m) => cc.porMetodo[m])
      .forEach((m) => {
        const datos = cc.porMetodo[m];
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><span class="tag">${escapeHtml(nombreMetodo(m))}</span></td>
          <td class="num">${datos.count}</td>
          <td class="num">${fmtUSD(datos.usd)}</td>
          <td class="num">${fmtBS(datos.bs)}</td>`;
        tbodyMetodos.appendChild(tr);
      });
  }

  // Tabla por vendedor
  const tbodyVend = document.getElementById("tbody-cc-vendedores");
  const emptyVend = document.getElementById("empty-cc-vendedores");
  if (tbodyVend) tbodyVend.innerHTML = "";
  const vendedores = Object.keys(cc.porVendedor).sort((a, b) => cc.porVendedor[b].usd - cc.porVendedor[a].usd);
  if (!vendedores.length) {
    if (emptyVend) emptyVend.style.display = "block";
  } else {
    if (emptyVend) emptyVend.style.display = "none";
    vendedores.forEach((v) => {
      const datos = cc.porVendedor[v];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(v)}</td>
        <td class="num">${datos.count}</td>
        <td class="num">${fmtUSD(datos.usd)}</td>`;
      tbodyVend.appendChild(tr);
    });
  }
}

async function imprimirCierreCaja() {
  if (!cierreCajaActual) await generarCierreCaja();
  const cc = cierreCajaActual;
  const usuario = await usuarioActualEmail();

  const filasMetodo = ORDEN_METODOS.concat(Object.keys(cc.porMetodo).filter((m) => !ORDEN_METODOS.includes(m)))
    .filter((m) => cc.porMetodo[m])
    .map((m) => {
      const d = cc.porMetodo[m];
      return `<tr><td>${escapeHtml(nombreMetodo(m))}</td><td class="der">${d.count}</td><td class="der">$${d.usd.toFixed(2)}</td></tr>`;
    }).join("");

  const contenido = `
    <div class="doc">
      <div class="doc-tag">CIERRE DE CAJA</div>
      <div class="doc-header">
        <p class="doc-empresa">${escapeHtml(NOMBRE_EMPRESA)}</p>
      </div>
      <div class="doc-datos">
        <p><strong>Fecha:</strong> ${escapeHtml(fmtFechaLarga(cc.fecha))}</p>
        <p><strong>Generado por:</strong> ${escapeHtml(usuario)}</p>
        <p><strong>Hora de cierre:</strong> ${new Date().toLocaleTimeString("es-VE")}</p>
      </div>
      <div class="doc-sep"></div>
      <table class="doc-tabla">
        <thead><tr><th>Método</th><th class="der">#</th><th class="der">Total $</th></tr></thead>
        <tbody>${filasMetodo || '<tr><td colspan="3">Sin movimientos</td></tr>'}</tbody>
      </table>
      <div class="doc-totales">
        <p><span>Facturas emitidas:</span><span>${cc.facturas.length}</span></p>
        <p><span>Descuentos otorgados:</span><span>-$${cc.totalDescuento.toFixed(2)}</span></p>
        <p class="doc-total-final"><span>TOTAL USD:</span><span>$${cc.totalUSD.toFixed(2)}</span></p>
        <p><span>TOTAL Bs:</span><span>Bs ${cc.totalBs.toFixed(2)}</span></p>
      </div>
      <div class="doc-firma">
        ______________________<br>Firma del cajero
        <br><br>
        ______________________<br>Firma del supervisor
      </div>
    </div>`;

  imprimirDocumento(plantillaTicket("Cierre de caja " + cc.fecha, contenido));
}

// ============================================================
// PANEL 2 — FACTURAS / REIMPRESIÓN
// ============================================================
window.__facturasReporte = [];

function primerDiaDelMes(mesStr) { return mesStr + "-01T00:00:00"; }
function primerDiaSiguienteMes(mesStr) {
  const [y, m] = mesStr.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return next + "-01T00:00:00";
}

async function buscarFacturasReporte() {
  const mes = document.getElementById("rf-mes")?.value;
  const dia = document.getElementById("rf-dia")?.value;
  const cedula = document.getElementById("rf-cedula")?.value.trim() || "";
  const vendedor = document.getElementById("rf-vendedor")?.value.trim() || "";
  const idFactura = document.getElementById("rf-id")?.value.trim() || "";
  const metodo = document.getElementById("rf-metodo")?.value || "";

  const statusEl = document.getElementById("status-rf");
  if (statusEl) { statusEl.textContent = "Cargando…"; statusEl.classList.remove("error"); }

  let query = `${SUPABASE_URL}/rest/v1/facturas?select=*&order=${COL_FECHA}.desc&limit=300`;

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
    renderFacturasReporte(data);
  } catch (err) {
    if (statusEl) { statusEl.textContent = "No se pudo cargar: " + err.message; statusEl.classList.add("error"); }
    renderFacturasReporte([]);
  }
}

function renderFacturasReporte(facturas) {
  const tbody = document.getElementById("tbody-rf");
  const empty = document.getElementById("empty-rf");
  const countLabel = document.getElementById("rf-count-label");

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
        <td>${fmtFecha(f[COL_FECHA])}</td>
        <td>${escapeHtml(f.nombre)} ${escapeHtml(f.apellido)}</td>
        <td>${escapeHtml(f.cedula)}</td>
        <td>${escapeHtml(f.vendedor)}</td>
        <td><span class="tag">${escapeHtml(nombreMetodo(f.metodo_pago))}</span></td>
        <td class="num">${fmtUSD(f.total_usd)}</td>
        <td class="num">${fmtBS(f.total_bs)}</td>
        <td class="text-center">
          <button class="btn small ghost" data-accion="ver-detalle" data-id="${escapeHtml(f.id_factura)}">Ver</button>
          <button class="btn small" data-accion="reimprimir" data-id="${escapeHtml(f.id_factura)}"><i class="fas fa-print"></i></button>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  window.__facturasReporte = facturas;
}

async function obtenerProductosFactura(idFactura) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/factura_detalles?id_factura=eq.${encodeQueryValue(idFactura)}&select=nombre_producto,cantidad,precio_unitario,precio_total`, { headers });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function verDetalleFacturaReporte(idFactura) {
  const factura = (window.__facturasReporte || []).find((f) => f.id_factura === idFactura);
  const titleEl = document.getElementById("modal-detalle-title");
  const body = document.getElementById("modal-detalle-body");
  const modal = document.getElementById("modal-detalle");
  const btnReimprimir = document.getElementById("modal-detalle-reimprimir");

  if (titleEl) titleEl.textContent = "Factura " + idFactura;
  if (body) body.innerHTML = "<p>Cargando productos…</p>";
  if (modal) modal.classList.add("active");
  if (btnReimprimir) btnReimprimir.dataset.id = idFactura;

  const productos = await obtenerProductosFactura(idFactura);
  const productosHtml = productos.length
    ? productos.map((p) => `
        <div class="row">
          <span>${escapeHtml(p.cantidad || 0)} × ${escapeHtml(p.nombre_producto || "Producto sin nombre")}</span>
          <span class="num">${fmtUSD(p.precio_total)}</span>
        </div>`).join("")
    : "<p>Sin productos registrados en esta factura.</p>";

  if (body) {
    body.innerHTML = `
      <div class="row"><span>Cliente</span><span>${escapeHtml(factura?.nombre)} ${escapeHtml(factura?.apellido)}</span></div>
      <div class="row"><span>Cédula</span><span>${escapeHtml(factura?.cedula)}</span></div>
      <div class="row"><span>Teléfono</span><span>${escapeHtml(factura?.telefono)}</span></div>
      <div class="row"><span>Vendedor</span><span>${escapeHtml(factura?.vendedor)}</span></div>
      <div class="row"><span>Método de pago</span><span>${escapeHtml(nombreMetodo(factura?.metodo_pago))}</span></div>
      <div class="row"><span>Referencia</span><span>${escapeHtml(factura?.referencia) || "N/A"}</span></div>
      <div class="row"><span>Banco</span><span>${escapeHtml(factura?.banco) || "N/A"}</span></div>
      <div class="row"><span>Observaciones</span><span>${escapeHtml(factura?.observaciones) || "N/A"}</span></div>
      <h4 style="margin:14px 0 6px;">Productos</h4>
      ${productosHtml}
      <div class="row" style="border-top:2px solid var(--ink); margin-top:8px; font-weight:700;">
        <span>Total</span><span class="num">${fmtUSD(factura?.total_usd)} · Bs ${fmtBS(factura?.total_bs)}</span>
      </div>`;
  }
}

async function reimprimirFactura(idFactura) {
  const factura = (window.__facturasReporte || []).find((f) => f.id_factura === idFactura);
  if (!factura) { alert("No se encontraron los datos de esta factura en la lista actual."); return; }

  const productos = await obtenerProductosFactura(idFactura);
  const filasProductos = productos.map((p) => `
    <tr>
      <td>${escapeHtml(p.cantidad || 0)}</td>
      <td>${escapeHtml(p.nombre_producto || "")}</td>
      <td class="der">$${(Number(p.precio_total) || 0).toFixed(2)}</td>
    </tr>`).join("");

  const contenido = `
    <div class="doc">
      <div class="doc-tag">FACTURA — REIMPRESIÓN</div>
      <div class="doc-header">
        <p class="doc-empresa">${escapeHtml(NOMBRE_EMPRESA)}</p>
      </div>
      <div class="doc-datos">
        <p><strong>ID:</strong> ${escapeHtml(factura.id_factura)}</p>
        <p><strong>Fecha original:</strong> ${escapeHtml(fmtFecha(factura[COL_FECHA]))}</p>
        <p><strong>Cliente:</strong> ${escapeHtml(factura.nombre)} ${escapeHtml(factura.apellido || "")}</p>
        <p><strong>Cédula:</strong> ${escapeHtml(factura.cedula || "N/A")}</p>
        <p><strong>Teléfono:</strong> ${escapeHtml(factura.telefono || "N/A")}</p>
        <p><strong>Vendedor:</strong> ${escapeHtml(factura.vendedor || "N/A")}</p>
        <p><strong>Método de pago:</strong> ${escapeHtml(nombreMetodo(factura.metodo_pago))}</p>
        ${factura.banco ? `<p><strong>Banco:</strong> ${escapeHtml(factura.banco)}</p>` : ""}
        ${factura.referencia ? `<p><strong>Referencia:</strong> ${escapeHtml(factura.referencia)}</p>` : ""}
      </div>
      <table class="doc-tabla">
        <thead><tr><th>Cant</th><th>Producto</th><th class="der">Total $</th></tr></thead>
        <tbody>${filasProductos || '<tr><td colspan="3">Sin productos</td></tr>'}</tbody>
      </table>
      <div class="doc-totales">
        <p><span>Subtotal:</span><span>$${(Number(factura.subtotal_usd) || 0).toFixed(2)}</span></p>
        <p><span>Descuento:</span><span>-$${(Number(factura.descuento_usd) || 0).toFixed(2)}</span></p>
        <p class="doc-total-final"><span>TOTAL:</span><span>$${(Number(factura.total_usd) || 0).toFixed(2)}</span></p>
        <p><span>Total Bs:</span><span>Bs ${(Number(factura.total_bs) || 0).toFixed(2)}</span></p>
        <p style="font-size:9px;text-align:right;">Tasa: ${(Number(factura.tasa_cambio) || 1).toFixed(2)} Bs/$</p>
      </div>
      <div class="doc-firma">Documento reimpreso el ${new Date().toLocaleString("es-VE")}</div>
    </div>`;

  imprimirDocumento(plantillaTicket("Factura " + factura.id_factura, contenido));
}


// ============================================================
// DELEGACIÓN DE EVENTOS (botones generados dinámicamente)
// ============================================================
document.addEventListener("click", (e) => {
  const btnVer = e.target.closest('[data-accion="ver-detalle"]');
  if (btnVer) { verDetalleFacturaReporte(btnVer.dataset.id); return; }

  const btnReimp = e.target.closest('[data-accion="reimprimir"]');
  if (btnReimp) { reimprimirFactura(btnReimp.dataset.id); return; }
});

document.getElementById("modal-detalle-close")?.addEventListener("click", () => {
  document.getElementById("modal-detalle")?.classList.remove("active");
});
document.getElementById("modal-detalle-cerrar")?.addEventListener("click", () => {
  document.getElementById("modal-detalle")?.classList.remove("active");
});
document.getElementById("modal-detalle")?.addEventListener("click", (e) => {
  if (e.target.id === "modal-detalle") e.currentTarget.classList.remove("active");
});
document.getElementById("modal-detalle-reimprimir")?.addEventListener("click", (e) => {
  const id = e.currentTarget.dataset.id;
  if (id) reimprimirFactura(id);
});

// ============================================================
// EVENTOS Y ARRANQUE
// ============================================================
document.getElementById("btn-cc-generar")?.addEventListener("click", generarCierreCaja);
document.getElementById("btn-cc-imprimir")?.addEventListener("click", imprimirCierreCaja);

document.getElementById("btn-rf-buscar")?.addEventListener("click", buscarFacturasReporte);
document.getElementById("btn-rf-limpiar")?.addEventListener("click", () => {
  ["rf-mes", "rf-dia", "rf-cedula", "rf-vendedor", "rf-id"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const elMetodo = document.getElementById("rf-metodo");
  if (elMetodo) elMetodo.value = "";
  renderFacturasReporte([]);
  const status = document.getElementById("status-rf");
  if (status) status.textContent = "";
});

document.getElementById("btn-rv-generar")?.addEventListener("click", generarReporteVentas);
document.getElementById("btn-rv-imprimir")?.addEventListener("click", imprimirReporteVentas);
document.getElementById("btn-rv-csv")?.addEventListener("click", exportarCSVVentas);

document.getElementById("btn-rc-generar")?.addEventListener("click", generarReporteComisiones);
document.getElementById("btn-rc-imprimir")?.addEventListener("click", imprimirReporteComisiones);

(async function init() {
  const hoy = hoyLocalISO();
  const mesActual = hoy.slice(0, 7);

  const ccFecha = document.getElementById("cc-fecha");
  if (ccFecha) ccFecha.value = hoy;

  const rvDesde = document.getElementById("rv-desde");
  const rvHasta = document.getElementById("rv-hasta");
  if (rvDesde) rvDesde.value = mesActual + "-01";
  if (rvHasta) rvHasta.value = hoy;

  const rcMes = document.getElementById("rc-mes");
  if (rcMes) rcMes.value = mesActual;

  // Solo se carga de inmediato la pestaña activa (Cierre de caja); las
  // demás se cargan la primera vez que el usuario hace click en su tab,
  // para no lanzar 4 consultas pesadas contra Supabase al entrar.
  tabsCargados.caja = true;
  await generarCierreCaja();
})();
