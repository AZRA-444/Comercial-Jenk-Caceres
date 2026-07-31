// ---------------------------------------------------------------------------
// Estado del módulo
// ---------------------------------------------------------------------------
let _facturasPendientes = [];
let _facturaActual      = null;

// --- Estado de la subida de comprobante vía QR (celular) ---
let _qrToken            = null;  // token único de la sesión de subida actual
let _qrComprobantePath  = null;  // ruta dentro del bucket una vez detectado el archivo
let _qrPollInterval     = null;  // referencia al setInterval de consulta en tiempo real
let _qrPollIntentos     = 0;
const QR_POLL_MS        = 3000;
const QR_POLL_MAX_INTENTOS = 200; // ~10 minutos antes de detenerse solo

// Estado editable de la factura seleccionada (se reconstruye al seleccionar)
const verState = {
  productos:    [],   // copia editable de detalles_factura_temporal
  tasaCambio:   1,
  subtotalUSD:  0,
  descuentoUSD: 0,
  totalUSD:     0,
  totalBS:      0,
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

  // Cambiar de factura invalida cualquier sesión de QR de la factura anterior.
  _detenerPollingQR();

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
  _actualizarEstadoBotonAprobar();
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
  if      (subDescUSD > 150) porcentaje = 20;
  else if (subDescUSD >  50) porcentaje = 15;
  else if (subDescUSD >  10) porcentaje = 10;

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
  }
}

// ---------------------------------------------------------------------------
// 6. Módulo de pago — render dinámico según método
// ---------------------------------------------------------------------------
function verSelectMetodoPago(valor) {
  const container = document.getElementById('verPaymentDetails');
  if (!container) return;

  // Cambiar de método cancela cualquier sesión de subida por QR en curso.
  _detenerPollingQR();

  container.innerHTML = '';

  const totalUSD = verState.totalUSD;
  const totalBS  = verState.totalBS;

  const montoHeader = `
    <div style="grid-column: 1 / -1; background: var(--accent-soft); border: 1px solid rgba(56,189,248,.25);
                border-radius: 10px; padding: 14px 16px; margin-bottom: 4px;">
      <p style="color: var(--text-secondary); font-size: .78rem; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px;">
        Monto a ${valor === 'PM' || valor === 'PVD' || valor === 'PVC' ? 'transferir' : 'pagar'}:
      </p>
      <p class="ver-monto-display" style="color: var(--accent); font-size: 1.4rem; font-weight: 700; margin:0;">
        $${totalUSD.toFixed(2)} <span style="color:var(--text-secondary); font-size:.9rem;">/ Bs ${totalBS.toFixed(2)}</span>
      </p>
    </div>`;

  if (valor === 'PM') {
    container.innerHTML = `
      ${montoHeader}
      <label class="form-field">Banco Destino
        <select id="verBankSelect">
          <option value="" disabled selected>Seleccione un banco</option>
          <option value="Banesco">Banesco</option>
          <option value="Venezuela">Banco de Venezuela</option>
          <option value="Provincial">Provincial</option>
          <option value="Banplus">Banplus</option>
        </select>
      </label>
      <label class="form-field">Número de Referencia
        <input type="number" id="verPmRef" placeholder="Últimos 4 dígitos" />
      </label>
      <div class="form-field capture-container" style="grid-column: 1 / -1;">
        <span class="capture-label">Comprobante de Pago</span>
        <input type="file" id="verReceiptCapture" accept="image/*" capture="environment"
               style="display:none;" onchange="verPreviewReceipt(this)" />
        <button type="button" class="btn-secondary btn-capture"
                onclick="document.getElementById('verReceiptCapture').click()">
          <i class="fas fa-camera"></i> Adjuntar o Tomar Foto
        </button>
        <div id="verReceiptPreview" class="receipt-preview-box" style="display:none;"></div>
      </div>

      <!-- Subida del comprobante escaneando un QR con el celular -->
      <div class="form-field qr-upload-container" style="grid-column: 1 / -1;">
        <span class="capture-label">O escanea este código con tu celular para tomar la foto</span>
        <div class="qr-upload-box">
          <div id="verQrContainer" class="qr-code-container"></div>
          <div class="qr-status" id="verQrStatus">
            <i class="fas fa-circle-notch fa-spin"></i>
            <span>Generando código QR…</span>
          </div>
        </div>
      </div>`;

    // Se genera después de insertar el HTML para que el contenedor #verQrContainer ya exista.
    setTimeout(() => verGenerarQR(), 0);

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

  } else if (valor === 'OTROS') {
    container.innerHTML = `
      ${montoHeader}
      <label class="form-field" style="grid-column: 1 / -1;">Observaciones
        <textarea id="verObsOTROS" rows="3" placeholder="Detalla alguna novedad..."></textarea>
      </label>
      <div class="form-field capture-container" style="grid-column: 1 / -1;">
        <span class="capture-label">Comprobante de Pago</span>
        <input type="file" id="verReceiptCapture" accept="image/*" capture="environment"
               style="display:none;" onchange="verPreviewReceipt(this)" />
        <button type="button" class="btn-secondary btn-capture"
                onclick="document.getElementById('verReceiptCapture').click()">
          <i class="fas fa-camera"></i> Adjuntar o Tomar Foto
        </button>
        <div id="verReceiptPreview" class="receipt-preview-box" style="display:none;"></div>
      </div>

      <!-- Subida del comprobante escaneando un QR con el celular -->
      <div class="form-field qr-upload-container" style="grid-column: 1 / -1;">
        <span class="capture-label">O escanea este código con tu celular para tomar la foto</span>
        <div class="qr-upload-box">
          <div id="verQrContainer" class="qr-code-container"></div>
          <div class="qr-status" id="verQrStatus">
            <i class="fas fa-circle-notch fa-spin"></i>
            <span>Generando código QR…</span>
          </div>
        </div>
      </div>`;

    // Se genera después de insertar el HTML para que el contenedor #verQrContainer ya exista.
    setTimeout(() => verGenerarQR(), 0);
  }

  _actualizarEstadoBotonAprobar();
}

