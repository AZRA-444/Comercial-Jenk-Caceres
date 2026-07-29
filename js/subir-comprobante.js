// ---------------------------------------------------------------------------
// Página móvil abierta al escanear el QR desde el módulo de verificación.
// Sube el comprobante DIRECTO al bucket de Supabase Storage (sin pasar por
// el backend), a la ruta qr/{id_factura}-{token}.{ext}, para que la pantalla
// de verificación lo detecte por sondeo en tiempo real.
// ---------------------------------------------------------------------------

const BUCKET_COMPROBANTES = 'comprobantes';
const MAX_BYTES_COMPROBANTE = 5 * 1024 * 1024; // 5MB

let _scIdFactura = null;
let _scToken     = null;
let _scArchivo    = null; // File ya comprimido, listo para subir
let _scClient     = null;

function _scMostrarEstado(id) {
  ['scEstadoInvalido', 'scEstadoInicial', 'scEstadoSubiendo', 'scEstadoExito', 'scEstadoError']
    .forEach(estadoId => {
      document.getElementById(estadoId)?.classList.toggle('hidden', estadoId !== id);
    });
}

function _scLeerParametros() {
  const params = new URLSearchParams(window.location.search);
  return { id: params.get('id'), token: params.get('token') };
}

// Reutiliza la misma lógica de compresión que el módulo de verificación,
// para que el archivo que llega al bucket sea liviano y consistente.
function _scComprimirImagen(file, maxAncho = 1600, calidad = 0.75) {
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
        resolve(new File([blob], 'comprobante.jpg', { type: 'image/jpeg' }));
      }, 'image/jpeg', calidad);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

function _scGetClient() {
  if (_scClient) return _scClient;
  if (!window.supabase?.createClient) return null;
  _scClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _scClient;
}

async function _scManejarSeleccionArchivo(input) {
  const previewBox = document.getElementById('scPreviewBox');
  const btnSubir    = document.getElementById('scBtnSubir');

  if (!input.files?.[0]) return;
  let file = input.files[0];

  try {
    file = await _scComprimirImagen(file);
  } catch (err) {
    console.warn('Compresión fallida, usando original:', err);
  }

  if (file.size > MAX_BYTES_COMPROBANTE) {
    alert('La imagen no debe superar los 5 MB.');
    return;
  }

  _scArchivo = file;

  const reader = new FileReader();
  reader.onload = e => {
    previewBox.innerHTML = `<img src="${e.target.result}" alt="Vista previa del comprobante" />`;
    previewBox.classList.remove('hidden');
    btnSubir.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

async function _scSubirComprobante() {
  if (!_scArchivo || !_scIdFactura || !_scToken) return;

  // Verificación preventiva de variables globales
  if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined') {
    _scMostrarEstado('scEstadoError');
    document.getElementById('scErrorMensaje').textContent =
      'Error de configuración: No se encontraron las credenciales de Supabase.';
    return;
  }

  const client = _scGetClient();
  if (!client) {
    _scMostrarEstado('scEstadoError');
    document.getElementById('scErrorMensaje').textContent =
      'No se pudo conectar con el almacenamiento. Verifica tu conexión a internet.';
    return;
  }

  _scMostrarEstado('scEstadoSubiendo');

  const path = `qr/${_scIdFactura}-${_scToken}.jpg`;

  try {
    const { data, error } = await client.storage
      .from(BUCKET_COMPROBANTES)
      .upload(path, _scArchivo, { 
        contentType: 'image/jpeg', 
        upsert: true // Requiere políticas RLS de INSERT y UPDATE
      });

    if (error) {
      console.error('Error detallado de Supabase Storage:', error);
      _scMostrarEstado('scEstadoError');
      document.getElementById('scErrorMensaje').textContent =
        'No se pudo subir el comprobante: ' + (error.message || 'Error de permisos en el Storage.');
      return;
    }

    console.log('Comprobante subido con éxito:', data);
    _scMostrarEstado('scEstadoExito');
  } catch (err) {
    console.error('Excepción al subir comprobante:', err);
    _scMostrarEstado('scEstadoError');
    document.getElementById('scErrorMensaje').textContent =
      'Error de conexión: ' + err.message;
  }
}
document.addEventListener('DOMContentLoaded', () => {
  const { id, token } = _scLeerParametros();

  if (!id || !token) {
    _scMostrarEstado('scEstadoInvalido');
    return;
  }

  _scIdFactura = id;
  _scToken     = token;
  document.getElementById('scFacturaRef').textContent = `Factura ${id}`;

  _scMostrarEstado('scEstadoInicial');

  const inputFoto  = document.getElementById('scInputFoto');
  const btnFoto    = document.getElementById('scBtnTomarFoto');
  const btnSubir   = document.getElementById('scBtnSubir');
  const btnReintentar = document.getElementById('scBtnReintentar');

  btnFoto.addEventListener('click', () => inputFoto.click());
  inputFoto.addEventListener('change', () => _scManejarSeleccionArchivo(inputFoto));
  btnSubir.addEventListener('click', _scSubirComprobante);
  btnReintentar?.addEventListener('click', () => _scMostrarEstado('scEstadoInicial'));
});
