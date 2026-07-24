//--- VARIABLES DE ESTADO ---//
const state = {
  listaProductos: [],
  tasaConver: 0,
  montoFinalUSD: 0,
  montoFinalBS: 0,
  descUSD: 0,
  descBS: 0,
  compraExitosa: false,
  clienteCompleto: false,
};

const inputVendedor = document.getElementById("nameVendedor");

if (inputVendedor) {
  inputVendedor.value = localStorage.getItem("vendedorActual") || "";

  inputVendedor.addEventListener("input", () => {
    localStorage.setItem("vendedorActual", inputVendedor.value.trim());
  });
}

const BACKEND_API_URL = "/api/guardar-factura";

//--- BLOQUEAR RECARGA ---//
window.addEventListener("beforeunload", (event) => {
  if (!state.compraExitosa) {
    event.preventDefault();
    event.returnValue = "";
  }
});

//--- MANEJO DE MODAL DATA-CLIENT ---//
window.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("modalDataCliente");

  if (modal) {
    modal.showModal();

    modal.addEventListener("cancel", (event) => {
      event.preventDefault();
      omitirDatosCliente();
    });
  }

  actualizarResumenCliente();

  // Inicializadores
  calcularPrecioTotal();
  inicializarTasa();
  configurarDelegacionEventos();
  inyectarEstilosAccionesProducto();
});

//--- ESTILOS MÍNIMOS PARA LOS BOTONES DE ACCIÓN DE CADA PRODUCTO ---//
function inyectarEstilosAccionesProducto() {
  if (document.getElementById("estilos-acciones-producto")) return;

  const style = document.createElement("style");
  style.id = "estilos-acciones-producto";
  style.textContent = `
    .acciones-producto {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .btn-toggle-desc {
      padding: 5px;
      border: 1px solid var(--accent, #666);
      background: transparent;
      color: var(--accent, #666);
      border-radius: 6px;
      width: 32px;
      height: 32px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .btn-toggle-desc:hover {
      background: var(--accent, #666);
      color: #fff;
    }
    .btn-toggle-desc.active {
      background: var(--accent, #666);
      color: #fff;
    }
  `;
  document.head.appendChild(style);
}

//--- FILTRADO Y FORMATEO DE DATOS ---//

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

//--- GUARDAR DATA-CLIENT E IMPRIMIR EN FACTURA ---//
function dataClientSave() {
  const name = document.getElementById("nameClient").value.trim();
  const secondName = document.getElementById("secondNameClient").value.trim();
  const documentID = document.getElementById("documentID").value.trim();
  const numberPhone = document.getElementById("numberPhone").value.trim();

  // CORRECCIÓN: Limpiar puntos para validar numéricamente la cédula
  const cedulaLimpia = parseInt(documentID.replace(/\./g, ""), 10) || 0;

  if (!name || !secondName || !documentID || !numberPhone) {
    alert("Por favor, llena todos los datos del cliente correctamente.");
    return;
  }

  if (cedulaLimpia < 100000) {
    alert("Número de cédula inválido.");
    return;
  }

  if (numberPhone.length < 13) {
    alert("Número telefónico incorrecto, ¡número(s) faltante!");
    return;
  }

  state.clienteCompleto = true;
  actualizarResumenCliente();

  const modal = document.getElementById("modalDataCliente");
  if (modal && modal.open) {
    modal.close();
  }
}

//--- OMITIR DATOS DEL CLIENTE (SE COMPLETAN MÁS TARDE) ---//
function omitirDatosCliente() {
  state.clienteCompleto = false;
  actualizarResumenCliente();

  const modal = document.getElementById("modalDataCliente");
  if (modal && modal.open) {
    modal.close();
  }
}

//--- ABRIR EL MODAL PARA COMPLETAR O EDITAR LOS DATOS DEL CLIENTE ---//
function abrirModalCliente() {
  const modal = document.getElementById("modalDataCliente");
  if (modal && !modal.open) {
    modal.showModal();
  }
}

