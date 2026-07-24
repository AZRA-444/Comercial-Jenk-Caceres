// 1. Consultar facturas pendientes (petición GET al endpoint de Python)
async function cargarFacturasPendientes() {
    mostrarCargando(true);
    try {
        const response = await fetch('/api/gestion-temporales', { // Ajusta la ruta si tu archivo se llama diferente en la carpeta api/
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        const textoRespuesta = await response.text();
        let json;
        try {
            json = JSON.parse(textoRespuesta);
        } catch (e) {
            console.error("Respuesta no válida del servidor:", textoRespuesta);
            mostrarModalError("El servidor no devolvió un JSON válido.");
            return;
        }

        mostrarCargando(false);

        if (json.status === "success") {
            // json.data contiene el arreglo de facturas pendientes con sus detalles
            return json.data;
        } else {
            mostrarModalError("Error: " + json.message);
        }
    } catch (error) {
        mostrarCargando(false);
        mostrarModalError("Error de conexión al cargar las facturas: " + error.message);
    }
}

// 2. Editar una factura temporal (petición PATCH/POST al endpoint de Python)
async function actualizarFacturaTemporal(idFactura, datosModificados) {
    mostrarCargando(true);
    try {
        // Aseguramos que el id_factura vaya dentro del cuerpo que espera el script Python
        const payload = {
            id_factura: idFactura,
            ...datosModificados
        };

        const response = await fetch('/api/verificar', { // Misma ruta del endpoint
            method: 'PATCH', // O 'POST' según prefieras usar
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const textoRespuesta = await response.text();
        let json;
        try {
            json = JSON.parse(textoRespuesta);
        } catch (e) {
            console.error("Respuesta no válida del servidor:", textoRespuesta);
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
