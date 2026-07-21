// BFMIDI DEMO — controladora virtual persistida no navegador.
// Mantém o mesmo contrato de API usado pelo editor, mas nunca acessa WiFi,
// Web Serial ou uma BFMIDI física.

export const DEMO_MODE = true;
export const URL_API = null;
export const WIFI_BLOCKED = true;
export const SERVED_BY_DEVICE = false;
export const USB_HIDDEN = true;

const DEMO_ORIGIN = 'https://bfmidi.demo.local';
const STORAGE_KEY = 'bfmidi_demo_memory_v1';
const BANK_LETTERS = 'ABCDEFGHIJ';
const PRESET_NAMES = ['CLEAN AMBIENT', 'CRUNCH', 'LEAD', 'MODULATION', 'DELAY', 'SOLO'];

const LED_RGB = [
  [255, 48, 48], [34, 204, 68], [58, 109, 255], [255, 204, 32],
  [154, 43, 217], [34, 212, 212], [245, 245, 255], [255, 122, 26],
  [255, 58, 146], [255, 90, 58], [26, 163, 255], [184, 53, 255],
  [255, 137, 204], [58, 255, 122], [58, 58, 62],
];

function defaultPreset(tag) {
  const number = Math.max(1, Number(tag.slice(1)) || 1);
  const name = PRESET_NAMES[(number - 1) % PRESET_NAMES.length];
  return {
    data: '',
    meta: {
      name,
      name_raw: name,
      midi_bank: '0',
      channel: '1',
      name_color: '4',
      name_border_color: '0',
      bg_color: String(33 + ((number - 1) % 4)),
      back_layers_color: '0',
      tag_color: '4',
      font_size: '18',
      font_bold: '1',
      name_x: '50',
      name_y: '50',
      layer2: '0',
      ext_indic_enabled: '1',
      extra_pcs: '',
      extra_ccs: '',
      sw_modes: '1,1,1,8,9,10',
      sw_modes_l2: '0,0,0,0,0,0',
    },
  };
}

function createMemory() {
  const presets = {};
  for (const letter of BANK_LETTERS) {
    for (let preset = 1; preset <= 6; preset++) {
      const tag = `${letter}${preset}`;
      presets[tag] = defaultPreset(tag);
    }
  }
  return {
    version: 1,
    config: {
      board: 'BFMIDI-3 7S',
      led_brightness: '184',
      led_color_mode: '0',
      letter_led_colors: [7, 2, 1, 8, 5, 10, 11, 12, 13, 3],
      switch_led_colors: [7, 2, 1, 8, 5, 10],
      bank_letter_enabled: Array(10).fill(1),
      colors: LED_RGB,
    },
    current: {
      bank_letter_index: 0,
      preset_number: 1,
      switch_mode: 0,
      live_layer: 1,
      sw_live_on: Array(6).fill(0),
      sw_live_on2: Array(6).fill(0),
      sw_live_on3: Array(6).fill(0),
      sw_momentary_count: Array(6).fill(0),
      sw_single_count: Array(6).fill(0),
      sw_tap_count: Array(6).fill(0),
      sw_spin_state: Array(6).fill(-1),
      last_single_sw: 0,
    },
    presets,
    swParams: {},
    media: { img: {}, icon: {} },
  };
}

function loadMemory() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.version === 1) {
      saved.config ||= {};
      saved.current ||= createMemory().current;
      saved.presets ||= {};
      saved.swParams ||= {};
      saved.media ||= { img: {}, icon: {} };
      saved.media.img ||= {};
      saved.media.icon ||= {};
      return saved;
    }
  } catch {}
  return createMemory();
}

let memory = loadMemory();

function saveMemory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch (error) {
    console.warn('[BFMIDI DEMO] Não foi possível salvar a memória local.', error);
  }
  window.dispatchEvent(new CustomEvent('bfmidi-demo-memory', { detail: getDemoSnapshot() }));
}