//--- PINTAR EL RESUMEN DEL CLIENTE (COMPLETO O PENDIENTE) ---//
function actualizarResumenCliente() {
  const data = document.getElementById("data-client");
  if (!data) return;

  if (state.clienteCompleto) {
    const name = document.getElementById("nameClient").value.trim();
    const secondName = document
      .getElementById("secondNameClient")
      .value.trim();
    const documentID = document.getElementById("documentID").value.trim();
    const numberPhone = document.getElementById("numberPhone").value.trim();

    data.innerHTML = `
      <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
        <div>
          <p><strong>Cliente:</strong> ${escapeHtml(name)} ${escapeHtml(secondName)}</p>
          <p><strong>C.I. / RIF:</strong> ${escapeHtml(documentID)}</p>
          <p><strong>Teléfono:</strong> ${escapeHtml(numberPhone)}</p>
        </div>
        <button type="button" class="btn-secondary" onclick="abrirModalCliente()">
          <i class="fas fa-pen"></i> Editar cliente
        </button>
      </div>
    `;
  } else {
    data.innerHTML = `
      <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
        <p><i class="fas fa-triangle-exclamation"></i> Datos del cliente pendientes</p>
        <button type="button" class="btn-primary" onclick="abrirModalCliente()">
          <i class="fas fa-user-plus"></i> Completar datos del cliente
        </button>
      </div>
    `;
  }
}

//--- OBTENCION DE TASA ACTUALIZADA POR API ---//
async function obtenerTasaDolar(inputTasa) {
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await response.json();

    if (data?.rates?.VES) {
      state.tasaConver = data.rates.VES;
      localStorage.setItem("tasaFacturacion", state.tasaConver);

      if (document.activeElement !== inputTasa) {
        inputTasa.value = state.tasaConver.toFixed(2);
      }

      if (state.listaProductos.length > 0) {
        recalcularPreciosPorNuevaTasa();
      }
    }
  } catch (error) {
    console.warn(
      "Fallo de conexión o API. Se mantendrá el valor manual o en caché.",
    );
  }
}

function inicializarTasa() {
  const inputTasa = document.getElementById("tasa-input");
  if (!inputTasa) return;

  const tasaGuardada = localStorage.getItem("tasaFacturacion");
  if (tasaGuardada) {
    state.tasaConver = Number(tasaGuardada);
    inputTasa.value = state.tasaConver.toFixed(2);
  }

  inputTasa.addEventListener("input", () => {
    state.tasaConver = Number(inputTasa.value) || 0;
    localStorage.setItem("tasaFacturacion", state.tasaConver);

    if (state.listaProductos.length > 0) {
      recalcularPreciosPorNuevaTasa();
    }
  });

  obtenerTasaDolar(inputTasa);
}

function recalcularPreciosPorNuevaTasa() {
  state.listaProductos.forEach((producto) => {
    producto.precioUnitarioBS = producto.precioUnitario * state.tasaConver;
    producto.precioTotalBS = producto.precioTotal * state.tasaConver;
  });
  actualizarTabla();
}

//--- INCORPORACION DE PRODUCTOS ---//
function acceptProductData() {
  const cantProd = Number(document.getElementById("cantProduct").value);
  const nameProd = document.getElementById("nameProduct").value.trim();
  const puProd = Number(document.getElementById("prcUndProduct").value);
  const ptProd = Number(document.getElementById("prcTotalProduct").value);

  if (state.tasaConver <= 0) {
    alert("Por favor, ingresa una tasa de conversión válida.");
    return;
  }

  if (!nameProd || cantProd <= 0 || puProd <= 0) {
    alert("Por favor, llena los datos del producto correctamente.");
    return;
  }

  state.listaProductos.push({
    cantidad: cantProd,
    nombre: nameProd,
    precioUnitario: puProd,
    precioUnitarioBS: state.tasaConver * puProd,
    precioTotal: ptProd,
    precioTotalBS: state.tasaConver * ptProd,
    excluidoDescuento: false,
  });

  actualizarTabla();
  limpiarFormulario();
}

