// ---------------------------------------------------------------------------
// Filtrado y formateo de datos en vivo (mientras el usuario escribe)
// ---------------------------------------------------------------------------

function formatText(input) {
  let valor = input.value.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ ]/g, "");
  input.value = valor
    .split(" ")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

function formatDoc(input) {
  let valor = input.value.replace(/\D/g, "");
  if (!valor) {
    input.value = "";
    return;
  }
  input.value = new Intl.NumberFormat("es-VE").format(parseInt(valor, 10));
}

function formatPhone(input) {
  let telefono = input.value.replace(/\D/g, "");
  if (telefono.length > 4 && telefono.length <= 7) {
    telefono = telefono.slice(0, 4) + "-" + telefono.slice(4);
  } else if (telefono.length > 7) {
    telefono =
      telefono.slice(0, 4) +
      "-" +
      telefono.slice(4, 7) +
      "-" +
      telefono.slice(7, 11);
  }
  input.value = telefono;
}

// ---------------------------------------------------------------------------
// Estado del módulo
// ---------------------------------------------------------------------------

let _pedidos       = [];
let _pedidoActual  = null;  // referencia directa al objeto en _pedidos
let _contadorPedidos = 0;

// ---------------------------------------------------------------------------
// Configuración: backend de facturación y almacenamiento local
// ---------------------------------------------------------------------------

const BACKEND_API_URL = "/api/precargar-factura";

const PEDIDOS_PENDIENTES_LS_KEY = "pedidosFacturasPendientes";

const PEDIDOS_BORRADOR_LS_KEY = "pedidosBorradorActivos";

// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Calcular precio total automáticamente
  const cantInput = document.getElementById('pedCantProduct');
  const prcInput  = document.getElementById('pedPrcUndProduct');
  const totInput  = document.getElementById('pedPrcTotalProduct');

  const calcTotal = () => {
    const cant = Number(cantInput.value) || 0;
    const prc  = Number(prcInput.value)  || 0;
    totInput.value = cant > 0 && prc > 0 ? (cant * prc).toFixed(2) : '';
  };

  cantInput.addEventListener('input', calcTotal);
  prcInput.addEventListener('input', calcTotal);

  // Delegación de eventos en tabla
  document.getElementById('tablaPedidoProductos')
    .addEventListener('click', _manejarClickTabla);

  // Botón nuevo pedido
  document.getElementById('btnNuevoPedido')
    .addEventListener('click', pedNuevoPedido);

  // --- Formateo en vivo + sincronización + autoguardado de los campos del cliente ---
  const inputNombre   = document.getElementById('pedNombre');
  const inputApellido = document.getElementById('pedApellido');
  const inputCedula   = document.getElementById('pedCedula');
  const inputTelefono = document.getElementById('pedTelefono');
  const inputVendedor = document.getElementById('pedVendedor');

  const onCampoClienteInput = (formateador) => (e) => {
    if (formateador) formateador(e.target);
    pedSyncCliente();
    _guardarBorradorLocalDebounced();
  };

  inputNombre?.addEventListener('input',   onCampoClienteInput(formatText));
  inputApellido?.addEventListener('input', onCampoClienteInput(formatText));
  inputVendedor?.addEventListener('input', onCampoClienteInput(formatText));
  inputCedula?.addEventListener('input',   onCampoClienteInput(formatDoc));
  inputTelefono?.addEventListener('input', onCampoClienteInput(formatPhone));

  document.getElementById('pedTasaInput')
    ?.addEventListener('input', () => _guardarBorradorLocalDebounced());

  // --- Restaurar pedidos en curso guardados por autoguardado, si existen ---
  const restaurado = _restaurarBorradorLocal();

  if (!restaurado) {
    // Restaurar vendedor guardado
    const vendedorGuardado = localStorage.getItem('vendedorActual');
    // Crear primer pedido automáticamente
    _crearPedido(vendedorGuardado || '');
  }

  const tasaGuardada = localStorage.getItem('pedidosTasaCambio');
  if (tasaGuardada && (!_pedidoActual?.tasaCambio || _pedidoActual.tasaCambio === 1)) {
    document.getElementById('pedTasaInput').value = tasaGuardada;
  }

  // Consultar la tasa de cambio actual en la API (no bloquea la carga)
  obtenerTasaDolarPedidos(document.getElementById('pedTasaInput'));

  // Mostrar si hay pedidos guardados localmente y reintentar enviarlos
  _actualizarBannerPendientes();
  pedReintentarPendientes();
  window.addEventListener('online', pedReintentarPendientes);

  // --- Advertir antes de recargar/cerrar si hay datos sin enviar ---
  window.addEventListener('beforeunload', (e) => {
    // Aseguramos que quede guardado lo último escrito, aunque el debounce
    // todavía no se haya disparado.
    clearTimeout(_debounceGuardarBorrador);
    _guardarBorradorLocal();

    if (!_hayDatosSinEnviar()) return;
    e.preventDefault();
    e.returnValue = ''; // Requerido por Chrome/Firefox para mostrar el diálogo nativo
    return '';
  });
});

