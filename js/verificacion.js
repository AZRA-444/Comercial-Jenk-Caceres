// Se ejecuta automáticamente al cargar la página de verificación
document.addEventListener('DOMContentLoaded', () => {
    cargarFacturasPendientes();
});

// 1. Carga y muestra automáticamente todas las facturas pendientes al entrar
async function cargarFacturasPendientes() {
    mostrarCargando(true);
    try {
        const response = await fetch('/api/gestion-temporales', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        const textoRespuesta = await response.text();
        let json;
        try {
            json = JSON.parse(textoRespuesta);
        } catch (e) {
            console.error("Respuesta no válida del servidor:", textoRespuesta);
            mostrarCargando(false);
            mostrarModalError("El servidor no devolvió un JSON válido.");
            return;
        }

        mostrarCargando(false);

        if (json.status === "success") {
            const facturas = json.data || [];
            renderizarListaPendientes(facturas);
        } else {
            mostrarModalError("Error al cargar facturas: " + json.message);
        }

    } catch (error) {
        mostrarCargando(false);
        mostrarModalError("Error de conexión al cargar las facturas: " + error.message);
    }
}

// 2. Renderiza la lista completa de facturas pendientes en la interfaz
function renderizarListaPendientes(facturas) {
    const contenedor = document.getElementById('infoFacturaContainer');
    
    if (!facturas || facturas.length === 0) {
        contenedor.style.display = 'block';
        contenedor.innerHTML = `<p style="text-align: center; color: #888; padding: 20px;">No hay facturas pendientes en este momento.</p>`;
        limpiarTablaProductos();
        return;
    }

    contenedor.style.display = 'block';
    
    // Generamos un selector o listado visual de las facturas pendientes encontradas
    let htmlLista = `
        <h3 style="margin-bottom: 10px; font-size: 16px; color: #333;">Facturas Pendientes (${facturas.length})</h3>
        <div style="display: flex; flex-direction: column; gap: 8px; max-height: 250px; overflow-y: auto;">
    `;

    facturas.forEach((factura, index) => {
        htmlLista += `
            <div style="padding: 10px; border: 1px solid #ddd; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; background: #f9f9f9;">
                <div>
                    <p style="margin: 0; font-weight: 600;">ID: ${factura.id_factura} - ${factura.nombre || 'Cliente'} ${factura.apellido || ''}</p>
                    <p style="margin: 0; font-size: 13px; color: #666;">Cédula: ${factura.cedula || 'N/A'} | Total: $${Number(factura.total_usd || 0).toFixed(2)}</p>
                </div>
                <button class="btn-primary" style="padding: 6px 12px; font-size: 13px;" onclick="seleccionarFacturaPendiente(${index})">
                    Ver Detalles
                </button>
            </div>
        `;
    });

    htmlLista += `</div>`;
    contenedor.innerHTML = htmlLista;

    // Guardamos temporalmente las facturas en una variable global del script para seleccionarlas rápido
    window._facturasPendientesCache = facturas;

    // Si hay al menos una, seleccionamos la primera por defecto automáticamente
    if (facturas.length > 0) {
        seleccionarFacturaPendiente(0);
    }
}

// 3. Muestra los detalles y productos de la factura seleccionada
function seleccionarFacturaPendiente(index) {
    const facturas = window._facturasPendientesCache || [];
    const factura = facturas[index];

    if (!factura) return;

    // Renderizar productos de esta factura en la tabla
    const tablaProductos = document.getElementById('tablaVerificacionProductos');
    tablaProductos.innerHTML = '';

    const detalles = factura.detalles_factura_temporal || [];

    if (detalles.length === 0) {
        tablaProductos.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #888;">Esta factura no registra productos.</td></tr>`;
    } else {
        detalles.forEach(prod => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${prod.cantidad}</td>
                <td>${prod.nombre_producto}</td>
                <td>$${Number(prod.precio_unitario).toFixed(2)}</td>
                <td>$${Number(prod.precio_total).toFixed(2)}</td>
                <td>Bs ${Number(prod.precio_total * (factura.tasa_cambio || 1)).toFixed(2)}</td>
            `;
            tablaProductos.appendChild(tr);
        });
    }

    // Renderizar totales
    const contenedorTotales = document.getElementById('totalesVerificacion');
    contenedorTotales.innerHTML = `
        <div style="text-align: right;">
            <p><strong>Subtotal USD:</strong> $${Number(factura.subtotal_usd || 0).toFixed(2)}</p>
            <p><strong>Total USD:</strong> $${Number(factura.total_usd || 0).toFixed(2)}</p>
            <p><strong>Total Bs:</strong> Bs ${Number(factura.total_bs || 0).toFixed(2)}</p>
        </div>
    `;

    // Botón de acción para aprobar
    const contenedorAcciones = document.getElementById('accionesVerificacion');
    contenedorAcciones.innerHTML = `
        <button class="btn-primary" onclick="aprobarFactura('${factura.id_factura}')">
            <i class="fas fa-check-circle"></i> Aprobar / Verificar Pago (ID: ${factura.id_factura})
        </button>
    `;
}

// 4. Actualizar factura temporal (PATCH al endpoint Python)
async function actualizarFacturaTemporal(idFactura, datosModificados) {
    mostrarCargando(true);
    try {
        const payload = {
            id_factura: idFactura,
            ...datosModificados
        };

        const response = await fetch('/api/gestion-temporales', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const textoRespuesta = await response.text();
        let json;
        try {
            json = JSON.parse(textoRespuesta);
        } catch (e) {
            console.error("Respuesta no válida del servidor:", textoRespuesta);
            mostrarCargando(false);
            mostrarModalError("Error crítico al procesar la actualización.");
            return;
        }

        mostrarCargando(false);

        if (json.status === "success") {
            mostrarModalExito("¡Factura temporal actualizada correctamente!");
            setTimeout(() => location.reload(), 1500);
        } else {
            mostrarModalError("No se pudo actualizar: " + json.message);
        }
    } catch (error) {
        mostrarCargando(false);
        mostrarModalError("Error de conexión al actualizar: " + error.message);
    }
}

// 5. Aprobar factura cambiando su estado
async function aprobarFactura(idFactura) {
    await actualizarFacturaTemporal(idFactura, { estado: 'aprobado' });
}

function limpiarTablaProductos() {
    document.getElementById('tablaVerificacionProductos').innerHTML = `<tr><td colspan="5" style="text-align: center; color: #888;">No hay productos para mostrar.</td></tr>`;
    document.getElementById('totalesVerificacion').innerHTML = '';
    document.getElementById('accionesVerificacion').innerHTML = '';
}

// Funciones auxiliares de modales
function mostrarCargando(mostrar) {
    const modal = document.getElementById('statusModal');
    const loading = document.getElementById('modalLoading');
    const success = document.getElementById('modalSuccess');
    const error = document.getElementById('modalError');

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
    document.getElementById('modalSuccessMessage').innerText = mensaje;
    modal.classList.remove('hidden');
}

function mostrarModalError(mensaje) {
    const modal = document.getElementById('statusModal');
    document.getElementById('modalLoading').classList.add('hidden');
    document.getElementById('modalSuccess').classList.add('hidden');
    document.getElementById('modalError').classList.remove('hidden');
    document.getElementById('modalErrorMessage').innerText = mensaje;
    modal.classList.remove('hidden');
}

function cerrarModalError() {
    document.getElementById('statusModal').classList.add('hidden');
}

// EXPONER FUNCIONES AL ÁMBITO GLOBAL
window.seleccionarFacturaPendiente = seleccionarFacturaPendiente;
window.aprobarFactura = aprobarFactura;
window.cerrarModalError = cerrarModalError;
