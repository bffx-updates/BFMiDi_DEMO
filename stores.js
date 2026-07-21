// ─── Stores de mídia (back-images + ícones de upload) ────────────────
// ImageStore (/img/*) e IconStore (/icon/*): caches globais dos slots de
// arquivo em LittleFS, com listeners pra re-render. Extraido de app.jsx no
// split incremental (ver CLAUDE.md). Depende só de ./api.js (folha) + hooks.
//
// DOIS transportes: por WiFi vai HTTP direto (apiUrl/queuedFetch, multipart);
// por USB (Web Serial) o firmware expõe /img/* e /icon/* no USB_CONTROL.h —
// upload CHUNKED (base64 cru no body, seq/fin) e read base64 numa linha. Cada
// função abaixo ramifica em _transport.usbConnected.

import { apiUrl, queuedFetch, apiCall, _transport } from './api.js';

const { useState, useEffect } = React;

// ─── Helpers de mídia por USB (base64 chunked) ───────────────────────
// Chunk de upload: 1350 bytes crus -> 1800 chars base64. Com o overhead
// "POST /icon/upload?slot=NN&seq=NNN&fin=N " (~41) cabe folgado na linha de
// request de 2048 B do USB_CONTROL.h. Múltiplo de 3 pra não gerar padding
// intermediário ao concatenar no firmware.
const USB_MEDIA_CHUNK = 1350;

// Uint8Array -> base64 (alfabeto padrão +/=). Em pedaços porque
// fromCharCode.apply estoura a pilha em arrays grandes.
function bytesToBase64(bytes) {
  let bin = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}

// Upload chunked de um Blob pra /<kind>/upload por USB. kind = 'img' | 'icon'.
// Manda seq=0..N com fin=1 no último; arquivo vazio = um único chunk vazio.
async function mediaUploadUsb(kind, slot, blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const total = bytes.length;
  let seq = 0;
  let off = 0;
  do {
    const end = Math.min(off + USB_MEDIA_CHUNK, total);
    const b64 = bytesToBase64(bytes.subarray(off, end));
    const fin = end >= total ? 1 : 0;
    // body = base64 cru; apiCall roteia pra USB (apiCallUsb monta a linha).
    await apiCall('POST', `/${kind}/upload?slot=${slot}&seq=${seq}&fin=${fin}`, b64);
    off = end;
    seq++;
  } while (off < total);
}

// Read base64 de um slot por USB -> string base64 (sem prefixo data:).
async function mediaReadBase64Usb(kind, slot) {
  const j = await apiCall('GET', `/${kind}/read?slot=${slot}`);
  return j && typeof j.data === 'string' ? j.data : '';
}

