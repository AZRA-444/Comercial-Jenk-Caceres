async function buscarFactura() {
    const inputBusqueda = document.getElementById('inputBusqueda').value.trim();
    
    if (!inputBusqueda) {
        mostrarModalError("Por favor, ingresa un ID de factura o una cédula para buscar.");
        return;
    }

    mostrarCargando(true);

    try {
        // Hacemos la consulta a Supabase (buscando en la tabla de facturas temporales o historial)
        const { data, error } = await supabaseClient
            .from('facturas_temporales') // Ajusta el nombre de la tabla si es tu historial general
            .select(`
                *,
                detalles_factura_temporal (*)
            `)
            .or(`id_factura.eq.${inputBusqueda},cedula.eq.${inputBusqueda}`)
            .maybeSingle();

        mostrarCargando(false);

        if (error) {
            console.error("Error en Supabase:", error);
            mostrarModalError("Error al consultar la base de datos.");
            return;
        }

        if (!data) {
            mostrarModalError("No se encontró ninguna factura con ese ID o cédula.");
            limpiarVistaVerificacion();
            return;
        }

        renderizarFacturaEncontrada(data);

    } catch (err) {
        mostrarCargando(false);
        console.error("Error de conexión:", err);
        mostrarModalError("Ocurrió un error de conexión al buscar la factura.");
    }
}

function renderizarFacturaEncontrada(factura) {
    // 1. Mostrar datos generales del cliente en el resumen superior
    const contenedorCliente = document.getElementById('infoFacturaContainer');
    contenedorCliente.style.display = 'block';
    contenedorCliente.innerHTML = `
        <p><strong>Cliente:</strong> ${factura.nombre || 'N/A'} ${factura.apellido || ''}</p>
        <p><strong>Cédula:</strong> ${factura.cedula || 'N/A'}</p>
        <p><strong>Teléfono:</strong> ${factura.telefono || 'N/A'}</p>
        <p><strong>ID Factura:</strong> ${factura.id_factura}</p>
        <p><strong>Estado:</strong> <span style="text-transform: uppercase; font-weight: 600; color: ${factura.estado === 'pendiente' ? '#e67e22' : '#27ae60'};">${factura.estado}</span></p>
    `;

    // 2. Renderizar los productos en la tabla
    const tablaProductos = document.getElementById('tablaVerificacionProductos');
    tablaProductos.innerHTML = '';

    const detalles = factura.detalles_factura_temporal || factura.detalles || [];

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

    // 3. Renderizar totales
    const contenedorTotales = document.getElementById('totalesVerificacion');
    contenedorTotales.innerHTML = `
        <div style="text-align: right;">
            <p><strong>Subtotal USD:</strong> $${Number(factura.subtotal_usd || 0).toFixed(2)}</p>
            <p><strong>Total USD:</strong> $${Number(factura.total_usd || 0).toFixed(2)}</p>
            <p><strong>Total Bs:</strong> Bs ${Number(factura.total_bs || 0).toFixed(2)}</p>
        </div>
    `;

    // 4. Gestionar botones de acción y permisos de edición
    const contenedorAcciones = document.getElementById('accionesVerificacion');
    
    // Aquí validamos si el usuario actual tiene permisos para editar (puedes enlazarlo con tu lógica de sesión o roles)
    const tienePermisoEdicion = true; // Cambiar según tu lógica de roles de administrador/cajero

    contenedorAcciones.innerHTML = '';

    if (tienePermisoEdicion && factura.estado === 'pendiente') {
        const btnEditar = document.createElement('button');
        btnEditar.className = 'btn-secondary';
        btnEditar.innerHTML = `<i class="fas fa-edit"></i> Editar Factura`;
        btnEditar.onclick = () => habilitarEdicionFactura(factura.id_factura);
        contenedorAcciones.appendChild(btnEditar);
    }

    const btnAprobar = document.createElement('button');
    btnAprobar.className = 'btn-primary';
    btnAprobar.innerHTML = `<i class="fas fa-check-circle"></i> Aprobar / Verificar Pago`;
    btnAprobar.onclick = () => aprobarFactura(factura.id_factura);
    contenedorAcciones.appendChild(btnAprobar);
}

function habilitarEdicionFactura(idFactura) {
    // Redirige de vuelta al módulo de facturación cargando los datos para editar, 
    // o habilita los campos según tu flujo de trabajo actual.
    localStorage.setItem('editar_id_factura', idFactura);
    window.location.href = 'facturacion.html?modo=editar';
}

async function aprobarFactura(idFactura) {
    mostrarCargando(true);
    try {
        const { error } = await supabaseClient
            .from('facturas_temporales')
            .update({ estado: 'aprobado' })
            .eq('id_factura', idFactura);

        mostrarCargando(false);

        if (error) {
            mostrarModalError("No se pudo aprobar la factura: " + error.message);
            return;
        }

        mostrarModalExito("¡Factura verificada y aprobada con éxito!");
        setTimeout(() => location.reload(), 1500);

    } catch (err) {
        mostrarCargando(false);
        mostrarModalError("Error inesperado al aprobar la factura.");
    }
}

function limpiarVistaVerificacion() {
    document.getElementById('infoFacturaContainer').style.display = 'none';
    document.getElementById('tablaVerificacionProductos').innerHTML = `<tr><td colspan="5" style="text-align: center; color: #888;">No hay factura seleccionada o cargada.</td></tr>`;
    document.getElementById('totalesVerificacion').innerHTML = '';
    document.getElementById('accionesVerificacion').innerHTML = '';
}

// Funciones auxiliares para el manejo de modales idénticas a utils.js
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