export function getDemoSnapshot() {
  return JSON.parse(JSON.stringify(memory));
}

export function resetDemoMemory() {
  memory = createMemory();
  saveMemory();
}

export function subscribeDemoMemory(listener) {
  const handler = (event) => listener(event.detail);
  window.addEventListener('bfmidi-demo-memory', handler);
  return () => window.removeEventListener('bfmidi-demo-memory', handler);
}

export function normalizeApiBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function isLocalPreviewHost() { return true; }
export function isValidLanIp() { return false; }

// Valor propositalmente não vazio: componentes antigos entendem que há um
// transporte disponível e carregam normalmente os dados da controladora virtual.
export let DEVICE_API = DEMO_ORIGIN;
export function apiUrl(path) { return DEMO_ORIGIN + path; }
export function setDeviceApi() { DEVICE_API = DEMO_ORIGIN; }
export function clearDeviceApi() { DEVICE_API = DEMO_ORIGIN; }

let heavyOps = 0;
export function getHeavyOpsInFlight() { return heavyOps; }
export function heavyOpEnter() { heavyOps++; }
export function heavyOpLeave() { heavyOps = Math.max(0, heavyOps - 1); }

export const _transport = { usbSend: null, usbConnected: false };

function currentTag() {
  const letter = BANK_LETTERS[memory.current.bank_letter_index] || 'A';
  return `${letter}${memory.current.preset_number || 1}`;
}

function ensurePreset(tag) {
  const safe = /^[A-J][1-6]$/.test(tag || '') ? tag : 'A1';
  memory.presets[safe] ||= defaultPreset(safe);
  return memory.presets[safe];
}

function boardCapabilities(board) {
  const name = String(board || '');
  return {
    // Sem filtro de chip na DEMO: o catálogo deve permitir experimentar
    // todos os modelos, inclusive a variante ESP32-S3.
    chip: '',
    has_micro: name.includes('MICRO') ? 1 : 0,
    has_exp: name.startsWith('BFMIDI-3') ? 1 : 0,
    has_ext_dual: name.includes('+') ? 1 : 0,
  };
}

function configResponse() {
  return { ...memory.config, ...boardCapabilities(memory.config.board) };
}

function formObject(body) {
  if (!body) return {};
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return Object.fromEntries(body.entries());
  }
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch {}
    return Object.fromEntries(new URLSearchParams(body).entries());
  }
  return typeof body === 'object' ? { ...body } : {};
}

function applyConfig(body) {
  const incoming = formObject(body);
  const next = { ...memory.config, ...incoming };
  next.letter_led_colors = Array.from({ length: 10 }, (_, index) =>
    Number(incoming[`letter_led_${index}`] ?? next.letter_led_colors?.[index] ?? 7));
  next.switch_led_colors = Array.from({ length: 6 }, (_, index) =>
    Number(incoming[`switch_led_${index}`] ?? next.switch_led_colors?.[index] ?? 7));
  next.bank_letter_enabled = Array.from({ length: 10 }, (_, index) =>
    Number(incoming[`bank_letter_enabled_${index}`] ?? next.bank_letter_enabled?.[index] ?? 1));
  next.colors = Array.from({ length: 15 }, (_, index) => {
    const raw = incoming[`color_${index}`];
    if (!raw) return next.colors?.[index] || LED_RGB[index];
    return String(raw).split(',').map((value) => Number(value) || 0).slice(0, 3);
  });
  for (const key of Object.keys(next)) {
    if (/^(letter_led_|switch_led_|bank_letter_enabled_|color_)\d+$/.test(key)) delete next[key];
  }
  memory.config = next;
  saveMemory();
  return configResponse();
}

function bankResponse() {
  const preset = ensurePreset(currentTag());
  return {
    ...memory.current,
    tag: currentTag(),
    data: preset.data || '',
    meta: { ...preset.meta },
  };
}

function bankLiveResponse() {
  const full = bankResponse();
  const { meta, data, ...live } = full;
  return live;
}

