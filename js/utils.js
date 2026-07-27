// ============================================================
// UTILIDADES COMPARTIDAS
// ============================================================

/**
 * Escapa caracteres especiales de HTML para poder insertar de forma segura
 * datos dinámicos (que pueden venir de la base de datos o de otro usuario)
 * dentro de innerHTML. Sin esto, un nombre de producto, cliente o vendedor
 * que contenga HTML/JS quedaría almacenado y se ejecutaría en el navegador
 * de quien vea la factura o el panel de administración (XSS almacenado).
 *
 * Úsese SIEMPRE que se inserte un valor que no fue escrito por el propio
 * desarrollador directamente en una plantilla `innerHTML`.
 */
function escapeHtml(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Evita que caracteres especiales rompan un filtro de PostgREST o generen
// resultados inesperados al construir queries con datos que vienen de la URL.
function encodeQueryValue(valor) {
  return encodeURIComponent(valor ?? "");
}