// ---------------------------------------------------------------------------
// 1. Gestión de pedidos
// ---------------------------------------------------------------------------

/** Crea un pedido nuevo y lo selecciona */
function pedNuevoPedido() {
  const vendedor = _pedidoActual?.cliente?.vendedor || localStorage.getItem('vendedorActual') || '';
  const tasa     = Number(document.getElementById('pedTasaInput').value) || _pedidoActual?.tasaCambio || 1;
  _crearPedido(vendedor, tasa);
}

function _crearPedido(vendedorInicial = '', tasaInicial = 1) {
  _contadorPedidos++;
  const pedido = {
    id:         `Pedido #${_contadorPedidos}`,
    idFactura:  null, // se genera al enviar el pedido a facturación (se conserva entre reintentos)
    cliente: {
      nombre:   '',
      apellido: '',
      cedula:   '',
      telefono: '',
      vendedor: vendedorInicial,
    },
    productos:  [],
    tasaCambio: tasaInicial,
    totales: { subtotalUSD: 0, descuentoUSD: 0, totalUSD: 0, totalBS: 0 },
  };

  _pedidos.push(pedido);
  _renderizarListaSidebar();
  _seleccionarPedido(pedido);
  _guardarBorradorLocal();
}

/** Eliminar un pedido de la lista */
function pedEliminarPedido(id, e) {
  e.stopPropagation(); // evitar seleccionar al eliminar

  if (_pedidos.length === 1) {
    // Si es el único, vaciarlo en lugar de eliminarlo
    _pedidoActual.productos  = [];
    _pedidoActual.cliente    = { nombre:'', apellido:'', cedula:'', telefono:'', vendedor: _pedidoActual.cliente.vendedor };
    _pedidoActual.totales    = { subtotalUSD:0, descuentoUSD:0, totalUSD:0, totalBS:0 };
    _cargarPedidoEnFormulario(_pedidoActual);
    _renderizarListaSidebar();
    _guardarBorradorLocal();
    return;
  }

  const idx = _pedidos.findIndex(p => p.id === id);
  if (idx === -1) return;

  _pedidos.splice(idx, 1);

  // Si se eliminó el pedido actual, seleccionar el anterior o el primero
  if (_pedidoActual?.id === id) {
    const siguiente = _pedidos[Math.min(idx, _pedidos.length - 1)];
    _renderizarListaSidebar();
    _seleccionarPedido(siguiente);
  } else {
    _renderizarListaSidebar();
  }
  _guardarBorradorLocal();
}

// ---------------------------------------------------------------------------
// 2. Seleccionar y cargar pedido en el formulario
// ---------------------------------------------------------------------------
function _seleccionarPedido(pedido) {
  // Guardar estado actual antes de cambiar
  if (_pedidoActual && _pedidoActual !== pedido) {
    _guardarEstadoFormulario(_pedidoActual);
  }

  _pedidoActual = pedido;

  // Marcar tarjeta activa
  document.querySelectorAll('.pedido-card').forEach(el =>
    el.classList.toggle('activa', el.dataset.id === pedido.id)
  );

  // Mostrar panel
  document.getElementById('detailEmpty').classList.add('hidden');
  document.getElementById('detailContent').classList.remove('hidden');

  // Cargar datos en formulario
  _cargarPedidoEnFormulario(pedido);
}

function _cargarPedidoEnFormulario(pedido) {
  // Tasa
  const tasaInput = document.getElementById('pedTasaInput');
  if (pedido.tasaCambio && pedido.tasaCambio > 0) {
    tasaInput.value = pedido.tasaCambio;
  }

  // Cliente
  document.getElementById('pedNombre').value    = pedido.cliente.nombre   || '';
  document.getElementById('pedApellido').value  = pedido.cliente.apellido || '';
  document.getElementById('pedCedula').value    = pedido.cliente.cedula   || '';
  document.getElementById('pedTelefono').value  = pedido.cliente.telefono || '';
  document.getElementById('pedVendedor').value  = pedido.cliente.vendedor || '';

  // Limpiar formulario de agregar producto
  _limpiarFormAgregar();

  // Renderizar tabla con los productos del pedido
  _renderizarTabla();
}

/** Guarda los datos del formulario en el pedido actual */
function _guardarEstadoFormulario(pedido) {
  if (!pedido) return;
  pedido.tasaCambio = Number(document.getElementById('pedTasaInput').value) || pedido.tasaCambio || 1;
  pedido.cliente.nombre    = document.getElementById('pedNombre').value.trim();
  pedido.cliente.apellido  = document.getElementById('pedApellido').value.trim();
  pedido.cliente.cedula    = document.getElementById('pedCedula').value.trim();
  pedido.cliente.telefono  = document.getElementById('pedTelefono').value.trim();
  pedido.cliente.vendedor  = document.getElementById('pedVendedor').value.trim();
}

