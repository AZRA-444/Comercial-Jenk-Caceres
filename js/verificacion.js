// ---------------------------------------------------------------------------
// Estado del módulo
// ---------------------------------------------------------------------------
let _facturasPendientes = [];
let _facturaActual      = null;

// Estado editable de la factura seleccionada (se reconstruye al seleccionar)
const verState = {
  productos:    [],   // copia editable de detalles_factura_temporal
  tasaCambio:   1,
  subtotalUSD:  0,
  descuentoUSD: 0,
  totalUSD:     0,
  totalBS:      0,
  combPagos:    [],   // líneas de pago del Pago Combinado (ver sección 6)
};

// ---------------------------------------------------------------------------
// Catálogo de bancos y de métodos combinables (usado por PM, TRANSF y COMB)
// ---------------------------------------------------------------------------
const BANCOS_VE = [
  'Banesco', 'Banco de Venezuela', 'Provincial', 'Banplus'
];

function _bancosOptionsHtml(seleccionado = '') {
  return `<option value="" disabled ${seleccionado ? '' : 'selected'}>Seleccione un banco</option>` +
    BANCOS_VE.map(b => `<option value="${b}" ${b === seleccionado ? 'selected' : ''}>${b}</option>`).join('');
}

// Métodos que se pueden combinar dentro de "Pago Combinado". Cada línea
// agregada por el verificador queda guardada en verState.combPagos con esta
// forma: { id, codigo, moneda: 'USD'|'BS', monto, banco, referencia }
const COMB_METODOS = {
  PM:     { label: 'Pago Móvil',              moneda: 'BS',  requiereBanco: true,  requiereRef: true,  refMin: 4 },
  TRANSF: { label: 'Transferencia Bancaria',  moneda: null,  requiereBanco: true,  requiereRef: true,  refMin: 1, monedaSeleccionable: true },
  PVD:    { label: 'Punto de Venta (Bs)',     moneda: 'BS',  requiereBanco: false, requiereRef: false },
  PVC:    { label: 'Punto de Venta ($)',      moneda: 'USD', requiereBanco: false, requiereRef: false },
  ED:     { label: 'Efectivo ($)',            moneda: 'USD', requiereBanco: false, requiereRef: false },
  EBS:    { label: 'Efectivo (Bs)',           moneda: 'BS',  requiereBanco: false, requiereRef: false },
};

// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  cargarFacturasPendientes();

  document.getElementById('inputBusqueda')
    .addEventListener('input', filtrarFacturas);

  document.getElementById('btnRefrescar')
    .addEventListener('click', cargarFacturasPendientes);

  // Calcular precio total automáticamente al tipear cantidad o precio
  const cantInput = document.getElementById('verCantProduct');
  const prcInput  = document.getElementById('verPrcUndProduct');
  const totInput  = document.getElementById('verPrcTotalProduct');

  const calcTotal = () => {
    const cant = Number(cantInput.value) || 0;
    const prc  = Number(prcInput.value)  || 0;
    totInput.value = (cant * prc).toFixed(2);
  };

  cantInput.addEventListener('input', calcTotal);
  prcInput.addEventListener('input',  calcTotal);

  // Delegación de eventos para los botones de la tabla
  document.getElementById('tablaVerificacionProductos')
    .addEventListener('click', _manejarClickTabla);
});