/** Actualiza solo el monto mostrado dentro del bloque de pago ya renderizado */
function _actualizarMontoPago(metodo, totalUSD, totalBS) {
  const el = document.querySelector('.ver-monto-display');
  if (!el) return;
  el.innerHTML = `$${totalUSD.toFixed(2)} <span style="color:var(--text-secondary); font-size:.9rem;">/ Bs ${totalBS.toFixed(2)}</span>`;
}

/** Preview del comprobante seleccionado */
function verPreviewReceipt(input) {
  const box = document.getElementById('verReceiptPreview');
  if (!box) return;
  if (input.files?.[0]) {
    const reader = new FileReader();
    reader.onload = e => {
      box.style.display = 'block';
      box.style.backgroundImage = `url('${e.target.result}')`;
    };
    reader.readAsDataURL(input.files[0]);
  } else {
    box.style.display = 'none';
    box.style.backgroundImage = 'none';
  }
  _actualizarEstadoBotonAprobar();
}

// ---------------------------------------------------------------------------
// 6b. Subida del comprobante vía QR (el celular sube directo al bucket)
// ---------------------------------------------------------------------------

/** Cliente de Supabase (rol anon) reutilizado para leer el bucket de comprobantes. */
let _supabaseClienteQR = null;
function _getSupabaseClienteQR() {
  if (_supabaseClienteQR) return _supabaseClienteQR;
  if (!window.supabase?.createClient || typeof SUPABASE_URL === 'undefined') return null;
  _supabaseClienteQR = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabaseClienteQR;
}

/** Genera un token de sesión, pinta el QR y arranca el sondeo en tiempo real. */
function verGenerarQR() {
  const qrBox = document.getElementById('verQrContainer');
  if (!qrBox || !_facturaActual) return;

  _detenerPollingQR();

  _qrToken = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  _qrComprobantePath = null;

  const idFactura = _facturaActual.id_factura;
  const url = `${window.location.origin}/assets/pages/subir-comprobante.html?id=${encodeURIComponent(idFactura)}&token=${encodeURIComponent(_qrToken)}`;

  qrBox.innerHTML = '';
  if (window.QRCode) {
    // eslint-disable-next-line no-new
    new QRCode(qrBox, { text: url, width: 150, height: 150 });
  } else {
    qrBox.textContent = 'No se pudo cargar el generador de QR.';
  }

  _setEstadoQR('esperando', 'Esperando que se tome la foto desde el celular…');

  _qrPollIntentos = 0;
  _qrPollInterval = setInterval(_verComprobarSubidaQR, QR_POLL_MS);
  // Primera consulta inmediata, sin esperar el primer intervalo.
  _verComprobarSubidaQR();
}

/** Consulta el bucket buscando el archivo que suba el celular para esta sesión. */
async function _verComprobarSubidaQR() {
  if (!_qrToken || !_facturaActual) return;

  const client = _getSupabaseClienteQR();
  if (!client) {
    _setEstadoQR('error', 'No se pudo conectar con el almacenamiento para verificar la subida.');
    return;
  }

  _qrPollIntentos++;
  if (_qrPollIntentos > QR_POLL_MAX_INTENTOS) {
    _setEstadoQR('error', 'Se agotó el tiempo de espera. Genera un nuevo código QR.');
    _detenerPollingQR();
    return;
  }

  const idFactura = _facturaActual.id_factura;
  const prefijoBusqueda = `${idFactura}-${_qrToken}`;

  try {
    const { data, error } = await client.storage.from('comprobantes').list('qr', { search: prefijoBusqueda });
    if (error) {
      console.warn('Error consultando el bucket de comprobantes:', error.message);
      return; // se reintenta en el siguiente ciclo
    }
    const archivo = (data || []).find(f => f.name.startsWith(prefijoBusqueda));
    if (archivo) {
      _qrComprobantePath = `qr/${archivo.name}`;
      _setEstadoQR('listo', 'Comprobante recibido desde el celular');
      _detenerPollingQR(true /* mantener el path detectado */);
      _actualizarEstadoBotonAprobar();
    }
  } catch (err) {
    console.warn('Error de red consultando el bucket de comprobantes:', err.message);
  }
}