// ---------------------------------------------------------------------------
// 3. Renderizar sidebar
// ---------------------------------------------------------------------------
function _renderizarListaSidebar() {
  const lista = document.getElementById('listaPedidos');
  document.getElementById('badgeCount').textContent = _pedidos.length;

  if (_pedidos.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-cart-plus"></i>
        <p>Aún no hay pedidos.<br>Crea uno con el botón de arriba.</p>
      </div>`;
    return;
  }

  lista.innerHTML = _pedidos.map(p => {
    const nombreCliente = [p.cliente.nombre, p.cliente.apellido].filter(Boolean).join(' ') || 'Sin nombre';
    const total = p.totales.totalUSD || 0;
    return `
      <div class="pedido-card" data-id="${escapeHtml(p.id)}"
           onclick="pedSeleccionarPorId('${escapeHtml(p.id)}')">
        <div class="pedido-card-left">
          <span class="pedido-card-num">${escapeHtml(p.id)}</span>
          <span class="pedido-card-nombre">${escapeHtml(nombreCliente)}</span>
          <span class="pedido-card-meta">${p.productos.length} producto${p.productos.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="pedido-card-right">
          <span class="pedido-card-total">$${total.toFixed(2)}</span>
          <button class="btn-eliminar-pedido" title="Eliminar pedido"
                  onclick="pedEliminarPedido('${escapeHtml(p.id)}', event)">
            <i class="fas fa-xmark"></i>
          </button>
        </div>
      </div>`;
  }).join('');
}

/** Seleccionar pedido desde el sidebar por ID */
function pedSeleccionarPorId(id) {
  const pedido = _pedidos.find(p => p.id === id);
  if (pedido) _seleccionarPedido(pedido);
}

// ---------------------------------------------------------------------------
// 4. Sync de campos del cliente al estado
// ---------------------------------------------------------------------------
function pedSyncCliente() {
  if (!_pedidoActual) return;
  _pedidoActual.cliente.nombre   = document.getElementById('pedNombre').value.trim();
  _pedidoActual.cliente.apellido = document.getElementById('pedApellido').value.trim();
  _pedidoActual.cliente.cedula   = document.getElementById('pedCedula').value.trim();
  _pedidoActual.cliente.telefono = document.getElementById('pedTelefono').value.trim();
  _pedidoActual.cliente.vendedor = document.getElementById('pedVendedor').value.trim();

  // Guardar vendedor en localStorage para persistirlo entre módulos
  if (_pedidoActual.cliente.vendedor) {
    localStorage.setItem('vendedorActual', _pedidoActual.cliente.vendedor);
  }

  // Actualizar nombre en sidebar
  _renderizarListaSidebar();
  // Re-marcar activo
  document.querySelectorAll('.pedido-card').forEach(el =>
    el.classList.toggle('activa', el.dataset.id === _pedidoActual.id)
  );
}

/** Sync de la tasa de cambio */
function pedActualizarTasa(valor) {
  if (!_pedidoActual) return;
  const tasa = Number(valor) || 1;
  _pedidoActual.tasaCambio = tasa;
  localStorage.setItem('pedidosTasaCambio', tasa);
  _renderizarTabla();
  _guardarBorradorLocal();
}

// ---------------------------------------------------------------------------
// 5. CRUD de productos
// ---------------------------------------------------------------------------
function pedAgregarProducto() {
  if (!_pedidoActual) return;

  const cant = Number(document.getElementById('pedCantProduct').value);
  const name = document.getElementById('pedNombreProduct').value.trim();
  const prc  = Number(document.getElementById('pedPrcUndProduct').value);
  const tot  = Number(document.getElementById('pedPrcTotalProduct').value);

  if (!name || cant <= 0 || prc <= 0) {
    alert('Por favor, completa correctamente: cantidad, nombre y precio unitario.');
    return;
  }

  _pedidoActual.productos.push({
    nombre:            name,
    cantidad:          cant,
    precioUnitario:    prc,
    precioTotal:       tot || cant * prc,
    excluidoDescuento: false,
  });

  _limpiarFormAgregar();
  _renderizarTabla();
  _renderizarListaSidebar();
  // Re-marcar activo
  document.querySelectorAll('.pedido-card').forEach(el =>
    el.classList.toggle('activa', el.dataset.id === _pedidoActual.id)
  );
  _guardarBorradorLocal();
}

function _manejarClickTabla(e) {
  const btnEliminar = e.target.closest('.btn-eliminar');
  if (btnEliminar) {
    const idx = parseInt(btnEliminar.dataset.index, 10);
    _pedidoActual.productos.splice(idx, 1);
    _renderizarTabla();
    _renderizarListaSidebar();
    document.querySelectorAll('.pedido-card').forEach(el =>
      el.classList.toggle('activa', el.dataset.id === _pedidoActual.id)
    );
    _guardarBorradorLocal();
    return;
  }

  const btnToggle = e.target.closest('.btn-toggle-desc');
  if (btnToggle) {
    const idx = parseInt(btnToggle.dataset.index, 10);
    const p   = _pedidoActual.productos[idx];
    if (p) {
      p.excluidoDescuento = !p.excluidoDescuento;
      _renderizarTabla();
      _guardarBorradorLocal();
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Cálculo de totales
// ---------------------------------------------------------------------------
function _recalcularTotales() {
  const productos = _pedidoActual?.productos || [];
  const tasa = Number(_pedidoActual?.tasaCambio) || 1;

  const descontables = productos.filter(p => !p.excluidoDescuento);
  const excluidos    = productos.filter(p => !!p.excluidoDescuento);

  const subDescUSD = descontables.reduce((acc, p) => acc + (Number(p.precioTotal) || 0), 0);
  const subExcUSD  = excluidos.reduce((acc, p) => acc + (Number(p.precioTotal) || 0), 0);
  const subTotalUSD = subDescUSD + subExcUSD;

  let porcentaje = 0;
  if      (subDescUSD > 150) porcentaje = 20;
  else if (subDescUSD >  50) porcentaje = 15;
  else if (subDescUSD >  10) porcentaje = 10;

  const descuentoUSD = subDescUSD * (porcentaje / 100);
  const totalUSD     = subDescUSD - descuentoUSD + subExcUSD;
  const totalBS      = totalUSD * tasa;

  // Guardar en el objeto del pedido
  _pedidoActual.totales = { subtotalUSD: subTotalUSD, descuentoUSD, totalUSD, totalBS };

  return { subTotalUSD, descuentoUSD, totalUSD, totalBS, porcentaje };
}

// ---------------------------------------------------------------------------
// 7. Renderizar tabla y actualizar UI
// ---------------------------------------------------------------------------
function _renderizarTabla() {
  if (!_pedidoActual) return;

  const tbody = document.getElementById('tablaPedidoProductos');
  const tasa  = _pedidoActual.tasaCambio || 1;
  const productos = _pedidoActual.productos;

  if (!productos || productos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Agrega productos para comenzar.</td></tr>`;
    _actualizarTotalesUI(0, 0, 0, 0);
    return;
  }

  tbody.innerHTML = productos.map((p, i) => {
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
            title="${excluido ? 'Volver a incluir en el descuento' : 'Excluir del descuento'}"
          >
            <i class="fa-solid ${excluido ? 'fa-rotate-left' : 'fa-tag'}"></i>
          </button>
          <button class="btn-eliminar" data-index="${i}" title="Eliminar producto">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>`;
  }).join('');

  const { subTotalUSD, descuentoUSD, totalUSD, totalBS } = _recalcularTotales();
  _actualizarTotalesUI(subTotalUSD, descuentoUSD, totalUSD, totalBS);
}

function _actualizarTotalesUI(subTotalUSD, descuentoUSD, totalUSD, totalBS) {
  const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
  const fmtBs = (n) => `Bs ${Number(n || 0).toFixed(2)}`;

  document.getElementById('pedSubtotalUsd').textContent = fmt(subTotalUSD);
  document.getElementById('pedDescuento').textContent   = `-${fmt(descuentoUSD)}`;
  document.getElementById('pedTotalUsd').textContent    = fmt(totalUSD);
  document.getElementById('pedTotalBs').textContent     = fmtBs(totalBS);
}

// ---------------------------------------------------------------------------
// 8. Generación del mensaje de WhatsApp
// ---------------------------------------------------------------------------

/**
 * Genera el texto del mensaje formateado para WhatsApp.
 * Usa emojis y asteriscos para el formato en negrita de WhatsApp.
 */
function _generarMensajeWhatsApp(pedido) {
  const c    = pedido.cliente;
  const t    = pedido.totales;
  const tasa = pedido.tasaCambio || 1;
  const now  = new Date();
  const fecha = now.toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric' });
  const hora  = now.toLocaleTimeString('es-VE', { hour:'2-digit', minute:'2-digit' });

  const nombreCliente = [c.nombre, c.apellido].filter(Boolean).join(' ') || 'Cliente';

  // Líneas de productos
  const lineasProd = (pedido.productos || []).map(p => {
    const excl = p.excluidoDescuento ? ' _(sin desc.)_' : '';
    return `  • ${p.cantidad}x ${escapeHtml(p.nombre)} — $${Number(p.precioUnitario).toFixed(2)}${excl} — $${Number(p.precioTotal).toFixed(2)}${excl}`;
  }).join('\n');

  // Descuento: solo mostrar si hay
  const linDescuento = t.descuentoUSD > 0
    ? `🏷️ *Descuento:* -$${t.descuentoUSD.toFixed(2)}\n`
    : '';

  // Vendedor: solo mostrar si hay
  const linVendedor = c.vendedor
    ? `👤 *Atendido por:* ${escapeHtml(c.vendedor)}\n`
    : '';

  const msg = [
    `🛒 *RESUMEN DE PEDIDO — Comercial Jenk Cáceres*`,
    `📋 *${escapeHtml(pedido.id)}*`,
    `📅 Fecha: ${fecha} a las ${hora}`,
    ``,
    `👤 *Cliente:* ${escapeHtml(nombreCliente)}`,
    c.cedula   ? `🪪 *Cédula:* ${escapeHtml(c.cedula)}` : null,
    c.telefono ? `📱 *Teléfono:* ${escapeHtml(c.telefono)}` : null,
    ``,
    `📦 *Productos:*`,
    lineasProd || `  _(sin productos)_`,
    ``,
    `💵 *Subtotal:* $${t.subtotalUSD.toFixed(2)}`,
    t.descuentoUSD > 0 ? `🏷️ *Descuento:* -$${t.descuentoUSD.toFixed(2)}` : null,
    `✅ *TOTAL USD:* $${t.totalUSD.toFixed(2)}`,
    `🇻🇪 *TOTAL Bs:* Bs ${t.totalBS.toFixed(2)}`,
    `📈 *Tasa:* ${Number(tasa).toFixed(2)} Bs/$`,
    ``,
    `💵 *Datos del Pago Movil*`,
    `*Telefono: 0414-146-5256*`,
    `*Cedula: 13.468.427*`,
    `*Bancos: Banesco (0134), Venezuela (0102), Banplus (0174), Provincial (0108)*`,
    ``,
    linVendedor.trim() || null,
    `_Gracias por su compra en Comercial Jenk Cáceres_ 🙏`,
  ].filter(l => l !== null).join('\n');

  return msg;
}

// ---------------------------------------------------------------------------
// 8b. Tasa de cambio vía API
// ---------------------------------------------------------------------------

/** Consulta la tasa USD→VES actual y la aplica al input y al pedido activo
 *  (si este todavía no tiene una tasa manual distinta a la de por defecto). */
async function obtenerTasaDolarPedidos(inputTasa) {
  if (!inputTasa) return;
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await response.json();

    if (data?.rates?.VES) {
      const tasa = data.rates.VES;
      localStorage.setItem('pedidosTasaCambio', tasa);

      // No pisar lo que el usuario esté escribiendo en este momento
      if (document.activeElement !== inputTasa) {
        inputTasa.value = tasa.toFixed(2);
      }

      if (_pedidoActual && (!_pedidoActual.tasaCambio || _pedidoActual.tasaCambio === 1)) {
        _pedidoActual.tasaCambio = tasa;
        _renderizarTabla();
      }
    }
  } catch (error) {
    console.warn('No se pudo actualizar la tasa desde la API. Se mantiene el valor manual o en caché.', error);
  }
}

/** Botón de refresco manual junto al input de tasa. */
function pedRefrescarTasa() {
  const inputTasa = document.getElementById('pedTasaInput');
  const btn = document.getElementById('btnRefrescarTasa');
  if (btn) btn.classList.add('girando');

  obtenerTasaDolarPedidos(inputTasa).finally(() => {
    if (btn) btn.classList.remove('girando');
  });
}

// ---------------------------------------------------------------------------
// 8b-bis. Autoguardado de borrador (evitar perder pedidos en curso)
// ---------------------------------------------------------------------------
// A diferencia de la cola de "pendientes" (8c), que solo guarda facturas que
// YA se intentaron enviar y fallaron, esto guarda TODO lo que el usuario va
// escribiendo en pantalla —incluso pedidos que ni siquiera se han intentado
// enviar— para poder recuperarlos si la página se recarga o se cierra sin
// querer, se corta la luz/conexión, etc.

/** Serializa y guarda en localStorage el estado completo de los pedidos
 *  activos en sesión (todos los de la sidebar), incluyendo el que se está
 *  editando ahora mismo en el formulario. */
function _guardarBorradorLocal() {
  try {
    if (_pedidoActual) _guardarEstadoFormulario(_pedidoActual);

    const estado = {
      pedidos: _pedidos,
      contadorPedidos: _contadorPedidos,
      pedidoActualId: _pedidoActual?.id || null,
    };
    localStorage.setItem(PEDIDOS_BORRADOR_LS_KEY, JSON.stringify(estado));
  } catch (err) {
    console.warn('No se pudo guardar el borrador de pedidos en localStorage:', err);
  }
}

/** Elimina el borrador guardado (se llama una vez que ya no hace falta,
 *  por ejemplo si el usuario limpia todo manualmente). */
function _borrarBorradorLocal() {
  localStorage.removeItem(PEDIDOS_BORRADOR_LS_KEY);
}

/** Versión con debounce de _guardarBorradorLocal, pensada para usarse en
 *  eventos que disparan muy seguido (como "input" al escribir), para no
 *  golpear localStorage en cada tecla. */
let _debounceGuardarBorrador = null;
function _guardarBorradorLocalDebounced(delayMs = 400) {
  clearTimeout(_debounceGuardarBorrador);
  _debounceGuardarBorrador = setTimeout(_guardarBorradorLocal, delayMs);
}

/** Restaura los pedidos guardados por el autoguardado, si hay alguno con
 *  datos reales (para no "revivir" pedidos vacíos sin sentido).
 *  Devuelve true si restauró algo, false si no había nada que restaurar. */
function _restaurarBorradorLocal() {
  let estado;
  try {
    estado = JSON.parse(localStorage.getItem(PEDIDOS_BORRADOR_LS_KEY));
  } catch {
    estado = null;
  }

  if (!estado || !Array.isArray(estado.pedidos) || estado.pedidos.length === 0) {
    return false;
  }

  const tieneDatos = estado.pedidos.some(p =>
    (p.productos && p.productos.length > 0) ||
    Object.values(p.cliente || {}).some(v => (v || '').trim() !== '')
  );
  if (!tieneDatos) return false;

  _pedidos = estado.pedidos;
  _contadorPedidos = estado.contadorPedidos || _pedidos.length;

  _renderizarListaSidebar();

  const pedidoARestaurar =
    _pedidos.find(p => p.id === estado.pedidoActualId) || _pedidos[0];
  _seleccionarPedido(pedidoARestaurar);

  return true;
}

/** Indica si hay algo que se perdería al cerrar/recargar la página ahora
 *  mismo: pedidos en curso con datos, o facturas que fallaron al enviarse
 *  y siguen en cola. Se usa para el aviso de "beforeunload". */
function _hayDatosSinEnviar() {
  const hayPedidosConDatos = _pedidos.some(p =>
    (p.productos && p.productos.length > 0) ||
    Object.values(p.cliente || {}).some(v => (v || '').trim() !== '')
  );
  const hayPendientes = _obtenerPendientesLocal().length > 0;
  return hayPedidosConDatos || hayPendientes;
}

// ---------------------------------------------------------------------------
// 8c. Cola de facturas pendientes en localStorage
// ---------------------------------------------------------------------------

function _obtenerPendientesLocal() {
  try {
    return JSON.parse(localStorage.getItem(PEDIDOS_PENDIENTES_LS_KEY)) || [];
  } catch {
    return [];
  }
}

function _guardarPendientesLocal(lista) {
  localStorage.setItem(PEDIDOS_PENDIENTES_LS_KEY, JSON.stringify(lista));
}

function _agregarOActualizarPendienteLocal(payload) {
  const lista = _obtenerPendientesLocal();
  const idx = lista.findIndex(f => f.id_factura === payload.id_factura);
  if (idx >= 0) lista[idx] = payload;
  else lista.push(payload);
  _guardarPendientesLocal(lista);
  _actualizarBannerPendientes();
}

function _quitarPendienteLocal(idFactura) {
  const lista = _obtenerPendientesLocal().filter(f => f.id_factura !== idFactura);
  _guardarPendientesLocal(lista);
  _actualizarBannerPendientes();
}

function _actualizarBannerPendientes() {
  const banner = document.getElementById('pedPendientesBanner');
  if (!banner) return;
  const lista = _obtenerPendientesLocal();

  if (lista.length === 0) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  const contador = document.getElementById('pedPendientesCount');
  if (contador) contador.textContent = lista.length;
}

/** Intenta reenviar todas las facturas guardadas localmente por fallas
 *  previas de red o del servidor. Se llama al cargar la página y al
 *  recuperar la conexión. Los que sigan fallando permanecen en la cola. */
async function pedReintentarPendientes() {
  const lista = _obtenerPendientesLocal();
  if (!lista.length) return;

  const btn = document.getElementById('btnReintentarPendientes');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reintentando...';
  }

  for (const payload of [...lista]) {
    try {
      const response = await fetch(BACKEND_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const resultado = await response.json().catch(() => null);
      if (response.ok && resultado?.status !== 'error') {
        _quitarPendienteLocal(payload.id_factura);
      }
    } catch (err) {
      // Sigue sin conexión: se deja en la cola para el próximo intento
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-rotate"></i> Reintentar envío';
  }
  _actualizarBannerPendientes();
}

// ---------------------------------------------------------------------------
// 8d. Envío del pedido al backend (facturas temporales para verificación)
// ---------------------------------------------------------------------------

function _generarIdFacturaPedido() {
  const sufijo =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 6)
      : Math.random().toString(36).slice(2, 8);
  return 'PED-' + Date.now().toString().slice(-8) + '-' + sufijo;
}

/** Construye el payload en el mismo formato que espera /api/precargar-factura
 *  (idéntico al que usa el módulo de facturación por mostrador). */
function _construirPayloadFactura(pedido) {
  const c = pedido.cliente;
  const t = pedido.totales;
  const tasa = Number(pedido.tasaCambio) || 1;

  if (!pedido.idFactura) {
    pedido.idFactura = _generarIdFacturaPedido();
  }

  return {
    id_factura: pedido.idFactura,
    nombre: c.nombre || 'Consumidor Final',
    apellido: c.apellido || '',
    cedula: c.cedula || 'V-00000000',
    telefono: (c.telefono || '').replace(/\D/g, '') || 'N/A',
    vendedor: c.vendedor || localStorage.getItem('vendedorActual') || 'Cajero General',
    tasa_cambio: tasa,
    subtotal_usd: t.subtotalUSD,
    descuento_usd: t.descuentoUSD,
    total_usd: t.totalUSD,
    subtotal_bs: t.subtotalUSD * tasa,
    descuento_bs: t.descuentoUSD * tasa,
    total_bs: t.totalBS,
    productos: pedido.productos.map(p => ({
      nombre: p.nombre,
      cantidad: p.cantidad,
      precioUnitario: p.precioUnitario,
      precioTotal: p.precioTotal,
    })),
  };
}

function mostrarModalCargandoPedido() {
  document.getElementById('statusModal').classList.remove('hidden');
  document.getElementById('modalLoading').classList.remove('hidden');
  document.getElementById('modalSuccess').classList.add('hidden');
  document.getElementById('modalError').classList.add('hidden');
}

function mostrarModalExitoPedido() {
  document.getElementById('modalLoading').classList.add('hidden');
  document.getElementById('modalSuccess').classList.remove('hidden');
  setTimeout(() => {
    document.getElementById('statusModal').classList.add('hidden');
  }, 1800);
}

function mostrarModalErrorPedido(mensaje) {
  document.getElementById('modalLoading').classList.add('hidden');
  document.getElementById('modalErrorMessage').textContent = mensaje;
  document.getElementById('modalError').classList.remove('hidden');
}

function cerrarModalErrorPedido() {
  document.getElementById('statusModal').classList.add('hidden');
}

/** Quita de la lista de pedidos activos uno que ya se envió con éxito
 *  a facturación, y selecciona el siguiente (o crea uno nuevo si era el
 *  único que había). */
function _quitarPedidoDeListaActiva(id) {
  const idx = _pedidos.findIndex(p => p.id === id);
  if (idx === -1) return;

  _pedidos.splice(idx, 1);

  if (_pedidos.length === 0) {
    _renderizarListaSidebar();
    _crearPedido(localStorage.getItem('vendedorActual') || '');
    return;
  }

  if (_pedidoActual?.id === id) {
    const siguiente = _pedidos[Math.min(idx, _pedidos.length - 1)];
    _renderizarListaSidebar();
    _seleccionarPedido(siguiente);
  } else {
    _renderizarListaSidebar();
  }
  _guardarBorradorLocal();
}

async function _enviarFacturaAlBackend(payload, pedidoId) {
  const boton = document.getElementById('btnEnviarPedido');
  if (boton) boton.disabled = true;
  mostrarModalCargandoPedido();

  try {
    const response = await fetch(BACKEND_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error('El servidor no devolvió una respuesta JSON válida');
    }

    const resultado = await response.json();
    if (!response.ok || resultado.status === 'error') {
      throw new Error(resultado.message || 'Error desconocido del servidor');
    }

    _quitarPendienteLocal(payload.id_factura);
    mostrarModalExitoPedido();
    _quitarPedidoDeListaActiva(pedidoId);
  } catch (error) {
    console.error('Error al enviar el pedido a facturación:', error);
    // Se guarda localmente para no perder el pedido; se reintentará solo
    // más adelante (al recargar la página o al recuperar conexión), o el
    // usuario puede forzar el reintento desde el banner.
    _agregarOActualizarPendienteLocal(payload);
    mostrarModalErrorPedido(
      `${error.message}. El pedido se guardó localmente y se reintentará el envío automáticamente.`,
    );
  } finally {
    if (boton) boton.disabled = false;
  }
}

/** Valida que TODOS los campos obligatorios del pedido estén completos y con
 *  un formato correcto antes de poder enviarlo a facturación. Devuelve un
 *  mensaje de error (string) si algo falta, o null si todo está en orden. */
function _validarCamposObligatorios(pedido) {
  const c = pedido.cliente;

  if (!pedido.productos.length) {
    return 'Agrega al menos un producto antes de enviar el pedido.';
  }

  if (!c.nombre.trim()) {
    return 'El nombre del cliente es obligatorio.';
  }
  if (!c.apellido.trim()) {
    return 'El apellido del cliente es obligatorio.';
  }

  const cedulaDigitos = (c.cedula || '').replace(/\D/g, '');
  if (!cedulaDigitos) {
    return 'La cédula del cliente es obligatoria.';
  }
  if (cedulaDigitos.length < 6 || cedulaDigitos.length > 9) {
    return 'La cédula ingresada no es válida (debe tener entre 6 y 9 dígitos).';
  }

  const telefonoDigitos = (c.telefono || '').replace(/\D/g, '');
  if (!telefonoDigitos) {
    return 'El teléfono del cliente es obligatorio.';
  }
  if (telefonoDigitos.length !== 11) {
    return 'El teléfono ingresado no es válido (debe tener 11 dígitos, ej: 0412-345-6789).';
  }

  if (!c.vendedor.trim()) {
    return 'El nombre del vendedor es obligatorio.';
  }

  return null;
}

/** Acción principal: envía el pedido activo a facturación (como factura
 *  temporal) en lugar de abrir WhatsApp. Queda pendiente de verificación
 *  en el módulo de facturación. */
async function pedEnviarAFacturacion() {
  if (!_pedidoActual) return;

  _guardarEstadoFormulario(_pedidoActual);
  _recalcularTotales();

  const errorValidacion = _validarCamposObligatorios(_pedidoActual);
  if (errorValidacion) {
    alert(errorValidacion);
    return;
  }

  const payload = _construirPayloadFactura(_pedidoActual);
  await _enviarFacturaAlBackend(payload, _pedidoActual.id);
}

/** Confirmar envío desde el modal de vista previa (reemplaza el antiguo
 *  "Abrir WhatsApp"). Si se ingresó un teléfono en el modal, se guarda
 *  también en los datos del cliente. */
function pedConfirmarEnvioDesdeModal() {
  const inputTel = document.getElementById('modalWaPhone');
  const numLimpio = (inputTel?.value || '').replace(/\D/g, '');

  if (_pedidoActual && numLimpio) {
    _pedidoActual.cliente.telefono = numLimpio;
    const campoTelefono = document.getElementById('pedTelefono');
    if (campoTelefono) campoTelefono.value = numLimpio;
  }

  pedCerrarVistaPrevia();
  pedEnviarAFacturacion();
}

// ---------------------------------------------------------------------------
// 9. Vista previa modal
// ---------------------------------------------------------------------------
function pedAbrirVistaPrevia() {
  if (!_pedidoActual) return;

  // Guardar estado antes de mostrar
  _guardarEstadoFormulario(_pedidoActual);
  _recalcularTotales();

  const msg = _generarMensajeWhatsApp(_pedidoActual);

  // Renderizar burbuja
  const bubble = document.getElementById('waBubbleContent');
  // Convertir asteriscos a negrita y saltos de línea a <br>
  bubble.innerHTML = msg
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');

  // Hora actual
  const hora = new Date().toLocaleTimeString('es-VE', { hour:'2-digit', minute:'2-digit' });
  document.getElementById('waBubbleTime').textContent = hora;

  // Pre-cargar teléfono del cliente si existe
  const tel = _pedidoActual.cliente.telefono || '';
  const numLimpio = tel.replace(/\D/g, '').replace(/^58/, '').replace(/^0/, '');
  document.getElementById('modalWaPhone').value = numLimpio;

  // Mostrar modal
  document.getElementById('modalPreview').classList.remove('hidden');
}

function pedCerrarVistaPrevia() {
  document.getElementById('modalPreview').classList.add('hidden');
  // Reset botón copiar
  const btn = document.getElementById('btnCopyMsg');
  btn.innerHTML = '<i class="fas fa-copy"></i> Copiar';
  btn.classList.remove('copied');
}

// Cerrar modal al hacer click fuera
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modalPreview').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalPreview')) pedCerrarVistaPrevia();
  });
});

/** Copia el mensaje al portapapeles */
async function pedCopiarMensaje() {
  if (!_pedidoActual) return;
  _guardarEstadoFormulario(_pedidoActual);
  _recalcularTotales();

  const msg = _generarMensajeWhatsApp(_pedidoActual);

  try {
    await navigator.clipboard.writeText(msg);
    const btn = document.getElementById('btnCopyMsg');
    btn.innerHTML = '<i class="fas fa-check"></i> ¡Copiado!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = '<i class="fas fa-copy"></i> Copiar';
      btn.classList.remove('copied');
    }, 2500);
  } catch (err) {
    alert('No se pudo copiar al portapapeles. Intenta manualmente.');
  }
}

function pedEnviarWhatsApp() {
  if (!_pedidoActual) return;
  _guardarEstadoFormulario(_pedidoActual);
  _recalcularTotales();

  const tel = _pedidoActual.cliente.telefono || '';
  const numLimpio = tel.replace(/\D/g, '').replace(/^0/, '');

  // Si tiene teléfono, abrir directamente; si no, abrir modal para pedirlo
  if (numLimpio.length >= 10) {
    _abrirWhatsApp(numLimpio);
  } else {
    pedAbrirVistaPrevia();
  }
}

// ---------------------------------------------------------------------------
// 10. Helpers
// ---------------------------------------------------------------------------
function _limpiarFormAgregar() {
  ['pedCantProduct', 'pedNombreProduct', 'pedPrcUndProduct', 'pedPrcTotalProduct']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
}

// ---------------------------------------------------------------------------
// Exposición global
// ---------------------------------------------------------------------------
window.pedNuevoPedido              = pedNuevoPedido;
window.pedEliminarPedido           = pedEliminarPedido;
window.pedSeleccionarPorId         = pedSeleccionarPorId;
window.pedSyncCliente              = pedSyncCliente;
window.pedActualizarTasa           = pedActualizarTasa;
window.pedAgregarProducto          = pedAgregarProducto;
window.pedAbrirVistaPrevia         = pedAbrirVistaPrevia;
window.pedCerrarVistaPrevia        = pedCerrarVistaPrevia;
window.pedCopiarMensaje            = pedCopiarMensaje;
window.pedRefrescarTasa            = pedRefrescarTasa;
window.pedReintentarPendientes     = pedReintentarPendientes;
window.pedEnviarAFacturacion       = pedEnviarAFacturacion;
window.pedConfirmarEnvioDesdeModal = pedConfirmarEnvioDesdeModal;
window.cerrarModalErrorPedido      = cerrarModalErrorPedido;
window.formatText                  = formatText;
window.formatDoc                   = formatDoc;
window.formatPhone                 = formatPhone;