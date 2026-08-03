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

const BACKEND_API_URL = "/api/precargar-factura";

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
    const secondName = document.getElementById("secondNameClient").value.trim();
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
  if (subTotalDescontableUSD > 100) porcentajeDescuento = 30;
  else if (subTotalDescontableUSD > 10) porcentajeDescuento = 20;

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
            <button class="process" onclick="finalizarCompra()" id="procesarCompra">Procesar Compra <i class="fas fa-receipt"></i> </button>
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
``;
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

function generarIdFactura() {
  const sufijoAleatorio =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 6)
      : Math.random().toString(36).slice(2, 8);

  return "FAC-" + Date.now().toString().slice(-8) + "-" + sufijoAleatorio;
}

async function finalizarCompra() {
  const boton = document.getElementById("procesarCompra");
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

  const facturaData = {
    id_factura: generarIdFactura(),
    nombre:
      document.getElementById("nameClient")?.value.trim() || "Consumidor Final",
    apellido: document.getElementById("secondNameClient")?.value.trim() || "",
    cedula: document.getElementById("documentID")?.value.trim() || "V-00000000",
    telefono:
      document
        .getElementById("numberPhone")
        ?.value.trim()
        .replace(/\D/g, "")
        .replace(/^0/, "+58") || "N/A",
    vendedor: localStorage.getItem("vendedorActual") || "Cajero General",

    tasa_cambio: state.tasaConver, // <--- NUEVO CAMPO ENVIADO AL BACKEND

    subtotal_usd: state.montoFinalUSD + state.descUSD,
    descuento_usd: state.descUSD,
    total_usd: state.montoFinalUSD,

    subtotal_bs: state.montoFinalBS + state.descBS,
    descuento_bs: state.descBS,
    total_bs: state.montoFinalBS,

    productos: state.listaProductos.map((p) => ({
      nombre: p.nombre,
      cantidad: p.cantidad,
      precioUnitario: p.precioUnitario,
      precioTotal: p.precioTotal,
    })),
  };
  boton.disabled = true;
  mostrarModalCargando();

  try {
    const response = await fetch(BACKEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(facturaData),
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