function updatePreset(tag, body) {
  const preset = ensurePreset(tag);
  const incoming = formObject(body);
  for (const [key, value] of Object.entries(incoming)) {
    if (/^sw[1-6](L2)?\./.test(key)) {
      memory.swParams[tag] ||= {};
      memory.swParams[tag][key] = String(value);
    } else {
      preset.meta[key] = String(value);
    }
  }
  if (Object.hasOwn(incoming, 'name')) {
    preset.meta.name = String(incoming.name);
    preset.meta.name_raw = String(incoming.name);
  }
  saveMemory();
  return { tag, data: preset.data || '', meta: { ...preset.meta } };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(data, mime) {
  const binary = atob(data || '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

async function mediaRoute(method, url, body) {
  const match = url.pathname.match(/^\/(img|icon)(?:\/(\d+)\.(jpg|png)|\/(list|read|upload|delete))$/);
  if (!match) return null;
  const kind = match[1];
  const slotFromPath = match[2];
  const action = match[4] || 'file';
  const slot = Number(slotFromPath ?? url.searchParams.get('slot'));
  const store = memory.media[kind];
  const count = kind === 'img' ? 15 : 10;
  const mime = kind === 'img' ? 'image/jpeg' : 'image/png';

  if (method === 'GET' && action === 'list') {
    const slots = Array.from({ length: count }, (_, index) => ({
      exists: !!store[index], size: store[index]?.size || 0,
    }));
    return { count, max_per: kind === 'img' ? 51200 : 30720,
      max_total: kind === 'img' ? 327680 : 174080,
      total: slots.reduce((sum, item) => sum + item.size, 0), slots };
  }
  if (method === 'GET' && action === 'read') return { data: store[slot]?.data || '' };
  if (method === 'GET' && action === 'file') {
    if (!store[slot]) return new Response('', { status: 404 });
    return new Response(base64ToBlob(store[slot].data, store[slot].mime || mime),
      { status: 200, headers: { 'Content-Type': store[slot].mime || mime } });
  }
  if (method === 'POST' && action === 'upload') {
    let file = body;
    if (typeof FormData !== 'undefined' && body instanceof FormData) file = body.get('file');
    if (!(file instanceof Blob)) return { ok: false, error: 'arquivo inválido' };
    store[slot] = { data: await blobToBase64(file), size: file.size, mime: file.type || mime };
    saveMemory();
    return { ok: true, slot, size: file.size };
  }
  if (method === 'POST' && action === 'delete') {
    delete store[slot];
    saveMemory();
    return { ok: true };
  }
  return {};
}

async function route(method, path, body) {
  const url = new URL(path, DEMO_ORIGIN);
  const media = await mediaRoute(method, url, body);
  if (media !== null) return media;

  if (method === 'GET' && url.pathname === '/ping') return { ok: true, demo: true };
  if (url.pathname === '/config/global') {
    return method === 'GET' ? configResponse() : applyConfig(body);
  }
  if (url.pathname === '/bank/current') {
    if (method === 'POST') {
      const tag = url.searchParams.get('bank') || 'A1';
      if (/^[A-J][1-6]$/.test(tag)) {
        memory.current.bank_letter_index = BANK_LETTERS.indexOf(tag[0]);
        memory.current.preset_number = Number(tag[1]);
        saveMemory();
      }
    }
    return bankResponse();
  }
  if (method === 'GET' && url.pathname === '/bank/live') return bankLiveResponse();
  if (url.pathname === '/bank/preset' || url.pathname === '/bank/preset/batch') {
    const tag = url.searchParams.get('bank') || currentTag();
    if (method === 'GET') {
      const preset = ensurePreset(tag);
      return { tag, data: preset.data || '', meta: { ...preset.meta } };
    }
    return updatePreset(tag, body);
  }
  if (url.pathname === '/sw/params') {
    const tag = url.searchParams.get('bank') || currentTag();
    memory.swParams[tag] ||= {};
    if (method === 'POST') {
      const sw = Math.min(6, Math.max(1, Number(url.searchParams.get('sw')) || 1));
      const layer = Number(url.searchParams.get('layer')) === 2 ? 'L2' : '';
      const mode = url.searchParams.get('mode') || 'mute';
      memory.swParams[tag][`sw${sw}${layer}.${mode}`] = Object.entries(formObject(body))
        .map(([key, value]) => `${key}=${value}`).join('|');
      saveMemory();
    }
    return { bank: tag, sw_params: { ...memory.swParams[tag] } };
  }
  if (method === 'POST' && url.pathname === '/mode') {
    memory.current.switch_mode = Number(url.searchParams.get('value')) === 1 ? 1 : 0;
    saveMemory();
    return bankResponse();
  }
  if (method === 'POST' && url.pathname === '/live/layer') {
    memory.current.live_layer = Number(url.searchParams.get('value')) === 2 ? 2 : 1;
    saveMemory();
    return { ok: true, layer: memory.current.live_layer };
  }
  if (method === 'GET' && url.pathname === '/backup') {
    return { version: 3, presets: memory.presets, sw_params: memory.swParams, demo: true };
  }
  if (method === 'POST' && url.pathname === '/restore') {
    const incoming = formObject(body);
    if (incoming.presets && typeof incoming.presets === 'object') {
      memory.presets = { ...memory.presets, ...incoming.presets };
    }
    if (incoming.sw_params && typeof incoming.sw_params === 'object') {
      memory.swParams = { ...memory.swParams, ...incoming.sw_params };
    }
    saveMemory();
    return { ok: true, applied: Object.keys(incoming.presets || {}).length };
  }
  if (method === 'POST' && url.pathname.startsWith('/erase/')) {
    const target = url.pathname.slice('/erase/'.length);
    if (target === 'presets') {
      const fresh = createMemory();
      memory.presets = fresh.presets;
      memory.swParams = fresh.swParams;
      memory.current = fresh.current;
    } else if (target === 'global') {
      memory.config = createMemory().config;
    }
    saveMemory();
    return { ok: true };
  }
  if (method === 'GET' && url.pathname === '/storage') {
    const used = JSON.stringify(memory).length;
    return { total: 5 * 1024 * 1024, used, free: Math.max(0, 5 * 1024 * 1024 - used) };
  }
  if (method === 'GET' && url.pathname === '/wifi/status') {
    return { sta_connected: false, ap_active: false, demo: true };
  }
  if (method === 'GET' && url.pathname === '/wifi/scan') return { networks: [], demo: true };
  if (method === 'GET' && url.pathname === '/usb_host/status') {
    return { online: false, mode: 0, ble: false, demo: true };
  }
  if (method === 'GET' && url.pathname === '/exp/live') return { value: 0, percent: 0 };
  return { ok: true, demo: true };
}

function asResponse(result) {
  if (result instanceof Response) return result;
  const text = typeof result === 'string' ? result : JSON.stringify(result || {});
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(new Blob([text]).size) },
  });
}

export async function queuedFetch(url, init = {}) {
  const path = String(url).startsWith(DEMO_ORIGIN) ? String(url).slice(DEMO_ORIGIN.length) : String(url);
  return asResponse(await route(String(init.method || 'GET').toUpperCase(), path, init.body));
}

export async function apiCall(method, path, body) {
  return route(String(method || 'GET').toUpperCase(), path, body);
}

// Alguns fluxos antigos (backup) usam fetch diretamente. Interceptamos apenas
// o endereço virtual, preservando qualquer outro uso legítimo do navegador.
const nativeFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;
if (nativeFetch && !globalThis.__bfmidiDemoFetchInstalled) {
  globalThis.__bfmidiDemoFetchInstalled = true;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (String(url).startsWith(DEMO_ORIGIN)) return queuedFetch(url, init);
    return nativeFetch(input, init);
  };
}