// base64 (sem prefixo) -> Blob do mime dado. Usado nos previews por USB.
function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// GET /<kind>/list por USB ou HTTP. Devolve o JSON parseado.
async function mediaListJson(kind) {
  if (_transport.usbConnected) return apiCall('GET', `/${kind}/list`);
  const r = await queuedFetch(apiUrl(`/${kind}/list`), { method: 'GET' }, 8000);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// Contagem de slots de imagem (espelha DISPLAY_COLORS.h). Mora aqui porque o
// _imageStore inicializa com ela; app.jsx importa pra derivar IMAGE_SLOT_FIRST_ID.
export const IMAGE_SLOT_COUNT = 15;

// ─── ImageStore — cache global dos 10 slots de back-image ─────────────
//
// Espelha o estado dos arquivos /img/<N>.jpg em LittleFS (firmware:
// IMAGE_STORE.h, rotas: WEB_API_IMAGES.h). Cada slot guarda { exists, size,
// blobUrl, loadingBlob }. blobUrl e criado sob demanda via URL.createObjectURL
// e invalidado em upload/delete pra evitar leak. listeners notifica subscribers
// (paleta, card de Upload Images) quando algo muda.
export const _imageStore = {
  slots: Array.from({ length: IMAGE_SLOT_COUNT }, (_, i) => ({
    slot: i, exists: false, size: 0, blobUrl: null, loadingBlob: false,
  })),
  fetched: false,
  fetching: null,           // Promise em voo, evita corrida
  listeners: new Set(),
  meta: { count: IMAGE_SLOT_COUNT, maxPer: 50 * 1024, maxTotal: 320 * 1024, total: 0 },
};

function imageStoreNotify() {
  _imageStore.listeners.forEach((cb) => { try { cb(); } catch {} });
}

function imageStoreRevokeSlot(slot) {
  const s = _imageStore.slots[slot];
  if (s && s.blobUrl) {
    try { URL.revokeObjectURL(s.blobUrl); } catch {}
    s.blobUrl = null;
  }
}

export async function imageStoreFetchList(force = false) {
  if (!force && _imageStore.fetched && !_imageStore.fetching) {
    return _imageStore;
  }
  if (_imageStore.fetching) return _imageStore.fetching;
  _imageStore.fetching = (async () => {
    try {
      const j = await mediaListJson('img');
      const slots = Array.isArray(j.slots) ? j.slots : [];
      for (let i = 0; i < _imageStore.slots.length; i++) {
        const next = slots[i] || { exists: false, size: 0 };
        const cur = _imageStore.slots[i];
        // Invalida blob se sumiu ou se mudou de tamanho (substituiu).
        if (cur.blobUrl && (!next.exists || next.size !== cur.size)) {
          imageStoreRevokeSlot(i);
        }
        cur.exists = !!next.exists;
        cur.size = Number(next.size) || 0;
      }
      _imageStore.meta.count = Number(j.count) || IMAGE_SLOT_COUNT;
      _imageStore.meta.maxPer = Number(j.max_per) || 50 * 1024;
      _imageStore.meta.maxTotal = Number(j.max_total) || 320 * 1024;
      _imageStore.meta.total = Number(j.total) || 0;
      _imageStore.fetched = true;
      imageStoreNotify();
      return _imageStore;
    } finally {
      _imageStore.fetching = null;
    }
  })();
  return _imageStore.fetching;
}

// Carrega o JPEG do slot e devolve um blob URL cacheado. null se slot vazio.
export async function imageStoreLoadBlob(slot) {
  const s = _imageStore.slots[slot];
  if (!s || !s.exists) return null;
  if (s.blobUrl) return s.blobUrl;
  if (s.loadingBlob) return null;  // re-render quando concluir via listener
  s.loadingBlob = true;
  try {
    let blob;
    if (_transport.usbConnected) {
      const b64 = await mediaReadBase64Usb('img', slot);
      if (!b64) { s.exists = false; imageStoreNotify(); return null; }
      blob = base64ToBlob(b64, 'image/jpeg');
    } else {
      // cache-bust pelo tamanho — se substituiu, ?v= muda e o SW nao serve o velho.
      const r = await queuedFetch(apiUrl(`/img/${slot}.jpg?v=${s.size}`),
                                  { method: 'GET' }, 8000);
      if (!r.ok) { s.exists = false; imageStoreNotify(); return null; }
      blob = await r.blob();
    }
    s.blobUrl = URL.createObjectURL(blob);
    imageStoreNotify();
    return s.blobUrl;
  } catch {
    return null;
  } finally {
    s.loadingBlob = false;
  }
}

export async function imageStoreUpload(slot, jpegBlob) {
  if (_transport.usbConnected) {
    await mediaUploadUsb('img', slot, jpegBlob);  // chunked base64
  } else {
    // POST multipart pra rota /img/upload?slot=N.
    const fd = new FormData();
    fd.append('file', jpegBlob, `slot-${slot}.jpg`);
    const r = await queuedFetch(apiUrl(`/img/upload?slot=${slot}`),
                                { method: 'POST', body: fd }, 30000);
    if (!r.ok) {
      const text = await r.text();
      throw new Error('upload falhou: HTTP ' + r.status + ' ' + text);
    }
  }
  imageStoreRevokeSlot(slot);
  await imageStoreFetchList(true);
}

export async function imageStoreDelete(slot) {
  if (_transport.usbConnected) {
    await apiCall('POST', `/img/delete?slot=${slot}`);
  } else {
    const r = await queuedFetch(apiUrl(`/img/delete?slot=${slot}`),
                                { method: 'POST' }, 8000);
    if (!r.ok) throw new Error('delete falhou: HTTP ' + r.status);
  }
  imageStoreRevokeSlot(slot);
  await imageStoreFetchList(true);
}

// Le o JPEG do slot e devolve base64 (sem prefixo data:). Usado pelo backup
// que embute imagens. Por USB usa /img/read (já vem base64); por HTTP baixa o
// binário. ?v=size faz cache-bust igual imageStoreLoadBlob.
export async function imageStoreFetchBase64(slot, size) {
  if (_transport.usbConnected) {
    return mediaReadBase64Usb('img', slot);
  }
  const r = await queuedFetch(apiUrl(`/img/${slot}.jpg?v=${size}`),
                              { method: 'GET' }, 15000);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  // btoa em pedacos: fromCharCode.apply estoura a pilha em arquivos grandes.
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// Converte base64 (sem prefixo) num Blob image/jpeg pra reupload no restore
// via imageStoreUpload → POST /img/upload.
export function base64ToJpegBlob(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

// Idem pra PNG (icones de upload) — usado no restore via iconStoreUpload.
export function base64ToPngBlob(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

// Hook React: forca re-render quando o store notifica. Devolve o store.
export function useImageStore() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const cb = () => setTick((v) => v + 1);
    _imageStore.listeners.add(cb);
    // Primeira carga lazy. Se ja carregou, no-op.
    if (!_imageStore.fetched && !_imageStore.fetching) {
      imageStoreFetchList().catch(() => {});
    }
    return () => { _imageStore.listeners.delete(cb); };
  }, []);
  return _imageStore;
}

// Helper pro ColorBar/paletteBackground: retorna o blobUrl do slot SE ja
// estiver no cache, OU dispara o load assincrono (proxima render mostra).
export function imageStoreBlobOrLoad(slot) {
  const s = _imageStore.slots[slot];
  if (!s || !s.exists) return null;
  if (s.blobUrl) return s.blobUrl;
  if (!s.loadingBlob) imageStoreLoadBlob(slot).catch(() => {});
  return null;
}

// ─── Icon store (slots de ICONE de upload, PNG com alpha) ────────────
// Espelha o image store, mas pra /icon/* (PNG). Os slots de upload complementam
// os icones COMPILADOS (build_icons.py): sao subidos pelo editor sem recompilar.
// Base de id FIXA (espelha ICON_STORE.h) — NAO depende da contagem de compilados.
//   compilado : icon_id 1..SW_ICON_COUNT
//   upload    : icon_id ICON_UPLOAD_FIRST_ID .. +ICON_UPLOAD_SLOT_COUNT-1
export const ICON_UPLOAD_FIRST_ID = 200;
export const ICON_UPLOAD_SLOT_COUNT = 10;
export const isUploadIcon = (id) => {
  const n = id | 0;
  return n >= ICON_UPLOAD_FIRST_ID && n < ICON_UPLOAD_FIRST_ID + ICON_UPLOAD_SLOT_COUNT;
};
export const iconUploadSlotOfId = (id) => isUploadIcon(id) ? ((id | 0) - ICON_UPLOAD_FIRST_ID) : -1;
export const iconUploadIdOfSlot = (slot) => ICON_UPLOAD_FIRST_ID + slot;

export const _iconStore = {
  slots: Array.from({ length: ICON_UPLOAD_SLOT_COUNT }, (_, i) => ({
    slot: i, exists: false, size: 0, blobUrl: null, loadingBlob: false,
  })),
  fetched: false,
  fetching: null,
  listeners: new Set(),
  meta: { count: ICON_UPLOAD_SLOT_COUNT, maxPer: 30 * 1024, maxTotal: 170 * 1024, total: 0 },
};

function iconStoreNotify() {
  _iconStore.listeners.forEach((cb) => { try { cb(); } catch {} });
}

function iconStoreRevokeSlot(slot) {
  const s = _iconStore.slots[slot];
  if (s && s.blobUrl) {
    try { URL.revokeObjectURL(s.blobUrl); } catch {}
    s.blobUrl = null;
  }
}

export async function iconStoreFetchList(force = false) {
  if (!force && _iconStore.fetched && !_iconStore.fetching) return _iconStore;
  if (_iconStore.fetching) return _iconStore.fetching;
  _iconStore.fetching = (async () => {
    try {
      const j = await mediaListJson('icon');
      const slots = Array.isArray(j.slots) ? j.slots : [];
      for (let i = 0; i < _iconStore.slots.length; i++) {
        const next = slots[i] || { exists: false, size: 0 };
        const cur = _iconStore.slots[i];
        if (cur.blobUrl && (!next.exists || next.size !== cur.size)) {
          iconStoreRevokeSlot(i);
        }
        cur.exists = !!next.exists;
        cur.size = Number(next.size) || 0;
      }
      _iconStore.meta.count = Number(j.count) || ICON_UPLOAD_SLOT_COUNT;
      _iconStore.meta.maxPer = Number(j.max_per) || 30 * 1024;
      _iconStore.meta.maxTotal = Number(j.max_total) || 170 * 1024;
      _iconStore.meta.total = Number(j.total) || 0;
      _iconStore.fetched = true;
      iconStoreNotify();
      return _iconStore;
    } finally {
      _iconStore.fetching = null;
    }
  })();
  return _iconStore.fetching;
}

export async function iconStoreLoadBlob(slot) {
  const s = _iconStore.slots[slot];
  if (!s || !s.exists) return null;
  if (s.blobUrl) return s.blobUrl;
  if (s.loadingBlob) return null;
  s.loadingBlob = true;
  try {
    let blob;
    if (_transport.usbConnected) {
      const b64 = await mediaReadBase64Usb('icon', slot);
      if (!b64) { s.exists = false; iconStoreNotify(); return null; }
      blob = base64ToBlob(b64, 'image/png');
    } else {
      const r = await queuedFetch(apiUrl(`/icon/${slot}.png?v=${s.size}`),
                                  { method: 'GET' }, 8000);
      if (!r.ok) { s.exists = false; iconStoreNotify(); return null; }
      blob = await r.blob();
    }
    s.blobUrl = URL.createObjectURL(blob);
    iconStoreNotify();
    return s.blobUrl;
  } catch {
    return null;
  } finally {
    s.loadingBlob = false;
  }
}

export async function iconStoreUpload(slot, pngBlob) {
  if (_transport.usbConnected) {
    await mediaUploadUsb('icon', slot, pngBlob);  // chunked base64
  } else {
    const fd = new FormData();
    fd.append('file', pngBlob, `slot-${slot}.png`);
    const r = await queuedFetch(apiUrl(`/icon/upload?slot=${slot}`),
                                { method: 'POST', body: fd }, 30000);
    if (!r.ok) {
      const text = await r.text();
      throw new Error('upload falhou: HTTP ' + r.status + ' ' + text);
    }
  }
  iconStoreRevokeSlot(slot);
  await iconStoreFetchList(true);
}

export async function iconStoreDelete(slot) {
  if (_transport.usbConnected) {
    await apiCall('POST', `/icon/delete?slot=${slot}`);
  } else {
    const r = await queuedFetch(apiUrl(`/icon/delete?slot=${slot}`),
                                { method: 'POST' }, 8000);
    if (!r.ok) throw new Error('delete falhou: HTTP ' + r.status);
  }
  iconStoreRevokeSlot(slot);
  await iconStoreFetchList(true);
}

// Le o PNG do slot e devolve base64 (sem prefixo data:). Espelha
// imageStoreFetchBase64 — usado pelo backup que embute icones. Por USB usa
// /icon/read (já vem base64); por HTTP baixa o binário. ?v=size faz cache-bust.
export async function iconStoreFetchBase64(slot, size) {
  if (_transport.usbConnected) {
    return mediaReadBase64Usb('icon', slot);
  }
  const r = await queuedFetch(apiUrl(`/icon/${slot}.png?v=${size}`),
                              { method: 'GET' }, 15000);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function useIconStore() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const cb = () => setTick((v) => v + 1);
    _iconStore.listeners.add(cb);
    if (!_iconStore.fetched && !_iconStore.fetching) {
      iconStoreFetchList().catch(() => {});
    }
    return () => { _iconStore.listeners.delete(cb); };
  }, []);
  return _iconStore;
}

// Retorna o blobUrl do slot de upload se cacheado; senao dispara load (e fetch
// da lista se ainda nao veio). null enquanto carrega — re-render via listener.
export function iconStoreBlobOrLoad(slot) {
  if (!_iconStore.fetched && !_iconStore.fetching) iconStoreFetchList().catch(() => {});
  const s = _iconStore.slots[slot];
  if (!s || !s.exists) return null;
  if (s.blobUrl) return s.blobUrl;
  if (!s.loadingBlob) iconStoreLoadBlob(slot).catch(() => {});
  return null;
}
