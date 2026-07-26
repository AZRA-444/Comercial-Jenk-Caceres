/**
 * verificacion.js
 * Lógica del módulo de verificación de pagos.
 * 
 * Flujo:
 *  1. Al cargar → cargarFacturasPendientes()
 *  2. El usuario hace click en una tarjeta → seleccionarFactura(index)
 *  3. El usuario escribe en el buscador → filtrarFacturas()
 *  4. Botón "Aprobar" → aprobarFacturaActual()
 */

// ---------------------------------------------------------------------------
// Estado del módulo
// ---------------------------------------------------------------------------
let _facturasPendientes = [];  // Todas las facturas cargadas
let _facturaActual = null;     // Factura actualmente seleccionada

// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  cargarFacturasPendientes();

  document.getElementById('inputBusqueda').addEventListener('input', filtrarFacturas);

  document.getElementById('btnRefrescar').addEventListener('click', () => {
    cargarFacturasPendientes();
  });
});

// ---------------------------------------------------------------------------
// 1. Carga de facturas pendientes
// ---------------------------------------------------------------------------
async function cargarFacturasPendientes() {
  setListaEstado('loading');

  try {
    const res = await fetch('/api/gestion-temporales', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const json = await _parseJSON(res);
    if (!json) return;

    if (json.status === 'success') {
      _facturasPendientes = json.data || [];
      renderizarLista(_facturasPendientes);
      document.getElementById('badgeCount').textContent = _facturasPendientes.length;

      // Auto-selecciona la primera si hay resultados
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
// 3. Seleccionar una factura y mostrar su detalle
// ---------------------------------------------------------------------------
function seleccionarFactura(index) {
  const factura = _facturasPendientes[index];
  if (!factura) return;
  _facturaActual = factura;

  // Marcar tarjeta activa
  document.querySelectorAll('.factura-card').forEach(el => {
    el.classList.toggle('activa', parseInt(el.dataset.index) === index);
  });

  // Rellenar encabezado
  document.getElementById('detailId').textContent = 'ID: ' + factura.id_factura;
  document.getElementById('detailCliente').textContent =
    `${factura.nombre || ''} ${factura.apellido || ''}`.trim() || 'Cliente';

  // Rellenar info del cliente
  document.getElementById('detailCedula').textContent   = factura.cedula    || 'N/A';
  document.getElementById('detailTelefono').textContent = factura.telefono  || 'N/A';
  document.getElementById('detailVendedor').textContent = factura.vendedor  || 'N/A';
  document.getElementById('detailMetodoPago').textContent = formatMetodoPago(factura.metodo_pago);

  // Tabla de productos
  const tbody = document.getElementById('tablaVerificacionProductos');
  const detalles = factura.detalles_factura_temporal || [];
  const tasaCambio = factura.tasa_cambio || 1;

  if (detalles.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">Sin productos registrados.</td></tr>`;
  } else {
    tbody.innerHTML = detalles.map(p => `
      <tr>
        <td>${p.cantidad}</td>
        <td>${escapeHtml(p.nombre_producto)}</td>
        <td class="text-right">$${Number(p.precio_unitario).toFixed(2)}</td>
        <td class="text-right">$${Number(p.precio_total).toFixed(2)}</td>
        <td class="text-right">Bs ${(Number(p.precio_total) * tasaCambio).toFixed(2)}</td>
      </tr>
    `).join('');
  }

  // Totales
  document.getElementById('totSubtotalUsd').textContent = `$${Number(factura.subtotal_usd || 0).toFixed(2)}`;
  document.getElementById('totTotalUsd').textContent    = `$${Number(factura.total_usd    || 0).toFixed(2)}`;
  document.getElementById('totTotalBs').textContent     = `Bs ${Number(factura.total_bs  || 0).toFixed(2)}`;

  // Mostrar panel de detalle
  document.getElementById('detailEmpty').classList.add('hidden');
  document.getElementById('detailContent').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// 4. Filtro de búsqueda en tiempo real
// ---------------------------------------------------------------------------
function filtrarFacturas() {
  const q = document.getElementById('inputBusqueda').value.toLowerCase().trim();

  if (!q) {
    renderizarLista(_facturasPendientes);
    return;
  }

  const filtradas = _facturasPendientes.filter(f =>
    (f.id_factura  || '').toLowerCase().includes(q) ||
    (f.cedula      || '').toLowerCase().includes(q) ||
    (f.nombre      || '').toLowerCase().includes(q) ||
    (f.apellido    || '').toLowerCase().includes(q)
  );

  // Mantenemos los índices originales para que onclick funcione bien
  const lista = document.getElementById('listaPendientes');
  if (filtradas.length === 0) {
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

  // Re-marcar activa si aplica
  if (_facturaActual) {
    const idxActual = _facturasPendientes.indexOf(_facturaActual);
    document.querySelectorAll('.factura-card').forEach(el => {
      el.classList.toggle('activa', parseInt(el.dataset.index) === idxActual);
    });
  }
}

// ---------------------------------------------------------------------------
// 5. Aprobar la factura actualmente seleccionada
// ---------------------------------------------------------------------------
async function aprobarFacturaActual() {
  if (!_facturaActual) return;
  const id = _facturaActual.id_factura;

  document.getElementById('btnAprobar').disabled = true;
  mostrarCargando(true);

  try {
    const res = await fetch('/api/gestion-temporales', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_factura: id, estado: 'aprobado' }),
    });

    const json = await _parseJSON(res);
    if (!json) {
      document.getElementById('btnAprobar').disabled = false;
      return;
    }

    if (json.status === 'success') {
      mostrarModalExito('Factura aprobada correctamente.');
      // Recargar la lista tras 1.6s
      setTimeout(() => {
        cerrarModal();
        limpiarDetalle();
        cargarFacturasPendientes();
      }, 1600);
      setTimeout(() => {
      window.location.reload();
      }, 1800);
    } else {
      mostrarModalError(json.message || 'No se pudo aprobar la factura.');
      document.getElementById('btnAprobar').disabled = false;
    }
  } catch (err) {
    mostrarModalError('Error de conexión: ' + err.message);
    document.getElementById('btnAprobar').disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Helpers de UI
// ---------------------------------------------------------------------------
function limpiarDetalle() {
  _facturaActual = null;
  document.getElementById('detailEmpty').classList.remove('hidden');
  document.getElementById('detailContent').classList.add('hidden');
  document.querySelectorAll('.factura-card').forEach(el => el.classList.remove('activa'));
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
  const map = {
    PM:    'Pago Móvil',
    PVD:   'Pago V/D',
    PVC:   'Pago V/C',
    ED:    'Efectivo $',
    EBS:   'Efectivo Bs',
    OTROS: 'Otro',
  };
  return map[codigo] || codigo || 'N/A';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Parsea JSON de una respuesta fetch; muestra error en modal si falla. */
async function _parseJSON(res) {
  const texto = await res.text();
  try {
    return JSON.parse(texto);
  } catch {
    console.error('Respuesta no válida del servidor:', texto);
    mostrarModalError('El servidor no devolvió una respuesta válida.');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers de modales
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
  const modal = document.getElementById('statusModal');
  document.getElementById('modalLoading').classList.add('hidden');
  document.getElementById('modalSuccess').classList.remove('hidden');
  document.getElementById('modalError').classList.add('hidden');
  document.getElementById('modalSuccessMessage').textContent = mensaje;
  modal.classList.remove('hidden');
}

function mostrarModalError(mensaje) {
  const modal = document.getElementById('statusModal');
  document.getElementById('modalLoading').classList.add('hidden');
  document.getElementById('modalSuccess').classList.add('hidden');
  document.getElementById('modalError').classList.remove('hidden');
  document.getElementById('modalErrorMessage').textContent = mensaje;
  modal.classList.remove('hidden');
}

function cerrarModal() {
  document.getElementById('statusModal').classList.add('hidden');
}

function cerrarModalError() {
  cerrarModal();
}

// ---------------------------------------------------------------------------
// Exposición global (necesaria para los onclick inline que permanecen)
// ---------------------------------------------------------------------------
window.seleccionarFactura      = seleccionarFactura;
window.aprobarFacturaActual    = aprobarFacturaActual;
window.cerrarModalError        = cerrarModalError;