function limpiarFormulario() {
  ["cantProduct", "nameProduct", "prcUndProduct", "prcTotalProduct"].forEach(
    (id) => {
      document.getElementById(id).value = "";
    },
  );
}

//--- ACTUALIZACION DE TABLA ---//
function actualizarTabla() {
  const tbody = document.getElementById("tablaProductos");
  if (!tbody) return;

  tbody.innerHTML = "";

  state.listaProductos.forEach((producto, index) => {
    const fila = document.createElement("tr");
    const excluido = !!producto.excluidoDescuento;
    fila.innerHTML = `
      <td>${producto.cantidad}</td>
      <td>${escapeHtml(producto.nombre)}</td>
      <td>$${producto.precioUnitario.toFixed(2)}</td>
      <td>${producto.precioUnitarioBS.toFixed(2)}Bs</td>
      <td>$${producto.precioTotal.toFixed(2)}</td>
      <td>${producto.precioTotalBS.toFixed(2)}Bs</td>
      <td class="acciones-producto">
        <button
          class="btn-toggle-desc${excluido ? " active" : ""}"
          data-index="${index}"
          title="${excluido ? "Volver a incluir en el descuento" : "Sacar del descuento (se suma completo al total)"}"
        >
          <i class="fa-solid ${excluido ? "fa-rotate-left" : "fa-tag"}"></i>
        </button>
        <button class="btn-eliminar" data-index="${index}"> <i class="fa-solid fa-trash"></i> </button>
      </td>
    `;
    tbody.appendChild(fila);
  });

  const productosDescontables = state.listaProductos.filter(
    (p) => !p.excluidoDescuento,
  );
  const productosExcluidos = state.listaProductos.filter(
    (p) => p.excluidoDescuento,
  );

  const subTotalDescontableUSD = productosDescontables.reduce(
    (acc, p) => acc + p.precioTotal,
    0,
  );
  const subTotalDescontableBS = productosDescontables.reduce(
    (acc, p) => acc + p.precioTotalBS,
    0,
  );

  const subTotalExcluidoUSD = productosExcluidos.reduce(
    (acc, p) => acc + p.precioTotal,
    0,
  );
  const subTotalExcluidoBS = productosExcluidos.reduce(
    (acc, p) => acc + p.precioTotalBS,
    0,
  );

  const subTotalUSD = subTotalDescontableUSD + subTotalExcluidoUSD;
  const subTotalBS = subTotalDescontableBS + subTotalExcluidoBS;

  // El porcentaje de descuento se calcula solo sobre lo que sí aplica a descuento
  let porcentajeDescuento = 0;
  if (subTotalDescontableUSD > 150) porcentajeDescuento = 20;
  else if (subTotalDescontableUSD > 50) porcentajeDescuento = 15;
  else if (subTotalDescontableUSD > 10) porcentajeDescuento = 10;

  state.descUSD = subTotalDescontableUSD * (porcentajeDescuento / 100);
  state.descBS = subTotalDescontableBS * (porcentajeDescuento / 100);

  // Los productos excluidos se suman completos (sin descuento) al total final
  state.montoFinalUSD =
    subTotalDescontableUSD - state.descUSD + subTotalExcluidoUSD;
  state.montoFinalBS =
    subTotalDescontableBS - state.descBS + subTotalExcluidoBS;

  const totalFinal = document.getElementById("totalesTabla");
  if (totalFinal) {
    if (state.montoFinalUSD <= 0) {
      totalFinal.innerHTML = "";
      return;
    }

    totalFinal.innerHTML = `
        ${
          porcentajeDescuento > 0
            ? `
          <div>
              <h2>Sub-Total:</h2>
              <h2>$${subTotalUSD.toFixed(2)} / ${subTotalBS.toFixed(2)}Bs</h2>
          </div>
          <div>
              <h2>Descuento (-${porcentajeDescuento}%):</h2>
              <h2>-$${state.descUSD.toFixed(2)} / -${state.descBS.toFixed(2)}Bs</h2>
          </div>
        `
            : ""
        } 
        <div class="total-procesar">
          <div>
            <h1>Total: </h1>
            <h1>$${state.montoFinalUSD.toFixed(2)} / ${state.montoFinalBS.toFixed(2)}Bs</h1>
            <br>
            <button class="process" onclick="finalizarCompra()">Procesar Compra <i class="fas fa-receipt"></i> </button>
          </div>
        </div>
    `;
  }
}