// ---------------------------------------------------------------------------
// 1. Carga de facturas pendientes
// ---------------------------------------------------------------------------
async function cargarFacturasPendientes() {
  setListaEstado('loading');

  try {
    const res  = await fetch('/api/gestion-temporales', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await _parseJSON(res);
    if (!json) return;

    if (json.status === 'success') {
      _facturasPendientes = json.data || [];
      renderizarLista(_facturasPendientes);
      document.getElementById('badgeCount').textContent = _facturasPendientes.length;
      if (_facturasPendientes.length > 0) seleccionarFactura(0);
    } else {
      setListaEstado('error', json.message);
    }
  } catch (err) {
    setListaEstado('error', 'Error de conexión: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// 2. Renderizar lista de tarjetas
// ---------------------------------------------------------------------------
function renderizarLista(facturas) {
  const lista = document.getElementById('listaPendientes');

  if (!facturas || facturas.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-circle-check"></i>
        <p>Sin facturas pendientes.<br>¡Todo al día!</p>
      </div>`;
    limpiarDetalle();
    return;
  }

  lista.innerHTML = facturas.map((f, i) => `
    <div class="factura-card" data-index="${i}" onclick="seleccionarFactura(${i})">
      <div class="factura-card-info">
        <p class="factura-card-id">ID: ${escapeHtml(f.id_factura)}</p>
        <p class="factura-card-meta">
          ${escapeHtml(f.nombre || '')} ${escapeHtml(f.apellido || '')}
          ${f.cedula ? '· ' + escapeHtml(f.cedula) : ''}
        </p>
      </div>
      <span class="factura-card-total">$${Number(f.total_usd || 0).toFixed(2)}</span>
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// 3. Seleccionar factura y construir estado editable
// ---------------------------------------------------------------------------
function seleccionarFactura(index) {
  const factura = _facturasPendientes[index];
  if (!factura) return;
  _facturaActual = factura;

  // Marcar tarjeta activa
  document.querySelectorAll('.factura-card').forEach(el =>
    el.classList.toggle('activa', parseInt(el.dataset.index) === index)
  );

  // Encabezado
  document.getElementById('detailId').textContent =
    'ID: ' + factura.id_factura;
  document.getElementById('detailCliente').textContent =
    `${factura.nombre || ''} ${factura.apellido || ''}`.trim() || 'Cliente';

  // Info cliente
  document.getElementById('detailCedula').textContent    = factura.cedula    || 'N/A';
  document.getElementById('detailTelefono').textContent  = factura.telefono  || 'N/A';
  document.getElementById('detailVendedor').textContent  = factura.vendedor  || 'N/A';

  // Construir estado editable de productos
  const detalles   = factura.detalles_factura_temporal || [];
  verState.tasaCambio = factura.tasa_cambio || 1;
  verState.combPagos  = []; // reinicia las líneas de pago combinado de la factura anterior

  verState.productos = detalles.map(p => ({
    nombre:            p.nombre_producto,
    cantidad:          Number(p.cantidad),
    precioUnitario:    Number(p.precio_unitario),
    precioTotal:       Number(p.precio_total),
    excluidoDescuento: false,
  }));

  // Mostrar panel
  document.getElementById('detailEmpty').classList.add('hidden');
  document.getElementById('detailContent').classList.remove('hidden');

  // Limpiar formulario de agregar producto
  _limpiarFormAgregar();

  // Renderizar tabla y totales
  verActualizarTabla();
}

// ---------------------------------------------------------------------------
// 4. CRUD — Agregar producto
// ---------------------------------------------------------------------------
function verAgregarProducto() {
  const cant = Number(document.getElementById('verCantProduct').value);
  const name = document.getElementById('verNameProduct').value.trim();
  const prc  = Number(document.getElementById('verPrcUndProduct').value);
  const tot  = Number(document.getElementById('verPrcTotalProduct').value);

  if (!name || cant <= 0 || prc <= 0) {
    alert('Por favor, llena correctamente los datos del producto (cantidad, nombre y precio).');
    return;
  }

  verState.productos.push({
    nombre:            name,
    cantidad:          cant,
    precioUnitario:    prc,
    precioTotal:       tot || cant * prc,
    excluidoDescuento: false,
  });

  _limpiarFormAgregar();
  verActualizarTabla();
}

// ---------------------------------------------------------------------------
// 4b. CRUD — Delegación de eventos en la tabla
// ---------------------------------------------------------------------------
function _manejarClickTabla(e) {
  const btnEliminar = e.target.closest('.btn-eliminar');
  if (btnEliminar) {
    const idx = parseInt(btnEliminar.dataset.index, 10);
    verState.productos.splice(idx, 1);
    verActualizarTabla();
    return;
  }

  const btnEditar = e.target.closest('.btn-editar');
  if (btnEditar) {
    const idx = parseInt(btnEditar.dataset.index, 10);
    _abrirModalEditarProductoVer(idx);
    return;
  }

  const btnToggle = e.target.closest('.btn-toggle-desc');
  if (btnToggle) {
    const idx = parseInt(btnToggle.dataset.index, 10);
    const p   = verState.productos[idx];
    if (p) {
      p.excluidoDescuento = !p.excluidoDescuento;
      verActualizarTabla();
    }
  }
}

// ---------------------------------------------------------------------------
// Modal de edición de producto (Verificación)
// ---------------------------------------------------------------------------
function _abrirModalEditarProductoVer(index) {
  const producto = verState.productos[index];
  if (!producto) return;

  let modal = document.getElementById('modalEditarProductoVer');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalEditarProductoVer';
    modal.className = 'modal-editar-producto';
    modal.innerHTML = `
      <div class="modal-editar-inner">
        <h3><i class="fa-solid fa-pen"></i> Editar producto</h3>
        <div class="campo-editar">
          <label>Cantidad</label>
          <input type="number" id="editVerCant" min="1" step="1">
        </div>
        <div class="campo-editar">
          <label>Nombre</label>
          <input type="text" id="editVerNombre">
        </div>
        <div class="campo-editar">
          <label>Precio unitario (USD)</label>
          <input type="number" id="editVerPrecioUnd" min="0" step="0.01">
        </div>
        <div class="acciones-modal-editar">
          <button class="btn-secondary" onclick="_cerrarModalEditarProductoVer()">Cancelar</button>
          <button class="btn-primary" onclick="_guardarEdicionProductoVer()">Guardar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) _cerrarModalEditarProductoVer();
    });
  }

  modal.dataset.index = index;
  document.getElementById('editVerCant').value = producto.cantidad;
  document.getElementById('editVerNombre').value = producto.nombre;
  document.getElementById('editVerPrecioUnd').value = producto.precioUnitario;
  modal.classList.remove('hidden');
}

function _cerrarModalEditarProductoVer() {
  const modal = document.getElementById('modalEditarProductoVer');
  if (modal) modal.classList.add('hidden');
}
window._cerrarModalEditarProductoVer = _cerrarModalEditarProductoVer;

function _guardarEdicionProductoVer() {
  const modal = document.getElementById('modalEditarProductoVer');
  if (!modal) return;
  const index = parseInt(modal.dataset.index, 10);
  const producto = verState.productos[index];
  if (!producto) return;

  const cant = Number(document.getElementById('editVerCant').value);
  const nombre = document.getElementById('editVerNombre').value.trim();
  const precioUnd = Number(document.getElementById('editVerPrecioUnd').value);

  if (!nombre || cant <= 0 || precioUnd <= 0) {
    alert('Por favor, completa correctamente cantidad, nombre y precio unitario.');
    return;
  }

  producto.cantidad = cant;
  producto.nombre = nombre;
  producto.precioUnitario = precioUnd;
  producto.precioTotal = cant * precioUnd;

  _cerrarModalEditarProductoVer();
  verActualizarTabla();
}
window._guardarEdicionProductoVer = _guardarEdicionProductoVer;

/**
 * Recalcula subtotales, descuentos y totales de la factura temporal activa
 * basándose en la lista de productos y la tasa de cambio actual.
 * 
 * @returns {Object} Objeto con todos los valores calculados
 */
function recalcularTotales() {
  const productos = verState.productos || [];
  const tasa = Number(verState.tasaCambio) || 1;

  // 1. Separar productos descontables vs. excluidos
  const descontables = productos.filter(p => !p.excluidoDescuento);
  const excluidos   = productos.filter(p => !!p.excluidoDescuento);

  // 2. Subtotales parciales
  const subDescUSD = descontables.reduce((acc, p) => acc + (Number(p.precioTotal) || 0), 0);
  const subExcUSD  = excluidos.reduce((acc, p) => acc + (Number(p.precioTotal) || 0), 0);
  const subTotalUSD = subDescUSD + subExcUSD;

  // 3. Escala de descuento según monto aplicable (USD)
  let porcentaje = 0;
  if      (subDescUSD > 100) porcentaje = 30;
  else if (subDescUSD >  10) porcentaje = 20;

  // 4. Cálculos finales
  const descuentoUSD = subDescUSD * (porcentaje / 100);
  const totalUSD     = subDescUSD - descuentoUSD + subExcUSD;
  const totalBS      = totalUSD * tasa;

  // 5. Sincronizar el estado global del módulo
  verState.subtotalUSD  = subTotalUSD;
  verState.descuentoUSD = descuentoUSD;
  verState.totalUSD     = totalUSD;
  verState.totalBS      = totalBS;

  return {
    subTotalUSD,
    descuentoUSD,
    totalUSD,
    totalBS,
    porcentaje
  };
}

// ---------------------------------------------------------------------------
// 5. Renderizar tabla editable y recalcular totales
// ---------------------------------------------------------------------------
function verActualizarTabla() {
  const tbody = document.getElementById('tablaVerificacionProductos');
  const tasa  = verState.tasaCambio;

  if (!verState.productos || verState.productos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Sin productos. Agrega uno arriba.</td></tr>`;
    _actualizarTotalesUI(0, 0, 0, 0);
    return;
  }

  // 1. Renderizar filas de la tabla
  tbody.innerHTML = verState.productos.map((p, i) => {
    const excluido      = !!p.excluidoDescuento;
    const precioUndBS   = (p.precioUnitario * tasa).toFixed(2);
    const precioTotalBS = (p.precioTotal    * tasa).toFixed(2);
    return `
      <tr>
        <td>${p.cantidad}</td>
        <td>${escapeHtml(p.nombre)}</td>
        <td>$${p.precioUnitario.toFixed(2)}</td>
        <td>${precioUndBS}Bs</td>
        <td>$${p.precioTotal.toFixed(2)}</td>
        <td>${precioTotalBS}Bs</td>
        <td class="acciones-producto">
          <button
            class="btn-toggle-desc${excluido ? ' active' : ''}"
            data-index="${i}"
            title="${excluido ? 'Volver a incluir en el descuento' : 'Sacar del descuento (se suma completo al total)'}"
          >
            <i class="fa-solid ${excluido ? 'fa-rotate-left' : 'fa-tag'}"></i>
          </button>
          <button class="btn-editar" data-index="${i}" title="Editar producto">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn-eliminar" data-index="${i}" title="Eliminar producto">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>`;
  }).join('');

  // 2. Ejecutar cálculo centralizado
  const { subTotalUSD, descuentoUSD, totalUSD, totalBS } = recalcularTotales();

  // 3. Reflejar montos en la interfaz
  _actualizarTotalesUI(subTotalUSD, descuentoUSD, totalUSD, totalBS);

  // 4. Actualizar el banner de la caja de pago si hay un método seleccionado
  const metodo = document.getElementById('verMetodoPago')?.value;
  if (metodo) {
    _actualizarMontoPago(metodo, totalUSD, totalBS);
    if (metodo === 'COMB') _verCombRefrescarResumen();
  }
}

// ---------------------------------------------------------------------------
// 6. Módulo de pago — render dinámico según método
// ---------------------------------------------------------------------------
function verSelectMetodoPago(valor) {
  const container = document.getElementById('verPaymentDetails');
  if (!container) return;

  container.innerHTML = '';

  const totalUSD = verState.totalUSD;
  const totalBS  = verState.totalBS;

  const montoHeader = `
    <div style="grid-column: 1 / -1; background: var(--rose-faint); border: 1px solid rgba(192,82,122,.25);
                border-radius: 10px; padding: 14px 16px; margin-bottom: 4px;">
      <p style="color: var(--text-secondary); font-size: .78rem; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px;">
        Monto a ${valor === 'PM' || valor === 'PVD' || valor === 'PVC' || valor === 'TRANSF' ? 'transferir' : 'pagar'}:
      </p>
      <p class="ver-monto-display" style="color: var(--rose-deep); font-size: 1.4rem; font-weight: 700; margin:0;">
        $${totalUSD.toFixed(2)} <span style="color:var(--text-secondary); font-size:.9rem;">/ Bs ${totalBS.toFixed(2)}</span>
      </p>
    </div>`;

  if (valor === 'PM') {
    container.innerHTML = `
      ${montoHeader}
      <label class="form-field">Banco Destino
        <select id="verBankSelect">${_bancosOptionsHtml()}</select>
      </label>
      <label class="form-field">Número de Referencia
        <input type="number" id="verPmRef" placeholder="Últimos 4 dígitos" />
      </label>`;

  } else if (valor === 'TRANSF') {
    container.innerHTML = `
      ${montoHeader}
      <label class="form-field">Moneda de la transferencia
        <select id="verTransfMoneda">
          <option value="BS">Bolívares (Bs)</option>
          <option value="USD">Dólares ($)</option>
        </select>
      </label>
      <label class="form-field">Banco
        <select id="verTransfBanco">${_bancosOptionsHtml()}</select>
      </label>
      <label class="form-field">Titular de la cuenta origen (opcional)
        <input type="text" id="verTransfTitular" placeholder="Nombre del titular" />
      </label>
      <label class="form-field">Número de Referencia / Operación
        <input type="text" id="verTransfRef" placeholder="Nº de operación" />
      </label>`;

  } else if (valor === 'PVD' || valor === 'PVC') {
    container.innerHTML = montoHeader;

  } else if (valor === 'ED') {
    container.innerHTML = `
      ${montoHeader}
      <label class="form-field">Monto Recibido ($)
        <input type="number" id="verEDMontoRecibido" placeholder="ej: 20" step="0.01" />
      </label>
      <label class="form-field">Vuelto a Entregar ($)
        <input type="text" id="verEDVuelto" readonly placeholder="0.00" />
      </label>
      <label class="form-field" style="grid-column: 1 / -1;">Observaciones
        <textarea id="verObsED" rows="3" placeholder="Detalla alguna novedad..."></textarea>
      </label>`;

    // Listener de vuelto
    setTimeout(() => {
      const recInput = document.getElementById('verEDMontoRecibido');
      const vueltoIn = document.getElementById('verEDVuelto');
      if (recInput && vueltoIn) {
        recInput.addEventListener('input', () => {
          const rec = Number(recInput.value) || 0;
          vueltoIn.value = rec < verState.totalUSD
            ? '0.00'
            : `$${(rec - verState.totalUSD).toFixed(2)}`;
        });
      }
    }, 0);

  } else if (valor === 'EBS') {
    container.innerHTML = `
      ${montoHeader}
      <label class="form-field">Monto Recibido (Bs)
        <input type="number" id="verEBSMontoRecibido" placeholder="ej: 2500" step="0.01" />
      </label>
      <label class="form-field">Vuelto a Entregar (Bs)
        <input type="text" id="verEBSVuelto" readonly placeholder="0.00" />
      </label>`;

    setTimeout(() => {
      const recInput = document.getElementById('verEBSMontoRecibido');
      const vueltoIn = document.getElementById('verEBSVuelto');
      if (recInput && vueltoIn) {
        recInput.addEventListener('input', () => {
          const rec = Number(recInput.value) || 0;
          vueltoIn.value = rec < verState.totalBS
            ? '0.00'
            : `${(rec - verState.totalBS).toFixed(2)}Bs`;
        });
      }
    }, 0);

} else if (valor === 'COMB') {

    // El Pago Combinado es una lista de líneas (verState.combPagos) que se
    // construye de a un pago a la vez con el mini-formulario "Añadir pago".
    // Esto permite, por ejemplo, dos Pagos Móviles de teléfonos distintos,
    // un Efectivo ($) y una Transferencia Bancaria, todo en la misma venta.
    verState.combPagos = [];

    container.innerHTML = `
      ${montoHeader}
      <div class="comb-builder">
        <div class="comb-add-row">
          <label class="form-field">Método a añadir
            <select id="combMetodoNuevo">
              ${Object.entries(COMB_METODOS).map(([cod, def]) => `<option value="${cod}">${def.label}</option>`).join('')}
            </select>
          </label>
          <div id="combCamposDinamicos" class="comb-campos-dinamicos"></div>
          <button type="button" class="btn-secondary comb-btn-add" id="btnCombAgregar">
            <i class="fas fa-plus"></i> Añadir pago
          </button>
        </div>

        <div class="table-responsive comb-tabla-wrap">
          <table class="comb-tabla">
            <thead><tr><th>Método</th><th>Monto</th><th>Detalle</th><th></th></tr></thead>
            <tbody id="combTablaBody">
              <tr><td colspan="4" class="table-empty">Aún no se ha agregado ningún pago.</td></tr>
            </tbody>
          </table>
        </div>

        <div id="verCombSummary" class="comb-summary">
          <div class="total-row">
            <span>Total ingresado</span>
            <strong>$<span id="verCombTotal">0.00</span>
              <span class="comb-sub">/ Bs <span id="verCombTotalBS">0.00</span></span>
            </strong>
          </div>
          <div class="total-row">
            <span>Resta por cubrir</span>
            <strong id="verCombRestanteContainer" class="comb-restante">
              $<span id="verCombRestante">${totalUSD.toFixed(2)}</span>
              <span class="comb-sub">/ Bs <span id="verCombRestanteBS">${totalBS.toFixed(2)}</span></span>
            </strong>
          </div>
          <div class="total-row hidden" id="verCombVueltoRow">
            <span>Vuelto a entregar (efectivo)</span>
            <strong id="verCombVuelto" style="color: var(--success);">$0.00</strong>
          </div>
        </div>
      </div>`;

    setTimeout(_initCombBuilder, 0);

  } else if (valor === 'OTROS') {
    container.innerHTML = `
      ${montoHeader}
      <label class="form-field" style="grid-column: 1 / -1;">Observaciones
        <textarea id="verObsOTROS" rows="3" placeholder="Detalla alguna novedad..."></textarea>
      </label>`;
  }
}

/** Actualiza solo el monto mostrado dentro del bloque de pago ya renderizado */
function _actualizarMontoPago(metodo, totalUSD, totalBS) {
  const el = document.querySelector('.ver-monto-display');
  if (!el) return;
  el.innerHTML = `$${totalUSD.toFixed(2)} <span style="color:var(--text-secondary); font-size:.9rem;">/ Bs ${totalBS.toFixed(2)}</span>`;
}

// ---------------------------------------------------------------------------
// 6b. Constructor de Pago Combinado (varias líneas de pago, cualquier mezcla
//     y repeticiones del mismo método: ej. 2 Pagos Móviles + 1 Transferencia)
// ---------------------------------------------------------------------------

/** Monto de una línea de pago combinado expresado en USD, según su moneda nativa */
function _verCombMontoUSD(pago) {
  const tasa = Number(verState.tasaCambio) || 1;
  return pago.moneda === 'USD' ? pago.monto : (pago.monto / tasa);
}

/** Monto de una línea de pago combinado expresado en Bs, según su moneda nativa */
function _verCombMontoBS(pago) {
  const tasa = Number(verState.tasaCambio) || 1;
  return pago.moneda === 'USD' ? (pago.monto * tasa) : pago.monto;
}

/** Renderiza en #combCamposDinamicos los campos que pide el método elegido */
function _renderCombCamposDinamicos() {
  const select = document.getElementById('combMetodoNuevo');
  const cont   = document.getElementById('combCamposDinamicos');
  if (!select || !cont) return;

  const codigo = select.value;
  const def    = COMB_METODOS[codigo];
  if (!def) { cont.innerHTML = ''; return; }

  let html = '';

  if (def.monedaSeleccionable) {
    html += `
      <label class="form-field">Moneda
        <select id="combMoneda">
          <option value="BS">Bolívares (Bs)</option>
          <option value="USD">Dólares ($)</option>
        </select>
      </label>`;
  }

  const unidad = def.monedaSeleccionable ? '' : (def.moneda === 'USD' ? ' ($)' : ' (Bs)');
  html += `
    <label class="form-field">Monto${unidad}
      <input type="number" id="combMontoNuevo" step="0.01" min="0.01" placeholder="0.00" />
    </label>`;

  if (def.requiereBanco) {
    html += `
      <label class="form-field">Banco
        <select id="combBancoNuevo">${_bancosOptionsHtml()}</select>
      </label>`;
  }
  if (def.requiereRef) {
    html += `
      <label class="form-field">Referencia
        <input type="text" id="combRefNuevo" placeholder="${codigo === 'PM' ? 'Últimos 4 dígitos' : 'Nº de referencia'}" />
      </label>`;
  }

  cont.innerHTML = html;
}

/** Lee el mini-formulario "Añadir pago", valida y agrega la línea a verState.combPagos */
function _combAgregarPago() {
  const select = document.getElementById('combMetodoNuevo');
  const codigo = select?.value;
  const def    = COMB_METODOS[codigo];
  if (!def) return;

  const montoInput = document.getElementById('combMontoNuevo');
  const monto = Number(montoInput?.value);
  if (!monto || monto <= 0) {
    alert(`Ingresa un monto válido para ${def.label}.`);
    return;
  }

  const moneda = def.monedaSeleccionable
    ? (document.getElementById('combMoneda')?.value || 'BS')
    : def.moneda;

  let banco = '';
  if (def.requiereBanco) {
    banco = document.getElementById('combBancoNuevo')?.value || '';
    if (!banco) {
      alert(`Selecciona el banco para ${def.label}.`);
      return;
    }
  }

  let referencia = '';
  if (def.requiereRef) {
    referencia = document.getElementById('combRefNuevo')?.value.trim() || '';
    if (!referencia || referencia.length < (def.refMin || 1)) {
      alert(`Ingresa un número de referencia válido para ${def.label}.`);
      return;
    }
  }

  verState.combPagos.push({
    id: 'p' + Date.now() + Math.random().toString(16).slice(2),
    codigo, moneda, monto, banco, referencia,
  });

  // Limpia solo monto/banco/referencia; deja el método elegido para poder
  // agregar rápidamente varios pagos del mismo tipo (ej. 2 Pagos Móviles).
  if (montoInput) montoInput.value = '';
  const bancoInput = document.getElementById('combBancoNuevo');
  if (bancoInput) bancoInput.value = '';
  const refInput = document.getElementById('combRefNuevo');
  if (refInput) refInput.value = '';

  _verCombRenderTabla();
  _verCombRefrescarResumen();
}

/** Dibuja la tabla con las líneas de pago ya agregadas */
function _verCombRenderTabla() {
  const tbody = document.getElementById('combTablaBody');
  if (!tbody) return;

  const filas = verState.combPagos || [];
  if (filas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty">Aún no se ha agregado ningún pago.</td></tr>`;
    return;
  }

  tbody.innerHTML = filas.map(p => {
    const def = COMB_METODOS[p.codigo] || { label: p.codigo };
    const montoTxt = p.moneda === 'USD' ? `$${p.monto.toFixed(2)}` : `Bs ${p.monto.toFixed(2)}`;
    const detalle = [p.banco, p.referencia ? `Ref: ${p.referencia}` : ''].filter(Boolean).map(escapeHtml).join(' · ');
    return `
      <tr>
        <td>${escapeHtml(def.label)}</td>
        <td>${montoTxt}</td>
        <td>${detalle || '—'}</td>
        <td class="acciones-producto">
          <button type="button" class="btn-eliminar comb-btn-eliminar" data-id="${p.id}" title="Quitar este pago">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>`;
  }).join('');
}

/** Recalcula y muestra el total ingresado, el restante y el vuelto (si aplica) */
function _verCombRefrescarResumen() {
  const spanTotal = document.getElementById('verCombTotal');
  if (!spanTotal) return; // el bloque COMB no está montado (otro método activo)

  const tasa = Number(verState.tasaCambio) || 1;
  const pagos = verState.combPagos || [];

  const sumaUSD    = pagos.reduce((acc, p) => acc + _verCombMontoUSD(p), 0);
  const sumaBS     = sumaUSD * tasa;
  const restanteUSD = verState.totalUSD - sumaUSD;
  const restanteBS  = restanteUSD * tasa;

  spanTotal.textContent = sumaUSD.toFixed(2);
  document.getElementById('verCombTotalBS').textContent = sumaBS.toFixed(2);
  document.getElementById('verCombRestante').textContent = restanteUSD > 0 ? restanteUSD.toFixed(2) : '0.00';
  document.getElementById('verCombRestanteBS').textContent = restanteBS > 0 ? restanteBS.toFixed(2) : '0.00';

  const restanteContainer = document.getElementById('verCombRestanteContainer');
  if (restanteContainer) {
    restanteContainer.classList.toggle('cubierto', restanteUSD <= 0.01);
  }

  // Vuelto: solo si hay excedente y ese excedente puede cubrirse con lo
  // recibido en efectivo (de una transferencia o pago móvil no se puede
  // "dar vuelto", así que no se ofrece cambio sobre esos montos).
  const vueltoRow  = document.getElementById('verCombVueltoRow');
  const vueltoSpan = document.getElementById('verCombVuelto');
  const efectivoUSD = pagos
    .filter(p => p.codigo === 'ED' || p.codigo === 'EBS')
    .reduce((acc, p) => acc + _verCombMontoUSD(p), 0);

  const excedenteUSD = sumaUSD - verState.totalUSD;
  if (excedenteUSD > 0.01 && efectivoUSD > 0 && vueltoRow && vueltoSpan) {
    const vuelto = Math.min(excedenteUSD, efectivoUSD);
    vueltoSpan.textContent = `$${vuelto.toFixed(2)}`;
    vueltoRow.classList.remove('hidden');
  } else if (vueltoRow) {
    vueltoRow.classList.add('hidden');
  }
}

/** Inicializa listeners del bloque COMB (se llama tras insertar su HTML) */
function _initCombBuilder() {
  const select = document.getElementById('combMetodoNuevo');
  const btnAdd = document.getElementById('btnCombAgregar');
  const tbody  = document.getElementById('combTablaBody');
  if (!select || !btnAdd || !tbody) return;

  _renderCombCamposDinamicos();
  select.addEventListener('change', _renderCombCamposDinamicos);
  btnAdd.addEventListener('click', _combAgregarPago);

  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('.comb-btn-eliminar');
    if (!btn) return;
    const id = btn.dataset.id;
    verState.combPagos = (verState.combPagos || []).filter(p => p.id !== id);
    _verCombRenderTabla();
    _verCombRefrescarResumen();
  });

  _verCombRenderTabla();
  _verCombRefrescarResumen();
}

// ---------------------------------------------------------------------------
// 7. Validar formulario de pago antes de aprobar
// ---------------------------------------------------------------------------
function _validarPago() {
  const metodo = document.getElementById('verMetodoPago')?.value;

  if (!metodo) {
    alert('Por favor selecciona un método de pago antes de aprobar.');
    return false;
  }

  if (metodo === 'PM') {
    const banco = document.getElementById('verBankSelect')?.value;
    const ref   = document.getElementById('verPmRef')?.value.trim();
    
    if (!banco) {
      alert('Para Pago Móvil, selecciona un Banco Destino.');
      return false;
    }
    if (!ref || ref.length < 4) {
      alert('Para Pago Móvil, ingresa el Número de Referencia (mínimo 4 dígitos).');
      return false;
    }
  }

  if (metodo === 'ED') {
    const monto = Number(document.getElementById('verEDMontoRecibido')?.value);
    if (!monto || monto < verState.totalUSD) {
      alert(`El monto recibido en $ es menor al total ($${verState.totalUSD.toFixed(2)}).`);
      return false;
    }
  }

  if (metodo === 'EBS') {
    const monto = Number(document.getElementById('verEBSMontoRecibido')?.value);
    if (!monto || monto < verState.totalBS) {
      alert(`El monto recibido en Bs es menor al total (${verState.totalBS.toFixed(2)} Bs).`);
      return false;
    }
  }

  if (metodo === 'TRANSF') {
    const banco = document.getElementById('verTransfBanco')?.value;
    const ref   = document.getElementById('verTransfRef')?.value.trim();

    if (!banco) {
      alert('Para Transferencia Bancaria, selecciona el Banco.');
      return false;
    }
    if (!ref) {
      alert('Para Transferencia Bancaria, ingresa el Número de Referencia / Operación.');
      return false;
    }
  }

  if (metodo === 'COMB') {
    const pagos = verState.combPagos || [];

    if (pagos.length === 0) {
      alert('Para Pago Combinado, agrega al menos un pago con el formulario "Añadir pago".');
      return false;
    }

    const sumaUSD = pagos.reduce((acc, p) => acc + _verCombMontoUSD(p), 0);

    // Verificación final del monto cubierto (tolerancia de $0.01 por redondeo decimal)
    if (sumaUSD < (verState.totalUSD - 0.01)) {
      const faltante = verState.totalUSD - sumaUSD;
      alert(`El pago combinado ingresado ($${sumaUSD.toFixed(2)}) no cubre la compra. Faltan $${faltante.toFixed(2)}.`);
      return false;
    }
  }

  if (metodo === 'OTROS') {
    const obs = document.getElementById('verObsOTROS')?.value.trim();
    if (!obs) {
      alert('Para el método OTROS, detalla las observaciones.');
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// 9. Aprobar factura — con datos de pago editados
// ---------------------------------------------------------------------------
async function aprobarFacturaActual() {
  if (!_facturaActual) return;

  // Validar que haya al menos un producto
  if (!verState.productos || verState.productos.length === 0) {
    alert('La factura no puede aprobarse sin productos.');
    return;
  }

  // Validar formulario de pago
  if (!_validarPago()) return;

  const btn = document.getElementById('btnAprobar');
  btn.disabled = true;
  mostrarCargando(true);

  const metodo = document.getElementById('verMetodoPago')?.value || 'OTROS';

  // Variables para recopilar la información del pago
  let banco = 'N/A';
  let referencia = 'N/A';
  let obsExtra = '';
  let pagosCombinados = [];
  let metodoPagoTexto = formatMetodoPago ? formatMetodoPago(metodo) : metodo;

  // Lógica de extracción según el método seleccionado
  if (metodo === 'COMB') {
    const bancosList = [];
    const refsList = [];
    const detallesTexto = [];

    pagosCombinados = (verState.combPagos || []).map(p => {
      const def = COMB_METODOS[p.codigo] || { label: p.codigo };
      const montoUSD = _verCombMontoUSD(p);
      const montoBs  = _verCombMontoBS(p);

      if (p.banco) bancosList.push(`${def.label}: ${p.banco}`);
      if (p.referencia) refsList.push(`${def.label}: ${p.referencia}`);

      const montoTexto = p.moneda === 'USD' ? `$${p.monto.toFixed(2)}` : `Bs ${p.monto.toFixed(2)}`;
      detallesTexto.push(
        `${def.label}${p.banco ? ' (' + p.banco + ')' : ''}: ${montoTexto}${p.referencia ? ' - Ref: ' + p.referencia : ''}`
      );

      return {
        metodo: def.label,
        codigo: p.codigo,
        moneda: p.moneda,
        montoNativo: p.monto,
        montoUSD,
        montoBs,
        banco: p.banco || '',
        referencia: p.referencia || '',
      };
    });

    banco = bancosList.length > 0 ? bancosList.join(' | ') : 'N/A';
    referencia = refsList.length > 0 ? refsList.join(' | ') : 'N/A';
    metodoPagoTexto = `Pago Combinado: [ ${detallesTexto.join(' + ')} ]`;

  } else if (metodo === 'PM') {
    banco = document.getElementById('verBankSelect')?.value || 'N/A';
    referencia = document.getElementById('verPmRef')?.value?.trim() || 'N/A';

  } else if (metodo === 'TRANSF') {
    const monedaT = document.getElementById('verTransfMoneda')?.value || 'BS';
    const titular = document.getElementById('verTransfTitular')?.value?.trim();
    banco = document.getElementById('verTransfBanco')?.value || 'N/A';
    referencia = document.getElementById('verTransfRef')?.value?.trim() || 'N/A';

    const detalles = [`Moneda: ${monedaT === 'USD' ? 'Dólares ($)' : 'Bolívares (Bs)'}`];
    if (titular) detalles.push(`Titular: ${titular}`);
    obsExtra = detalles.join(' · ');
  }

  const obs =
    document.getElementById('verObsOTROS')?.value.trim() ||
    document.getElementById('verObsED')?.value.trim()    ||
    obsExtra || '';

  const payload = {
    id_factura: _facturaActual.id_factura,
    estado:     'aprobado',

    // Datos de pago actualizados
    metodo_pago:      metodo,
    banco:            banco,
    referencia:       referencia,
    observaciones:    obs || 'N/A',
    pagos_combinados: pagosCombinados, // Array estructurado (una fila por cada pago del Pago Combinado)

    // Totales recalculados
    subtotal_usd:  verState.subtotalUSD,
    descuento_usd: verState.descuentoUSD,
    total_usd:     verState.totalUSD,
    total_bs:      verState.totalBS,

    // Productos editados
    productos: verState.productos.map(p => ({
      nombre:         p.nombre,
      cantidad:       p.cantidad,
      precioUnitario: p.precioUnitario,
      precioTotal:    p.precioTotal,
    })),
  };

  try {
    const res  = await fetch('/api/gestion-temporales', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const json = await _parseJSON(res);
    if (!json) { btn.disabled = false; return; }

    if (json.status === 'success') {
      mostrarModalExito('Factura aprobada correctamente. Si el papel se traba o se termina, usa los botones de abajo para reimprimir.');

      // Guardamos los datos completos para la nota de entrega
      const datosNota = {
        id_factura:      _facturaActual.id_factura,
        nombre:          _facturaActual.nombre,
        apellido:        _facturaActual.apellido,
        cedula:          _facturaActual.cedula,
        telefono:        _facturaActual.telefono,
        vendedor:        _facturaActual.vendedor,
        metodoPagoTexto: metodoPagoTexto,
        banco:           payload.banco,
        referencia:      payload.referencia,
        pagosCombinados: pagosCombinados,
        productos:       verState.productos,
        subtotalUSD:     verState.subtotalUSD,
        descuentoUSD:    verState.descuentoUSD,
        totalUSD:        verState.totalUSD,
        totalBS:         verState.totalBS,
        tasaCambio:      Number(verState.tasaCambio) || 1,
      };

      try {

        imprimirNotaEntrega(datosNota);

      } catch (errImpresion) {

        console.warn('No se pudo generar la nota de entrega para imprimir:', errImpresion);
        mostrarModalError(
          'La factura se guardó correctamente, pero no se pudo abrir la impresión automática. Usa "Reintentar impresión".',
          true

        );

      }

    } else {

      mostrarModalError(json.message || 'No se pudo aprobar la factura.');

      btn.disabled = false;

    }

  } catch (err) {

    mostrarModalError('Error de conexión: ' + err.message);

    btn.disabled = false;

  }

}

// ---------------------------------------------------------------------------
// 9b. Impresión de Nota de Entrega (Original + Copia)
// ---------------------------------------------------------------------------

const ANCHO_ROLLO_MM = 57;

// Guarda los datos de la última nota generada para poder reimprimirla
let _ultimaNotaImpresa = null;

function _filaProductoNota(p) {
  return `
    <tr>
      <td>${p.cantidad}</td>
      <td>${escapeHtml(p.nombre)}</td>
      <td class="der">$${Number(p.precioTotal).toFixed(2)}</td>
    </tr>`;
}

function _construirNotaEntregaHTML(datos) {
  const fecha = new Date().toLocaleString('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const filasProductos = (datos.productos || []).map(_filaProductoNota).join('');

  // Generación dinámica de la sección de pago (Combinado vs Tradicional)
  let bloquePagoHTML = '';

  if (datos.pagosCombinados && datos.pagosCombinados.length > 0) {
    const renglonesPago = datos.pagosCombinados.map(p => {
      let info = `<strong>${escapeHtml(p.metodo)}:</strong> `;

      // Se muestra en la moneda que realmente se recibió (p.moneda), no
      // simplemente el primer monto que exista, ya que ahora ambos
      // equivalentes (USD y Bs) viajan siempre juntos en cada línea.
      if (p.moneda === 'USD') {
        info += `$${Number(p.montoUSD ?? p.montoNativo ?? 0).toFixed(2)}`;
      } else if (p.montoBs != null || p.moneda === 'BS') {
        info += `Bs ${Number(p.montoBs ?? p.montoNativo ?? 0).toFixed(2)}`;
      } else if (p.montoUSD) {
        info += `$${Number(p.montoUSD).toFixed(2)}`;
      }

      const extras = [];
      if (p.banco) extras.push(escapeHtml(p.banco));
      if (p.referencia) extras.push(`Ref: ${escapeHtml(p.referencia)}`);

      if (extras.length > 0) {
        info += ` <span style="font-size: 0.85em;">(${extras.join(' - ')})</span>`;
      }

      return `<p style="margin: 2px 0 2px 8px; font-size: 0.9em;">• ${info}</p>`;
    }).join('');

    bloquePagoHTML = `
      <div style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed #ccc;">
        <p style="margin-bottom: 2px;"><strong>Método de pago:</strong> Combinado</p>
        ${renglonesPago}
      </div>`;
  } else {
    bloquePagoHTML = `
      <p><strong>Método de pago:</strong> ${escapeHtml(datos.metodoPagoTexto || 'N/A')}</p>
      ${datos.banco && datos.banco !== 'N/A' ? `<p><strong>Banco:</strong> ${escapeHtml(datos.banco)}</p>` : ''}
      ${datos.referencia && datos.referencia !== 'N/A' ? `<p><strong>Referencia:</strong> ${escapeHtml(datos.referencia)}</p>` : ''}
    `;
  }

  return `
    <section class="nota">
      <div class="nota-header">
        <p class="nota-empresa">Comercial Jenk Cáceres</p>
        <p class="nota-titulo">Nota de Entrega</p>
      </div>
      <div class="nota-datos">
        <p><strong>ID:</strong> ${escapeHtml(datos.id_factura)}</p>
        <p><strong>Fecha:</strong> ${fecha}</p>
        <p><strong>Cliente:</strong> ${escapeHtml(datos.nombre)} ${escapeHtml(datos.apellido || '')}</p>
        <p><strong>Cédula:</strong> ${escapeHtml(datos.cedula || 'N/A')}</p>
        <p><strong>Teléfono:</strong> ${escapeHtml(datos.telefono || 'N/A')}</p>
        <p><strong>Vendedor:</strong> ${escapeHtml(datos.vendedor || 'N/A')}</p>
        ${bloquePagoHTML}
      </div>
      <table class="nota-tabla">
        <thead><tr><th>Cant</th><th>Producto</th><th class="der">Total $</th></tr></thead>
        <tbody>${filasProductos}</tbody>
      </table>
      
      <table class="nota-totales-tabla">
        <tr><td>Subtotal:</td><td class="der">$${Number(datos.subtotalUSD || 0).toFixed(2)}</td></tr>
        <tr><td>Descuento:</td><td class="der">-$${Number(datos.descuentoUSD || 0).toFixed(2)}</td></tr>
        <tr class="nota-total-final"><td>TOTAL:</td><td class="der">$${Number(datos.totalUSD || 0).toFixed(2)}</td></tr>
        <tr><td>Total Bs:</td><td class="der">Bs ${Number(datos.totalBS || 0).toFixed(2)}</td></tr>
      </table>

      <p class="nota-tasa">Tasa: ${Number(datos.tasaCambio || 1).toFixed(2)} Bs/$</p>
    </section>`;
}

function _imprimirUnaCopiaNota(datos, alTerminar) {
  const contenido = _construirNotaEntregaHTML(datos);

  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Nota de Entrega ${escapeHtml(datos.id_factura)}</title>
        <style>
          /* 1. Eliminamos márgenes del navegador para controlar el centrado nosotros */
          @page { 
            size: ${ANCHO_ROLLO_MM}mm auto; 
            margin: 0mm; 
          }
          
          * { 
            box-sizing: border-box; 
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          
          html, body {
            margin: 0;
            padding: 0;
            background: #ffffff;
          }

          body {
            /* 2. Ancho útil real de impresión (49mm) centrado en el papel de 57mm */
            width: 49mm;
            margin: 0;
            padding: 2mm 0 2mm 1mm;
            
            /* 3. Fuente sin serifas gruesa optimizada para cabezales térmicos de 203 DPI */
            font-family: Arial, Helvetica, sans-serif;
            font-size: 9.5px;
            font-weight: 600; /* Mayor densidad de calor */
            color: #000000;
            line-height: 1.2;
          }

          .nota { width: 100%; }
          .nota-header { text-align: center; margin-bottom: 4px; }
          .nota-empresa { font-weight: 900; font-size: 12px; margin: 0 0 2px 0; text-transform: uppercase; }
          .nota-titulo { font-size: 10px; font-weight: bold; margin: 0; }
          
          .nota-datos { 
            border-top: 1px dashed #000; 
            border-bottom: 1px dashed #000; 
            padding: 3px 0; 
            margin: 4px 0; 
          }
          .nota-datos p { margin: 1.5px 0; word-break: break-word; font-size: 9px; }
          
          /* Tabla de productos alineada */
          .nota-tabla { width: 100%; border-collapse: collapse; margin: 4px 0; table-layout: fixed; }
          .nota-tabla th, .nota-tabla td { text-align: left; padding: 2px 0; font-size: 9px; vertical-align: top; }
          .nota-tabla th { font-weight: 900; border-bottom: 1px solid #000; }
          .nota-tabla th:nth-child(1), .nota-tabla td:nth-child(1) { width: 14%; }
          .nota-tabla th:nth-child(2), .nota-tabla td:nth-child(2) { width: 56%; }
          .nota-tabla th:nth-child(3), .nota-tabla td:nth-child(3) { width: 30%; }
          .der { text-align: right !important; }
          
          /* Tabla de Totales (reemplaza a flexbox para evitar errores de alineación) */
          .nota-totales-tabla { width: 100%; border-collapse: collapse; margin-top: 4px; }
          .nota-totales-tabla td { padding: 1.5px 0; font-size: 9px; }
          .nota-total-final td { 
            font-weight: 900; 
            font-size: 11px; 
            border-top: 1px dashed #000; 
            padding-top: 3px; 
          }
          
          .nota-tasa { font-size: 8px; text-align: right; margin-top: 3px; font-weight: normal; }
          .nota-firma { margin-top: 15px; font-size: 8.5px; text-align: center; font-weight: normal; }
        </style>
      </head>
      <body>${contenido}</body>
    </html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right  = '0';
  iframe.style.bottom = '0';
  iframe.style.width  = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  let yaDisparado = false;
  let yaTerminado = false;
  const terminar = () => {
    if (yaTerminado) return;
    yaTerminado = true;
    if (typeof alTerminar === 'function') alTerminar();
  };

  const dispararImpresion = () => {
    if (yaDisparado) return;
    yaDisparado = true;
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.warn('No se pudo abrir el diálogo de impresión:', e);
      if (typeof mostrarModalError === 'function') {
        mostrarModalError('No se pudo abrir el diálogo de impresión.', true);
      }
      terminar();
    }
    const limpiar = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      terminar();
    };
    if (iframe.contentWindow) iframe.contentWindow.onafterprint = limpiar;
    setTimeout(limpiar, 6000);
  };

  iframe.onload = dispararImpresion;
  setTimeout(dispararImpresion, 800);

  try {
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
  } catch (e) {
    console.error('No se pudo generar el contenido:', e);
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    if (typeof mostrarModalError === 'function') {
      mostrarModalError('No se pudo generar la nota de entrega.', true);
    }
    terminar();
  }
}

function imprimirNotaEntrega(datos) {
  _ultimaNotaImpresa = datos;
  _imprimirUnaCopiaNota(datos, () => {
    setTimeout(() => {
      const otraCopia = confirm('¿Deseas imprimir otra copia de la nota de entrega?');
      if (otraCopia) {
        _imprimirUnaCopiaNota(datos);
      }
    }, 300);
  });
}

function reimprimirNota() {
  if (!_ultimaNotaImpresa) {
    alert('Todavía no se ha generado ninguna nota de entrega para reimprimir.');
    return;
  }
  imprimirNotaEntrega(_ultimaNotaImpresa);
}

// ---------------------------------------------------------------------------
// Filtro de búsqueda
// ---------------------------------------------------------------------------
function filtrarFacturas() {
  const q = document.getElementById('inputBusqueda').value.toLowerCase().trim();
  if (!q) { renderizarLista(_facturasPendientes); return; }

  const filtradas = _facturasPendientes.filter(f =>
    (f.id_factura || '').toLowerCase().includes(q) ||
    (f.cedula     || '').toLowerCase().includes(q) ||
    (f.nombre     || '').toLowerCase().includes(q) ||
    (f.apellido   || '').toLowerCase().includes(q)
  );

  const lista = document.getElementById('listaPendientes');
  if (!filtradas.length) {
    lista.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-magnifying-glass"></i>
        <p>Sin resultados para<br>"${escapeHtml(q)}"</p>
      </div>`;
    return;
  }

  lista.innerHTML = filtradas.map(f => {
    const idx = _facturasPendientes.indexOf(f);
    return `
      <div class="factura-card" data-index="${idx}" onclick="seleccionarFactura(${idx})">
        <div class="factura-card-info">
          <p class="factura-card-id">ID: ${escapeHtml(f.id_factura)}</p>
          <p class="factura-card-meta">
            ${escapeHtml(f.nombre || '')} ${escapeHtml(f.apellido || '')}
            ${f.cedula ? '· ' + escapeHtml(f.cedula) : ''}
          </p>
        </div>
        <span class="factura-card-total">$${Number(f.total_usd || 0).toFixed(2)}</span>
      </div>`;
  }).join('');

  if (_facturaActual) {
    const idxActual = _facturasPendientes.indexOf(_facturaActual);
    document.querySelectorAll('.factura-card').forEach(el =>
      el.classList.toggle('activa', parseInt(el.dataset.index) === idxActual)
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers UI
// ---------------------------------------------------------------------------
function continuarDespuesDeAprobar() {
  cerrarModal();
  limpiarDetalle();
  window.location.reload();
}

function limpiarDetalle() {
  _facturaActual = null;
  document.getElementById('detailEmpty').classList.remove('hidden');
  document.getElementById('detailContent').classList.add('hidden');
  document.querySelectorAll('.factura-card').forEach(el => el.classList.remove('activa'));
}

function _actualizarTotalesUI(subTotalUSD = 0, descuentoUSD = 0, totalUSD = 0, totalBS = 0) {
  // Conversión segura a número
  const subUSD = Number(subTotalUSD) || 0;
  const descUSD = Number(descuentoUSD) || 0;
  const totUSD = Number(totalUSD) || 0;
  const totBS = Number(totalBS) || 0;

  // Selección de elementos del DOM (IDs reales usados en verificacion.html)
  const elSubtotal  = document.getElementById("totSubtotalUsd");
  const elDescuento = document.getElementById("totDescuento");
  const elTotalUSD  = document.getElementById("totTotalUsd");
  const elTotalBS   = document.getElementById("totTotalBs");

  // Formateo y renderizado
  if (elSubtotal)  elSubtotal.textContent  = typeof fmtUSD === "function" ? fmtUSD(subUSD)  : `$${subUSD.toFixed(2)}`;
  if (elDescuento) elDescuento.textContent = (typeof fmtUSD === "function" ? `-${fmtUSD(descUSD)}` : `-$${descUSD.toFixed(2)}`);
  if (elTotalUSD)  elTotalUSD.textContent  = typeof fmtUSD === "function" ? fmtUSD(totUSD)  : `$${totUSD.toFixed(2)}`;
  if (elTotalBS)   elTotalBS.textContent   = typeof fmtBS === "function"  ? `Bs ${fmtBS(totBS)}` : `Bs ${totBS.toFixed(2)}`;
}

function _limpiarFormAgregar() {
  ['verCantProduct', 'verNameProduct', 'verPrcUndProduct', 'verPrcTotalProduct']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
}

function setListaEstado(estado, mensaje = '') {
  const lista = document.getElementById('listaPendientes');
  if (estado === 'loading') {
    lista.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-circle-notch fa-spin"></i>
        <p>Cargando…</p>
      </div>`;
  } else if (estado === 'error') {
    lista.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-triangle-exclamation"></i>
        <p>${escapeHtml(mensaje)}</p>
      </div>`;
  }
}

function formatMetodoPago(codigo) {
  const map = { PM: 'Pago Móvil', PVD: 'Pago V/D', PVC: 'Pago V/C',
                ED: 'Efectivo $', EBS: 'Efectivo Bs', TRANSF: 'Transferencia Bancaria',
                COMB: 'Pago Combinado', OTROS: 'Otro' };
  return map[codigo] || codigo || 'N/A';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function _parseJSON(res) {
  const texto = await res.text();
  try { return JSON.parse(texto); }
  catch {
    console.error('Respuesta no válida del servidor:', texto);
    mostrarModalError('El servidor no devolvió una respuesta válida.');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Modales
// ---------------------------------------------------------------------------
function mostrarCargando(mostrar) {
  const modal   = document.getElementById('statusModal');
  const loading = document.getElementById('modalLoading');
  const success = document.getElementById('modalSuccess');
  const error   = document.getElementById('modalError');

  if (mostrar) {
    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    success.classList.add('hidden');
    error.classList.add('hidden');
  } else {
    modal.classList.add('hidden');
  }
}

function mostrarModalExito(mensaje) {
  document.getElementById('statusModal').classList.remove('hidden');
  document.getElementById('modalLoading').classList.add('hidden');
  document.getElementById('modalSuccess').classList.remove('hidden');
  document.getElementById('modalError').classList.add('hidden');
  document.getElementById('modalSuccessMessage').textContent = mensaje;
}

function mostrarModalError(mensaje, conReintentoImpresion = false) {
  document.getElementById('statusModal').classList.remove('hidden');
  document.getElementById('modalLoading').classList.add('hidden');
  document.getElementById('modalSuccess').classList.add('hidden');
  document.getElementById('modalError').classList.remove('hidden');
  document.getElementById('modalErrorMessage').textContent = mensaje;

  const accionesImpresion = document.getElementById('modalErrorPrintActions');
  if (accionesImpresion) accionesImpresion.classList.toggle('hidden', !conReintentoImpresion);
}

function cerrarModal()      { document.getElementById('statusModal').classList.add('hidden'); }
function cerrarModalError() { cerrarModal(); }

// ---------------------------------------------------------------------------
// Exposición global
// ---------------------------------------------------------------------------
window.seleccionarFactura    = seleccionarFactura;
window.verAgregarProducto    = verAgregarProducto;
window.verSelectMetodoPago   = verSelectMetodoPago;
window.aprobarFacturaActual  = aprobarFacturaActual;
window.cerrarModalError      = cerrarModalError;
window.imprimirNotaEntrega   = imprimirNotaEntrega;
window.reimprimirNota        = reimprimirNota;
window.continuarDespuesDeAprobar = continuarDespuesDeAprobar;

