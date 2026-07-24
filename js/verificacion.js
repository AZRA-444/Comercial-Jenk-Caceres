// 1. Función principal que se dispara al hacer clic en el botón de búsqueda
async function buscarFactura() {
    const inputBusqueda = document.getElementById('inputBusqueda').value.trim();
    
    if (!inputBusqueda) {
        mostrarModalError("Por favor, ingresa un ID de factura o una cédula para buscar.");
        return;
    }

    mostrarCargando(true);

    try {
        // Hacemos la petición GET al endpoint de Python en Vercel 
        // (Asegúrate de que el nombre del archivo en la carpeta api/ coincida con esta ruta, ej: api/verificar.py)
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
            // Buscamos dentro de la lista de pendientes el ID o la cédula que escribió el usuario
            const facturas = json.data || [];
            const facturaEncontrada = facturas.find(f => 
                f.id_factura === inputBusqueda || f.cedula === inputBusqueda
            );

            if (!facturaEncontrada) {
                mostrarModalError("No se encontró ninguna factura pendiente con ese ID o cédula.");
                limpiarVistaVerificacion();
                return;
            }

            renderizarFacturaEncontrada(facturaEncontrada);
        } else {
            mostrarModalError("Error: " + json.message);
        }

    } catch (error) {
        mostrarCargando(false);
        mostrarModalError("Error de conexión al buscar la factura: " + error.message);
    }
}

// 2. Renderizar los datos en la interfaz
function renderizarFacturaEncontrada(factura) {
    const contenedorCliente = document.getElementById('infoFacturaContainer');
    contenedorCliente.style.display = 'block';
    contenedorCliente.innerHTML = `
        <p><strong>Cliente:</strong> ${factura.nombre || 'N/A'} ${factura.apellido || ''}</p>
        <p><strong>Cédula:</strong> ${factura.cedula || 'N/A'}</p>
        <p><strong>Teléfono:</strong> ${factura.telefono || 'N/A'}</p>
        <p><strong>ID Factura:</strong> ${factura.id_factura}</p>
        <p><strong>Estado:</strong> <span style="text-transform: uppercase; font-weight: 600; color: #e67e22;">${factura.estado}</span></p>
    `;

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
                <td>Bs ${Number(prod.precio_total).toFixed(2)}</td>
            `;
            tablaProductos.appendChild(tr);
        });
    }

    const contenedorTotales = document.getElementById('totalesVerificacion');
    contenedorTotales.innerHTML = `
        <div style="text-align: right;">
            <p><strong>Subtotal USD:</strong> $${Number(factura.subtotal_usd || 0).toFixed(2)}</p>
            <p><strong>Total USD:</strong> $${Number(factura.total_usd || 0).toFixed(2)}</p>
            <p><strong>Total Bs:</strong> Bs ${Number(factura.total_bs || 0).toFixed(2)}</p>
        </div>
    `;

    const contenedorAcciones = document.getElementById('accionesVerificacion');
    contenedorAcciones.innerHTML = `
        <button class="btn-primary" onclick="aprobarFactura('${factura.id_factura}')">
            <i class="fas fa-check-circle"></i> Aprobar / Verificar Pago
        </button>
    `;
}

// 3. Editar una factura temporal (petición PATCH al endpoint de Python)
async function actualizarFacturaTemporal(idFactura, datosModificados) {
    mostrarCargando(true);
    try {
        const payload = {
            id_factura: idFactura,
            ...datosModificados
        };

        const response = await fetch('/api/verificar', {
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

// 4. Aprobar factura cambiando su estado
async function aprobarFactura(idFactura) {
    await actualizarFacturaTemporal(idFactura, { estado: 'aprobado' });
}

function limpiarVistaVerificacion() {
    document.getElementById('infoFacturaContainer').style.display = 'none';
    document.getElementById('tablaVerificacionProductos').innerHTML = `<tr><td colspan="5" style="text-align: center; color: #888;">No hay factura seleccionada o cargada.</td></tr>`;
    document.getElementById('totalesVerificacion').innerHTML = '';
    document.getElementById('accionesVerificacion').innerHTML = '';
}

// Funciones de modales
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

// EXPONER FUNCIONES AL ÁMBITO GLOBAL (Soluciona el error ReferenceError)
window.buscarFactura = buscarFactura;
window.actualizarFacturaTemporal = actualizarFacturaTemporal;
window.aprobarFactura = aprobarFactura;
window.cerrarModalError = cerrarModalError;