function configurarDelegacionEventos() {
  document.addEventListener("click", (e) => {
    const botonEliminar = e.target.closest(".btn-eliminar");
    if (botonEliminar) {
      const index = parseInt(botonEliminar.getAttribute("data-index"), 10);
      state.listaProductos.splice(index, 1);
      actualizarTabla();
      return;
    }

    const botonToggleDesc = e.target.closest(".btn-toggle-desc");
    if (botonToggleDesc) {
      const index = parseInt(botonToggleDesc.getAttribute("data-index"), 10);
      const producto = state.listaProductos[index];
      if (producto) {
        producto.excluidoDescuento = !producto.excluidoDescuento;
        actualizarTabla();
      }
    }
  });
}

function calcularPrecioTotal() {
  const cantidadInput = document.getElementById("cantProduct");
  const precioUndInput = document.getElementById("prcUndProduct");
  const precioTotalInput = document.getElementById("prcTotalProduct");

  if (!cantidadInput || !precioUndInput || !precioTotalInput) return;

  const calcular = () => {
    const cantidad = Number(cantidadInput.value) || 0;
    const precioUnitario = Number(precioUndInput.value) || 0;
    precioTotalInput.value = (cantidad * precioUnitario).toFixed(2);
  };

  cantidadInput.addEventListener("input", calcular);
  precioUndInput.addEventListener("input", calcular);
}

//--- SECCIONES DE PAGO ---//
function mostrarSeccionPago() {
  if (!state.clienteCompleto) {
    alert(
      "Debes completar los datos del cliente antes de continuar con el pago.",
    );
    abrirModalCliente();
    return;
  }

  const seccionProducto = document.getElementById("seccionProducto");
  const seccionFactura = document.getElementById("seccionFactura");
  const seccionPago = document.getElementById("seccionPago");
  const inputTasaBCV = document.getElementById("tasa-input");

  if (seccionProducto && seccionFactura && seccionPago) {
    seccionProducto.style.display = "none";
    seccionFactura.style.display = "none";
    if (inputTasaBCV) inputTasaBCV.readOnly = true;
    seccionPago.style.display = "block";

    const metodoPagoSelect = document.getElementById("metodoPago");
    if (metodoPagoSelect) selectMetodoPago(metodoPagoSelect.value);
  }
}

function ocultarSeccionPagos() {
  const seccionProducto = document.getElementById("seccionProducto");
  const seccionFactura = document.getElementById("seccionFactura");
  const seccionPago = document.getElementById("seccionPago");
  const inputTasaBCV = document.getElementById("tasa-input");

  if (seccionProducto && seccionFactura && seccionPago) {
    seccionProducto.style.display = "grid";
    seccionFactura.style.display = "grid";
    if (inputTasaBCV) inputTasaBCV.readOnly = false;
    seccionPago.style.display = "none";
  }
}