function _setEstadoQR(estado, mensaje) {
  const el = document.getElementById('verQrStatus');
  if (!el) return;
  const iconos = {
    esperando: '<i class="fas fa-circle-notch fa-spin"></i>',
    listo:     '<i class="fas fa-circle-check" style="color: var(--success);"></i>',
    error:     '<i class="fas fa-triangle-exclamation" style="color: var(--danger);"></i>',
  };
  el.className = `qr-status qr-status-${estado}`;
  el.innerHTML = `${iconos[estado] || ''} <span>${escapeHtml(mensaje)}</span>`;
}

/** Detiene el sondeo periódico. Si conservarPath es false, también olvida el comprobante detectado. */
function _detenerPollingQR(conservarPath = false) {
  if (_qrPollInterval) {
    clearInterval(_qrPollInterval);
    _qrPollInterval = null;
  }
  _qrPollIntentos = 0;
  if (!conservarPath) {
    _qrToken = null;
    _qrComprobantePath = null;
  }
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
    const comp  = document.getElementById('verReceiptCapture');

    if (!banco) {
      alert('Para Pago Móvil, selecciona un Banco Destino.');
      return false;
    }
    if (!ref || ref.length < 4) {
      alert('Para Pago Móvil, ingresa el Número de Referencia (mínimo 4 dígitos).');
      return false;
    }
    if (!comp?.files?.length && !_qrComprobantePath) {
      alert('Para Pago Móvil, adjunta el comprobante de pago o espera a que se reciba desde el celular vía QR.');
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

  if (metodo === 'OTROS') {
    const obs  = document.getElementById('verObsOTROS')?.value.trim();
    const comp = document.getElementById('verReceiptCapture');
    if (!obs) {
      alert('Para el método OTROS, detalla las observaciones.');
      return false;
    }
    if (!comp?.files?.length && !_qrComprobantePath) {
      alert('Para el método OTROS, adjunta el comprobante de pago o espera a que se reciba desde el celular vía QR.');
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// 8. Comprimir imagen comprobante
// ---------------------------------------------------------------------------
function _comprimirImagen(file, maxAncho = 1600, calidad = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('El archivo no es una imagen'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxAncho) {
        height = Math.round((height * maxAncho) / width);
        width  = maxAncho;
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No se pudo preparar el canvas')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('No se pudo comprimir la imagen')); return; }
        resolve(new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
      }, 'image/jpeg', calidad);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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

  // Procesar comprobante si existe
  let comprobanteBase64 = null;
  let comprobanteNombre = null;
  let comprobanteTipo   = null;
  let comprobantePathRemoto = null;

  const comprobanteInput = document.getElementById('verReceiptCapture');
  if (comprobanteInput?.files?.[0]) {
    let file = comprobanteInput.files[0];
    try { file = await _comprimirImagen(file); }
    catch (err) { console.warn('Compresión fallida, usando original:', err); }

    if (file.size > 5 * 1024 * 1024) {
      mostrarModalError('La imagen del comprobante no debe superar los 5 MB.');
      btn.disabled = false;
      return;
    }
    try {
      comprobanteBase64 = await _fileToBase64(file);
      comprobanteNombre = file.name;
      comprobanteTipo   = file.type;
    } catch (err) {
      mostrarModalError('No se pudo procesar la imagen del comprobante.');
      btn.disabled = false;
      return;
    }
  } else if (_qrComprobantePath) {
    // El comprobante ya fue subido directamente al bucket desde el celular
    // (vía QR); no hace falta volver a subirlo, solo indicarle su ruta al backend.
    comprobantePathRemoto = _qrComprobantePath;
  }

  const metodo = document.getElementById('verMetodoPago')?.value || 'OTROS';
  const obs =
    document.getElementById('verObsOTROS')?.value.trim() ||
    document.getElementById('verObsED')?.value.trim()    || '';

  const payload = {
    id_factura: _facturaActual.id_factura,
    estado:     'aprobado',

    // Datos de pago actualizados
    metodo_pago:  metodo,
    banco:        document.getElementById('verBankSelect')?.value || 'N/A',
    referencia:   document.getElementById('verPmRef')?.value      || 'N/A',
    observaciones: obs || 'N/A',

    comprobante_base64: comprobanteBase64,
    comprobante_nombre: comprobanteNombre,
    comprobante_tipo:   comprobanteTipo,
    comprobante_path_remoto: comprobantePathRemoto,

    // Totales recalculados
    subtotal_usd:  verState.subtotalUSD,
    descuento_usd: verState.descuentoUSD,
    total_usd:     verState.totalUSD,
    total_bs:      verState.totalBS,

    // Productos editados
    productos: verState.productos.map(p => ({
      nombre:        p.nombre,
      cantidad:      p.cantidad,
      precioUnitario: p.precioUnitario,
      precioTotal:   p.precioTotal,
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
      _detenerPollingQR();
      mostrarModalExito('Factura aprobada correctamente. Si el papel se traba o se termina, usa los botones de abajo para reimprimir.');

      // Guardamos los datos para poder reimprimir en cualquier momento
      // (papel trabado, impresora sin conexión, corte de luz, etc.) sin
      // tener que reconstruir la factura desde cero.
      const datosNota = {
        id_factura:   _facturaActual.id_factura,
        nombre:       _facturaActual.nombre,
        apellido:     _facturaActual.apellido,
        cedula:       _facturaActual.cedula,
        telefono:     _facturaActual.telefono,
        vendedor:     _facturaActual.vendedor,
        metodoPagoTexto: formatMetodoPago(metodo),
        banco:        payload.banco,
        referencia:   payload.referencia,
        productos:    verState.productos,
        subtotalUSD:  verState.subtotalUSD,
        descuentoUSD: verState.descuentoUSD,
        totalUSD:     verState.totalUSD,
        totalBS:      verState.totalBS,
        tasaCambio:   Number(verState.tasaCambio) || 1,
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

      // Ya NO se recarga automáticamente. El usuario decide cuándo
      // continuar (botón "Continuar" del modal), para tener todo el
      // tiempo que necesite si tiene que reimprimir por un fallo de papel,
      // atasco o desconexión de la impresora.
    } else {
      mostrarModalError(json.message || 'No se pudo aprobar la factura.');
      btn.disabled = false;
    }
  } catch (err) {
    mostrarModalError('Error de conexión: ' + err.message);
    btn.disabled = false;
  }
}

/** Se ejecuta cuando el usuario ya terminó de imprimir/reimprimir y confirma. */
function continuarDespuesDeAprobar() {
  cerrarModal();
  limpiarDetalle();
  window.location.reload();
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
        <p><strong>Método de pago:</strong> ${escapeHtml(datos.metodoPagoTexto || 'N/A')}</p>
        ${datos.banco && datos.banco !== 'N/A' ? `<p><strong>Banco:</strong> ${escapeHtml(datos.banco)}</p>` : ''}
        ${datos.referencia && datos.referencia !== 'N/A' ? `<p><strong>Referencia:</strong> ${escapeHtml(datos.referencia)}</p>` : ''}
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
      <p class="nota-firma">______________________<br>Firma de conformidad</p>
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
            margin: 0 auto;
            padding: 2mm 0;
            
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
function limpiarDetalle() {
  _facturaActual = null;
  _detenerPollingQR();
  document.getElementById('detailEmpty').classList.remove('hidden');
  document.getElementById('detailContent').classList.add('hidden');
  document.querySelectorAll('.factura-card').forEach(el => el.classList.remove('activa'));
}

/** Habilita/deshabilita el botón "Aprobar pago" según si falta el comprobante
 *  para los métodos que lo requieren (PM y OTROS). Para el resto de métodos,
 *  el botón queda habilitado y la validación completa ocurre al hacer clic. */
function _actualizarEstadoBotonAprobar() {
  const btn = document.getElementById('btnAprobar');
  if (!btn) return;

  const metodo = document.getElementById('verMetodoPago')?.value;
  const requiereComprobante = metodo === 'PM' || metodo === 'OTROS';

  if (!requiereComprobante) {
    btn.disabled = false;
    return;
  }

  const tieneArchivoLocal = !!document.getElementById('verReceiptCapture')?.files?.length;
  const tieneComprobante  = tieneArchivoLocal || !!_qrComprobantePath;

  btn.disabled = !tieneComprobante;
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
                ED: 'Efectivo $', EBS: 'Efectivo Bs', OTROS: 'Otro' };
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
window.verPreviewReceipt     = verPreviewReceipt;
window.verGenerarQR          = verGenerarQR;
window.aprobarFacturaActual  = aprobarFacturaActual;
window.cerrarModalError      = cerrarModalError;
window.imprimirNotaEntrega   = imprimirNotaEntrega;
window.reimprimirNota        = reimprimirNota;
window.continuarDespuesDeAprobar = continuarDespuesDeAprobar;