function selectMetodoPago(valor) {
  const detailsContainer = document.getElementById("paymentDetails");
  if (!detailsContainer) return;

  detailsContainer.innerHTML = "";
  if (state.montoFinalUSD <= 0) return;

  const montoEncabezado = `
    <div style="grid-column: 1 / -1; margin-bottom: 10px;">
      <h3 style="color: var(--text-secondary); font-size: 0.9rem; text-transform: uppercase;">Monto a transferir:</h3>
      <h2 style="color: var(--accent); font-size: 1.5rem; font-weight: 600;">$${state.montoFinalUSD.toFixed(2)} / ${state.montoFinalBS.toFixed(2)}Bs</h2>
    </div>
  `;

  if (valor === "PM") {
    detailsContainer.innerHTML = `
      <div class="form-billing-grid" style="margin-top: 16px;">
        ${montoEncabezado}
        <label class="form-field">Banco Destino
          <select id="bankSelect">
            <option value="" disabled selected>Seleccione un banco</option>
            <option value="Banesco">Banesco</option>
            <option value="Venezuela">Banco de Venezuela</option>
            <option value="Provincial">Provincial</option>
            <option value="Banplus">Banplus</option>
          </select>
        </label>
        <label class="form-field">Número de Referencia
          <input type="number" id="pmRef" placeholder="Últimos 4 dígitos">
        </label>
        <div class="form-field capture-container" style="grid-column: 1 / -1;">
          <span class="capture-label">Comprobante de Pago</span>
          <input type="file" id="receiptCapture" accept="image/*" capture="environment" style="display: none;" onchange="previewReceipt(this)">
          <button type="button" class="btn-secondary btn-capture" onclick="document.getElementById('receiptCapture').click()">
            <i class="fas fa-camera"></i> Adjuntar o Tomar Foto
          </button>
          <div id="receiptPreview" class="receipt-preview-box" style="display: none;"></div>
        </div>
      </div>
    `;
  } else if (valor === "PVD" || valor === "PVC") {
    detailsContainer.innerHTML = montoEncabezado;
  } else if (valor === "ED") {
    detailsContainer.innerHTML = `
      <div style="grid-column: 1 / -1; margin-bottom: 10px;">
        <h3 style="color: var(--text-secondary); font-size: 0.9rem; text-transform: uppercase;">Monto a pagar:</h3>
        <h2 style="color: var(--accent); font-size: 1.5rem; font-weight: 600;">$${state.montoFinalUSD.toFixed(2)}</h2>
      </div>
      <div class="form-billing-grid" style="margin-top: 16px;">
        <label class="form-field">Monto Recibido ($)
          <input type="number" id="EDMontoRecibido" placeholder="ej: 20" step="0.01">
        </label>
        <label class="form-field">Vuelto a Entregar ($)
          <input type="text" id="EDVueltoEntrega" readonly placeholder="0.00">
        </label>
        <label class="form-field">Observaciones
          <textarea id="observacionesED" rows="4" placeholder="Detalla alguna novedad..."></textarea>
        </label>
      </div>
    `;
    activarCalculoVueltoED();
  } else if (valor === "EBS") {
    detailsContainer.innerHTML = `
      <div style="grid-column: 1 / -1; margin-bottom: 10px;">
        <h3 style="color: var(--text-secondary); font-size: 0.9rem; text-transform: uppercase;">Monto a pagar:</h3>
        <h2 style="color: var(--accent); font-size: 1.5rem; font-weight: 600;">${state.montoFinalBS.toFixed(2)}Bs</h2>
      </div>
      <div class="form-billing-grid" style="margin-top: 16px;">
        <label class="form-field">Monto Recibido (Bs)
          <input type="number" id="EBSMontoRecibido" placeholder="ej: 2500" step="0.01">
        </label>
        <label class="form-field">Vuelto a Entregar (Bs)
          <input type="text" id="EBSVueltoEntrega" readonly placeholder="0.00">
        </label> 
      </div> `;
    activarCalculoVueltoEBS();
  } else if (valor === "OTROS") {
    detailsContainer.innerHTML = `
      ${montoEncabezado}
      <div class="form-billing-grid" style="margin-top: 16px;">
        <label class="form-field">Observaciones
          <textarea id="observacionesOTROS" rows="4" placeholder="Detalla alguna novedad..."></textarea>
        </label>
        <div class="form-field capture-container" style="grid-column: 1 / -1;">
          <span class="capture-label">Comprobante de Pago</span>
          <input type="file" id="receiptCapture" accept="image/*" capture="environment" style="display: none;" onchange="previewReceipt(this)">
          <button type="button" class="btn-secondary btn-capture" onclick="document.getElementById('receiptCapture').click()">
            <i class="fas fa-camera"></i> Adjuntar o Tomar Foto
          </button>
          <div id="receiptPreview" class="receipt-preview-box" style="display: none;"></div>
        </div>
      </div>
    `;
  }
}

function activarCalculoVueltoED() {
  const montoRecibidoInput = document.getElementById("EDMontoRecibido");
  const vueltoEntregaInput = document.getElementById("EDVueltoEntrega");

  if (!montoRecibidoInput || !vueltoEntregaInput) return;

  montoRecibidoInput.addEventListener("input", () => {
    const montoRecibido = Number(montoRecibidoInput.value) || 0;
    if (montoRecibido < state.montoFinalUSD) {
      vueltoEntregaInput.value = "0.00";
      return;
    }
    vueltoEntregaInput.value = `$${(montoRecibido - state.montoFinalUSD).toFixed(2)}`;
  });
}

function activarCalculoVueltoEBS() {
  const montoRecibidoInput = document.getElementById("EBSMontoRecibido");
  const vueltoEntregaInput = document.getElementById("EBSVueltoEntrega");

  if (!montoRecibidoInput || !vueltoEntregaInput) return;

  montoRecibidoInput.addEventListener("input", () => {
    const montoRecibido = Number(montoRecibidoInput.value) || 0;
    if (montoRecibido < state.montoFinalBS) {
      vueltoEntregaInput.value = "0.00";
      return;
    }
    vueltoEntregaInput.value = `${(montoRecibido - state.montoFinalBS).toFixed(2)}Bs`;
  });
}

function previewReceipt(input) {
  const previewBox = document.getElementById("receiptPreview");
  if (!previewBox) return;

  if (input.files?.[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      previewBox.style.display = "block";
      previewBox.style.backgroundImage = `url('${e.target.result}')`;
    };
    reader.readAsDataURL(input.files[0]);
  } else {
    previewBox.style.display = "none";
    previewBox.style.backgroundImage = "none";
  }
}

//--- CONVERTIR ARCHIVO A BASE64 (sin el prefijo "data:image/...;base64,") ---//
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- COMPRIMIR/REDIMENSIONAR LA FOTO DEL COMPROBANTE ANTES DE ENVIARLA ---//
// Las fotos tomadas con la cámara de un celular suelen pesar varios MB. Al
// convertirlas a base64 (que pesa ~33% más) y sumarle el resto del JSON de
// la factura, es fácil superar el límite de tamaño de solicitud que
// aceptan las funciones serverless (por ejemplo, Vercel corta las
// peticiones que superan ~4.5MB en el plan gratuito, ANTES de que nuestra
// función en Python llegue siquiera a ejecutarse). Por eso el comprobante
// podía fallar en silencio justo en los celulares con mejor cámara, aunque
// en la computadora (probando con imágenes más livianas) funcionara sin
// problema.
//
// Para que el resultado no dependa del dispositivo, la imagen se
// redimensiona/comprime aquí antes de seguir. Si por alguna razón el
// navegador no puede procesarla (formato no soportado, etc.), se sigue con
// el archivo original y es la validación de tamaño la que decide si se
// puede enviar o no.
function comprimirImagenComprobante(file, maxAncho = 1600, calidad = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("El archivo no es una imagen"));
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;
      if (width > maxAncho) {
        height = Math.round((height * maxAncho) / width);
        width = maxAncho;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("No se pudo preparar el lienzo de compresión"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("No se pudo comprimir la imagen"));
            return;
          }
          const nombreComprimido = file.name.replace(/\.\w+$/, "") + ".jpg";
          resolve(new File([blob], nombreComprimido, { type: "image/jpeg" }));
        },
        "image/jpeg",
        calidad
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen seleccionada"));
    };

    img.src = url;
  });
}

function mostrarModalCargando() {
  document.getElementById("statusModal").classList.remove("hidden");
  document.getElementById("modalLoading").classList.remove("hidden");
  document.getElementById("modalSuccess").classList.add("hidden");
  document.getElementById("modalError").classList.add("hidden");
}

function mostrarModalExito() {
  document.getElementById("modalLoading").classList.add("hidden");
  document.getElementById("modalSuccess").classList.remove("hidden");
}

function mostrarModalError(mensaje) {
  document.getElementById("modalLoading").classList.add("hidden");
  document.getElementById("modalErrorMessage").textContent = mensaje;
  document.getElementById("modalError").classList.remove("hidden");
}

function cerrarModalError() {
  document.getElementById("statusModal").classList.add("hidden");
}

async function finalizarCompra() {
  const boton = document.getElementById("btnFinalizarCompra");
  if (!boton) return;

  // Verificación de seguridad: no debería llegarse aquí sin datos del
  // cliente, pero se valida de nuevo por si el flujo cambia en el futuro.
  if (!state.clienteCompleto) {
    alert(
      "Debes completar los datos del cliente antes de finalizar la compra.",
    );
    abrirModalCliente();
    return;
  }

  const metodoPagoSelect = document.getElementById("metodoPago");
  const metodoSeleccionado = metodoPagoSelect?.value;

  // ==========================================
  // --- 1. VALIDACIONES DEL MÉTODO DE PAGO ---
  // ==========================================

  if (!metodoSeleccionado) {
    alert("Por favor, seleccione un método de pago antes de finalizar la compra.");
    return; // Detiene la ejecución
  }

  if (metodoSeleccionado === "PM") {
    const banco = document.getElementById("bankSelect")?.value;
    const referencia = document.getElementById("pmRef")?.value.trim();
    const comprobante = document.getElementById("receiptCapture");
    
    if (!banco) {
      alert("Para Pago Móvil, es obligatorio seleccionar un Banco Destino.");
      return;
    }
    if (!referencia || referencia.length < 4) {
      alert("Para Pago Móvil, debe ingresar un Número de Referencia (al menos los últimos 4 dígitos).");
      return;
    }
    if (!comprobante || !comprobante.files || comprobante.files.length === 0) {
      alert("Para Pago Móvil, es obligatorio adjuntar o tomar la foto del Comprobante de Pago.");
      return;
    }
  } 
  else if (metodoSeleccionado === "ED") {
    const montoRecibido = Number(document.getElementById("EDMontoRecibido")?.value);
    if (!montoRecibido || montoRecibido < state.montoFinalUSD) {
      alert(`El monto recibido en efectivo ($) es inválido o menor al total a pagar ($${state.montoFinalUSD.toFixed(2)}).`);
      return;
    }
  } 
  else if (metodoSeleccionado === "EBS") {
    const montoRecibido = Number(document.getElementById("EBSMontoRecibido")?.value);
    if (!montoRecibido || montoRecibido < state.montoFinalBS) {
      alert(`El monto recibido en efectivo (Bs) es inválido o menor al total a pagar (${state.montoFinalBS.toFixed(2)}Bs).`);
      return;
    }
  }
  else if (metodoSeleccionado === "OTROS") {
    const observaciones = document.getElementById("observacionesOTROS")?.value.trim();
    const comprobante = document.getElementById("receiptCapture");

    if (!observaciones) {
      alert("Para el método 'OTROS', es obligatorio ingresar las Observaciones detallando la novedad.");
      return;
    }
  
    if (!comprobante || !comprobante.files || comprobante.files.length === 0) {
      alert("Para el método 'OTROS', es obligatorio adjuntar o tomar la foto del Comprobante de Pago.");
      return;
    }
  }

  // ==========================================
  // --- 2. PREPARACIÓN Y ENVÍO DE DATOS ------
  // ==========================================

  // Convertir el comprobante a base64 (si el usuario adjuntó uno)
  const comprobanteInputFinal = document.getElementById("receiptCapture");
  let comprobanteBase64 = null;
  let comprobanteNombre = null;
  let comprobanteTipo = null;

  if (comprobanteInputFinal?.files?.[0]) {
    let file = comprobanteInputFinal.files[0];

    try {
      file = await comprimirImagenComprobante(file);
    } catch (err) {
      // Si no se pudo comprimir (formato raro, navegador viejo, etc.), se
      // sigue con el archivo tal cual llegó; la validación de tamaño de
      // abajo decide si de todas formas se puede enviar.
      console.warn("No se pudo comprimir el comprobante, se usará el original:", err);
    }

    if (file.size > 5 * 1024 * 1024) {
      alert("La imagen del comprobante no debe superar los 5MB.");
      return;
    }

    try {
      comprobanteBase64 = await fileToBase64(file);
      comprobanteNombre = file.name;
      comprobanteTipo = file.type;
    } catch (err) {
      alert("No se pudo procesar la imagen del comprobante.");
      return;
    }
  }

  // Las observaciones se piden en el formulario de pago (método ED u OTROS)
  // pero antes no se incluían en el payload: se perdían silenciosamente y
  // nunca quedaban guardadas en la factura.
  const observaciones =
    document.getElementById("observacionesOTROS")?.value.trim() ||
    document.getElementById("observacionesED")?.value.trim() ||
    "";

  const facturaData = {
    id_factura: "FAC-" + Date.now().toString().slice(-8),
    nombre: document.getElementById("nameClient")?.value.trim() || "Consumidor Final",
    apellido: document.getElementById("secondNameClient")?.value.trim() || "",
    cedula: document.getElementById("documentID")?.value.trim() || "V-00000000",
    telefono: document.getElementById("numberPhone")?.value.trim().replace(/\D/g, '').replace(/^0/, '+58') || "N/A",
    vendedor: localStorage.getItem("vendedorActual") || "Cajero General",

    subtotal_usd: state.montoFinalUSD + state.descUSD,
    descuento_usd: state.descUSD,
    total_usd: state.montoFinalUSD,

    subtotal_bs: state.montoFinalBS + state.descBS,
    descuento_bs: state.descBS,
    total_bs: state.montoFinalBS,

    metodo_pago: metodoSeleccionado || "OTROS",
    referencia: document.getElementById("pmRef")?.value || "N/A",
    banco: document.getElementById("bankSelect")?.value || "N/A",
    observaciones: observaciones || "N/A",

    // Comprobante de pago (imagen)
    comprobante_base64: comprobanteBase64,
    comprobante_nombre: comprobanteNombre,
    comprobante_tipo: comprobanteTipo,

    // Productos con estructura exacta que espera el backend
    productos: state.listaProductos.map(p => ({
      nombre: p.nombre,
      cantidad: p.cantidad,
      precioUnitario: p.precioUnitario,
      precioTotal: p.precioTotal
    }))
  };

  boton.disabled = true;
  mostrarModalCargando();

  try {
    const response = await fetch(BACKEND_API_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(facturaData)
    });

    // === CRÍTICO: Verificar si realmente es JSON ===
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const text = await response.text();
      console.error("Backend devolvió no-JSON:", text);
      throw new Error("El servidor no devolvió una respuesta JSON válida");
    }

    const resultado = await response.json();

    if (!response.ok || resultado.status === "error") {
      throw new Error(resultado.message || "Error desconocido del servidor");
    }

    mostrarModalExito();
    state.compraExitosa = true;
    state.listaProductos = [];
    actualizarTabla();

    setTimeout(() => {
      location.reload();
    }, 1800);

  } catch (error) {
    console.error("Error en finalizarCompra:", error);
    
    document.getElementById("statusModal").classList.remove("hidden");
    mostrarModalError(error.message);
  } finally {
    boton.disabled = false;
  }
}
