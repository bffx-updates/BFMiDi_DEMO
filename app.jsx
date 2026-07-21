// BFMIDI webApp — visual estilo iPhone, totalmente plugado nos endpoints do ESP32-S2.
// Mantém todo o estado/handlers do app.jsx anterior (loadGlobalConfig, saveGlobalConfig,
// selectBank, scan/connect/disconnect WiFi, loadBankCurrent, loadWifiStatus).
// Visual = referência "BFMIDI iPhone Live".

// Nomes especiais de PC/CC por pedal (gerado de LABELS_HTML.h por
// tools/extract_labels.mjs). esbuild faz o bundle deste import.
import { PC_LABELS, CC_LABELS } from './pedal_labels.js';
// Camada de API (transporte HTTP/USB + URL/IP) — extraida pra ./api.js no
// split incremental do app.jsx (ver CLAUDE.md / mapa do webApp).
import {
  DEVICE_API, apiUrl, setDeviceApi, apiCall, queuedFetch,
  _transport, normalizeApiBase, isLocalPreviewHost, getHeavyOpsInFlight,
  heavyOpEnter, heavyOpLeave,
  URL_API, WIFI_BLOCKED, USB_HIDDEN, DEMO_MODE, resetDemoMemory,
  getDemoSnapshot,
} from './api.js';
// Stores de mídia (back-images + ícones de upload) — extraidos pra ./stores.js.
import {
  IMAGE_SLOT_COUNT, _imageStore, useImageStore, imageStoreFetchList,
  imageStoreLoadBlob, imageStoreUpload, imageStoreDelete, imageStoreFetchBase64,
  base64ToJpegBlob, base64ToPngBlob, imageStoreBlobOrLoad,
  ICON_UPLOAD_FIRST_ID, ICON_UPLOAD_SLOT_COUNT, isUploadIcon,
  iconUploadSlotOfId, iconUploadIdOfSlot, useIconStore, iconStoreFetchList,
  iconStoreLoadBlob, iconStoreUpload, iconStoreDelete, iconStoreBlobOrLoad,
  iconStoreFetchBase64, _iconStore,
} from './stores.js';
// i18n da UI (rótulos/títulos/botões traduzíveis) — ver ./i18n.js.
import { tr } from './i18n.js';
// CCs especiais NRPN do Kemper (200..321) — GERADO de NRPN_KEMPER.h por
// tools/extract_kemper_nrpn.mjs. So aparecem na lista de CC em MODO KEMPER.
import { KEMPER_NRPN_CCS } from './kemper_nrpn.js';
// Rótulos de VALOR fixo do Kemper (figuras do Transpose + enums de delay/reverb).
// MANTIDO À MÃO (≠ kemper_nrpn.js, que é gerado). Ver kemper_values.js.
import { KEMPER_TRANSPOSE_CC, kemperValueLabelsFor } from './kemper_values.js';
import { pedalValueLabelsForKey } from './pedal_values.js';
// Studio redesign (refactor2/BFMIDI Redesign.html) — visuais novos da tela
// BANK em mobile. Modulo folha: nao reimporta nada do app.jsx.
import { NowPlayingCard, SwPreviewGrid, StudioToggle, StudioToggleRow } from './pages/bank.jsx';
// Substituto drop-in do select nativo: ao abrir, mostra a roda (WheelPopup)
// estilo iOS. Mesma interface do select (onChange recebe {target:{value}}),
// entao os call-sites (e) => Number(e.target.value) seguem inalterados.
import { BfSelect } from './components/wheel.jsx';

const { useState, useEffect, useRef, useCallback, useMemo } = React;

// ─── i18n leve: idioma da UI ───────────────────────────────────────
// Store global (nivel de modulo) pro seletor de idioma do header sem prop
// drilling. O idioma afeta os rotulos visiveis traduzidos via UI_STRINGS/tr()
// em ./i18n.js (titulos de card, abas, botoes, aria-labels). Ficam fixos so
// termos de produto/protocolo (MIDI, USB, STOMP, PRESET, GLOBAL, nomes de
// pedal...). Padrao: PT.
const BF_I18N = {
  language: (() => { try { return localStorage.getItem('bfmidi_language') || 'pt'; } catch { return 'pt'; } })(),
  listeners: new Set(),
};
function bfI18nNotify() { BF_I18N.listeners.forEach((fn) => { try { fn(); } catch {} }); }
function bfSetLanguage(lang) {
  BF_I18N.language = lang;
  try { localStorage.setItem('bfmidi_language', lang); } catch {}
  bfI18nNotify();
}
// Hook que re-renderiza quem o usa quando o idioma muda.
function useBfI18n() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((x) => x + 1);
    BF_I18N.listeners.add(fn);
    return () => { BF_I18N.listeners.delete(fn); };
  }, []);
  return {
    language: BF_I18N.language,
    setLanguage: bfSetLanguage,
    // t('chave', {var}) resolve no idioma atual (ver ./i18n.js).
    t: (key, vars) => tr(BF_I18N.language, key, vars),
  };
}




// ─── Paleta de LEDs (mantém id 0..14 igual ao firmware) ─────────────
const LED_COLORS = [
  { id: 0,  hex: '#ff3030', name: 'VERMELHO',     rgb: [255, 48, 48] },
  { id: 1,  hex: '#22cc44', name: 'VERDE',        rgb: [34, 204, 68] },
  { id: 2,  hex: '#3a6dff', name: 'AZUL',         rgb: [58, 109, 255] },
  { id: 3,  hex: '#ffcc20', name: 'AMARELO',      rgb: [255, 204, 32] },
  { id: 4,  hex: '#9a2bd9', name: 'ROXO',         rgb: [154, 43, 217] },
  { id: 5,  hex: '#22d4d4', name: 'CYAN',         rgb: [34, 212, 212] },
  { id: 6,  hex: '#f5f5ff', name: 'BRANCO',       rgb: [245, 245, 255] },
  { id: 7,  hex: '#ff7a1a', name: 'LARANJA',      rgb: [255, 122, 26] },
  { id: 8,  hex: '#ff3a92', name: 'MAGENTA',      rgb: [255, 58, 146] },
  { id: 9,  hex: '#ff5a3a', name: 'CORAL',        rgb: [255, 90, 58] },
  { id: 10, hex: '#1aa3ff', name: 'AZUL CELESTE', rgb: [26, 163, 255] },
  { id: 11, hex: '#b835ff', name: 'VIOLETA',      rgb: [184, 53, 255] },
  { id: 12, hex: '#ff89cc', name: 'ROSA',         rgb: [255, 137, 204] },
  { id: 13, hex: '#3aff7a', name: 'MENTA',        rgb: [58, 255, 122] },
  { id: 14, hex: '#3a3a3e', name: 'OFF',          rgb: [58, 58, 62] },
];

// ─── Paleta visual (cores de display, distinta de LED_COLORS) ──────
// ─── Paleta de cores do display (espelha DISPLAY_PALETTE em DISPLAY_COLORS.h) ──
// Ordem e contagem DEVEM bater com o firmware. IDs = indices neste array.
const SYSTEM_THEME_STORAGE_KEY = 'bfmidi_system_theme';
const AUTO_SAVE_STORAGE_KEY = 'bfmidi_auto_save';
const AUTO_SAVE_DELAY_MS = 850;
const SYSTEM_THEMES = [
  { id: 'default', label: 'Escuro', sub: 'BFMIDI laranja', accent: '#ff6a1f', accent2: '#ff8a3a', hi: '#ffc59a', lo: '#7c350f', bg: '#131318', screen: '#27272d', card: '#141418', card2: '#1c1c20', card3: '#232328', glowA: 'rgba(255,106,31,0.10)', glowB: 'rgba(10,132,255,0.06)' },
  { id: 'studio-green', label: 'Claro', sub: 'Limpo e luminoso', accent: '#ff6a1f', accent2: '#ff8a3a', hi: '#ffc59a', lo: '#7c350f', bg: '#d9dee6', screen: '#cfd6df', card: '#f2f4f7', card2: '#e8ecf1', card3: '#dce3eb', text: '#15171c', muted: 'rgba(21,23,28,0.66)', faint: 'rgba(21,23,28,0.42)', ghost: 'rgba(21,23,28,0.20)', hair: 'rgba(20,24,32,0.12)', hairStrong: 'rgba(20,24,32,0.22)', glowA: 'transparent', glowB: 'transparent', light: true },
];
function getSystemTheme(id) {
  return SYSTEM_THEMES.find((theme) => theme.id === id) || SYSTEM_THEMES[0];
}

const DISP_TYPE = {
  SOLID: 0,
  GRADIENT_1: 1,
  GRADIENT_2: 2,
  CUSTOM_BLACK: 3,
  MISC_GRADIENT: 4,
  TRANSPARENT: 5,
  BACK_IMAGE: 6,
};
const DISP_DIR = { NONE: 0, H: 1, V: 2, D: 3, RADIAL: 4 };

// 32 cores base reutilizadas pelos blocos SOLID/G1/G2/CUSTOM.
const DISPLAY_BASE_COLORS = [
  { name: 'Preto',           hex: 0x000000 },
  { name: 'Cinza Escuro',    hex: 0x555555 },
  { name: 'Cinza Claro',     hex: 0xAAAAAA },
  { name: 'Branco',          hex: 0xFFFFFF },
  { name: 'Oliva Escuro',    hex: 0x666600 },
  { name: 'Oliva',           hex: 0xAAAA00 },
  { name: 'Amarelo',         hex: 0xFFFF00 },
  { name: 'Amarelo Claro',   hex: 0xFFFF88 },
  { name: 'Marrom',          hex: 0x8B4513 },
  { name: 'Ocre',            hex: 0xD2691E },
  { name: 'Laranja',         hex: 0xFF8C00 },
  { name: 'Pessego',         hex: 0xFFDAB9 },
  { name: 'Bordo',           hex: 0x800000 },
  { name: 'Vermelho Escuro', hex: 0xCC0000 },
  { name: 'Vermelho',        hex: 0xFF0000 },
  { name: 'Salmao',          hex: 0xFA8072 },
  { name: 'Purpura',         hex: 0x800080 },
  { name: 'Magenta Escura',  hex: 0xCC00CC },
  { name: 'Magenta',         hex: 0xFF00FF },
  { name: 'Rosa Claro',      hex: 0xFFB6C1 },
  { name: 'Indigo',          hex: 0x4B0082 },
  { name: 'Roxo',            hex: 0x8A2BE2 },
  { name: 'Violeta',         hex: 0x9932CC },
  { name: 'Lilas',           hex: 0xDDA0DD },
  { name: 'Azul Marinho',    hex: 0x000080 },
  { name: 'Azul Escuro',     hex: 0x0000CC },
  { name: 'Azul',            hex: 0x0000FF },
  { name: 'Azul Claro',      hex: 0x87CEFA },
  { name: 'Verde Escuro',    hex: 0x006400 },
  { name: 'Verde Medio',     hex: 0x00A000 },
  { name: 'Verde',           hex: 0x00FF00 },
  { name: 'Verde Claro',     hex: 0x98FB98 },
];

// SOLID/G1/G2/CUSTOM: hex_mid/hex_end ficam null (derivam stops da base).
// G2 e DIAGONAL; CUSTOM e VERTICAL com preto/base/preto.
const _baseAs = (prefix, type, direction) =>
  DISPLAY_BASE_COLORS.map((c) => ({
    name: prefix + c.name, hex: c.hex, hex_mid: null, hex_end: null, type, direction,
  }));

const DISPLAY_PALETTE = [
  { name: 'Sem Cor', hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.TRANSPARENT, direction: DISP_DIR.NONE },
  ..._baseAs('',         DISP_TYPE.SOLID,        DISP_DIR.NONE),
  ..._baseAs('G1 ',      DISP_TYPE.GRADIENT_1,   DISP_DIR.V),
  ..._baseAs('G2 ',      DISP_TYPE.GRADIENT_2,   DISP_DIR.D),
  ..._baseAs('Custom ',  DISP_TYPE.CUSTOM_BLACK, DISP_DIR.V),
  // MISC: 3 stops explicitos (start -> mid -> end) ao longo da direcao.
  { name: 'Sunset Horizontal',        hex: 0xFF2D55, hex_mid: 0xFFB347, hex_end: 0xFF6A00, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.H },
  { name: 'Fire Diagonal',            hex: 0xFFD200, hex_mid: 0xFF6A00, hex_end: 0xB30000, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.D },
  { name: 'Ember Horizontal',         hex: 0xFF8C00, hex_mid: 0xFF3D00, hex_end: 0x6E0E0E, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.H },
  { name: 'Lava Vertical',            hex: 0xFFD000, hex_mid: 0xFF3C00, hex_end: 0x800000, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.V },
  { name: 'Berry Diagonal',           hex: 0xFF85B3, hex_mid: 0xFF2D74, hex_end: 0x800040, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.D },
  { name: 'Flamingo Horizontal',      hex: 0xFFB6C1, hex_mid: 0xFF6E96, hex_end: 0xC0426E, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.H },
  { name: 'Candy Diagonal',           hex: 0xFFB3D9, hex_mid: 0xFF50B4, hex_end: 0x7A1F5E, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.D },
  { name: 'Por do Sol Vertical',      hex: 0xFFB347, hex_mid: 0xFF7832, hex_end: 0xB33A00, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.V },
  { name: 'Gold Vertical',            hex: 0xFFEB99, hex_mid: 0xFFC247, hex_end: 0xB8860B, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.V },
  { name: 'Cobre Horizontal',         hex: 0xE8A77A, hex_mid: 0xC87832, hex_end: 0x6B3410, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.H },
  { name: 'Steel Vertical',           hex: 0xD7DAE0, hex_mid: 0xA5B0C4, hex_end: 0x4F5562, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.V },
  { name: 'Noite Vertical',           hex: 0x4B5BAF, hex_mid: 0x191970, hex_end: 0x000033, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.V },
  { name: 'Lima Horizontal',          hex: 0xDEFF80, hex_mid: 0xA0FF00, hex_end: 0x5C9900, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.H },
  { name: 'Toxic Horizontal',         hex: 0xB3FF80, hex_mid: 0x76FF03, hex_end: 0x2E7D00, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.H },
  { name: 'Aurora Vertical',          hex: 0xA8FFD8, hex_mid: 0x44FFB0, hex_end: 0x00805F, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.V },
  { name: 'Floresta Horizontal',      hex: 0x4FE077, hex_mid: 0x00B43C, hex_end: 0x003D14, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.H },
  { name: 'Neon Diagonal',            hex: 0xB3FFE0, hex_mid: 0x00FFB4, hex_end: 0x008866, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.D },
  { name: 'Aqua Diagonal',            hex: 0x99EEFF, hex_mid: 0x00D8FF, hex_end: 0x007A99, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.D },
  { name: 'Ice Diagonal',             hex: 0xC8F7FF, hex_mid: 0x78F0FF, hex_end: 0x0099AA, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.D },
  { name: 'Ocean Horizontal',         hex: 0x99DAFF, hex_mid: 0x00B4FF, hex_end: 0x003C99, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.H },
  { name: 'Sky Diagonal',             hex: 0xBBDFFF, hex_mid: 0x62BEFF, hex_end: 0x0E5499, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.D },
  { name: 'Oceano Profundo Diagonal', hex: 0x4683C5, hex_mid: 0x0050A0, hex_end: 0x002550, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.D },
  { name: 'Grape Horizontal',         hex: 0xD9B3FF, hex_mid: 0x9B4DFF, hex_end: 0x4A1E80, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.H },
  { name: 'Ametista Diagonal',        hex: 0xC599FF, hex_mid: 0x823CFF, hex_end: 0x3A0F80, type: DISP_TYPE.MISC_GRADIENT, direction: DISP_DIR.D },

  // BACK IMAGES — 15 slots fixos. Espelha DISPLAY_COLORS.h no firmware.
  // Cada slot corresponde a /img/<N>.jpg em LittleFS. hex=0 e fallback se
  // o slot estiver vazio (renderer pinta preto). Os slots tem que ser as
  // ULTIMAS entradas e em numero igual a IMAGE_SLOT_COUNT, senao
  // IMAGE_SLOT_FIRST_ID diverge do firmware e o mapeamento de slot quebra.
  { name: 'Imagem 1',  hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
  { name: 'Imagem 2',  hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
  { name: 'Imagem 3',  hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
  { name: 'Imagem 4',  hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
  { name: 'Imagem 5',  hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
  { name: 'Imagem 6',  hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
  { name: 'Imagem 7',  hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
  { name: 'Imagem 8',  hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
  { name: 'Imagem 9',  hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
  { name: 'Imagem 10', hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
  { name: 'Imagem 11', hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
  { name: 'Imagem 12', hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
  { name: 'Imagem 13', hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
  { name: 'Imagem 14', hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
  { name: 'Imagem 15', hex: 0x000000, hex_mid: null, hex_end: null, type: DISP_TYPE.BACK_IMAGE, direction: DISP_DIR.NONE },
];

// IDs dos slots de imagem ocupam os ultimos indices do array.
// Espelha IMAGE_SLOT_FIRST_ID em DISPLAY_COLORS.h. IMAGE_SLOT_COUNT mora em
// ./stores.js (é a contagem de slots de imagem) e vem importado no topo.
const IMAGE_SLOT_FIRST_ID = DISPLAY_PALETTE.length - IMAGE_SLOT_COUNT;
const IMAGE_SLOT_LAST_ID = DISPLAY_PALETTE.length - 1;

// Hook reativo pra CSS media query — usado pra dar layouts diferentes em
// mobile vs desktop sem duplicar JSX. Retorna boolean q acompanha a query.
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const update = (e) => setMatches(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', update);
    else if (mq.addListener) mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', update);
      else if (mq.removeListener) mq.removeListener(update);
    };
  }, [query]);
  return matches;
}

// Renderiza node inline ou via portal pro DOM target se houver. Usado pra
// teleportar cards do BankPage pra slots de coluna no desktop sem mexer
// na ordem mobile original.
function maybePortal(node, target) {
  return target ? ReactDOM.createPortal(node, target) : node;
}

// Helper: retorna 0..9 se id corresponde a slot de imagem; -1 se nao.
function imageSlotOfId(id) {
  if (typeof id !== 'number') return -1;
  if (id < IMAGE_SLOT_FIRST_ID) return -1;
  const slot = id - IMAGE_SLOT_FIRST_ID;
  if (slot >= IMAGE_SLOT_COUNT) return -1;
  return slot;
}
// Helper inverso: slot 0..9 -> ID na paleta.
function imageIdOfSlot(slot) {
  return IMAGE_SLOT_FIRST_ID + slot;
}
// IDs por bloco — uteis pra renderizar secoes no popover.
const PALETTE_SECTIONS = (() => {
  const sections = { transparent: [], solid: [], g1: [], g2: [], custom: [], misc: [], images: [] };
  DISPLAY_PALETTE.forEach((c, id) => {
    if (c.type === DISP_TYPE.TRANSPARENT)    sections.transparent.push(id);
    else if (c.type === DISP_TYPE.SOLID)     sections.solid.push(id);
    else if (c.type === DISP_TYPE.GRADIENT_1) sections.g1.push(id);
    else if (c.type === DISP_TYPE.GRADIENT_2) sections.g2.push(id);
    else if (c.type === DISP_TYPE.CUSTOM_BLACK) sections.custom.push(id);
    else if (c.type === DISP_TYPE.MISC_GRADIENT) sections.misc.push(id);
    else if (c.type === DISP_TYPE.BACK_IMAGE) sections.images.push(id);
  });
  return sections;
})();

function hexToCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}
function shiftHex(hex, amt) {
  let r = (hex >> 16) & 0xFF, g = (hex >> 8) & 0xFF, b = hex & 0xFF;
  if (amt >= 0) {
    r = r + (255 - r) * amt; g = g + (255 - g) * amt; b = b + (255 - b) * amt;
  } else {
    r = r * (1 + amt); g = g * (1 + amt); b = b * (1 + amt);
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}
// CSS background string para preview do swatch. Espelha o renderer do firmware:
//   G1 (V):   light(base) -> base -> dark(base)
//   G2 (D):   light(base) -> base -> dark(base)
//   CUSTOM (V): preto       -> base -> preto
//   MISC:     hex          -> hex_mid -> hex_end (na direcao do struct)
// CSS background do swatch. Quando entry e BACK_IMAGE e o slot existe no
// ImageStore, devolve url(blobUrl) — caller pode passar `id` explicito pra
// destravar isso (callers antigos passam so entry e veem cinza placeholder).
function paletteBackground(entry, id) {
  if (!entry) return '#000';
  const { type, direction, hex, hex_mid, hex_end } = entry;
  if (type === DISP_TYPE.TRANSPARENT) {
    return 'repeating-conic-gradient(#9aa3b2 0% 25%, #4a4f59 0% 50%) 50% / 12px 12px';
  }
  if (type === DISP_TYPE.BACK_IMAGE) {
    const slot = typeof id === 'number' ? imageSlotOfId(id) : -1;
    if (slot >= 0) {
      const url = imageStoreBlobOrLoad(slot);
      if (url) return `center/cover no-repeat url("${url}")`;
    }
    // Placeholder: hash diagonal cinza pra indicar slot vazio.
    return 'repeating-linear-gradient(45deg, #2a2d33 0 6px, #1a1c20 6px 12px)';
  }
  if (type === DISP_TYPE.SOLID) {
    return hexToCss(hex);
  }
  const base = hexToCss(hex);
  if (type === DISP_TYPE.GRADIENT_1) {
    const light = shiftHex(hex, 0.35);
    const dark = shiftHex(hex, -0.45);
    return `linear-gradient(180deg, ${light} 0%, ${base} 50%, ${dark} 100%)`;
  }
  if (type === DISP_TYPE.GRADIENT_2) {
    const light = shiftHex(hex, 0.35);
    const dark = shiftHex(hex, -0.45);
    return `linear-gradient(135deg, ${light} 0%, ${base} 50%, ${dark} 100%)`;
  }
  if (type === DISP_TYPE.CUSTOM_BLACK) {
    return `linear-gradient(180deg, #000 0%, ${base} 50%, #000 100%)`;
  }
  if (type === DISP_TYPE.MISC_GRADIENT) {
    const s0 = hexToCss(hex);
    const s1 = hexToCss(hex_mid != null ? hex_mid : hex);
    const s2 = hexToCss(hex_end != null ? hex_end : hex);
    const angle =
      direction === DISP_DIR.H ? '90deg' :
      direction === DISP_DIR.D ? '135deg' :
      '180deg';
    return `linear-gradient(${angle}, ${s0} 0%, ${s1} 50%, ${s2} 100%)`;
  }
  return base;
}

// ─── Modelos ────────────────────────────────────────────────────────
const MODELS = [
  { id: 'BFMIDI-1 7S_A1', tag: 'BFMIDI-1', switches: 8, size: '3x3 GRID' },
  { id: 'BFMIDI-1 7S_B1', tag: 'BFMIDI-1', switches: 8, size: '3x3 GRID' },
  { id: 'BFMIDI-1 7S_C1', tag: 'BFMIDI-1', switches: 8, size: '3x3 GRID' },
  { id: 'BFMIDI-1 4S',    tag: 'BFMIDI-1', switches: 4, size: '1x4 LAYOUT' },
  { id: 'BFMIDI-2 NANO',  tag: 'BFMIDI-2', switches: 6, size: '2x3 LAYOUT' },
  { id: 'BFMIDI-2 MICRO', tag: 'BFMIDI-2', switches: 4, size: '2x2 LAYOUT' },
  { id: 'BFMIDI-2 4S',    tag: 'BFMIDI-2', switches: 4, size: '1x4 LAYOUT' },
  { id: 'BFMIDI-2 6S',    tag: 'BFMIDI-2', switches: 6, size: '2x3 LAYOUT' },
  { id: 'BFMIDI-2 7S',    tag: 'BFMIDI-2', switches: 8, size: '3x3 GRID' },
  { id: 'BFMIDI-3 NANO',  tag: 'BFMIDI-3', switches: 6, size: '2x3 LAYOUT' },
  { id: 'BFMIDI-3 NANO+', tag: 'BFMIDI-3', switches: 6, size: '2x3 LAYOUT' },
  { id: 'BFMIDI-3 MICRO', tag: 'BFMIDI-3', switches: 4, size: '2x2 LAYOUT' },
  { id: 'BFMIDI-3 6SW+',  tag: 'BFMIDI-3', switches: 6, size: '2x3 LAYOUT' },
  { id: 'BFMIDI-3 7S',    tag: 'BFMIDI-3', switches: 8, size: '3x3 GRID' },
  { id: 'BFMIDI-3 7SW+',  tag: 'BFMIDI-3', switches: 8, size: '3x3 GRID' },
  // chip: 's3' = placa de pinagem ESP32-S3 (sem o campo = 's2'). Espelha
  // boardIsForThisChip (BOARDS.h): o seletor de placa so mostra modelos do
  // chip do pedal conectado (campo "chip" do /config/global).
  { id: 'BFMIDI-3 8SW+', tag: 'BFMIDI-3', switches: 8, size: '3x3 GRID', chip: 's3' },
];

const FAMILIES = ['BFMIDI-1', 'BFMIDI-2', 'BFMIDI-3'];

// EXTERNAL EXPRESSION (GLOBAL > MIDI) — resolucao do ADC do ESP32-S2 (12 bits,
// 0..4095). Casa com EXP_ADC_MAX no firmware (GLOBAL_CONFIG.h).
const EXP_ADC_MAX = 4095;

// Espelha expRawToMidi do firmware (EXP_PEDAL.h): mapeia o ADC cru pra 0..127
// entre calMin (=> 0) e calMax (=> 127), invertendo sozinho se calMin > calMax.
// Usado pra mostrar o MIDI ao vivo refletindo a calibracao AINDA NAO salva.
function expRawToMidiJs(raw, lo, hi) {
  if (lo === hi) return 0;
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const r = Math.max(a, Math.min(b, raw));
  const v = Math.abs(r - lo);
  const span = Math.abs(hi - lo);
  return Math.max(0, Math.min(127, Math.round((v * 127) / span)));
}

// COMANDOS ESPECIAIS de SW — "CC" >= 128 NAO manda MIDI: dispara uma acao de
// navegacao interna (firmware: SW_BANK.h::swSpecialCmdFromCc / executor em
// SW_MODE.h). Aparecem no fim de TODA lista de CC do editor (independente do
// MATCH MODE/pedal). `value` = numero salvo no slot do SW (128..134).
const SW_SPECIAL_CCS = [
  { value: 128, label: 'UP BANK' },
  { value: 129, label: 'DOWN BANK' },
  { value: 130, label: 'UP PRESET' },
  { value: 131, label: 'DOWN PRESET' },
  { value: 132, label: 'OUT LIVE MODE' },
  { value: 133, label: 'TO LAYER' },
  { value: 134, label: 'SW_LIVE' },
];
// Teto do range dos comandos de navegacao (128..134). Mantido pra semantica
// "e comando de navegacao?" — NAO usar como teto de clamp (ver CC_NUM_MAX).
const SW_SPECIAL_CC_MAX = 134;
// Teto do clamp de numero de CC: cobre os comandos de navegacao (128..134) E
// os CCs especiais NRPN do Kemper (200..321). Usado em todos os clamps de num.
const CC_NUM_MAX = 321;

// MATCH MODE — pedal/dispositivo alvo do mapeamento MIDI (GLOBAL > MIDI).
// O index na lista e o valor persistido na NVS (match_mode); index 0 =
// MULTIPLE MODE (sem pedal fixo). APPEND-ONLY: nunca reordenar — pedais
// novos vao SEMPRE no FIM, senao os valores ja salvos passam a apontar pro
// pedal errado. Precisa casar com MATCH_MODE_COUNT no firmware (GLOBAL_CONFIG.h).
const MATCH_MODE_OPTIONS = [
  'MULTIPLE MODE',
  'AMPERO AS2', 'AMPERO MINI', 'HX STOMP', 'A. STAGE 2', 'GP-200LT', 'Valeton GP-5 - GP50',
  'POCKET MASTER', 'TONEX', 'KEMPER PLAYER', 'AMPERO MP350', 'MX5', 'NANO CORTEX',
  'QUAD CORTEX', 'SYNERGY AMPS', 'BigSky', 'BlueSky', 'TimeLine',
  'ELCAPISTAN', 'FLINT', 'HX-ONE', 'VTR NARCISO', 'VTR LOKI', 'VTR KAILANI',
  'BFMiDi - Keyboard', 'CUSTOM', "UAFX Ruby '63", "UAFX Enigmatic '82",
  "UAFX Lion '68", "UAFX Dream '65", 'FRACTAL VP4', 'FRACTAL VP4+',
  'TONEX ONE+', 'VTR IGNIS', 'VTR HELIOS', 'VTR VENATOR',
  'HEADRUSH FLEX PRIME',
];

// Liga cada índice de MATCH_MODE_OPTIONS às chaves de PC_LABELS/CC_LABELS
// (pedal_labels.js). null = sem dados (MULTIPLE MODE). APPEND-ONLY junto com
// MATCH_MODE_OPTIONS — mesma ordem, mesmo tamanho. AS2 e A. STAGE 2 são
// pedais diferentes que compartilham o mesmo conjunto de CC (AMPEROST2).
const MATCH_MODE_PEDAL = [
  null,                                       // 0  MULTIPLE MODE
  { pc: 'AS2',           cc: 'AMPEROST2' },    // 1  AMPERO AS2
  { pc: 'AMPERO_MINI',   cc: 'AMPERO_MINI' },  // 2  AMPERO MINI
  { pc: 'HX_STOMP',      cc: 'HX_STOMP' },     // 3  HX STOMP
  { pc: 'ASTG2',         cc: 'AMPEROST2' },    // 4  A. STAGE 2
  { pc: 'GP200LT',       cc: 'GP200LT' },      // 5  GP-200LT
  { pc: 'VALETON_GP5',   cc: 'VALETON_GP5' },  // 6  Valeton GP-5 - GP50
  { pc: 'POCKET_MASTER', cc: 'POCKET_MASTER' },// 7  POCKET MASTER
  { pc: 'TONEX',         cc: 'TONEX' },        // 8  TONEX
  { pc: 'KEMPER_PLAYER', cc: 'KEMPER_PLAYER' },// 9  KEMPER PLAYER
  { pc: 'AMPERO_MP350',  cc: null },           // 10 AMPERO MP350
  { pc: null,            cc: 'MX5' },          // 11 MX5
  { pc: null,            cc: 'NANO_CORTEX' },  // 12 NANO CORTEX
  { pc: 'QUAD_CORTEX',   cc: 'QUAD_CORTEX' },  // 13 QUAD CORTEX
  { pc: null,            cc: 'SYN2' },         // 14 SYNERGY AMPS
  { pc: 'BIGSKY',        cc: 'BIGSKY' },       // 15 BigSky
  { pc: 'BLUESKY',       cc: 'BLUESKY' },      // 16 BlueSky
  { pc: 'TIMELINE',      cc: 'TIMELINE' },     // 17 TimeLine
  { pc: null,            cc: 'ELCAPISTAN' },   // 18 ELCAPISTAN
  { pc: null,            cc: 'FLINT' },        // 19 FLINT
  { pc: null,            cc: 'HXONE' },        // 20 HX-ONE
  { pc: null,            cc: 'VTR_NARCISO' },  // 21 VTR NARCISO
  { pc: null,            cc: 'VTR_LOKI' },     // 22 VTR LOKI
  { pc: null,            cc: 'KAILANI' },      // 23 VTR KAILANI
  { pc: null,            cc: 'BFMIDI_KEYBOARD' }, // 24 BFMiDi - Keyboard
  { pc: null,            cc: 'CUSTOM' },          // 25 CUSTOM (set de CCs genérico)
  { pc: null,            cc: 'RUBY63' },          // 26 UAFX Ruby '63
  { pc: null,            cc: 'ENIGMATIC82' },     // 27 UAFX Enigmatic '82
  { pc: null,            cc: 'LION68' },          // 28 UAFX Lion '68
  { pc: null,            cc: 'DREAM65' },         // 29 UAFX Dream '65
  { pc: 'FRACTAL_VP4',      cc: null },           // 30 FRACTAL VP4
  { pc: 'FRACTAL_VP4_PLUS', cc: 'CUSTOM' },       // 31 FRACTAL VP4+
  { pc: 'TONEX_ONE_PLUS',   cc: 'TONEX_ONE_PLUS' }, // 32 TONEX ONE+ (PC PRESET 1..20)
  { pc: null,            cc: 'VTR_IGNIS' },       // 33 VTR IGNIS (CC1 Bypass + PC 1..10)
  { pc: null,            cc: 'VTR_HELIOS' },      // 34 VTR HELIOS
  { pc: null,            cc: 'VTR_VENATOR' },     // 35 VTR VENATOR
  { pc: null,            cc: 'FLEX_PRIME' },      // 36 HEADRUSH FLEX PRIME
];

// Ordem de EXIBIÇÃO (alfabética) dos pedais no dropdown do Match Mode. NÃO
// reordena MATCH_MODE_OPTIONS — esse array é APPEND-ONLY porque o índice é o
// valor salvo na NVS; reordenar apontaria configs salvas pro pedal errado.
// Aqui só definimos a sequência dos <option>: o índice 0 (MULTIPLE MODE / "—")
// fica fixo no topo e o resto ordena por nome. O `value` de cada <option>
// continua sendo o índice ORIGINAL em MATCH_MODE_OPTIONS.
const MATCH_MODE_ORDER = [
  0,
  ...MATCH_MODE_OPTIONS
    .map((_, i) => i)
    .slice(1)
    .sort((a, b) => MATCH_MODE_OPTIONS[a].localeCompare(
      MATCH_MODE_OPTIONS[b], 'pt', { sensitivity: 'base' })),
];

// Espelho de leitura do estado de Match Mode (App.jsx sincroniza no topo do
// corpo do App, antes dos filhos renderizarem). Existe pra os helpers de rótulo
// serem chamados de qualquer editor de SW sem prop-drilling. NUNCA escrever a
// partir de um componente filho — só o App escreve, em render.
//   __matchMode      : 0 = MULTIPLE MODE; 1..31 = pedal único (vale p/ todo canal)
//   __matchOmit      : 1 = ocultar PC/CC sem nome
//   __matchChannels  : MULTIPLE MODE — pedal por canal 1..16 (índice 0..31; 0=GLOBAL/cru)
const MATCH_CHANNEL_SLOTS = 16;  // canais MIDI do MULTIPLE MODE (1..16) — NAO e banco!
const MATCH_CHANNEL_PAGE_SIZE = 6;  // 3 páginas de 6 campos cobrem os 16 canais
// Letras de banco A..J. Espelha BANK_LETTER_COUNT/BANK_MEMORY_LETTERS no firmware
// (GLOBAL_CONFIG.h / BANK_MEMORY.h). Era 5 (A..E); dobrado pra 10. Use estas
// constantes em vez de hardcodar — NAO confundir com MATCH_CHANNEL_SLOTS acima.
const BANK_LETTER_COUNT = 10;
const BANK_LETTERS = Array.from({ length: BANK_LETTER_COUNT },
                                (_, i) => String.fromCharCode(65 + i));
let __matchMode = 0;
let __matchOmit = 0;
let __matchChannels = Array(MATCH_CHANNEL_SLOTS).fill(0);
// Resolucao do display da placa ativa (pro preview de posicao do nome usar o
// aspect certo, 480x320 vs 320x240). Escrito por App() a cada render, sem
// prop-drilling — mesma convencao dos __match*. Default = placa padrao (480).
let __displayRes = { w: 480, h: 320 };
// Layout do modo PRESET (0 classica · 1..4 tiles · 5 lista) + se a placa e de
// 4 switches — usados pelo preview de posicao do nome pra desenhar a AREA dos
// icones (pra o usuario posicionar o nome no vazio). Tambem escritos por App().
let __presetLayout = 0;
let __presetCustomLayout = null;
let __is4sw = false;
// Chip do pedal conectado ('s2' | 's3' | '' = desconhecido), do campo "chip"
// do /config/global. Escrito por App() a cada render (mesmo padrao do
// __matchMode). Filtra o seletor de placa: modelo com chip diferente do
// pedal some (aplicar placa de outro chip e fatal — ver boardIsForThisChip
// em BOARDS.h). Sem info (firmware antigo/desconectado) mostra tudo.
let __deviceChip = '';
const modelIsForChip = (m) => !__deviceChip || (m.chip || 's2') === __deviceChip;

// Resolve o pedal alvo (entrada de MATCH_MODE_PEDAL) pra um canal MIDI:
//   • pedal único (__matchMode > 0): vale pra TODOS os canais;
//   • MULTIPLE MODE: mapa por canal 1..MATCH_CHANNEL_SLOTS; fora disso = nenhum.
// Retorna a entrada {pc,cc} ou null (GLOBAL/cru). `channel` é obrigatório.
function pedalEntryForChannel(channel) {
  let idx;
  if (__matchMode > 0) idx = __matchMode;
  else if (channel >= 1 && channel <= __matchChannels.length) idx = __matchChannels[channel - 1];
  else idx = 0;
  return idx > 0 ? MATCH_MODE_PEDAL[idx] : null;
}
// Nome do pedal alvo de um canal ('' = GLOBAL/cru). Mesma resolução acima.
function pedalNameForChannel(channel) {
  let idx;
  if (__matchMode > 0) idx = __matchMode;
  else if (channel >= 1 && channel <= __matchChannels.length) idx = __matchChannels[channel - 1];
  else idx = 0;
  return idx > 0 ? (MATCH_MODE_OPTIONS[idx] || '') : '';
}

// Indice de KEMPER PLAYER em MATCH_MODE_OPTIONS (= valor salvo no firmware).
const KEMPER_PLAYER_MATCH_IDX = MATCH_MODE_OPTIONS.indexOf('KEMPER PLAYER');
// True se o canal resolve pro Kemper (pedal unico, ou MULTIPLE MODE com o canal
// mapeado pro Kemper). Mesma resolucao de pedalEntryForChannel. Gateia a lista
// de CCs NRPN do Kemper no editor (so aparecem em MODO KEMPER PLAYER).
function isKemperChannel(channel) {
  let idx;
  if (__matchMode > 0) idx = __matchMode;
  else if (channel >= 1 && channel <= __matchChannels.length) idx = __matchChannels[channel - 1];
  else idx = 0;
  return idx === KEMPER_PLAYER_MATCH_IDX;
}

// Opções do select de canal MIDI. Cada canal mostra "<n> - <pedal do canal>"
// (ex.: "1 - Kemper Player") dentro do campo; sem pedal, só o número. O canal 0
// é sempre OFF (desligado, sem pedal). offLabel/chPrefix acomodam o estilo do
// macros ("CH OFF"/"CH 1").
function channelOptionElems(offLabel, chPrefix) {
  const out = [<option key={0} value={0}>{offLabel || 'OFF'}</option>];
  for (let n = 1; n <= 16; n++) {
    const ped = pedalNameForChannel(n);
    out.push(
      <option key={n} value={n}>{ped ? `${n} - ${ped}` : `${chPrefix || ''}${n}`}</option>
    );
  }
  return out;
}

// Arrays de valores reutilizados pelos selects de PC/CC.
const MIDI_VALUES_128 = Array.from({ length: 128 }, (_, n) => n);
const PC_VALUES_601 = Array.from({ length: 601 }, (_, n) => n);

// CCs especiais NRPN do Kemper divididos em 2 grupos (campo `group` vem do
// gerador, a partir das seções do NRPN_KEMPER.h) e ordenados alfabeticamente
// pelo rótulo dentro de cada grupo. Renderizados no select de CC com uma
// option-cabeçalho desabilitada por grupo (o wheel não suporta <optgroup>).
const _kpByLabel = (a, b) => a.label.localeCompare(b.label, 'pt');
const KEMPER_NRPN_ONOFF = KEMPER_NRPN_CCS.filter((c) => c.group === 'onoff').sort(_kpByLabel);
const KEMPER_NRPN_PARAM = KEMPER_NRPN_CCS.filter((c) => c.group !== 'onoff').sort(_kpByLabel);

// Gera os <option> de um select de número MIDI (PC ou CC) aplicando os nomes
// do pedal mapeado pro `channel` do campo. `kind`: 'pc' | 'cc'. `current` =
// valor selecionado (nunca é ocultado, pra o select sempre exibir o salvo).
// `channel` é obrigatório (resolve qual pedal via pedalEntryForChannel).
// Regras:
//   • Sem pedal no canal (GLOBAL/cru): número cru — comportamento original.
//   • Tem nome: PC mostra só o nome (ex.: "A00-1"); CC "<num> - <nome>"
//     (ex.: "45 - Delay").
//   • Sem nome: se __matchOmit, oculta (exceto `current`, que aparece com o
//     número cru); senão mostra o número cru.
// `allowSpecial` (so p/ kind==='cc'): anexa os COMANDOS ESPECIAIS (>=128) no
// fim da lista. Default ON — eles aparecem em todo select de CC. Passe false
// onde nao fazem sentido (ex.: CC varrido do RAMP, que e sweep continuo).
function midiOptionElems(values, kind, current, channel, allowSpecial = true) {
  const entry = pedalEntryForChannel(channel);
  const data = entry && entry[kind]
    ? (kind === 'pc' ? PC_LABELS[entry.pc] : CC_LABELS[entry.cc])
    : null;
  const out = [];
  for (const n of values) {
    if (data) {
      const name = data[n];
      if (name) {
        const label = kind === 'cc' ? `${n} - ${name}` : name;
        out.push(<option key={n} value={n}>{label}</option>);
      } else if (!__matchOmit || n === current) {
        out.push(<option key={n} value={n}>{n}</option>);
      }
      // omit + sem nome + não é o atual: pula
    } else {
      out.push(<option key={n} value={n}>{n}</option>);
    }
  }
  if (kind === 'cc' && allowSpecial) {
    for (const sp of SW_SPECIAL_CCS) {
      out.push(<option key={`sp${sp.value}`} value={sp.value}>{`» ${sp.label}`}</option>);
    }
    // CCs especiais NRPN do Kemper (200..321) — so quando o canal e Kemper.
    // Marcador ◆ pra distinguir dos comandos de navegacao (»). Separados em
    // FX ON/OFF e PARÂMETROS, cada grupo em ordem alfabetica, com uma
    // option-cabecalho desabilitada (nao selecionavel) por grupo.
    if (isKemperChannel(channel)) {
      out.push(<option key="kp-h-onoff" value="__kp_onoff" disabled>── FX ON/OFF ──</option>);
      for (const sp of KEMPER_NRPN_ONOFF) {
        out.push(<option key={`kp${sp.value}`} value={sp.value}>{`◆ ${sp.label}`}</option>);
      }
      out.push(<option key="kp-h-param" value="__kp_param" disabled>── PARÂMETROS ──</option>);
      for (const sp of KEMPER_NRPN_PARAM) {
        out.push(<option key={`kp${sp.value}`} value={sp.value}>{`◆ ${sp.label}`}</option>);
      }
    }
  }
  return out;
}

// Resolve os rótulos de VALOR {min,max,labels} pro CC de um slot conforme o
// MODO AMIGÁVEL do canal: Kemper (kemper_values.js) OU um pedal com value-labels
// (pedal_values.js, ex.: UAFX). null = sem rótulos → mostra 0..127 cru. Mesma
// resolução de canal de pedalEntryForChannel/isKemperChannel.
function valueLabelsFor(channel, cc) {
  if (isKemperChannel(channel)) return kemperValueLabelsFor(cc);
  const entry = pedalEntryForChannel(channel);
  return entry && entry.cc ? pedalValueLabelsForKey(entry.cc, cc) : null;
}

// Gera os <option> de um select de VALOR de CC (0..127). Quando o canal resolve
// pro Kemper OU um pedal do MODO AMIGÁVEL E o CC do slot tem rótulos fixos
// (Transpose = figuras musicais; enums de delay/reverb; Model/Cab/Channel/Bypass
// dos pedais UAFX; Bypass/Algoritmo/Figura dos VTR), troca o range cru pela
// lista rotulada "<i> - <nome>". Senão cai no 0..127 normal. `current` sempre
// aparece (mesmo fora do range), pra nunca esconder o valor salvo. Def com
// `sparse: true` (faixas, ver pedal_values.js) lista SÓ as âncoras rotuladas.
// (Nome histórico "kemper*" — hoje cobre Kemper + pedais.)
function kemperValueOptionElems(current, channel, cc) {
  const def = valueLabelsFor(channel, cc);
  if (!def) return MIDI_VALUES_128.map((n) => <option key={n} value={n}>{n}</option>);
  const cur = Number(current);
  const out = [];
  let curShown = false;
  for (let i = def.min; i <= def.max; i++) {
    const name = def.labels[i];
    if (def.sparse && !name) continue;  // faixas: só as âncoras rotuladas
    out.push(<option key={i} value={i}>{name ? `${i} - ${name}` : i}</option>);
    if (i === cur) curShown = true;
  }
  if (!curShown && Number.isFinite(cur)) {
    out.unshift(<option key={`cur${cur}`} value={cur}>{cur}</option>);
  }
  return out;
}

// Ao TROCAR o CC de um slot pra um CC Kemper com range rotulado, encaixa o
// valor salvo dentro de [min,max] (evita mandar valor inválido no NRPN). Fora
// do range: Transpose -> 64 (ORIGINAL), demais -> min. Valor já válido (e o
// sentinela -1 = "não enviar", usado no MACROS) passam intactos. Use no
// onChange do select de CC, aplicando aos campos de valor do mesmo slot.
function kemperSnapValue(value, channel, cc) {
  const def = valueLabelsFor(channel, cc);
  if (!def) return value;
  const n = Number(value);
  if (n === -1) return value;
  if (n >= def.min && n <= def.max) return n;
  return cc === KEMPER_TRANSPOSE_CC ? 64 : def.min;
}

// ─── API base — extraida pra ./api.js (import no topo) ───────────────

// ─── ImageStore + Icon store — extraidos pra ./stores.js (import no topo) ─

// ─── Display resolution conforme a board atual ─────────────────────────
// Editor de imagem precisa do aspect ratio do display. BFMIDI-3 = 480x320,
// resto = 320x240. Lookup grosso pelo prefixo do board name (MODELS lista
// completa). Default: 320x240 (BFMIDI-1/2).
function displayResolutionFor(boardName) {
  const n = String(boardName || '').toUpperCase();
  // BFMIDI-3 MICRO usa display 320x240 (ST7789), exceção dentro da família
  // BFMIDI-3 (que normalmente é 480x320). Mantém o aspect do editor de imagem
  // alinhado com DISPLAY_TYPE em BOARDS.h.
  if (n === 'BFMIDI-3 MICRO') return { w: 320, h: 240 };
  if (n.startsWith('BFMIDI-3')) return { w: 480, h: 320 };
  return { w: 320, h: 240 };
}

function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, Number(v) || 0)); }
const CUSTOM_LAYOUT_MIN_SIZE = 12;
const CUSTOM_LAYOUT_MAX_SIZE = 45;
const CUSTOM_LAYOUT_DEFAULT_SIZE = 20;
const CUSTOM_LAYOUT_DEFAULT_X = [0, 20, 40, 60, 80, 100];
function makeDefaultCustomLayout() {
  return Array.from({ length: 8 }, (_, i) => ({
    enabled: i < 6,
    x: i < 6 ? CUSTOM_LAYOUT_DEFAULT_X[i] : (i === 6 ? 35 : 65),
    y: i < 6 ? 50 : 75,
    size: CUSTOM_LAYOUT_DEFAULT_SIZE,
  }));
}
function parseCustomLayout(value) {
  const out = makeDefaultCustomLayout();
  if (typeof value !== 'string' || !value.trim()) return out;
  value.split(';').slice(0, 8).forEach((part, i) => {
    const p = part.split(':').map(Number);
    if (p.length !== 4 || p.some((v) => !Number.isFinite(v))) return;
    out[i] = {
      enabled: p[0] !== 0,
      x: clamp(p[1], 0, 100),
      y: clamp(p[2], 0, 100),
      size: clamp(p[3], CUSTOM_LAYOUT_MIN_SIZE, CUSTOM_LAYOUT_MAX_SIZE),
    };
  });
  return out;
}
function serializeCustomLayout(items) {
  const src = Array.isArray(items) ? items : makeDefaultCustomLayout();
  return Array.from({ length: 8 }, (_, i) => {
    const it = src[i] || makeDefaultCustomLayout()[i];
    return `${it.enabled ? 1 : 0}:${Math.round(clamp(it.x, 0, 100))}:` +
      `${Math.round(clamp(it.y, 0, 100))}:` +
      `${Math.round(clamp(it.size, CUSTOM_LAYOUT_MIN_SIZE, CUSTOM_LAYOUT_MAX_SIZE))}`;
  }).join(';');
}
// Limite de segurança: 100% no app = 80% real no LED (byte máx = 204).
const BRIGHTNESS_BYTE_MAX = 204;
function brightnessByteToPercent(v) { return Math.round(clamp(v, 0, BRIGHTNESS_BYTE_MAX) / BRIGHTNESS_BYTE_MAX * 100); }
function brightnessPercentToByte(v) { return Math.round(clamp(v, 0, 100) / 100 * BRIGHTNESS_BYTE_MAX); }
function applyDevicePalette(colors) {
  if (!Array.isArray(colors)) return;
  colors.forEach((rgb, i) => {
    if (!LED_COLORS[i] || !Array.isArray(rgb) || rgb.length < 3) return;
    LED_COLORS[i].rgb = [clamp(rgb[0], 0, 255), clamp(rgb[1], 0, 255), clamp(rgb[2], 0, 255)];
  });
}
window.LED_COLORS = LED_COLORS;

// ─── Atoms visuais ──────────────────────────────────────────────────
function StatusBar({ time }) {
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0,
      padding: '18px 28px 10px', display: 'flex',
      justifyContent: 'space-between', zIndex: 20, color: '#fff',
      fontFamily: '-apple-system, system-ui', fontSize: 17, fontWeight: 590,
      pointerEvents: 'none',
    }}>
      <span>{time}</span>
      <span style={{ width: 126 }} />
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <svg width="18" height="11" viewBox="0 0 18 11"><rect x="0" y="7" width="3" height="4" rx=".6" fill="#fff"/><rect x="5" y="5" width="3" height="6" rx=".6" fill="#fff"/><rect x="10" y="2" width="3" height="9" rx=".6" fill="#fff"/><rect x="15" y="0" width="3" height="11" rx=".6" fill="#fff"/></svg>
        <svg width="16" height="11" viewBox="0 0 16 11" fill="#fff"><path d="M8 2.8C10.1 2.8 12 3.6 13.4 4.9L14.5 3.8C12.7 2.2 10.5 1.2 8 1.2C5.5 1.2 3.3 2.2 1.5 3.8L2.6 4.9C4 3.6 5.9 2.8 8 2.8z"/><path d="M8 6.2C9.3 6.2 10.4 6.6 11.2 7.4L12.3 6.3C11.1 5.2 9.6 4.5 8 4.5C6.4 4.5 4.9 5.2 3.7 6.3L4.8 7.4C5.6 6.6 6.7 6.2 8 6.2z"/><circle cx="8" cy="9.5" r="1.3"/></svg>
        <svg width="26" height="12" viewBox="0 0 26 12"><rect x="0.5" y="0.5" width="22" height="11" rx="3" stroke="#fff" strokeOpacity="0.4" fill="none"/><rect x="2" y="2" width="19" height="8" rx="2" fill="#fff"/><path d="M24 4v4c.7-.2 1.3-1 1.3-2s-.6-1.8-1.3-2z" fill="#fff" fillOpacity=".4"/></svg>
      </span>
    </div>
  );
}

function HomeIndicator() {
  return (
    <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 60, pointerEvents: 'none' }}>
      <div style={{ width: 134, height: 5, borderRadius: 100, background: 'rgba(255,255,255,0.5)' }} />
    </div>
  );
}

function BrightnessSlider({ value, onChange }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);

  const update = useCallback((clientX) => {
    const node = ref.current; if (!node) return;
    const r = node.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onChange(Math.round(t * 100));
  }, [onChange]);

  useEffect(() => {
    if (!drag) return;
    const mm = (e) => { e.preventDefault(); update(e.clientX); };
    const tm = (e) => { e.preventDefault(); update(e.touches[0].clientX); };
    const up = () => setDrag(false);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', tm, { passive: false });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', tm);
      window.removeEventListener('touchend', up);
    };
  }, [drag, update]);

  return (
    <div className="bf-brightness">
      <div className="bf-brightness-top">
        <div className="bf-brightness-circle">
          <span className="v">{value}</span>
        </div>
        <span className="bf-brightness-unit">%</span>
      </div>
      <div
        ref={ref}
        className={'bf-slider' + (drag ? ' is-dragging' : '')}
        onMouseDown={(e) => { e.preventDefault(); setDrag(true); update(e.clientX); }}
        onTouchStart={(e) => { setDrag(true); update(e.touches[0].clientX); }}
        style={{ cursor: 'ew-resize', touchAction: 'none' }}
      >
        <div className="bf-slider-fill" style={{ width: `${value}%` }} />
        <div className="bf-slider-ticks">
          {Array.from({ length: 21 }).map((_, i) => <span key={i} className="t" />)}
        </div>
      </div>
    </div>
  );
}

function FootswitchArc({ label, colorId, onChange, litArcs, labelInside, readOnly }) {
  const { t } = useBfI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const safeId = clamp(colorId, 0, 14);
  const color = LED_COLORS[safeId].hex;
  const isOff = safeId === 14;
  const r = 30, cx = 36, cy = 36;
  const arcs = [90, 210, 330];
  const seg = (a) => {
    const a1 = (a - 36) * Math.PI / 180;
    const a2 = (a + 36) * Math.PI / 180;
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };

  // Fechar ao clicar fora ja e responsabilidade do .bf-modal-backdrop
  // (renderizado em portal). Antes tinhamos um mousedown global aqui que,
  // depois que o popup virou portal, considerava CADA swatch como "fora"
  // do ref.current — o close disparava no mousedown antes do onClick do
  // swatch rodar, e a nova cor nunca chegava no onChange. Removido.

  return (
    <div className={'bf-fsw' + (labelInside ? ' has-label-inside' : '')} ref={ref} style={{ position: 'relative' }}>
      <button className="bf-fsw-glyph" style={{ '--led-c': color, border: 0, padding: 0, cursor: readOnly ? 'default' : 'pointer' }} onClick={readOnly ? undefined : () => setOpen((v) => !v)}>
        <svg className="bf-fsw-arcs" viewBox="0 0 72 72">
          {arcs.map((a, i) => {
            // litArcs (opcional): so esses indices ficam acesos, o resto
            // escuro. undefined = todos acesos (comportamento padrao).
            const arcLit = !litArcs || litArcs.includes(i);
            return (
              <path key={i} d={seg(a)}
                    stroke={(isOff || !arcLit) ? '#26262a' : color} />
            );
          })}
        </svg>
        {labelInside && <span className="bf-fsw-label bf-fsw-label-inside">{label}</span>}
      </button>
      {!labelInside && <span className="bf-fsw-label">{label}</span>}
      {!readOnly && open && ReactDOM.createPortal(
        <>
        <div className="bf-modal-backdrop" onClick={() => setOpen(false)} />
        <div className="bf-color-pop">
          <div className="bf-color-pop-head">
            <div className="bf-color-pop-preview" style={{ background: LED_COLORS[safeId].hex }} />
            <div className="bf-color-pop-info">
              <span className="bf-color-pop-eyebrow">COR ATUAL · {label}</span>
              <span className="bf-color-pop-name">{LED_COLORS[safeId].name}</span>
            </div>
            <button className="bf-color-pop-close" onClick={() => setOpen(false)} aria-label={t('common.close')}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6L18 18M18 6L6 18"/>
              </svg>
            </button>
          </div>
          <div className="bf-color-pop-grid">
            {LED_COLORS.map((c) => (
              <button
                key={c.id}
                className={'bf-swatch' + (c.id === safeId ? ' is-active' : '') + (c.id === 14 ? ' is-off' : '')}
                style={{ '--sw': c.hex }}
                onClick={() => { onChange(c.id); setOpen(false); }}
                aria-label={c.name}
              >{c.id === 14 && <span>OFF</span>}</button>
            ))}
          </div>
        </div>
        </>,
        document.body
      )}
    </div>
  );
}

// Esboco/preview do layout da tela LIVE selecionado (1..4). Desenha um
// "mock" da tela do pedal com tiles de SW e a faixa NOME DO PRESET nas
// posicoes de cada layout. So visual — espelha icon_draw_live_layout do
// firmware (ICONS_RENDER.h):
//   1: 3x2 tiles + faixa no meio
//   2: 3x2 tiles (sem faixa)
//   3: faixa no topo + 1x6 tiles
//   4: faixa no topo + 2x6 tiles (L1 em cima, L2 embaixo)
function LiveLayoutSketch({ layout, iconShape, namePresetLive, presetCount }) {
  const circle = iconShape === 'circle';
  const tileCls = 'bf-llsk-tile' + (circle ? ' is-circle' : '');
  // Placas de 4 switches (4S/MICRO): grids viram 2 cols, rows viram 4 tiles
  // (espelha is4sw do firmware).
  const sw4 = (presetCount || 6) <= 4;
  const gridN = sw4 ? 2 : 3;
  const rowN = sw4 ? 4 : 6;
  // small=true → tiles 70x70 quadrados (layouts 3/4), nao esticam.
  const Row = ({ n, small }) => (
    <div className={'bf-llsk-row' + (small ? ' is-small' : '')}>
      {Array.from({ length: n }).map((_, i) => (
        <div className={tileCls} key={i} />
      ))}
    </div>
  );
  // Faixa NOME DO PRESET: so aparece se namePresetLive (espelha o gate do
  // firmware em LIVE). OFF = placeholder invisivel que MANTEM a geometria
  // (os tiles ficam no mesmo lugar, igual no pedal — so some a faixa).
  const Strip = () => namePresetLive
    ? <div className="bf-llsk-strip">PRESET</div>
    : <div className="bf-llsk-strip is-empty" aria-hidden="true" />;
  return (
    <div className="bf-llsk">
      <div className={'bf-llsk-screen is-l' + layout}>
        {layout === 1 && (<><Row n={gridN} /><Strip /><Row n={gridN} /></>)}
        {layout === 2 && (<><Row n={gridN} /><Row n={gridN} /></>)}
        {layout === 3 && (<><Strip /><Row n={rowN} small /></>)}
        {layout === 4 && (
          <><Strip />
            <div className="bf-llsk-pair">
              <Row n={rowN} small /><Row n={rowN} small />
            </div>
          </>
        )}
      </div>
      <span className="bf-llsk-cap">
        PRÉVIA · LAYOUT {layout} · {circle ? 'REDONDO' : 'QUADRADO'}
      </span>
    </div>
  );
}

// ─── BANK ───────────────────────────────────────────────────────────
const DEFAULT_PRESET_META = () => ({
  name: '',
  bank: 0,            // MSB+LSB combinado, 0..16383
  channel: 0,         // 0 = MUTE/OFF (padrao), 1..16
  nameColorId: 4,     // SOLID Branco (DISPLAY_PALETTE)
  nameBorderColorId: 0, // TRANSPARENT (sem contorno por padrao)
  bgColorId: 0,       // TRANSPARENT (display fica preto na tela cheia)
  backLayersColorId: 0,
  tagColorId: 11,     // SOLID Laranja
  fontSize: 18,       // 9 (so bold), 12, 18, 24
  fontBold: false,    // FreeSans vs FreeSansBold
  // Posicao livre do nome no display: top-left do frame como % do espaco
  // livre da tela (0=borda esq/topo, 100=dir/base, 50=centro). Substitui o
  // antigo name_align (grade 3x3). 50/50 = centralizado (default).
  nameX: 50,
  nameY: 50,
  // LAYER 2 por preset: habilita a segunda camada de footswitches no LIVE
  // deste preset (icone "L2" no header do card PRINCIPAL). Chave `l2` no
  // header do firmware; arg `layer2` na API. Default OFF.
  layer2: false,
  // MASTER dos indicadores de SW externos neste preset. Ligado por padrao
  // para preservar presets antigos; o escopo PRESET/LIVE continua global.
  extIndicEnabled: true,
  // Extras: 4 PCs + 2 CCs. ch=0 indica slot desativado.
  extraPcs: [
    { ch: 0, program: 0 },
    { ch: 0, program: 0 },
    { ch: 0, program: 0 },
    { ch: 0, program: 0 },
  ],
  extraCcs: [
    { ch: 0, ctrl: 0, value: 0 },
    { ch: 0, ctrl: 0, value: 0 },
  ],
});

// Helpers para serializar/parsear extras na string compacta usada na API:
//   extra_pcs = "ch:pg,ch:pg,ch:pg,ch:pg"
//   extra_ccs = "ch:ctl:val,ch:ctl:val"
//
// NOTA DE ARQUITETURA: program/ctrl/value sao valores LOGICOS. A traducao
// para bytes MIDI reais (RAW PC, Bank MSB+LSB+PC, par de CCs, sysex...)
// acontece no firmware usando um OutputProfile por canal (a implementar).
// Trocar pedal de saida => editar OutputProfile, nunca os presets.
function parseExtraPcsStr(s) {
  const out = [
    { ch: 0, program: 0 }, { ch: 0, program: 0 },
    { ch: 0, program: 0 }, { ch: 0, program: 0 },
  ];
  if (typeof s !== 'string' || !s) return out;
  const parts = s.split(',');
  for (let i = 0; i < 4 && i < parts.length; i++) {
    const [ch, pg] = parts[i].split(':');
    out[i].ch = clamp(parseInt(ch, 10) || 0, 0, 16);
    out[i].program = clamp(parseInt(pg, 10) || 0, 0, 127);
  }
  return out;
}
function serializeExtraPcs(arr) {
  return arr.map(p => `${p.ch | 0}:${p.program | 0}`).join(',');
}
function parseExtraCcsStr(s) {
  const out = [
    { ch: 0, ctrl: 0, value: 0 }, { ch: 0, ctrl: 0, value: 0 },
  ];
  if (typeof s !== 'string' || !s) return out;
  const parts = s.split(',');
  for (let i = 0; i < 2 && i < parts.length; i++) {
    const [ch, ctl, val] = parts[i].split(':');
    out[i].ch = clamp(parseInt(ch, 10) || 0, 0, 16);
    out[i].ctrl = clamp(parseInt(ctl, 10) || 0, 0, 127);
    out[i].value = clamp(parseInt(val, 10) || 0, 0, 127);
  }
  return out;
}
function serializeExtraCcs(arr) {
  return arr.map(c => `${c.ch | 0}:${c.ctrl | 0}:${c.value | 0}`).join(',');
}

// Tamanhos disponiveis: regular nao tem 9pt, so bold.
const FONT_SIZES_BOLD = [9, 12, 18, 24];
const FONT_SIZES_REGULAR = [12, 18, 24];
function fontSizesFor(bold) { return bold ? FONT_SIZES_BOLD : FONT_SIZES_REGULAR; }
function nextFontSize(size, bold) {
  const list = fontSizesFor(bold);
  const idx = list.indexOf(size);
  return list[(idx + 1) % list.length];
}
function clampFontSize(size, bold) {
  const list = fontSizesFor(bold);
  return list.includes(size) ? size : list[0];
}

// excludeImages: omite a secao IMAGES do popover. Usado nos pickers de cor de
// tile do SW (icone, border, bg do tile) — imagens so fazem sentido como
// background da tela inteira (bg_color / back_layers_color), nao em fills de
// pequenos rects que o firmware renderiza com display_color_resolve_solid.
function ColorBar({ label, colorId, onChange, restrictTypes, excludeImages }) {
  const { t } = useBfI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const safeId = clamp(colorId, 0, DISPLAY_PALETTE.length - 1);
  const safe = DISPLAY_PALETTE[safeId] || DISPLAY_PALETTE[0];
  const fill = paletteBackground(safe, safeId);
  // Inscreve no ImageStore — re-renderiza quando upload/delete acontece em
  // outro lugar do app (ex: card Upload Images do GLOBAL). useImageStore ja
  // dispara fetchList lazy na primeira chamada.
  useImageStore();

  // Fechar ao clicar fora ja e responsabilidade do .bf-modal-backdrop
  // (renderizado em portal). Antes tinhamos um mousedown global aqui que,
  // depois que o popup virou portal, considerava CADA swatch como "fora"
  // do ref.current — o close disparava no mousedown antes do onClick do
  // swatch rodar, e a nova cor nunca chegava no onChange. Removido.

  const allowType = (t) => !restrictTypes || restrictTypes.includes(t);
  const sectionDefs = [
    // IMAGES vem PRIMEIRO conforme pedido do usuario (preview no inicio do
    // picker). Filtrada por allowType (restrictTypes a TRANSPARENT/SOLID
    // omite imagens em nameColor/border/tag) E por excludeImages (omite em
    // cor de tile dos switches — display nao renderiza imagem em tile pequeno).
    { id: 'images',      title: 'IMAGES',        type: DISP_TYPE.BACK_IMAGE,  ids: PALETTE_SECTIONS.images, skipIf: excludeImages },
    { id: 'transparent', title: 'TRANSPARENCIA', type: DISP_TYPE.TRANSPARENT, ids: PALETTE_SECTIONS.transparent },
    { id: 'solid',       title: 'SOLID COLORS',  type: DISP_TYPE.SOLID,       ids: PALETTE_SECTIONS.solid },
    { id: 'g1',          title: 'GRADIENT 1',    type: DISP_TYPE.GRADIENT_1,  ids: PALETTE_SECTIONS.g1 },
    { id: 'g2',          title: 'GRADIENT 2',    type: DISP_TYPE.GRADIENT_2,  ids: PALETTE_SECTIONS.g2 },
    { id: 'custom',      title: 'CUSTOM',        type: DISP_TYPE.CUSTOM_BLACK,ids: PALETTE_SECTIONS.custom },
    { id: 'misc',        title: 'MISC GRADIENTS',type: DISP_TYPE.MISC_GRADIENT,ids: PALETTE_SECTIONS.misc },
  ].filter((s) => allowType(s.type) && !s.skipIf);

  return (
    <div className="bf-field" ref={ref} style={{ position: 'relative' }}>
      <span className="bf-field-label">{label}</span>
      <button
        type="button"
        className="bf-color-bar"
        style={{ background: fill }}
        onClick={() => setOpen((v) => !v)}
        aria-label={`${label}: ${safe.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      />
      {open && ReactDOM.createPortal(
        <>
          <div className="bf-modal-backdrop" onClick={() => setOpen(false)} />
          <div className="bf-color-pop bf-palette-pop">
            <div className="bf-color-pop-head">
              <div className="bf-color-pop-preview" style={{ background: fill }} />
              <div className="bf-color-pop-info">
                <span className="bf-color-pop-eyebrow">COR ATUAL · {label}</span>
                <span className="bf-color-pop-name">{safe.name}</span>
              </div>
              <button className="bf-color-pop-close" onClick={() => setOpen(false)} aria-label={t('common.close')}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M6 6L18 18M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="bf-palette-scroll">
              {sectionDefs.map((sec) => (
                <div key={sec.id} className={'bf-palette-section bf-palette-section-' + sec.id}>
                  <div className="bf-palette-section-title">{sec.title}</div>
                  <div className={'bf-color-pop-grid' + (sec.id === 'images' ? ' bf-color-pop-grid-images' : '')}>
                    {sec.ids.map((id) => {
                      const c = DISPLAY_PALETTE[id];
                      // Para IMAGES, paletteBackground(c, id) consulta o ImageStore
                      // e devolve url(blobUrl) se carregado, ou hash cinza se slot
                      // vazio. Slot vazio fica selecionavel mas o firmware faz
                      // fallback pra preto (ver bfmidi_fill_or_image).
                      const isImage = c.type === DISP_TYPE.BACK_IMAGE;
                      const slot = isImage ? imageSlotOfId(id) : -1;
                      const exists = slot >= 0 && _imageStore.slots[slot] &&
                                     _imageStore.slots[slot].exists;
                      return (
                        <button
                          key={id}
                          type="button"
                          className={'bf-swatch' + (id === safeId ? ' is-active' : '') +
                                     (isImage ? ' bf-swatch-image' : '') +
                                     (isImage && !exists ? ' bf-swatch-image-empty' : '')}
                          style={{ '--sw': hexToCss(c.hex), background: paletteBackground(c, id) }}
                          onClick={() => { onChange(id); setOpen(false); }}
                          aria-label={isImage ? `${c.name}${exists ? '' : ' (vazio)'}` : c.name}
                          title={isImage ? `${c.name}${exists ? '' : ' — slot vazio'}` : c.name}
                        >
                          {isImage && <span className="bf-swatch-image-label">{(slot + 1)}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

// Posicao livre do nome (0..100 cada eixo). Migra presets antigos que so tem
// name_align (0..8 grade 3x3): col*50 / row*50. Se name_x/name_y existem (o
// firmware ja os emite, derivando do name_align quando necessario), usa direto.
function parseNameXY(json) {
  const hasX = json.name_x !== undefined && json.name_x !== null;
  const hasY = json.name_y !== undefined && json.name_y !== null;
  if (hasX || hasY) {
    return {
      nameX: clamp(parseInt(json.name_x, 10) || 0, 0, 100),
      nameY: clamp(parseInt(json.name_y, 10) || 0, 0, 100),
    };
  }
  const a = clamp(parseInt(json.name_align, 10) || 0, 0, 8);
  return { nameX: (a % 3) * 50, nameY: Math.floor(a / 3) * 50 };
}

// ─── NAME POSITION — preview do display + frame arrastavel ──────────
//
// Espelha display_draw_centered (DISPLAY_320/480.h): o frame do nome (tag bg +
// texto + contorno) e posicionado pelo top-left como fracao do espaco livre da
// tela (nameX/nameY 0..100). Truque CSS: left/top em % do container + translate
// negativo de % do PROPRIO frame => 0=encosta esq/topo, 100=dir/base, 50=centro,
// sem precisar medir nada pra renderizar. O drag mede container+frame so no
// pointerdown pra converter px -> %.

// Constroi o estilo inline do frame a partir do meta + escala + posicao.
function npFrameStyle(meta, scale, pos, isBig, interactive) {
  const palLen = DISPLAY_PALETTE.length;
  const tagType = DISPLAY_PALETTE[clamp(meta.tagColorId, 0, palLen - 1)].type;
  const nameType = DISPLAY_PALETTE[clamp(meta.nameColorId, 0, palLen - 1)].type;
  const borderType = DISPLAY_PALETTE[clamp(meta.nameBorderColorId, 0, palLen - 1)].type;
  const tagBg = tagType === DISP_TYPE.TRANSPARENT ? 'transparent' : paletteCss(meta.tagColorId);
  const nameColor = nameType === DISP_TYPE.TRANSPARENT ? 'transparent' : paletteCssSolid(meta.nameColorId);
  const borderColor = borderType === DISP_TYPE.TRANSPARENT ? null : paletteCssSolid(meta.nameBorderColorId);
  const padX = (isBig ? 18 : 14) * scale;
  const padY = (isBig ? 10 : 8) * scale;
  const radius = (isBig ? 12 : 10) * scale;
  const font = (meta.fontSize || 18) * scale;
  const x = clamp(pos.x, 0, 100), y = clamp(pos.y, 0, 100);
  const ol = borderColor
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
        .map(([dx, dy]) => `${borderColor} ${dx}px ${dy}px 0`).join(', ')
    : 'none';
  return {
    position: 'absolute', left: `${x}%`, top: `${y}%`,
    transform: `translate(${-x}%, ${-y}%)`,
    background: tagBg, color: nameColor,
    fontWeight: meta.fontBold ? 700 : 400,
    fontSize: `${font}px`, lineHeight: 1.05,
    padding: `${padY}px ${padX}px`, borderRadius: `${radius}px`,
    whiteSpace: 'nowrap', userSelect: 'none', textShadow: ol,
    cursor: interactive ? 'grab' : 'default', touchAction: 'none',
    maxWidth: '100%', boxSizing: 'border-box',
  };
}

function npLabel(meta, tag) {
  const n = (meta && typeof meta.name === 'string') ? meta.name.trim() : '';
  return n || tag || 'B1';
}

// Retangulos (px no display) dos tiles de SW pro layout de PRESET ativo (1..4).
// Espelha icon_draw_live_layout (ICONS_RENDER.h) pra o preview mostrar a AREA
// ocupada pelos icones — assim o usuario posiciona o nome no vazio. Layout 0
// (classica) e 5 (lista) => sem tiles. presetMode=true (offset do L3/L4).
function presetLayoutTiles(layout, W, H, is4sw, big, customLayout = null) {
  const rects = [];
  const row = (cols, xStart, tileW, tileH, gapX, y) => {
    for (let c = 0; c < cols; c++) {
      rects.push({ x: xStart + c * (tileW + gapX), y, w: tileW, h: tileH });
    }
  };
  if (layout === 1) {
    const tileW = big ? 150 : 100, tileH = big ? 120 : 80, stripH = big ? 56 : 40;
    const cols = is4sw ? 2 : 3;
    const gapX = (W - cols * tileW) / (cols + 1), xStart = gapX;
    const gapY = (H - (2 * tileH + stripH)) / 4;
    const yTop = gapY, yStrip = yTop + tileH + gapY, yBot = yStrip + stripH + gapY;
    row(cols, xStart, tileW, tileH, gapX, yTop);
    row(cols, xStart, tileW, tileH, gapX, yBot);
  } else if (layout === 2) {
    const tileW = big ? 150 : 100, tileH = big ? 150 : 100;
    const cols = is4sw ? 2 : 3;
    const gapX = (W - cols * tileW) / (cols + 1), xStart = gapX;
    const gapY = (H - 2 * tileH) / 3;
    const yTop = gapY, yBot = yTop + tileH + gapY;
    row(cols, xStart, tileW, tileH, gapX, yTop);
    row(cols, xStart, tileW, tileH, gapX, yBot);
  } else if (layout === 3) {
    const tileW = big ? 70 : 47, tileH = big ? 70 : 47, stripH = big ? 80 : 56;
    const cols = is4sw ? 4 : 6;
    const gapX = (W - cols * tileW) / (cols + 1), xStart = gapX;
    const gapY = (H - stripH - tileH) / 3;
    const yRow = gapY + stripH + gapY + 10;  // presetMode desce 10px
    row(cols, xStart, tileW, tileH, gapX, yRow);
  } else if (layout === 4) {
    const tileW = big ? 70 : 47, tileH = big ? 70 : 47, stripH = big ? 56 : 40;
    const cols = is4sw ? 4 : 6;
    const gapX = (W - cols * tileW) / (cols + 1), xStart = gapX;
    const innerGapY = big ? 6 : 4;
    const gapY = (H - (stripH + 2 * tileH + innerGapY)) / 3;
    const yStrip = gapY + 20, yRowL1 = yStrip + stripH + gapY;
    const yRowL2 = yRowL1 + tileH + innerGapY;
    row(cols, xStart, tileW, tileH, gapX, yRowL1);
    row(cols, xStart, tileW, tileH, gapX, yRowL2);
  } else if ((layout === 5 || layout === 6) && Array.isArray(customLayout)) {
    const items = customLayout;
    const count = is4sw ? 4 : 6;
    items.slice(0, count).forEach((it) => {
      if (!it || !it.enabled) return;
      const tile = H * clamp(it.size, CUSTOM_LAYOUT_MIN_SIZE,
                             CUSTOM_LAYOUT_MAX_SIZE) / 100;
      rects.push({
        x: (W - tile) * clamp(it.x, 0, 100) / 100,
        y: (H - tile) * clamp(it.y, 0, 100) / 100,
        w: tile, h: tile,
      });
    });
  }
  return rects;
}

// Mini preview estatico no botao do card. Altura fixa via CSS; escala derivada.
function NamePosMiniPreview({ meta, tag }) {
  useImageStore();  // re-render se o slot de imagem de fundo carregar
  const res = __displayRes;
  const isBig = res.w >= 400;
  const MINI_H = 76;
  const scale = MINI_H / res.h;
  const pos = { x: clamp(meta.nameX ?? 50, 0, 100), y: clamp(meta.nameY ?? 50, 0, 100) };
  return (
    <div className="bf-namepos-screen bf-namepos-mini"
         style={{ height: `${MINI_H}px`, aspectRatio: `${res.w} / ${res.h}` }}>
      <div className="bf-namepos-bg" style={{ background: paletteCss(meta.bgColorId) }} />
      <div className="bf-namepos-frame" style={npFrameStyle(meta, scale, pos, isBig, false)}>
        {npLabel(meta, tag)}
      </div>
    </div>
  );
}

// Modal: display em escala + frame arrastavel (mouse e touch). onApply(x, y).
function NamePositionEditor({ meta, tag, onClose, onApply }) {
  const { t } = useBfI18n();
  useImageStore();
  const res = __displayRes;
  const isBig = res.w >= 400;
  const [pos, setPos] = useState({
    x: clamp(meta.nameX ?? 50, 0, 100), y: clamp(meta.nameY ?? 50, 0, 100),
  });
  const [scale, setScale] = useState(0);
  const screenRef = useRef(null);
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  // Area dos icones do layout de PRESET ativo (1..4). Layout 0/5 => sem tiles.
  const tiles = presetLayoutTiles(
    __presetLayout, res.w, res.h, __is4sw, isBig,
    __presetLayout === 6 ? __presetCustomLayout : null,
  );
  const isListLayout = __presetLayout === 5;

  // Escala da fonte/pad = altura renderizada / altura logica do display.
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    const upd = () => setScale(el.clientHeight / res.h);
    upd();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(upd);
      ro.observe(el);
    }
    return () => { if (ro) ro.disconnect(); };
  }, [res.h]);

  const onDown = (e) => {
    const box = screenRef.current, fr = frameRef.current;
    if (!box || !fr) return;
    try { fr.setPointerCapture(e.pointerId); } catch {}
    const br = box.getBoundingClientRect();
    const fw = fr.offsetWidth, fh = fr.offsetHeight;
    const travelX = Math.max(0, br.width - fw);
    const travelY = Math.max(0, br.height - fh);
    dragRef.current = {
      id: e.pointerId, travelX, travelY, sx: e.clientX, sy: e.clientY,
      startLeft: (pos.x / 100) * travelX, startTop: (pos.y / 100) * travelY,
    };
  };
  const onMove = (e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const nl = clamp(d.startLeft + (e.clientX - d.sx), 0, d.travelX);
    const nt = clamp(d.startTop + (e.clientY - d.sy), 0, d.travelY);
    setPos({
      x: d.travelX ? Math.round((nl / d.travelX) * 100) : 50,
      y: d.travelY ? Math.round((nt / d.travelY) * 100) : 50,
    });
  };
  const onUp = (e) => {
    const d = dragRef.current;
    if (d && d.id === e.pointerId) {
      dragRef.current = null;
      try { frameRef.current.releasePointerCapture(e.pointerId); } catch {}
    }
  };

  return ReactDOM.createPortal(
    <div className="bf-modal-backdrop bf-modal-backdrop-strong" onClick={onClose}>
      <div className="bf-modal bf-namepos-modal" role="dialog"
           aria-label={t('preset.alignTitle')} onClick={(e) => e.stopPropagation()}>
        <div className="bf-modal-head">
          <span className="bf-modal-title">{t('preset.alignTitle')}</span>
          <button type="button" className="bf-modal-close" onClick={onClose}
                  aria-label={t('common.close')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M5 5 L19 19 M19 5 L5 19" />
            </svg>
          </button>
        </div>
        <div className="bf-namepos-body">
          <div className="bf-namepos-screen bf-namepos-stage" ref={screenRef}
               style={{ aspectRatio: `${res.w} / ${res.h}` }}>
            <div className="bf-namepos-bg" style={{ background: paletteCss(meta.bgColorId) }} />
            {tiles.map((r, i) => (
              <div key={i} className="bf-namepos-tile" style={{
                left: `${(r.x / res.w) * 100}%`, top: `${(r.y / res.h) * 100}%`,
                width: `${(r.w / res.w) * 100}%`, height: `${(r.h / res.h) * 100}%`,
              }} />
            ))}
            {scale > 0 && (
              <div ref={frameRef} className="bf-namepos-frame bf-namepos-frame-drag"
                   style={npFrameStyle(meta, scale, pos, isBig, true)}
                   onPointerDown={onDown} onPointerMove={onMove}
                   onPointerUp={onUp} onPointerCancel={onUp}>
                {npLabel(meta, tag)}
              </div>
            )}
          </div>
          <p className="bf-namepos-hint">
            {isListLayout ? t('preset.alignListNote')
              : tiles.length ? t('preset.alignHintIcons') : t('preset.alignHint')}
          </p>
          <div className="bf-namepos-readout">X {pos.x}% · Y {pos.y}%</div>
        </div>
        <div className="bf-image-editor-actions bf-namepos-actions">
          <button type="button" className="bf-action bf-action-ghost"
                  onClick={() => setPos({ x: 50, y: 50 })}>
            {t('preset.alignReset')}
          </button>
          <button type="button" className="bf-action bf-action-primary"
                  onClick={() => onApply(pos.x, pos.y)}>
            {t('preset.alignApply')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── INDICADORES ESW — helpers, mini preview e editor de posição ─────
// Retângulos ESW1/ESW2 na tela mostrando o estado on/off dos dual switches
// externos. Posição livre (x/y 0..100) por caixa, arrastável (mesma mecânica do
// nome do preset). Firmware: EXT_INDIC.h. Só placas com hasExtDual.

// Preto ou branco conforme a luminância do fill (espelha extIndicContrast no fw).
function eswContrast(colorId) {
  const c = DISPLAY_PALETTE[clamp(colorId, 0, DISPLAY_PALETTE.length - 1)];
  const hex = c ? c.hex : 0;
  const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#000' : '#fff';
}

// Estilo de uma caixa ESW posicionada por fração do espaço livre (left/top % +
// translate negativo do próprio frame) — igual npFrameStyle.
function eswBoxStyle(colorId, scale, xPct, yPct, interactive) {
  const x = clamp(xPct, 0, 100), y = clamp(yPct, 0, 100);
  const fg = eswContrast(colorId);
  return {
    position: 'absolute', left: `${x}%`, top: `${y}%`,
    transform: `translate(${-x}%, ${-y}%)`,
    background: paletteCssSolid(colorId), color: fg,
    border: `1px solid ${fg}`, fontWeight: 700,
    fontSize: `${15 * scale}px`, lineHeight: 1,
    padding: `${5 * scale}px ${9 * scale}px`, borderRadius: `${6 * scale}px`,
    whiteSpace: 'nowrap', userSelect: 'none', boxSizing: 'border-box',
    cursor: interactive ? 'grab' : 'default', touchAction: 'none',
  };
}

function eswSigla(siglas, i) {
  const s = (siglas && typeof siglas[i] === 'string') ? siglas[i].trim() : '';
  return s || `ESW${i + 1}`;
}

// Mini preview estático no card: áreas dos ícones (tiles do layout em escopo) +
// as 2 caixas na SUA cor ON. `activeIndex` (opcional): destaca essa caixa e
// esmaece a outra (referência de posição relativa).
function ExtIndicMiniPreview({ onColors, siglas, x, y, tilesLayout, customLayout, activeIndex }) {
  const res = __displayRes;
  const MINI_H = 76;
  const scale = MINI_H / res.h;
  const tiles = presetLayoutTiles(
    tilesLayout, res.w, res.h, __is4sw, res.w >= 400, customLayout,
  );
  return (
    <div className="bf-namepos-screen bf-namepos-mini"
         style={{ height: `${MINI_H}px`, aspectRatio: `${res.w} / ${res.h}` }}>
      <div className="bf-namepos-bg" style={{ background: '#0c0d10' }} />
      {tiles.map((r, i) => (
        <div key={'t' + i} className="bf-namepos-tile" style={{
          left: `${(r.x / res.w) * 100}%`, top: `${(r.y / res.h) * 100}%`,
          width: `${(r.w / res.w) * 100}%`, height: `${(r.h / res.h) * 100}%`,
        }} />
      ))}
      {[0, 1].map((i) => {
        const dim = activeIndex != null && i !== activeIndex;
        return (
          <div key={i} style={{ ...eswBoxStyle(onColors[i], scale, x[i], y[i], false),
                                opacity: dim ? 0.35 : 1 }}>
            {eswSigla(siglas, i)}
          </div>
        );
      })}
    </div>
  );
}

// Modal: display em escala + caixas ESW sobre o pre-render de ícones.
// `activeIndex` (opcional): só essa caixa é arrastável; a outra fica como
// referência esmaecida. Sem activeIndex, ambas arrastáveis. onApply(xArr, yArr).
function ExtIndicPositionEditor({ onColors, offColors, siglas, x, y, tilesLayout, customLayout, activeIndex, onClose, onApply }) {
  const { t } = useBfI18n();
  const res = __displayRes;
  const isBig = res.w >= 400;
  const canDrag = (i) => activeIndex == null || i === activeIndex;
  const [pos, setPos] = useState([{ x: x[0], y: y[0] }, { x: x[1], y: y[1] }]);
  const [scale, setScale] = useState(0);
  const screenRef = useRef(null);
  const frame0 = useRef(null), frame1 = useRef(null);
  const frameRefs = [frame0, frame1];
  const dragRef = useRef(null);
  // Áreas dos ícones do layout em escopo (mesmo pre-render do editor de nome) —
  // pra o usuário posicionar as caixas ESW no vazio, longe dos ícones. Layout 0
  // (preset clássico) e 5 (lista) => sem tiles.
  const tiles = presetLayoutTiles(
    tilesLayout, res.w, res.h, __is4sw, isBig, customLayout,
  );
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    const upd = () => setScale(el.clientHeight / res.h);
    upd();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(upd); ro.observe(el); }
    return () => { if (ro) ro.disconnect(); };
  }, [res.h]);
  const onDown = (i) => (e) => {
    const box = screenRef.current, fr = frameRefs[i].current;
    if (!box || !fr) return;
    try { fr.setPointerCapture(e.pointerId); } catch {}
    const br = box.getBoundingClientRect();
    const travelX = Math.max(0, br.width - fr.offsetWidth);
    const travelY = Math.max(0, br.height - fr.offsetHeight);
    dragRef.current = {
      i, id: e.pointerId, travelX, travelY, sx: e.clientX, sy: e.clientY,
      startLeft: (pos[i].x / 100) * travelX, startTop: (pos[i].y / 100) * travelY,
    };
  };
  const onMove = (e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const nl = clamp(d.startLeft + (e.clientX - d.sx), 0, d.travelX);
    const nt = clamp(d.startTop + (e.clientY - d.sy), 0, d.travelY);
    setPos((prev) => {
      const next = prev.slice();
      next[d.i] = {
        x: d.travelX ? Math.round((nl / d.travelX) * 100) : 50,
        y: d.travelY ? Math.round((nt / d.travelY) * 100) : 50,
      };
      return next;
    });
  };
  const onUp = (e) => {
    const d = dragRef.current;
    if (d && d.id === e.pointerId) {
      dragRef.current = null;
      try { frameRefs[d.i].current.releasePointerCapture(e.pointerId); } catch {}
    }
  };
  const colorOf = (i) => onColors[i];  // cada caixa na sua cor ON
  return ReactDOM.createPortal(
    <div className="bf-modal-backdrop bf-modal-backdrop-strong" onClick={onClose}>
      <div className="bf-modal bf-namepos-modal" role="dialog"
           aria-label={t('glob.esw.posTitle')} onClick={(e) => e.stopPropagation()}>
        <div className="bf-modal-head">
          <span className="bf-modal-title">{t('glob.esw.posTitle')}</span>
          <button type="button" className="bf-modal-close" onClick={onClose} aria-label={t('common.close')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M5 5 L19 19 M19 5 L5 19" />
            </svg>
          </button>
        </div>
        <div className="bf-namepos-body">
          <div className="bf-namepos-screen bf-namepos-stage" ref={screenRef}
               style={{ aspectRatio: `${res.w} / ${res.h}` }}>
            <div className="bf-namepos-bg" style={{ background: '#0c0d10' }} />
            {tiles.map((r, i) => (
              <div key={'t' + i} className="bf-namepos-tile" style={{
                left: `${(r.x / res.w) * 100}%`, top: `${(r.y / res.h) * 100}%`,
                width: `${(r.w / res.w) * 100}%`, height: `${(r.h / res.h) * 100}%`,
              }} />
            ))}
            {scale > 0 && [0, 1].map((i) => (
              canDrag(i) ? (
                <div key={i} ref={frameRefs[i]} className="bf-namepos-frame-drag"
                     style={eswBoxStyle(colorOf(i), scale, pos[i].x, pos[i].y, true)}
                     onPointerDown={onDown(i)} onPointerMove={onMove}
                     onPointerUp={onUp} onPointerCancel={onUp}>
                  {eswSigla(siglas, i)}
                </div>
              ) : (
                <div key={i} style={{ ...eswBoxStyle(colorOf(i), scale, pos[i].x, pos[i].y, false),
                                      opacity: 0.35, pointerEvents: 'none' }}>
                  {eswSigla(siglas, i)}
                </div>
              )
            ))}
          </div>
          <p className="bf-namepos-hint">{t('glob.esw.posHint')}</p>
          <div className="bf-namepos-readout">
            {activeIndex != null
              ? `${eswSigla(siglas, activeIndex)} X ${pos[activeIndex].x}% · Y ${pos[activeIndex].y}%`
              : `${eswSigla(siglas, 0)} X ${pos[0].x}% · Y ${pos[0].y}%  |  ${eswSigla(siglas, 1)} X ${pos[1].x}% · Y ${pos[1].y}%`}
          </div>
        </div>
        <div className="bf-image-editor-actions bf-namepos-actions">
          <button type="button" className="bf-action bf-action-ghost"
                  onClick={() => setPos((prev) => {
                    const def = [{ x: 6, y: 6 }, { x: 6, y: 22 }];
                    if (activeIndex == null) return def;
                    const next = prev.slice(); next[activeIndex] = def[activeIndex]; return next;
                  })}>
            {t('preset.alignReset')}
          </button>
          <button type="button" className="bf-action bf-action-primary"
                  onClick={() => onApply([pos[0].x, pos[1].x], [pos[0].y, pos[1].y])}>
            {t('preset.alignApply')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function metaFromApi(json) {
  if (!json || typeof json !== 'object') return DEFAULT_PRESET_META();
  const fontBold = String(json.font_bold) === '1' || json.font_bold === true;
  const rawSize = parseInt(json.font_size, 10);
  const fontSize = clampFontSize(Number.isFinite(rawSize) ? rawSize : 18, fontBold);
  return {
    name: typeof json.name_raw === 'string' ? json.name_raw : '',
    bank: clamp(parseInt(json.midi_bank, 10) || 0, 0, 16383),
    channel: clamp(parseInt(json.channel, 10) || 0, 0, 16),
    nameColorId: clamp(parseInt(json.name_color, 10) || 0, 0, DISPLAY_PALETTE.length - 1),
    nameBorderColorId: clamp(parseInt(json.name_border_color, 10) || 0, 0, DISPLAY_PALETTE.length - 1),
    bgColorId: clamp(parseInt(json.bg_color, 10) || 0, 0, DISPLAY_PALETTE.length - 1),
    backLayersColorId: clamp(parseInt(json.back_layers_color, 10) || 0, 0, DISPLAY_PALETTE.length - 1),
    tagColorId: clamp(parseInt(json.tag_color, 10) || 0, 0, DISPLAY_PALETTE.length - 1),
    fontSize,
    fontBold,
    ...parseNameXY(json),
    layer2: Number(json.layer2) === 1,
    extIndicEnabled: typeof json.ext_indic_enabled === 'undefined'
      ? true
      : Number(json.ext_indic_enabled) === 1,
    extraPcs: parseExtraPcsStr(json.extra_pcs),
    extraCcs: parseExtraCcsStr(json.extra_ccs),
  };
}

function metaToApiBody(meta) {
  const body = new URLSearchParams();
  body.set('name', meta.name);
  body.set('midi_bank', String(meta.bank));
  body.set('channel', String(meta.channel));
  body.set('name_color', String(meta.nameColorId));
  body.set('name_border_color', String(meta.nameBorderColorId));
  body.set('bg_color', String(meta.bgColorId));
  body.set('back_layers_color', String(meta.backLayersColorId));
  body.set('tag_color', String(meta.tagColorId));
  body.set('font_size', String(meta.fontSize));
  body.set('font_bold', meta.fontBold ? '1' : '0');
  body.set('name_x', String(clamp(meta.nameX ?? 50, 0, 100)));
  body.set('name_y', String(clamp(meta.nameY ?? 50, 0, 100)));
  body.set('layer2', meta.layer2 ? '1' : '0');
  body.set('ext_indic_enabled', meta.extIndicEnabled !== false ? '1' : '0');
  body.set('extra_pcs', serializeExtraPcs(meta.extraPcs || []));
  body.set('extra_ccs', serializeExtraCcs(meta.extraCcs || []));
  return body;
}

function PresetEditorCard({ tag, onDisplayNameChange, onRegisterSave, savedSwModes, savedSwParams, reloadToken, paramsTarget, hidePresetTab, hideExtrasTab, noFrame }) {
  const { t } = useBfI18n();
  const [metaByTag, setMetaByTag] = useState({});
  const [savedMetaByTag, setSavedMetaByTag] = useState({});
  const [status, setStatus] = useState('idle'); // idle | loading | saving | saved | error
  // Mobile (Studio redesign): a aba PRESET (nome + PC + CANAL) e absorvida
  // pelo NowPlayingCard — abre direto na DISPLAY/TELA pra nao mostrar uma
  // aba vazia.
  const [activeTab, setActiveTab] = useState(hidePresetTab ? 'display' : 'midi');
  // meta tem que ter REFERENCIA estavel entre renders quando nada mudou —
  // a useEffect de registro do save handle inclui `meta` como dep e o
  // NowPlayingCard mobile dispara setPresetMeta(meta) no pai. Sem useMemo,
  // DEFAULT_PRESET_META() retorna um objeto novo a cada render -> dep
  // muda -> setPresetMeta -> re-render -> loop infinito.
  const meta = useMemo(
    () => metaByTag[tag] || DEFAULT_PRESET_META(),
    [metaByTag, tag]
  );
  const savedMeta = savedMetaByTag[tag];
  const isDirty = savedMeta
    ? JSON.stringify(meta) !== JSON.stringify(savedMeta)
    : false;

  // Carrega meta do firmware ao trocar de tag (uma vez por tag). Usa
  // apiCall (HTTP ou USB conforme transporte ativo). reloadToken bumpa
  // depois de PASTE PRESET/BANK pra invalidar o cache e re-buscar — sem
  // isso o cache stale faz o SAVE do rodape sobrescrever o paste.
  useEffect(() => {
    if (metaByTag[tag] || (!DEVICE_API && !_transport.usbConnected)) return;
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        const json = await apiCall('GET', `/bank/preset?bank=${encodeURIComponent(tag)}`);
        if (cancelled) return;
        const loaded = metaFromApi(json.meta || json);
        setMetaByTag((prev) => ({ ...prev, [tag]: loaded }));
        setSavedMetaByTag((prev) => ({ ...prev, [tag]: loaded }));
        setStatus('idle');
      } catch (e) {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [tag, metaByTag]);

  // Invalida o cache de meta do tag corrente quando reloadToken bumpa
  // (paste preset/bank, ou transport recem-conectado). O useEffect acima
  // entao re-busca do firmware. SEMPRE cria um novo metaByTag (mesmo se
  // o tag nao estava cacheado) — sem isso, quando o fetch inicial falhou
  // por falta de transport, o reload nao re-disparava.
  useEffect(() => {
    if (!reloadToken) return;
    setMetaByTag((prev) => {
      const next = { ...prev };
      delete next[tag];
      return next;
    });
  }, [reloadToken, tag]);

  const savePreset = useCallback(async () => {
    if ((!DEVICE_API && !_transport.usbConnected) || !metaByTag[tag]) return;
    setStatus('saving');
    try {
      await apiCall('POST', `/bank/preset?bank=${encodeURIComponent(tag)}`, metaToApiBody(meta));
      setSavedMetaByTag((prev) => ({ ...prev, [tag]: meta }));
      setStatus('saved');
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1200);
    } catch (e) {
      setStatus('error');
    }
  }, [tag, meta, metaByTag]);

  const update = useCallback((patch) => {
    setMetaByTag((prev) => ({
      ...prev,
      [tag]: { ...(prev[tag] || DEFAULT_PRESET_META()), ...patch },
    }));
  }, [tag]);

  const displayName = meta.name || tag;
  useEffect(() => {
    if (onDisplayNameChange) onDisplayNameChange(meta.name || '');
  }, [meta.name, tag, onDisplayNameChange]);

  // Registra savePreset + estado pro botao SAVE global (TabBar) acionar.
  // Tambem expoe meta + update pro NowPlayingCard (Studio mobile) absorver
  // os campos PC/CANAL/NOME do preset que antigamente so existiam na aba
  // PRESET do PARAMETROS card. Quem nao precisa, ignora os campos novos.
  useEffect(() => {
    if (!onRegisterSave) return;
    onRegisterSave({ save: savePreset, status, isDirty, meta, update });
  }, [onRegisterSave, savePreset, status, isDirty, meta, update]);

  // Ao desmontar (ex: trocar pra LIVE MODE, o card some), limpa o registro
  // pra que o botao SAVE do TabBar volte a idle. onRegisterSave e estavel
  // (useCallback []), entao este cleanup so roda no unmount.
  useEffect(() => {
    return () => { if (onRegisterSave) onRegisterSave(null); };
  }, [onRegisterSave]);
  const statusLabel = {
    loading: t('preset.st.loading'),
    saving: t('preset.st.saving'),
    saved: t('preset.st.saved'),
    error: t('preset.st.error'),
    idle: '',
  }[status];

  const [namePosOpen, setNamePosOpen] = useState(false);

  return maybePortal(
    <div className={'bf-preset-card bf-preset-card-params' + (noFrame ? ' bf-preset-card-attached' : '')}>
      <div className="bf-preset-card-head bf-preset-card-head-with-tabs">
        {!noFrame && <h2 className="bf-preset-card-title">{t('preset.parameters')}</h2>}
        <div className="bf-preset-tabs bf-preset-tabs-inline" role="tablist" aria-label={t('preset.editModeAria')}>
          {!hidePresetTab && <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'midi'}
            className={'bf-preset-tab' + (activeTab === 'midi' ? ' is-active' : '')}
            onClick={() => setActiveTab('midi')}
            aria-label="PRESET"
          >
            <svg viewBox="0 0 24 24" className="bf-tab-ico" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle className="bf-tab-shape" cx="12" cy="12" r="8.5" />
              <circle className="bf-tab-dot" cx="12"   cy="6.5"  r="1.0" />
              <circle className="bf-tab-dot" cx="8.5"  cy="7.4"  r="1.0" />
              <circle className="bf-tab-dot" cx="15.5" cy="7.4"  r="1.0" />
              <circle className="bf-tab-dot" cx="6.5"  cy="10"   r="1.0" />
              <circle className="bf-tab-dot" cx="17.5" cy="10"   r="1.0" />
              <circle className="bf-tab-dot" cx="6.5"  cy="13"   r="1.0" />
              <circle className="bf-tab-dot" cx="17.5" cy="13"   r="1.0" />
              <circle className="bf-tab-dot" cx="12"   cy="15.5" r="1.0" />
              <path className="bf-tab-shape" d="M10 19 L12 21 L14 19" />
            </svg>
            <span>PRESET</span>
          </button>}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'display'}
            className={'bf-preset-tab' + (activeTab === 'display' ? ' is-active' : '')}
            onClick={() => setActiveTab('display')}
            aria-label="DISPLAY"
          >
            <svg viewBox="0 0 24 24" className="bf-tab-ico" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect className="bf-tab-shape" x="2.5" y="4.5" width="19" height="12" rx="1.6" />
              <rect className="bf-tab-dot" x="6"  y="11" width="1.6" height="3.5" />
              <rect className="bf-tab-dot" x="9"  y="9"  width="1.6" height="5.5" />
              <rect className="bf-tab-dot" x="12" y="7"  width="1.6" height="7.5" />
              <rect className="bf-tab-dot" x="15" y="10" width="1.6" height="4.5" />
              <rect className="bf-tab-dot" x="18" y="12" width="1.6" height="2.5" />
              <path className="bf-tab-shape" d="M9 21h6 M12 16.5v4.5" />
            </svg>
            <span>{t('glob.tab.display')}</span>
          </button>
          {!hideExtrasTab && <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'extras'}
            className={'bf-preset-tab' + (activeTab === 'extras' ? ' is-active' : '')}
            onClick={() => setActiveTab('extras')}
            aria-label="EXTRAS"
          >
            <svg viewBox="0 0 24 24" className="bf-tab-ico" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path className="bf-tab-shape" d="M6 4V20" />
              <path className="bf-tab-shape" d="M12 4V20" />
              <path className="bf-tab-shape" d="M18 4V20" />
              <circle className="bf-tab-shape" cx="6"  cy="10" r="2.3" />
              <circle className="bf-tab-shape" cx="12" cy="15" r="2.3" />
              <circle className="bf-tab-shape" cx="18" cy="8"  r="2.3" />
            </svg>
            <span>EXTRAS</span>
          </button>}
        </div>
      </div>

      <div className="bf-preset-card-body">
        {activeTab === 'midi' && !hidePresetTab && (
          <>
            <div className="bf-preset-name-wrap">
              <input
                type="text"
                className="bf-preset-name-input"
                value={meta.name}
                placeholder={tag}
                onChange={(e) => update({ name: e.target.value.slice(0, 16) })}
                maxLength={16}
                spellCheck={false}
                aria-label={t('bank.nameAria')}
              />
            </div>
            <hr className="bf-preset-divider" />
            <div className="bf-extras-row">
              <span className="bf-extras-index">1</span>
              <label className="bf-extras-cell">
                <span className="bf-field-label">PC</span>
                <div className="bf-select-wrap">
                  <BfSelect
                    className="bf-input bf-select"
                    value={meta.bank}
                    onChange={(e) => update({ bank: clamp(Number(e.target.value), 0, 600) })}
                    aria-label={t('preset.pcAria')}
                  >
                    {midiOptionElems(PC_VALUES_601, 'pc', meta.bank, meta.channel)}
                  </BfSelect>
                  <span className="bf-select-chev">▾</span>
                </div>
              </label>
              <label className="bf-extras-cell">
                <span className="bf-field-label">{t('sw.channel')}</span>
                <div className="bf-select-wrap">
                  <BfSelect
                    className={'bf-input bf-select' + (meta.channel === 0 ? ' is-mute' : '')}
                    value={meta.channel}
                    onChange={(e) => update({ channel: Number(e.target.value) })}
                    aria-label={t('preset.chAria')}
                  >
                    {channelOptionElems()}
                  </BfSelect>
                  <span className="bf-select-chev">▾</span>
                </div>
              </label>
            </div>
          </>
        )}

        {activeTab === 'display' && (
          <div className="bf-display-grid">
            <label className="bf-field bf-grid-tamanho">
              <span className="bf-field-label">{t('preset.size')}</span>
              <button
                type="button"
                className="bf-input bf-input-num"
                onClick={() => update({ fontSize: nextFontSize(meta.fontSize, meta.fontBold) })}
                aria-label={t('preset.fontSizeAria', { n: meta.fontSize })}
                title={t('preset.toggleHint')}
              >
                {meta.fontSize}pt
              </button>
            </label>
            <label className="bf-field bf-grid-negrito">
              <span className="bf-field-label">{t('preset.bold')}</span>
              <button
                type="button"
                className={'bf-input bf-input-num' + (meta.fontBold ? ' is-active' : '')}
                onClick={() => {
                  const nextBold = !meta.fontBold;
                  update({ fontBold: nextBold, fontSize: clampFontSize(meta.fontSize, nextBold) });
                }}
                aria-pressed={meta.fontBold}
                aria-label={meta.fontBold ? t('preset.boldAriaYes') : t('preset.boldAriaNo')}
                title={t('preset.toggleHint')}
              >
                {meta.fontBold ? t('preset.yes') : t('preset.no')}
              </button>
            </label>
            <div className="bf-grid-namecolor-top">
              <ColorBar
                label={t('preset.nameColor')}
                colorId={meta.nameColorId}
                onChange={(id) => update({ nameColorId: id })}
                restrictTypes={[DISP_TYPE.TRANSPARENT, DISP_TYPE.SOLID]}
              />
            </div>

            <div className="bf-grid-namecolor">
              <ColorBar
                label={t('preset.nameBorder')}
                colorId={meta.nameBorderColorId}
                onChange={(id) => update({ nameBorderColorId: id })}
                restrictTypes={[DISP_TYPE.TRANSPARENT, DISP_TYPE.SOLID]}
              />
            </div>
            <div className="bf-grid-background">
              <ColorBar
                label={t('preset.background')}
                colorId={meta.bgColorId}
                onChange={(id) => update({ bgColorId: id })}
              />
            </div>
            <div className="bf-field bf-grid-alinhamento">
              <span className="bf-field-label">{t('preset.align')}</span>
              <button
                type="button"
                className="bf-namepos-btn"
                onClick={() => setNamePosOpen(true)}
                aria-label={t('preset.alignAria')}
                title={t('preset.alignOpen')}
              >
                <NamePosMiniPreview meta={meta} tag={tag} />
                <span className="bf-namepos-btn-cta">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
                  </svg>
                  {t('preset.alignOpen')}
                </span>
              </button>
            </div>
            {namePosOpen && (
              <NamePositionEditor
                meta={meta}
                tag={tag}
                onClose={() => setNamePosOpen(false)}
                onApply={(nameX, nameY) => { update({ nameX, nameY }); setNamePosOpen(false); }}
              />
            )}

            <div className="bf-grid-tagcolor">
              <ColorBar
                label={t('preset.tagColor')}
                colorId={meta.tagColorId}
                onChange={(id) => update({ tagColorId: id })}
                restrictTypes={[DISP_TYPE.TRANSPARENT, DISP_TYPE.SOLID]}
              />
            </div>
            <div className="bf-grid-backlayers">
              <ColorBar
                label={t('preset.backLayers')}
                colorId={meta.backLayersColorId}
                onChange={(id) => update({ backLayersColorId: id })}
              />
            </div>
          </div>
        )}

        {activeTab === 'extras' && !hideExtrasTab && (
          <div className="bf-extras-grid">
            <div className="bf-extras-section">
              <div className="bf-extras-section-title">{t('preset.extraPcs')}</div>
              {meta.extraPcs.map((pc, i) => (
                <div key={i} className="bf-extras-row">
                  <span className="bf-extras-index">{i + 2}</span>
                  <label className="bf-extras-cell">
                    <span className="bf-field-label">PC</span>
                    <div className="bf-select-wrap">
                      <BfSelect
                        className="bf-input bf-select"
                        value={pc.program}
                        disabled={pc.ch === 0}
                        onChange={(e) => {
                          const next = meta.extraPcs.slice();
                          next[i] = { ...next[i], program: Number(e.target.value) };
                          update({ extraPcs: next });
                        }}
                        aria-label={t('bank.extraPcAria', { n: i + 1 })}
                      >
                        {midiOptionElems(MIDI_VALUES_128, 'pc', pc.program, pc.ch)}
                      </BfSelect>
                      <span className="bf-select-chev">▾</span>
                    </div>
                  </label>
                  <label className="bf-extras-cell">
                    <span className="bf-field-label">{t('sw.channel')}</span>
                    <div className="bf-select-wrap">
                      <BfSelect
                        className="bf-input bf-select"
                        value={pc.ch}
                        onChange={(e) => {
                          const next = meta.extraPcs.slice();
                          next[i] = { ...next[i], ch: Number(e.target.value) };
                          update({ extraPcs: next });
                        }}
                        aria-label={t('bank.extraChAria', { n: i + 1 })}
                      >
                        {channelOptionElems()}
                      </BfSelect>
                      <span className="bf-select-chev">▾</span>
                    </div>
                  </label>
                </div>
              ))}
            </div>

            <div className="bf-extras-section">
              <div className="bf-extras-section-title">{t('preset.extraCcs')}</div>
              {meta.extraCcs.map((cc, i) => (
                <div key={i} className="bf-extras-row bf-extras-row-cc">
                  <span className="bf-extras-index">{i + 6}</span>
                  <label className="bf-extras-cell">
                    <span className="bf-field-label">CC</span>
                    <div className="bf-select-wrap">
                      <BfSelect
                        className="bf-input bf-select"
                        value={cc.ctrl}
                        disabled={cc.ch === 0}
                        onChange={(e) => {
                          const next = meta.extraCcs.slice();
                          next[i] = { ...next[i], ctrl: Number(e.target.value) };
                          update({ extraCcs: next });
                        }}
                        aria-label={`Controlador do CC extra ${i + 1}`}
                      >
                        {/* CCs extras vao no header do preset (disparam na
                            chamada), nao em press de SW — sem comandos
                            especiais aqui (allowSpecial=false). */}
                        {midiOptionElems(MIDI_VALUES_128, 'cc', cc.ctrl, cc.ch, false)}
                      </BfSelect>
                      <span className="bf-select-chev">▾</span>
                    </div>
                  </label>
                  <label className="bf-extras-cell">
                    <span className="bf-field-label">{t('sw.value')}</span>
                    <div className="bf-select-wrap">
                      <BfSelect
                        className="bf-input bf-select"
                        value={cc.value}
                        disabled={cc.ch === 0}
                        onChange={(e) => {
                          const next = meta.extraCcs.slice();
                          next[i] = { ...next[i], value: Number(e.target.value) };
                          update({ extraCcs: next });
                        }}
                        aria-label={`Valor do CC extra ${i + 1}`}
                      >
                        {Array.from({ length: 128 }, (_, n) => n).map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </BfSelect>
                      <span className="bf-select-chev">▾</span>
                    </div>
                  </label>
                  <label className="bf-extras-cell">
                    <span className="bf-field-label">{t('sw.channel')}</span>
                    <div className="bf-select-wrap">
                      <BfSelect
                        className="bf-input bf-select"
                        value={cc.ch}
                        onChange={(e) => {
                          const next = meta.extraCcs.slice();
                          next[i] = { ...next[i], ch: Number(e.target.value) };
                          update({ extraCcs: next });
                        }}
                        aria-label={`Canal do CC extra ${i + 1}`}
                      >
                        {channelOptionElems()}
                      </BfSelect>
                      <span className="bf-select-chev">▾</span>
                    </div>
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {(statusLabel || (isDirty && status === 'idle')) && (
          <p className="bf-hint">
            {statusLabel && <span className={'bf-hint-status is-' + status}>{statusLabel}</span>}
            {isDirty && status === 'idle' && <span className="bf-hint-status is-dirty">{t('preset.st.unsaved')}</span>}
          </p>
        )}
      </div>
    </div>
  , paramsTarget);
}

// Header compartilhado entre as 3 paginas (PRESET / GLOBAL / SYSTEM):
// titulo grande a esquerda + chip AP/STA + chip USB a direita.
function PageHeader({
  title, onOpenWifi, deviceState, usbState, onToggleUsb,
  connectionMode, onToggleConnectionMode,
  systemTheme, onToggleTheme,
  centerSlot,
}) {
  const isLightTheme = getSystemTheme(systemTheme).light;
  return (
    <div className="bf-header bf-header-preset">
      <h1 className="bf-title">{title}</h1>
      {/* Slot central opcional (ex: toggle PRESET/LIVE MODE no header da
          pagina BANK no desktop). Renderizado na ordem DOM entre titulo e
          icones pra preservar a ordem de leitura (titulo -> toggle ->
          icones); a posicao visual vem do grid no desktop. */}
      {centerSlot ? <div className="bf-header-center">{centerSlot}</div> : null}
      <div className="bf-conn-icons">
        {typeof onToggleTheme === 'function' && (
          /* Segmento sol/lua (visual portado do Manual BFMiDi) — as duas
             opcoes ficam visiveis e a ativa brilha em --accent. So ha 2 temas
             (Escuro/Claro), entao clicar na opcao inativa = onToggleTheme(). */
          <div className="bf-theme-seg" role="group" aria-label="Tema claro ou escuro">
            <button
              type="button"
              className={'bf-theme-seg-btn' + (isLightTheme ? ' is-on' : '')}
              onClick={() => { if (!isLightTheme) onToggleTheme(); }}
              aria-pressed={isLightTheme}
              aria-label="Tema claro"
              title="Tema CLARO"
            >
              {/* sol */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4.2" />
                <path d="M12 2v2.4M12 19.6V22M4.5 4.5l1.7 1.7M17.8 17.8l1.7 1.7M2 12h2.4M19.6 12H22M4.5 19.5l1.7-1.7M17.8 6.2l1.7-1.7" />
              </svg>
            </button>
            <button
              type="button"
              className={'bf-theme-seg-btn' + (!isLightTheme ? ' is-on' : '')}
              onClick={() => { if (isLightTheme) onToggleTheme(); }}
              aria-pressed={!isLightTheme}
              aria-label="Tema escuro"
              title="Tema ESCURO"
            >
              {/* lua */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z" />
              </svg>
            </button>
          </div>
        )}
        {DEMO_MODE && (
          <>
            <span className="bf-demo-badge" title="Esta versão não usa uma controladora física">
              DEMO
            </span>
            <button
              type="button"
              className="bf-demo-open"
              onClick={onToggleUsb}
              aria-label="Abrir simulador da controladora"
              title="Visualizar a controladora selecionada"
            >
              <span className="bf-demo-open-screen" aria-hidden="true" />
              <span>SIMULADOR</span>
            </button>
          </>
        )}
        {/* Botao WiFi: escondido na versao online (HTTPS), onde mixed-content
            bloqueia HTTP pro device e so o USB conecta. Ver WIFI_BLOCKED (api.js). */}
        {!WIFI_BLOCKED && (
        <div
          className={'bf-conn-mode bf-conn-wifi is-' + deviceState + ' is-mode-' + (connectionMode || 'STA').toLowerCase()}
          role="button"
          tabIndex={0}
          onClick={() => onOpenWifi && onOpenWifi()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenWifi && onOpenWifi(); } }}
          style={{ cursor: 'pointer' }}
          aria-label={`WiFi ${connectionMode || 'STA'}: ${deviceState} — abrir configurações de WiFi`}
          title={
            `WiFi ${connectionMode || 'STA'} — ` +
            (deviceState === 'online' ? 'CONECTADO'
              : deviceState === 'loading' ? 'CONECTANDO'
              : 'OFFLINE') +
            ' · abrir configurações'
          }
        >
          <svg viewBox="0 0 24 24" className="bf-conn-mode-ico" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {/* Ondas WiFi concentricas + ponto na base */}
            <path d="M2 8.5 Q12 0 22 8.5" />
            <path d="M5 13 Q12 6 19 13" />
            <path d="M8.5 17.5 Q12 14 15.5 17.5" />
            <circle cx="12" cy="21" r="1.4" fill="currentColor" />
          </svg>
          <span className="bf-conn-mode-label">{connectionMode || 'STA'}</span>
        </div>
        )}

        {/* Botao USB: escondido no webApp INTERNO (servido pelo device, conexao
            same-origin) e no APK Android (WebView sem Web Serial). Ver USB_HIDDEN. */}
        {!USB_HIDDEN && (
        <button
          type="button"
          className={'bf-conn-mode is-' + usbState}
          onClick={onToggleUsb}
          disabled={usbState === 'unsupported'}
          aria-label={
            usbState === 'connected' ? 'USB conectado — clique para desconectar'
            : usbState === 'connecting' ? 'USB conectando'
            : usbState === 'unsupported' ? 'USB indisponivel neste browser'
            : 'USB offline — clique para conectar'
          }
          title={
            usbState === 'connected' ? 'USB ONLINE'
            : usbState === 'connecting' ? 'USB CONECTANDO'
            : usbState === 'unsupported' ? 'Web Serial nao suportado'
            : usbState === 'error' ? 'USB falhou — clique para tentar de novo'
            : 'USB OFFLINE — clique para conectar'
          }
        >
          <svg viewBox="0 0 24 24" className="bf-conn-mode-ico" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {/* USB trident */}
            <path d="M12 2L8.5 6.5H15.5Z" fill="currentColor" stroke="none" />
            <path d="M12 6.5V20.5" />
            <path d="M12 13H7V17" />
            <rect x="5.5" y="16.5" width="3" height="3" fill="currentColor" stroke="none" />
            <path d="M12 10H17V14" />
            <circle cx="17" cy="15.2" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="12" cy="21" r="1.8" fill="currentColor" stroke="none" />
          </svg>
          <span className="bf-conn-mode-label">USB</span>
        </button>
        )}
      </div>
    </div>
  );
}

// ─── LIVE MODE ──────────────────────────────────────────────────────
// Em LIVE MODE a pagina mostra 6 botoes (SW1..SW6). Cada switch e
// independente; clicar abre um card de config abaixo. O card tem 2
// icones no topo-esquerda — engrenagem (config) e display (visual) —
// e sempre abre na engrenagem. Os conteudos de cada aba serao
// implementados aos poucos.

// As 10 opcoes de modo de operacao de um SW em LIVE MODE. id = chave
// interna; title = rotulo grande; sub = descritor. O comportamento de
// cada modo sera implementado aos poucos — por ora e so a selecao.
const SW_MODES = [
  // MUTE = padrao de um SW sem modo salvo (silencioso, nao faz nada).
  { id: 'mute',      title: 'MUTE',      sub: 'MUTE' },
  // STOMP-1/2/3 = stomps; a diferenca esta no gesto que cada um trata:
  // STOMP unificado: comporta-se como classico, dual ou trial conforme
  // o numero de secoes com canal configurado (so A / A+B / A+B+C).
  { id: 'fx1',       title: 'STOMP',     sub: 'CLICK / LONG / RECLICK' },
  // Legados — mantidos pra dados antigos, escondidos do picker.
  { id: 'fx2',       title: 'STOMP - 2', sub: 'DUAL STOMP', hidden: true },
  { id: 'fx3',       title: 'STOMP - 3', sub: 'TRIAL STOMP', hidden: true },
  { id: 'spin',      title: 'SPIN',      sub: 'SPIN' },
  { id: 'ramp',      title: 'RAMP',      sub: 'RAMP' },
  { id: 'momentary', title: 'MOMENTARY', sub: 'MOMENTARY' },
  // FAVORITE como modo separado foi removido — agora vive como toggle
  // por secao dentro do STOMP. Mantido oculto no array pra preservar o
  // indice 7 em SW_MODE_IDS (compat com presets antigos).
  { id: 'favorite',  title: 'FAVORITE',  sub: 'FAVORITE', hidden: true },
  { id: 'macros',    title: 'MACROS',    sub: 'MACROS' },
  { id: 'tap_tempo', title: 'TAP TEMPO', sub: 'TAP TEMPO' },
  { id: 'single',    title: 'SINGLE',    sub: 'SINGLE' },
];

// ─── SW DISPLAY (icone + cores por SW) ──────────────────────────────
// Icones servidos por webApp/icons/sw/ICO<id>.png. Dois tipos:
//   TINGIDO  — a cor nao esta no bitmap; e aplicada via CSS mask-image.
//   COLORIDO — mini-imagem (pedal) com cor propria; renderiza <img> direto,
//              so background/borda do tile mudam de cor.
// Pra adicionar: solte ICO<N>.png em icons/source/ (tingido) OU
// icons/source_color/ (colorido) e rode `py tools/build_icons.py` — ele
// sincroniza os PNGs pra ca e gera count/color_ids (inlinados no build).
// Total e lista de coloridos vem do build (tools/build_icons.py -> ICONS_META.json).
const SW_ICON_COUNT = (typeof __BF_ICON_COUNT__ !== 'undefined') ? __BF_ICON_COUNT__ : 52;
const COLOR_ICON_IDS = (typeof __BF_COLOR_ICON_IDS__ !== 'undefined') ? __BF_COLOR_ICON_IDS__ : [];
const COLOR_ICON_SET = new Set(COLOR_ICON_IDS);
const isColorIcon = (id) => COLOR_ICON_SET.has(id | 0) || isUploadIcon(id);
const SW_ICONS = Array.from({ length: SW_ICON_COUNT }, (_, i) => `ico${i + 1}`);

// Defaults por SW. mode 'icon' + ico1 + sigla vazia.
// Cores padrao (DISPLAY_PALETTE indices):
//   0 = Sem Cor (transparente), 3 = SOLID Cinza Claro, 15 = SOLID Vermelho
//   ICON  ON=Vermelho / OFF=Cinza
//   BACK  ON=Transparente / OFF=Transparente
//   BORDA ON=Vermelho / OFF=Cinza (igual ao ICON)
function DEFAULT_SW_DISPLAY() {
  return {
    icon_id: 1,           // 1-based no SW_ICONS
    mode: 'icon',         // 'icon' | 'text'
    sigla: '',            // rodape do icone (icon mode) ou texto central (text mode)
    ic_off: 3, ic_on: 15, // ICON: Cinza Claro / Vermelho (estados OFF/ON)
    bg_off: 0, bg_on: 0,  // BACK: Sem Cor / Sem Cor (transparente)
    br_off: 3, br_on: 15, // BORDER: igual ao ICON (Cinza Claro / Vermelho)
    sg: -1,               // cor da SIGLA (nome): -1 = segue a cor do ICON (legado);
                          //   >=0 = cor propria (necessario p/ icone colorido/upload)
    // SPIN: 3 sub-configs INDEPENDENTES (so usadas quando modo=SPIN). Cada
    // estado tem icone proprio + sigla + cor ON dos 3 elementos (ICON/BACK/
    // BORDER). Nao tem OFF — SPIN sempre cicla entre os 3 estados ativos.
    spin: [DEFAULT_SW_SPIN_STATE(), DEFAULT_SW_SPIN_STATE(), DEFAULT_SW_SPIN_STATE()],
    // STOMP: 4 sub-configs adicionais pras secoes B (click longo) e C
    // (reclick), cada uma com OFF e ON. Secao A continua usando ic_off/
    // ic_on/bg_off/bg_on/br_off/br_on do config principal acima.
    //   [0]=B_off, [1]=B_on, [2]=C_off, [3]=C_on
    // Cada entrada tem icone + cor ICON + cor BACK + cor BORDER. Sigla
    // continua sendo a do config principal (compartilhada).
    //   [0]=B_off, [1]=B_on, [2]=C_off, [3]=C_on
    stomp: [DEFAULT_SW_STOMP_SUB(false), DEFAULT_SW_STOMP_SUB(true),
            DEFAULT_SW_STOMP_SUB(false), DEFAULT_SW_STOMP_SUB(true)],
    // TAP TEMPO: 3 sub-configs.
    //   [0]=TAP (estado unico, sem OFF/ON — analogo a um SPIN state)
    //   [1]=LP_off, [2]=LP_on (analogo a uma secao STOMP)
    // Sigla continua compartilhada com o config principal.
    //   [0]=TAP (ativo), [1]=LP_off, [2]=LP_on
    tap: [DEFAULT_SW_STOMP_SUB(true), DEFAULT_SW_STOMP_SUB(false),
          DEFAULT_SW_STOMP_SUB(true)],
    // SPIN LONG PRESS: 1 ícone/sigla COMPARTILHADO + cores OFF/ON (igual o
    // STOMP). Mostrado no tile quando o último gesto foi o long-press, com as
    // cores conforme liveOn2 (OFF/ON). Tag 'p' no blob (bases i/s/m + a/A b/B c/C).
    spinlp: { icon_id: 1, mode: 'icon', sigla: '',
              ic_off: 3, ic_on: 15, bg_off: 0, bg_on: 0, br_off: 3, br_on: 15 },
  };
}

function DEFAULT_SW_SPIN_STATE() {
  // SPIN states sao sempre "ativos" (ciclo, sem OFF) -> ICON/BORDER vermelho,
  // BACK transparente.
  return { icon_id: 1, sigla: '', mode: 'icon', ic_on: 15, bg_on: 0, br_on: 15 };
}

// Sub-config de uma secao STOMP/TAP. `on` escolhe o esquema: ON = ICON/BORDER
// vermelho (15), OFF = cinza (3); BACK sempre transparente (0); BORDER = ICON.
function DEFAULT_SW_STOMP_SUB(on = true) {
  const c = on ? 15 : 3;
  // sigla: nome proprio da secao (so usado pelas secoes STOMP B/C, guardado no
  // slot OFF como canonico — igual o icon_id). Vazio = herda a sigla principal.
  // sg: cor da sigla da secao (-1 = segue a cor do ICON da secao, igual o main).
  return { icon_id: 1, mode: 'icon', sigla: '', sg: -1, ic: c, bg: 0, br: c };
}

// Mapeamento de chaves COMPACTAS (storage) <-> longas (state JS).
// O storage usa chaves curtas pra caber no orcamento de DRAM do firmware
// (BANK_MEMORY_DATA_SIZE = 576). O state interno do React mantem nomes
// auto-descritivos.
const SW_DISPLAY_KEY_SHORT = {
  icon_id: 'i', ic_off: 'a', ic_on: 'A',
  bg_off: 'b', bg_on: 'B',
  br_off: 'c', br_on: 'C',
  sg: 'g',  // cor da sigla (nome) — nivel SW, -1 = segue o ICON
};
const SW_DISPLAY_KEY_LONG = Object.fromEntries(
  Object.entries(SW_DISPLAY_KEY_SHORT).map(([l, s]) => [s, l]));

// Lê os 9 campos do SW de dentro do blob da API (formato compacto
// "i=5;m=1;s=STOMP;a=0;A=4;b=0;B=0;c=0;C=0"). Separador INTERNO e ';'
// (nao '|') pra nao conflitar com o separador EXTERNO de campos do
// header do preset, que e '|'. Aceita tambem nomes longos
// (icon_id=, mode=, sigla=, ic_off=...) pra backward-compat.
function parseSwDisplayOne(blob) {
  const out = DEFAULT_SW_DISPLAY();
  // Aceita ambos os separadores (compat com payloads antigos que
  // chegaram a usar '|' antes do bug de conflito ser corrigido).
  const pairs = String(blob || '').split(/[;|]/);
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const k = pair.slice(0, eq);
    const v = pair.slice(eq + 1);
    if (k === 'm' || k === 'mode') {
      out.mode = (v === 'text' || v === '0') ? 'text' : 'icon';
      continue;
    }
    if (k === 's' || k === 'sigla') { out.sigla = v; continue; }
    // SPIN sub-configs (tags 1..3): chaves i1/s1/A1/B1/C1 → spin[0] etc.
    // STOMP sub-configs (tags 4..7): chaves i4/A4/B4/C4 → stomp[0] etc.
    //   [0]=B_off, [1]=B_on, [2]=C_off, [3]=C_on
    // TAP TEMPO sub-configs (sufixos 't', 'o', 'n'): chaves it/At/Bt/Ct
    //   → tap[0] (TAP); io/... → tap[1] (LP_off); in/... → tap[2] (LP_on)
    if (k.length === 2) {
      const last = k.charCodeAt(k.length - 1);
      const base = k[0];
      // Digit tag (1..7) → SPIN/STOMP
      if (last >= 49 && last <= 55) {
        const tag = last - 48;
        if (tag <= 3) {
          const state = out.spin[tag - 1];
          if (base === 'i') state.icon_id = parseInt(v, 10) || 1;
          else if (base === 's') state.sigla = v;
          else if (base === 'm') state.mode = v === '0' ? 'text' : 'icon';
          else if (base === 'A') state.ic_on = parseInt(v, 10) || 0;
          else if (base === 'B') state.bg_on = parseInt(v, 10) || 0;
          else if (base === 'C') state.br_on = parseInt(v, 10) || 0;
        } else {
          const stompIdx = tag - 4;
          const sub = out.stomp[stompIdx];
          if (base === 'i') sub.icon_id = parseInt(v, 10) || 1;
          else if (base === 's') sub.sigla = v;  // sigla da secao (B/C)
          else if (base === 'g') sub.sg = parseInt(v, 10);  // cor da sigla da secao
          else if (base === 'm') sub.mode = v === '0' ? 'text' : 'icon';
          else if (base === 'A') sub.ic = parseInt(v, 10) || 0;
          else if (base === 'B') sub.bg = parseInt(v, 10) || 0;
          else if (base === 'C') sub.br = parseInt(v, 10) || 0;
        }
        continue;
      }
      // Letter tag (t/o/n) → TAP TEMPO
      const tapIdx = k[1] === 't' ? 0 : k[1] === 'o' ? 1 : k[1] === 'n' ? 2 : -1;
      if (tapIdx >= 0) {
        const sub = out.tap[tapIdx];
        if (base === 'i') sub.icon_id = parseInt(v, 10) || 1;
        else if (base === 'm') sub.mode = v === '0' ? 'text' : 'icon';
        else if (base === 'A') sub.ic = parseInt(v, 10) || 0;
        else if (base === 'B') sub.bg = parseInt(v, 10) || 0;
        else if (base === 'C') sub.br = parseInt(v, 10) || 0;
        continue;
      }
      // Letter tag 'p' → SPIN LONG PRESS (1 ícone/sigla + cores OFF/ON).
      // bases: i/s/m compartilhados; a/A=ic off/on, b/B=bg off/on, c/C=br off/on.
      if (k[1] === 'p') {
        const sub = out.spinlp;
        if (base === 'i') sub.icon_id = parseInt(v, 10) || 1;
        else if (base === 's') sub.sigla = v;
        else if (base === 'm') sub.mode = v === '0' ? 'text' : 'icon';
        else if (base === 'a') sub.ic_off = parseInt(v, 10) || 0;
        else if (base === 'A') sub.ic_on = parseInt(v, 10) || 0;
        else if (base === 'b') sub.bg_off = parseInt(v, 10) || 0;
        else if (base === 'B') sub.bg_on = parseInt(v, 10) || 0;
        else if (base === 'c') sub.br_off = parseInt(v, 10) || 0;
        else if (base === 'C') sub.br_on = parseInt(v, 10) || 0;
        continue;
      }
    }
    const longKey = SW_DISPLAY_KEY_LONG[k] || k;
    if (longKey in out && longKey !== 'mode' && longKey !== 'sigla' &&
        longKey !== 'spin') {
      const n = parseInt(v, 10);
      if (Number.isFinite(n)) out[longKey] = n;
    }
  }
  return out;
}

// Extrai sw_display dos 6 SWs do meta retornado pela API. Cada entry vem
// como string compacta na chave swdispN. Sempre retorna 6 entries com
// defaults se faltar algum.
function parseSwDisplayFromMeta(rawMeta, layerSuffix = '') {
  const out = {};
  for (let sw = 1; sw <= 6; sw++) {
    const blob = (rawMeta && rawMeta['swdisp' + sw + layerSuffix]) || '';
    out[sw] = parseSwDisplayOne(blob);
  }
  return out;
}

// Serializa um SW pro formato COMPACTO "i=5;m=1;s=STOMP;a=0;A=4;b=0;...".
// Separador INTERNO e ';' (nao '|') pra nao conflitar com o separador
// EXTERNO de campos do header. Chaves curtas pra caber no orcamento de
// DRAM do firmware. Sigla truncada em 8 chars; '|' e ';' filtrados da
// sigla pra nao quebrar nenhum parser (interno ou externo).
function serializeSwDisplayOne(d) {
  const merged = { ...DEFAULT_SW_DISPLAY(), ...(d || {}) };
  const spin = Array.isArray(d && d.spin) ? d.spin : [];
  const stomp = Array.isArray(d && d.stomp) ? d.stomp : [];
  const sigla = String(merged.sigla || '').replace(/[|;]/g, ' ').slice(0, 8);
  const parts = [
    `i=${merged.icon_id|0}`,
    `m=${merged.mode === 'text' ? 0 : 1}`,
    `s=${sigla}`,
    `a=${merged.ic_off|0}`, `A=${merged.ic_on|0}`,
    `b=${merged.bg_off|0}`, `B=${merged.bg_on|0}`,
    `c=${merged.br_off|0}`, `C=${merged.br_on|0}`,
  ];
  // Cor da sigla: so emite quando definida (>=0). -1 = segue o ICON (firmware
  // usa o sentinela 0xFF) — omitir mantem o comportamento legado e poupa bytes.
  if ((merged.sg | 0) >= 0 && merged.sg !== -1) parts.push(`g=${merged.sg|0}`);
  // SPIN sub-configs (i1/i2/i3 etc.): emite so campos != default.
  // mode='text' vira m{N}=0; default 'icon' (m{N}=1) e omitido.
  const defSpin = DEFAULT_SW_SPIN_STATE();
  for (let i = 0; i < 3; i++) {
    const s = { ...defSpin, ...(spin[i] || {}) };
    const tag = String(i + 1);
    if ((s.icon_id|0) !== defSpin.icon_id) parts.push(`i${tag}=${s.icon_id|0}`);
    const sg = String(s.sigla || '').replace(/[|;]/g, ' ').slice(0, 6);
    if (sg) parts.push(`s${tag}=${sg}`);
    if (s.mode === 'text') parts.push(`m${tag}=0`);
    if ((s.ic_on|0) !== defSpin.ic_on) parts.push(`A${tag}=${s.ic_on|0}`);
    if ((s.bg_on|0) !== defSpin.bg_on) parts.push(`B${tag}=${s.bg_on|0}`);
    if ((s.br_on|0) !== defSpin.br_on) parts.push(`C${tag}=${s.br_on|0}`);
  }
  // STOMP sub-configs pras secoes B e C, OFF e ON. Tags: 4..7.
  //   [0]=B_off, [1]=B_on, [2]=C_off, [3]=C_on -> impar = ON (vermelho).
  // Default de comparacao POR INDICE (tem que casar com o parser, que parte
  // dos arrays per-indice de DEFAULT_SW_DISPLAY), senao o round-trip omite
  // um valor e a releitura preenche com o default errado.
  for (let i = 0; i < 4; i++) {
    const defStomp = DEFAULT_SW_STOMP_SUB((i & 1) === 1);
    const s = { ...defStomp, ...(stomp[i] || {}) };
    const tag = String(i + 4);  // 4,5,6,7
    if ((s.icon_id|0) !== defStomp.icon_id) parts.push(`i${tag}=${s.icon_id|0}`);
    // Sigla da secao: so nos slots OFF (i=0 → B, i=2 → C) — 1 sigla por secao,
    // compartilhada entre OFF/ON (igual o icone). Vazio = herda a principal.
    if (i === 0 || i === 2) {
      const sg = String(s.sigla || '').replace(/[|;]/g, ' ').slice(0, 8);
      if (sg) parts.push(`s${tag}=${sg}`);
      // Cor da sigla da secao: so emite quando definida (>=0). -1 = segue o ICON.
      if ((s.sg | 0) >= 0 && s.sg !== -1) parts.push(`g${tag}=${s.sg|0}`);
    }
    if (s.mode === 'text') parts.push(`m${tag}=0`);
    if ((s.ic|0) !== defStomp.ic) parts.push(`A${tag}=${s.ic|0}`);
    if ((s.bg|0) !== defStomp.bg) parts.push(`B${tag}=${s.bg|0}`);
    if ((s.br|0) !== defStomp.br) parts.push(`C${tag}=${s.br|0}`);
  }
  // TAP TEMPO sub-configs (3 estados). Sufixos: 't' = TAP, 'o' = LP_off,
  // 'n' = LP_on. Mesma estrutura {icon_id, mode, ic, bg, br}. Default por
  // indice: TAP/LP_on = ON (vermelho), LP_off = OFF (cinza).
  const tap = Array.isArray(d && d.tap) ? d.tap : [];
  const tapTags = ['t', 'o', 'n'];
  for (let i = 0; i < 3; i++) {
    const defStomp = DEFAULT_SW_STOMP_SUB(i !== 1);
    const s = { ...defStomp, ...(tap[i] || {}) };
    const tag = tapTags[i];
    if ((s.icon_id|0) !== defStomp.icon_id) parts.push(`i${tag}=${s.icon_id|0}`);
    if (s.mode === 'text') parts.push(`m${tag}=0`);
    if ((s.ic|0) !== defStomp.ic) parts.push(`A${tag}=${s.ic|0}`);
    if ((s.bg|0) !== defStomp.bg) parts.push(`B${tag}=${s.bg|0}`);
    if ((s.br|0) !== defStomp.br) parts.push(`C${tag}=${s.br|0}`);
  }
  // SPIN LONG PRESS (tag 'p'): 1 ícone/sigla COMPARTILHADO + cores OFF/ON.
  // bases: i/s/m + a/A (ic off/on), b/B (bg off/on), c/C (br off/on). Só != default.
  {
    const dlp = { icon_id: 1, mode: 'icon', sigla: '',
                  ic_off: 3, ic_on: 15, bg_off: 0, bg_on: 0, br_off: 3, br_on: 15 };
    const s = { ...dlp, ...((d && d.spinlp) || {}) };
    if ((s.icon_id|0) !== dlp.icon_id) parts.push(`ip=${s.icon_id|0}`);
    const sg = String(s.sigla || '').replace(/[|;]/g, ' ').slice(0, 6);
    if (sg) parts.push(`sp=${sg}`);
    if (s.mode === 'text') parts.push(`mp=0`);
    if ((s.ic_off|0) !== dlp.ic_off) parts.push(`ap=${s.ic_off|0}`);
    if ((s.ic_on|0)  !== dlp.ic_on)  parts.push(`Ap=${s.ic_on|0}`);
    if ((s.bg_off|0) !== dlp.bg_off) parts.push(`bp=${s.bg_off|0}`);
    if ((s.bg_on|0)  !== dlp.bg_on)  parts.push(`Bp=${s.bg_on|0}`);
    if ((s.br_off|0) !== dlp.br_off) parts.push(`cp=${s.br_off|0}`);
    if ((s.br_on|0)  !== dlp.br_on)  parts.push(`Cp=${s.br_on|0}`);
  }
  return parts.join(';');
}

// Insere os 6 swdispN[L2] no body de POST /bank/preset. layerSuffix = ''
// (L1) ou 'L2' — define o sufixo das chaves enviadas.
function swDisplayToApiBody(disp, body, layerSuffix = '') {
  for (let sw = 1; sw <= 6; sw++) {
    body.set('swdisp' + sw + layerSuffix,
             serializeSwDisplayOne(disp && disp[sw]));
  }
}

// Default por SW (1..6) — usado em presets não modificados.
// SW1=4, SW2=12, SW3=19, SW4=22, SW5=38, SW6=49. Mantido em sync com
// icon_default_id_for_sw() no firmware (ICONS_RENDER.h).
const DEFAULT_ICON_BY_SW = { 1: 4, 2: 12, 3: 19, 4: 22, 5: 38, 6: 49 };

// Defaults pros 6 SWs — usado quando ainda nao carregou nada.
function defaultSwDisplayMap() {
  const out = {};
  for (let sw = 1; sw <= 6; sw++) {
    out[sw] = { ...DEFAULT_SW_DISPLAY(), icon_id: DEFAULT_ICON_BY_SW[sw] || 1 };
  }
  return out;
}

// Compara dois mapas de swDisplay pra dirty tracking.
function swDisplayEqual(a, b) {
  if (a === b) return true;
  for (let sw = 1; sw <= 6; sw++) {
    const A = serializeSwDisplayOne(a && a[sw]);
    const B = serializeSwDisplayOne(b && b[sw]);
    if (A !== B) return false;
  }
  return true;
}

// sw_modes no PRESET: 6 indices em SW_MODES, formato compacto "i,i,i,i,i,i".
// "0,4,0,..." <-> { 1:'mute', 2:'spin', ... }. Indice fora de faixa cai
// em 'mute' (0) — cobre presets antigos sem o campo.
function parseSwModesStr(s) {
  const parts = (typeof s === 'string' && s ? s : '').split(',');
  const out = {};
  for (let i = 0; i < 6; i++) {
    const mode = SW_MODES[parseInt(parts[i], 10)] || SW_MODES[0];
    out[i + 1] = mode.id;
  }
  return out;
}
function swModesToStr(obj) {
  const parts = [];
  for (let n = 1; n <= 6; n++) {
    let idx = SW_MODES.findIndex((m) => m.id === ((obj && obj[n]) || 'mute'));
    if (idx < 0) idx = 0;
    parts.push(idx);
  }
  return parts.join(',');
}

// ── Parametros por SW/modo ────────────────────────────────────────────
// Cada SW, em cada modo, tem um conjunto de campos proprio. O firmware
// guarda como linhas sw<N>.<modo>:<key=value|...> e a API entrega/recebe
// o blob. Aqui o shape e { [sw]: { [modeId]: {campos} } }.
//
// STOMP (fx1, unificado): ate 3 secoes — A (sem sufixo), B (sufixo 2),
// C (sufixo 3). Cada secao tem num 0..127 (CC), ch 0=OFF 1..16, custom
// 0/1, on/off 0..127, start 0/1, color 0..14. O comportamento de uso
// adapta conforme quantas secoes tem canal valido (1..16):
//   so A      -> STOMP classico: tap = toggle, segurar = momentaneo.
//   A + B     -> tap = A, long-press = B (sem momentaneo).
//   A + B + C -> tap (apos 350ms) = A, long-press = B, duplo-click = C.
// Os legados fx2 (14 campos) e fx3 (21 campos, mesmas chaves do fx1)
// seguem existindo pra dados antigos, mas o picker so oferece fx1.
// MACROS — helpers de serializacao dos 4 slots de uma secao. Cada slot:
//   { t: 0|1, ch: 0..16, num: 0..16383, on: -1..16383, off: -1..16383 }
//   t=0 (CC): num e o CC#, on/off sao valores de CC.
//   t=1 (PC): num ignorado; on e o PC# pra ON; off e o PC# pra OFF.
//   on/off = -1 -> pula a direcao (OFF na UI).
// Storage: string "t:ch:num:on:off,t:ch:num:on:off,t:ch:num:on:off,t:ch:num:on:off"
function emptyMslot() {
  return { t: 0, ch: 0, num: 0, on: 127, off: 0 };
}
function emptyMslotsStr() {
  // Pre-popula 4 slots vazios (ch=0 = inativo). O firmware ignora slots
  // com ch fora de 1..16, entao o resultado fica inert sem precisar de
  // logica de "slot existe/nao existe".
  return '0:0:0:127:0,0:0:0:127:0,0:0:0:127:0,0:0:0:127:0';
}
function parseMslots(str) {
  const out = [emptyMslot(), emptyMslot(), emptyMslot(), emptyMslot()];
  if (typeof str !== 'string' || !str) return out;
  const parts = str.split(',');
  for (let i = 0; i < 4 && i < parts.length; i++) {
    const p = (parts[i] || '').split(':');
    if (p.length < 5) continue;
    const t = parseInt(p[0], 10);
    const ch = parseInt(p[1], 10);
    const num = parseInt(p[2], 10);
    const on = parseInt(p[3], 10);
    const off = parseInt(p[4], 10);
    out[i] = {
      t: t === 1 ? 1 : 0,
      ch: Number.isFinite(ch) ? clamp(ch, 0, 16) : 0,
      num: Number.isFinite(num) ? clamp(num, 0, 16383) : 0,
      on: Number.isFinite(on) ? clamp(on, -1, 16383) : 127,
      off: Number.isFinite(off) ? clamp(off, -1, 16383) : 0,
    };
  }
  return out;
}
function serializeMslots(slots) {
  const four = (slots || []).slice(0, 4);
  while (four.length < 4) four.push(emptyMslot());
  return four.map((s) =>
    `${s.t|0}:${s.ch|0}:${s.num|0}:${s.on|0}:${s.off|0}`
  ).join(',');
}

// SINGLE — slots mais simples que os do MACROS: um valor unico por slot
// (sem ON/OFF). Cada slot { t, ch, num, val }.
//   t=0 (CC): num=CC#, val=valor de CC (0..127).
//   t=1 (PC): num ignorado, val=PC# (0..16383).
// Storage: "t:ch:num:val,t:ch:num:val,t:ch:num:val,t:ch:num:val" (4 slots).
function emptySingleSlot() {
  return { t: 0, ch: 0, num: 0, val: 127 };
}
function emptySingleSlotsStr() {
  return '0:0:0:127,0:0:0:127,0:0:0:127,0:0:0:127';
}
function parseSingleSlots(str) {
  const out = [emptySingleSlot(), emptySingleSlot(), emptySingleSlot(), emptySingleSlot()];
  if (typeof str !== 'string' || !str) return out;
  const parts = str.split(',');
  for (let i = 0; i < 4 && i < parts.length; i++) {
    const p = (parts[i] || '').split(':');
    if (p.length < 4) continue;
    const t = parseInt(p[0], 10);
    const ch = parseInt(p[1], 10);
    const num = parseInt(p[2], 10);
    const val = parseInt(p[3], 10);
    out[i] = {
      t: t === 1 ? 1 : 0,
      ch: Number.isFinite(ch) ? clamp(ch, 0, 16) : 0,
      num: Number.isFinite(num) ? clamp(num, 0, 16383) : 0,
      val: Number.isFinite(val) ? clamp(val, 0, 16383) : 127,
    };
  }
  return out;
}
function serializeSingleSlots(slots) {
  const four = (slots || []).slice(0, 4);
  while (four.length < 4) four.push(emptySingleSlot());
  return four.map((s) =>
    `${s.t|0}:${s.ch|0}:${s.num|0}:${s.val|0}`
  ).join(',');
}

// TAP TEMPO — slots ainda mais simples: so canal e CC# (valor fixo 127
// na hora do disparo, sem type CC/PC). Storage: "ch:num,ch:num,..." (4).
// TAP TEMPO slot: ch + num + mode. mode 1 = so CC+127 (classico). mode 2
// = CC+127 seguido de CC+0 (pulse). Formato compacto "ch:num:mode";
// formato legado "ch:num" (sem mode) cai em mode=1. Maximo 3 slots
// (sobra espaco no UI pra um slot fixo de long-press separado).
const TAP_MAX_SLOTS = 3;
function emptyTapSlot() { return { ch: 0, num: 0, mode: 1 }; }
function emptyTapSlotsStr() { return '0:0:1,0:0:1,0:0:1'; }
function parseTapSlots(str) {
  const out = Array.from({ length: TAP_MAX_SLOTS }, () => emptyTapSlot());
  if (typeof str !== 'string' || !str) return out;
  const parts = str.split(',');
  for (let i = 0; i < TAP_MAX_SLOTS && i < parts.length; i++) {
    const p = (parts[i] || '').split(':');
    if (p.length < 2) continue;
    const ch = parseInt(p[0], 10);
    const num = parseInt(p[1], 10);
    const mode = p.length >= 3 ? parseInt(p[2], 10) : 1;
    out[i] = {
      ch: Number.isFinite(ch) ? clamp(ch, 0, 16) : 0,
      num: Number.isFinite(num) ? clamp(num, 0, CC_NUM_MAX) : 0,
      mode: mode === 2 ? 2 : 1,
    };
  }
  return out;
}
function serializeTapSlots(slots) {
  const arr = (slots || []).slice(0, TAP_MAX_SLOTS);
  while (arr.length < TAP_MAX_SLOTS) arr.push(emptyTapSlot());
  return arr.map((s) => `${s.ch|0}:${s.num|0}:${s.mode === 2 ? 2 : 1}`).join(',');
}

// SPIN slot — ch + num + 3 valores (um por estado). Ate 3 slots por SW,
// disparados simultaneamente em cada press (mesmo estado). Formato:
// "ch:num:v1:v2:v3,ch:num:v1:v2:v3,ch:num:v1:v2:v3".
function emptySpinSlot() {
  return { ch: 0, num: 0, v1: 0, v2: 64, v3: 127 };
}
function emptySpinSlotsStr() {
  return '0:0:0:64:127,0:0:0:64:127,0:0:0:64:127';
}
function parseSpinSlots(str) {
  const out = [emptySpinSlot(), emptySpinSlot(), emptySpinSlot()];
  if (typeof str !== 'string' || !str) return out;
  const parts = str.split(',');
  for (let i = 0; i < 3 && i < parts.length; i++) {
    const p = (parts[i] || '').split(':');
    if (p.length < 2) continue;
    const ch = parseInt(p[0], 10);
    const num = parseInt(p[1], 10);
    const v1 = p.length >= 3 ? parseInt(p[2], 10) : 0;
    const v2 = p.length >= 4 ? parseInt(p[3], 10) : 64;
    const v3 = p.length >= 5 ? parseInt(p[4], 10) : 127;
    out[i] = {
      ch: Number.isFinite(ch) ? clamp(ch, 0, 16) : 0,
      num: Number.isFinite(num) ? clamp(num, 0, CC_NUM_MAX) : 0,
      v1: Number.isFinite(v1) ? clamp(v1, 0, 127) : 0,
      v2: Number.isFinite(v2) ? clamp(v2, 0, 127) : 64,
      v3: Number.isFinite(v3) ? clamp(v3, 0, 127) : 127,
    };
  }
  return out;
}
function serializeSpinSlots(slots) {
  const arr = (slots || []).slice(0, 3);
  while (arr.length < 3) arr.push(emptySpinSlot());
  return arr.map((s) =>
    `${s.ch|0}:${s.num|0}:${s.v1|0}:${s.v2|0}:${s.v3|0}`).join(',');
}

// MOMENTARY slot — pulse de ch+num com par on/off. Formato "ch:num:on:off"
// (4 campos), ate 4 slots. Cada press do SW dispara TODOS os slots em
// sequencia: ON, delay, OFF. Default: on=127, off=0.
const MOM_MAX_SLOTS = 4;
function emptyMomSlot() { return { ch: 0, num: 0, on: 127, off: 0 }; }
function emptyMomSlotsStr() { return '0:0:127:0,0:0:127:0,0:0:127:0,0:0:127:0'; }
function parseMomSlots(str) {
  const out = Array.from({ length: MOM_MAX_SLOTS }, () => emptyMomSlot());
  if (typeof str !== 'string' || !str) return out;
  const parts = str.split(',');
  for (let i = 0; i < MOM_MAX_SLOTS && i < parts.length; i++) {
    const p = (parts[i] || '').split(':');
    if (p.length < 2) continue;
    const ch = parseInt(p[0], 10);
    const num = parseInt(p[1], 10);
    const on = p.length >= 3 ? parseInt(p[2], 10) : 127;
    const off = p.length >= 4 ? parseInt(p[3], 10) : 0;
    out[i] = {
      ch: Number.isFinite(ch) ? clamp(ch, 0, 16) : 0,
      num: Number.isFinite(num) ? clamp(num, 0, CC_NUM_MAX) : 0,
      on: Number.isFinite(on) ? clamp(on, 0, 127) : 127,
      off: Number.isFinite(off) ? clamp(off, 0, 127) : 0,
    };
  }
  return out;
}
function serializeMomSlots(slots) {
  const arr = (slots || []).slice(0, MOM_MAX_SLOTS);
  while (arr.length < MOM_MAX_SLOTS) arr.push(emptyMomSlot());
  return arr.map((s) =>
    `${s.ch|0}:${s.num|0}:${s.on|0}:${s.off|0}`).join(',');
}

function DEFAULT_SW_PARAMS(modeId) {
  if (modeId === 'fx1' || modeId === 'fx3') {
    // inv/inv2/inv3 = INVERTER LED por secao: o indicador visual (LED + tile)
    // acende no OFF logico. So visual — o MIDI enviado nao muda.
    return {
      num: 0, ch: 0, custom: 0, on: 127, off: 0, start: 0, at_preset: 1, color: 1, inv: 0,
      fav: 0, fav_bank: 0, fav_preset: 1, fav_mode: 0, fav_layer: 0,
      num2: 0, ch2: 0, custom2: 0, on2: 127, off2: 0, start2: 0, at_preset2: 1, color2: 1, inv2: 0,
      fav2: 0, fav_bank2: 0, fav_preset2: 1, fav_mode2: 0, fav_layer2: 0,
      num3: 0, ch3: 0, custom3: 0, on3: 127, off3: 0, start3: 0, at_preset3: 1, color3: 1, inv3: 0,
      fav3: 0, fav_bank3: 0, fav_preset3: 1, fav_mode3: 0, fav_layer3: 0,
    };
  }
  if (modeId === 'fx2') {
    return {
      num: 0, ch: 0, custom: 0, on: 127, off: 0, start: 0, at_preset: 1, color: 1, inv: 0,
      fav: 0, fav_bank: 0, fav_preset: 1, fav_mode: 0, fav_layer: 0,
      num2: 0, ch2: 0, custom2: 0, on2: 127, off2: 0, start2: 0, at_preset2: 1, color2: 1, inv2: 0,
      fav2: 0, fav_bank2: 0, fav_preset2: 1, fav_mode2: 0, fav_layer2: 0,
    };
  }
  if (modeId === 'momentary') {
    // MOMENTARY: ate 4 slots em `mom_slots` ("ch:num:on:off,..."). Cada
    // press do SW dispara TODOS os slots como pulse (ON, delay, OFF).
    // Sem estado persistente. Campos legados (num/ch/custom/on/off) ficam
    // como fallback do firmware pra dados antigos (slot 1).
    return {
      mom_slots: emptyMomSlotsStr(),
      num: 0, ch: 0, custom: 0, on: 127, off: 0,
      start: 0, color: 1,
    };
  }
  if (modeId === 'macros') {
    // MACROS: uma secao unica com 4 slots (CC ou PC) com valor ON e OFF
    // (-1 = OFF/pula direcao). mslots e string compacta "t:ch:num:on:off,...".
    // at_preset + start replicam o padrao do STOMP: at_preset=0 aguarda
    // LIVE; at_preset=1 dispara ON ou OFF na chamada conforme `start`.
    return {
      mslots: emptyMslotsStr(),
      at_preset: 1, start: 0, color: 1,
      // inv = INVERTER LED: indicador visual (LED + tile) acende no OFF logico.
      inv: 0,
    };
  }
  if (modeId === 'tap_tempo') {
    // TAP TEMPO: ate 3 slots de CC (ch + num + mode) + 1 slot fixo de
    // long-press (lp_ch + lp_num + lp_val) que dispara quando o usuario
    // segura o SW (~300ms). LED anima sozinho — idle (pixel 1 -> 2 -> 3
    // ciclico) ate bater o tempo, dai pisca no intervalo entre taps.
    return {
      tslots: emptyTapSlotsStr(),
      lp_ch: 0, lp_num: 0, lp_on: 127, lp_off: 0,
      lp_start: 0, lp_at_preset: 1,
      color: 1,
    };
  }
  if (modeId === 'single') {
    // Disparo unico — agora com ate 4 slots em `sslots` ("t:ch:num:val,..."),
    // cada slot CC ou PC. Os campos legados (num, ch, on, pc, as_pc, start)
    // ficam como fallback do firmware pra dados antigos.
    // `at_preset=1` -> dispara todos os slots na chamada do preset.
    // (Padronizado com MACROS; `start` legado ainda lido como fallback.)
    // `lslots`/`rslots`: grupos AUXILIARES — LONG PRESS (segurar 300ms) e
    // RECLICK (duplo-toque). Mesmo formato do sslots. O timing do disparo
    // principal se adapta no firmware: nada extra = press imediato; só LONG
    // = release; RECLICK = espera a janela do duplo-toque (~350ms).
    return {
      sslots: emptySingleSlotsStr(),
      lslots: emptySingleSlotsStr(),
      rslots: emptySingleSlotsStr(),
      num: 0, ch: 0, on: 127, pc: 0, as_pc: 0,
      at_preset: 1, start: 0, remember_state: 0, color: 1,
      // Cores do anel por GESTO (o anel do SW ativo mostra a cor do ultimo
      // gesto disparado): principal=color, LONG=lp_color, RECLICK=rc_color.
      lp_color: 5, rc_color: 9,
    };
  }
  if (modeId === 'spin') {
    // SPIN — maquina de 3 estados (pixel 1, 2, 3) com ATE 3 SLOTS de CC
    // disparados SIMULTANEAMENTE em cada estado. Cada slot tem ch + num
    // + 3 valores (v1/v2/v3). Storage composta em `spin_slots`. Os
    // campos legados (ch/num/val1/val2/val3 soltos) ficam como fallback
    // pra dados antigos (vira slot 1).
    return {
      spin_slots: emptySpinSlotsStr(),
      ch: 0, num: 0, val1: 0, val2: 64, val3: 127,
      at_preset: 1, color: 1,
      // LONG PRESS — slot fixo (toggle ON/OFF) ao segurar o SW, independente
      // do ciclo de 3 estados. Mesmas chaves lp_* do TAP TEMPO (firmware reusa
      // swLiveFireTapLongPress). 0 = sem canal => long-press nao dispara nada.
      // lp_color = cor dos 2 pixels NAO usados pelo SPIN quando o long-press
      // esta ON (ver LED_STRIP.h).
      // lp_start    = estado inicial do toggle (0=OFF, 1=ON) na chamada do preset.
      // lp_at_preset= dispara o lp_on/lp_off conforme lp_start no load do preset.
      lp_ch: 0, lp_num: 0, lp_on: 127, lp_off: 0, lp_color: 1,
      lp_start: 0, lp_at_preset: 0,
    };
  }
  if (modeId === 'ramp') {
    // RAMP — sweep gradual de CC entre min/max com tempo de subida/descida
    // configuravel. Mecanica de press inspirada em controladoras tipo
    // Boss FS-1, Strymon MultiSwitch e expression mapping de Helix:
    //   ch, num             — destino MIDI
    //   min_val/max_val     — valor MIDI nos extremos (default 0/127)
    //   up_ms / down_ms     — tempo total pra ir min->max / max->min
    //   curve               — 0=LINEAR, 1=EXP, 2=LOG, 3=SINE (S-curve)
    //   trigger             — 0=TOGGLE (cada press flipa direcao;
    //                                    press durante movimento INVERTE)
    //                         1=HOLD (segura = sobe; solta = desce)
    //                         2=LOOP (press inicia ping-pong continuo;
    //                                 press para)
    //   step_ms             — intervalo entre envios MIDI (default 25ms)
    //   start_on            — estado inicial (0=min, 1=max) — so visual,
    //                         RAMP NUNCA dispara no load do preset (so
    //                         opera em LIVE MODE por design)
    //   color               — LED
    return {
      ch: 0, num: 0,
      min_val: 0, max_val: 127,
      up_ms: 1000, down_ms: 1000,
      curve: 0, trigger: 0, step_ms: 25,
      start_on: 0, color: 1,
    };
  }
  return {};
}

// Parseia o objeto sw_params da API ({"sw1.fx1":"type=0|num=48|..."}) pro
// shape { [sw]: { [modeId]: {campos numericos} } }. Campos ausentes caem
// no default do modo.
// Parseia a resposta de /sw/params em 2 mapas {sw -> modo -> fields},
// um por layer. Bucketa por sufixo da chave: `sw1.fx1` -> L1[1].fx1;
// `sw1L2.spin` -> L2[1].spin. Retorna { l1, l2 }. Helper antigo
// (parseSwParamsObj) eh wrapper sobre este e retorna so o L1 — preserva
// callers que ainda nao foram migrados.
function parseSwParamsObjByLayer(obj) {
  const l1 = {};
  const l2 = {};
  if (!obj || typeof obj !== 'object') return { l1, l2 };
  for (const key of Object.keys(obj)) {
    const m = /^sw([1-6])(L2)?\.(.+)$/.exec(key);
    if (!m) continue;
    const sw = parseInt(m[1], 10);
    const target = m[2] === 'L2' ? l2 : l1;
    const modeId = m[3];
    const fields = { ...DEFAULT_SW_PARAMS(modeId) };
    const blob = obj[key] || '';
    for (const pair of String(blob).split('|')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const k = pair.slice(0, eq);
      const raw = pair.slice(eq + 1);
      // Chaves compostas string (ex.: MACROS mslots[N] = "t:ch:num:on:off,...")
      // ficam como string; os demais campos sao numericos.
      if (k && (k === 'mslots' || k === 'sslots' || k === 'tslots' ||
                k === 'lslots' || k === 'rslots' ||
                k === 'mom_slots' || k === 'spin_slots')) {
        fields[k] = raw;
      } else {
        const v = parseInt(raw, 10);
        if (k && Number.isFinite(v)) fields[k] = v;
      }
    }
    if (!target[sw]) target[sw] = {};
    target[sw][modeId] = fields;
  }
  return { l1, l2 };
}

// Compat: retorna so o L1. Callers que precisam de L2 usam
// parseSwParamsObjByLayer e bucketam explicitamente.
function parseSwParamsObj(obj) {
  return parseSwParamsObjByLayer(obj).l1;
}

// Serializa os campos de um SW/modo no body de POST /sw/params.
function swParamsToApiBody(fields) {
  const body = new URLSearchParams();
  for (const k of Object.keys(fields || {})) {
    body.set(k, String(fields[k]));
  }
  return body;
}

// SW GLOBAL: a config vai num unico campo (sw_global_params) do /config/global,
// no formato blob `key=value|...` — o mesmo que o firmware guarda em
// swActive.data[i] (ver SW_GLOBAL.h / BANK_MEMORY.h). Aqui (web) serializamos
// e parseamos esse blob, ja que /config/global manda 1 string por campo.
function swParamsToGlobalBlob(fields) {
  return Object.keys(fields || {})
    .map((k) => `${k}=${String(fields[k]).replace(/[|="\\\r\n]/g, '')}`)
    .join('|');
}
function globalBlobToSwParams(blob, modeId) {
  const base = DEFAULT_SW_PARAMS(modeId);
  if (!blob) return base;
  const out = { ...base };
  for (const pair of String(blob).split('|')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    const val = pair.slice(eq + 1);
    // Coage pro tipo do default (numero vs string compacta tipo "ch:num:...").
    out[key] = (typeof base[key] === 'number') ? (Number(val) || 0) : val;
  }
  return out;
}

// Helpers pra montar mensagens MIDI individuais. Cada mensagem reflete
// um disparo real no fio (CC ou PC), com os numeros que sairam de fato
// pro pedal. `when` (opcional) e um rotulo curto tipo ON/OFF/PULSE/TAP
// pra contexto em listagens com varias mensagens da mesma origem.
function ccMsg(ch, num, val, when) {
  const m = { kind: 'cc', ch: Number(ch), num: Number(num), val: Number(val) };
  if (when) m.when = when;
  return m;
}
function pcMsg(ch, pc, when) {
  const m = { kind: 'pc', ch: Number(ch), pc: Number(pc) };
  if (when) m.when = when;
  return m;
}

// SNAPSHOT (PRESET MODE) — monta a entrada estruturada de um SW pro MONITOR
// de chamada de preset. Retorna { sw, modeLabel, sections: [...] } com cada
// section { label, flags, messages }; a logica espelha o firmware.
//
// Regra: secoes que disparam NA CHAMADA do preset (at_preset=true, direcao do
// START) aparecem sem flag especial. Modos puramente REATIVOS A PRESS
// (MOMENTARY, RAMP) nao disparam no load — mas, em vez de ficarem vazios,
// listam o MIDI configurado numa secao marcada "@ PRESS" pra o usuario ver o
// que cada SW envia. (TAP slots tambem so reagem a press; o LP entra so se
// lp_at_preset=true.)
function buildSnapshotStomp(sw, id, userParams) {
  const p = { ...DEFAULT_SW_PARAMS(id), ...(userParams || {}) };
  const chOK = (v) => v >= 1 && v <= 16;
  const hasB = chOK(Number(p.ch2)) || Number(p.fav2) === 1;
  const hasC = id !== 'fx2' &&
               (chOK(Number(p.ch3)) || Number(p.fav3) === 1);
  const tierLabel = (s) => {
    if (hasC) return s === 0 ? 'CURTO' : s === 1 ? 'LONGO' : 'RECLICK';
    if (hasB) return s === 0 ? 'CURTO' : 'LONGO';
    return '';
  };
  const sections = [];
  for (let s = 0; s < 3; s++) {
    if (s === 2 && id === 'fx2') continue;
    const suf = s === 0 ? '' : s === 1 ? '2' : '3';
    // FAVORITE: secao nao dispara MIDI no load do preset (so reage a
    // press fisico). Pula no snapshot.
    if (Number(p['fav' + suf]) === 1) continue;
    const ch = Number(p['ch' + suf]);
    if (!chOK(ch)) continue;
    const atPreset = (typeof p['at_preset' + suf] !== 'undefined')
      ? Number(p['at_preset' + suf]) === 1
      : true;  // default STOMP antigo: dispara no preset
    if (!atPreset) continue;
    const num = Number(p['num' + suf]);
    const asPc = Number(p['aspc' + suf]) === 1;
    const custom = p['custom' + suf] === 1;
    const onV = custom ? Number(p['on' + suf]) : 127;
    const offV = custom ? Number(p['off' + suf]) : 0;
    const startOn = (Number(p['start' + suf]) === 1) !==
      (Number(p['inv' + suf]) === 1);
    const value = asPc
      ? Number(p[(startOn ? 'on' : 'off') + suf])
      : (startOn ? onV : offV);
    sections.push({
      label: tierLabel(s),
      flags: [startOn ? tr(BF_I18N.language, 'sw.startOn') : tr(BF_I18N.language, 'sw.startOff')],
      messages: value < 0 ? [] : [asPc ? pcMsg(ch, value) : ccMsg(ch, num, value)],
    });
  }
  return { sw, modeLabel: 'STOMP', sections };
}

function buildSnapshotMomentary(sw, userParams) {
  // MOMENTARY nao dispara no load do preset — so reage a press. Mostra o MIDI
  // configurado (pulse ON+OFF por slot) numa secao marcada "@ PRESS" pra nao
  // ficar vazio quando o SW de fato tem canais configurados.
  const p = { ...DEFAULT_SW_PARAMS('momentary'), ...(userParams || {}) };
  const slotsFromMom = parseMomSlots(p.mom_slots || '');
  const momHasAny = slotsFromMom.some((s) => s.ch >= 1 && s.ch <= 16);
  const slots = slotsFromMom.slice();
  if (!momHasAny && Number(p.ch) >= 1 && Number(p.ch) <= 16) {
    slots[0] = {
      ch: Number(p.ch), num: Number(p.num) || 0,
      on: Number(p.custom) === 1 ? (Number(p.on) || 127) : 127,
      off: Number(p.custom) === 1 ? (Number(p.off) || 0) : 0,
    };
  }
  const active = slots.filter((s) => s.ch >= 1 && s.ch <= 16);
  if (active.length === 0) return { sw, modeLabel: 'MOMENTARY', sections: [] };
  const messages = [];
  for (const s of active) {
    messages.push(ccMsg(s.ch, s.num, s.on));
    messages.push(ccMsg(s.ch, s.num, s.off));
  }
  return {
    sw, modeLabel: 'MOMENTARY',
    sections: [{ label: 'RESPOSTA AO PRESS', flags: ['@ PRESS'], messages }],
  };
}

function buildSnapshotSingle(sw, userParams) {
  const p = { ...DEFAULT_SW_PARAMS('single'), ...(userParams || {}) };
  const atPreset = (typeof p.at_preset !== 'undefined')
    ? p.at_preset === 1 : p.start === 1;
  const slotsFromSslots = parseSingleSlots(p.sslots || '');
  const sslotsHasAny = slotsFromSslots.some((s) => s.ch >= 1 && s.ch <= 16);
  const slots = slotsFromSslots.slice();
  if (!sslotsHasAny && Number(p.ch) >= 1 && Number(p.ch) <= 16) {
    slots[0] = {
      t: Number(p.as_pc) === 1 ? 1 : 0,
      ch: Number(p.ch),
      num: Number(p.num) || 0,
      val: Number(p.as_pc) === 1 ? (Number(p.pc) || 0) : (Number(p.on) || 127),
    };
  }
  const active = slots.filter((s) => s.ch >= 1 && s.ch <= 16);
  if (active.length === 0) return { sw, modeLabel: 'SINGLE', sections: [] };
  const messages = active.map((s) =>
    s.t === 1 ? pcMsg(s.ch, s.val) : ccMsg(s.ch, s.num, s.val));
  // at_preset=1: dispara na chamada do preset (sem flag). at_preset=0: so
  // reage a press — marca "@ PRESS" em vez de sumir do monitor (mesmo padrao
  // de MOMENTARY/RAMP/TAP).
  return {
    sw, modeLabel: 'SINGLE',
    sections: [atPreset
      ? { label: '', flags: [], messages }
      : { label: 'RESPOSTA AO PRESS', flags: ['@ PRESS'], messages }],
  };
}

function buildSnapshotMacros(sw, userParams) {
  const p = { ...DEFAULT_SW_PARAMS('macros'), ...(userParams || {}) };
  const chOK = (s) => s.ch >= 1 && s.ch <= 16;
  if (p.at_preset !== 1) return { sw, modeLabel: 'MACROS', sections: [] };
  const slots = parseMslots(p.mslots || '');
  const active = slots.filter(chOK);
  if (active.length === 0) return { sw, modeLabel: 'MACROS', sections: [] };
  const startOn = (Number(p.start) === 1) !== (Number(p.inv) === 1);
  const messages = [];
  for (const slot of active) {
    const v = startOn ? slot.on : slot.off;
    if (v < 0) continue;
    messages.push(slot.t === 1
      ? pcMsg(slot.ch, v)
      : ccMsg(slot.ch, slot.num, v));
  }
  if (messages.length === 0) return { sw, modeLabel: 'MACROS', sections: [] };
  return {
    sw, modeLabel: 'MACROS',
    sections: [{
      label: '',
      flags: [startOn ? tr(BF_I18N.language, 'sw.startOn') : tr(BF_I18N.language, 'sw.startOff')],
      messages,
    }],
  };
}

function buildSnapshotTap(sw, userParams) {
  // TAP TEMPO: a secao LONG PRESS dispara no load do preset se lp_at_preset=1
  // (sem flag especial). Os slots de TAP nunca disparam no load (reativos a
  // press, sem opcao at_preset) — listam o MIDI configurado em "@ PRESS".
  const p = { ...DEFAULT_SW_PARAMS('tap_tempo'), ...(userParams || {}) };
  const sections = [];

  const lpCh = Number(p.lp_ch) || 0;
  if (Number(p.lp_at_preset) === 1 && lpCh >= 1 && lpCh <= 16) {
    const lpNum = Number(p.lp_num) || 0;
    const startOn = Number(p.lp_start) === 1;
    const lpOn = typeof p.lp_on !== 'undefined' ? Number(p.lp_on) : 127;
    const lpOff = Number(p.lp_off) || 0;
    sections.push({
      label: 'LONG PRESS',
      flags: [startOn ? tr(BF_I18N.language, 'sw.startOn') : tr(BF_I18N.language, 'sw.startOff')],
      messages: [ccMsg(lpCh, lpNum, startOn ? lpOn : lpOff)],
    });
  }

  const tapSlots = parseTapSlots(p.tslots || '')
    .filter((s) => s.ch >= 1 && s.ch <= 16);
  if (tapSlots.length > 0) {
    const messages = [];
    for (const s of tapSlots) {
      messages.push(ccMsg(s.ch, s.num, 127));
      if (s.mode === 2) messages.push(ccMsg(s.ch, s.num, 0));
    }
    sections.push({ label: 'TAP', flags: ['@ PRESS'], messages });
  }

  return { sw, modeLabel: 'TAP TEMPO', sections };
}

function buildSnapshotSpin(sw, userParams) {
  // SPIN fire-on-preset: se at_preset=1, envia VAL1 de cada slot
  // configurado (estado inicial = pixel 1). Sem at_preset, nao dispara
  // nada no load (fica awaiting).
  const p = { ...DEFAULT_SW_PARAMS('spin'), ...(userParams || {}) };
  const sections = [];
  // PIXEL 1 — só dispara no load se at_preset=1 (estado inicial = pixel 1).
  if (Number(p.at_preset) === 1) {
    const parsed = parseSpinSlots(p.spin_slots || '');
    const hasAny = parsed.some((s) => s.ch >= 1 && s.ch <= 16);
    const slots = parsed.slice();
    if (!hasAny && Number(p.ch) >= 1 && Number(p.ch) <= 16) {
      slots[0] = {
        ch: Number(p.ch), num: Number(p.num) || 0,
        v1: Number(p.val1) || 0,
        v2: typeof p.val2 !== 'undefined' ? Number(p.val2) : 64,
        v3: typeof p.val3 !== 'undefined' ? Number(p.val3) : 127,
      };
    }
    const active = slots.filter((s) => s.ch >= 1 && s.ch <= 16);
    if (active.length > 0) {
      sections.push({
        label: 'PIXEL 1',
        flags: [`${active.length} SLOT${active.length > 1 ? 'S' : ''}`],
        messages: active.map((s) => ccMsg(s.ch, s.num, s.v1)),
      });
    }
  }
  // LONG PRESS — reativo ao hold (nunca dispara no load); lista o CC configurado.
  const lpCh = Number(p.lp_ch) || 0;
  if (lpCh >= 1 && lpCh <= 16) {
    const lpNum = Number(p.lp_num) || 0;
    const lpOn = typeof p.lp_on !== 'undefined' ? Number(p.lp_on) : 127;
    sections.push({
      label: 'LONG PRESS', flags: ['@ HOLD'],
      messages: [ccMsg(lpCh, lpNum, lpOn)],
    });
  }
  return { sw, modeLabel: 'SPIN', sections };
}

function buildSnapshotRamp(sw, userParams) {
  // RAMP nunca dispara na chamada do preset (so opera em LIVE MODE por
  // design). Mostra o MIDI configurado (extremos do sweep) numa secao marcada
  // "@ PRESS" pra nao ficar vazio quando o canal esta configurado.
  const p = { ...DEFAULT_SW_PARAMS('ramp'), ...(userParams || {}) };
  const ch = Number(p.ch) || 0;
  if (ch < 1 || ch > 16) return { sw, modeLabel: 'RAMP', sections: [] };
  const num = Number(p.num) || 0;
  const minV = Number(p.min_val) || 0;
  const maxV = typeof p.max_val !== 'undefined' ? Number(p.max_val) : 127;
  const curveLabels = ['LINEAR', 'EXP', 'LOG', 'SINE'];
  const curve = curveLabels[Number(p.curve) || 0] || 'LINEAR';
  const upMs = Number(p.up_ms) || 1000;
  const downMs = Number(p.down_ms) || 1000;
  return {
    sw, modeLabel: 'RAMP',
    sections: [{
      label: 'RESPOSTA AO PRESS',
      flags: ['@ PRESS', curve],
      messages: [
        ccMsg(ch, num, maxV, `↑ ${upMs}ms`),
        ccMsg(ch, num, minV, `↓ ${downMs}ms`),
      ],
    }],
  };
}

function buildSnapshotSwEntry(sw, id, params) {
  if (!id || id === 'mute') return { sw, modeLabel: 'MUTE', sections: [] };
  if (id === 'fx1' || id === 'fx2' || id === 'fx3') {
    return buildSnapshotStomp(sw, id, params);
  }
  if (id === 'momentary') return buildSnapshotMomentary(sw, params);
  if (id === 'single')    return buildSnapshotSingle(sw, params);
  if (id === 'macros')    return buildSnapshotMacros(sw, params);
  if (id === 'tap_tempo') return buildSnapshotTap(sw, params);
  if (id === 'ramp')      return buildSnapshotRamp(sw, params);
  if (id === 'spin')      return buildSnapshotSpin(sw, params);
  // Outros modos ainda nao implementados — mostra so o rotulo.
  const mode = SW_MODES.find((m) => m.id === id);
  return { sw, modeLabel: mode ? (mode.sub || mode.title) : id.toUpperCase(),
           sections: [] };
}

// Monta um evento de press de SW em LIVE MODE pro MONITOR. section: 0 =
// click curto (chaves sem sufixo), 1 = click longo (sufixo 2), 2 = reclick
// do STOMP 3 (sufixo 3). nowOn: estado novo apos o press. Retorna null se
// o modo do SW nao produz MIDI naquela secao (mute, fx1 section>0, etc.).
// O objeto retornado tem:
//   sw          — numero do SW (1..6)
//   modeLabel   — rotulo do modo (STOMP, MACROS, SINGLE, etc.)
//   sectionLabel— rotulo da secao no tier (CURTO/LONGO/RECLICK) ou ''
//   on          — true/false do toggle, ou true pra disparos one-shot
//   messages    — array de { kind: 'cc'|'pc', ch, num/pc, val } com cada
//                 mensagem MIDI que foi realmente disparada
function buildLivePressEvent(sw, section, nowOn, savedSwModes, savedSwParams) {
  const id = (savedSwModes && savedSwModes[sw]) || 'mute';
  const userParams = savedSwParams && savedSwParams[sw] && savedSwParams[sw][id];

  // STOMP unificado (fx1) e legados fx2/fx3 — toggle de uma secao com
  // um CC. tierLabel mostra CURTO/LONGO/RECLICK conforme as secoes
  // configuradas (so A = sem label; A+B = CURTO/LONGO; +C = todos).
  if (id === 'fx1' || id === 'fx2' || id === 'fx3') {
    const p = { ...DEFAULT_SW_PARAMS(id), ...(userParams || {}) };
    const chOK = (v) => v >= 1 && v <= 16;
    // Secao "esta ativa" se tem canal valido OU se esta como FAVORITE.
    const hasB = chOK(Number(p.ch2)) || Number(p.fav2) === 1;
    const hasC = id !== 'fx2' &&
                 (chOK(Number(p.ch3)) || Number(p.fav3) === 1);
    const tierLabel = (s) => {
      if (hasC) return s === 0 ? 'CURTO' : s === 1 ? 'LONGO' : 'RECLICK';
      if (hasB) return s === 0 ? 'CURTO' : 'LONGO';
      return '';
    };
    const suf = section === 0 ? '' : section === 1 ? '2' : '3';
    // FAVORITE: a secao carrega banco/preset em vez de mandar CC.
    if (Number(p['fav' + suf]) === 1) {
      const bankLetters = BANK_LETTERS;
      const fb = clamp(Number(p['fav_bank' + suf]) || 0, 0, BANK_LETTER_COUNT - 1);
      const fp = clamp(Number(p['fav_preset' + suf]) || 1, 1, 30);
      const isLive = Number(p['fav_mode' + suf]) === 1;
      // Em LIVE, anexa o layer alvo (L2 so quando fav_layer=1).
      const fm = isLive
        ? (Number(p['fav_layer' + suf]) === 1 ? 'LIVE L2' : 'LIVE L1')
        : 'PRESET';
      return {
        sw, modeLabel: 'STOMP',
        sectionLabel: tierLabel(section),
        on: null,
        messages: [{
          kind: 'fav',
          bank: bankLetters[fb] || 'A',
          preset: fp,
          mode: fm,
        }],
      };
    }
    const ch = Number(p['ch' + suf]);
    if (!chOK(ch)) {
      // Secao pressionada mas sem canal: loga o press (vazio) em vez de
      // sumir do monitor.
      return { sw, modeLabel: 'STOMP', sectionLabel: tierLabel(section),
               on: nowOn, messages: [] };
    }
    const asPc = Number(p['aspc' + suf]) === 1;
    const custom = Number(p['custom' + suf]) === 1;
    const onV = Number(p['on' + suf]);
    const offV = Number(p['off' + suf]);
    const value = asPc
      ? (nowOn ? onV : offV)
      : (custom ? (nowOn ? onV : offV) : (nowOn ? 127 : 0));
    return {
      sw, modeLabel: 'STOMP', sectionLabel: tierLabel(section), on: nowOn,
      messages: value < 0 ? [] : [asPc
        ? pcMsg(ch, value)
        : ccMsg(ch, Number(p['num' + suf]), value)],
    };
  }

  if (id === 'momentary' && section === 0) {
    const p = { ...DEFAULT_SW_PARAMS('momentary'), ...(userParams || {}) };
    const slotsFromMom = parseMomSlots(p.mom_slots || '');
    const momHasAny = slotsFromMom.some((s) => s.ch >= 1 && s.ch <= 16);
    const slots = slotsFromMom.slice();
    if (!momHasAny && Number(p.ch) >= 1 && Number(p.ch) <= 16) {
      slots[0] = {
        ch: Number(p.ch),
        num: Number(p.num) || 0,
        on: Number(p.custom) === 1 ? (Number(p.on) || 127) : 127,
        off: Number(p.custom) === 1 ? (Number(p.off) || 0) : 0,
      };
    }
    const active = slots.filter((s) => s.ch >= 1 && s.ch <= 16);
    if (active.length === 0) {
      return { sw, modeLabel: 'MOMENTARY', sectionLabel: '', on: null,
               messages: [] };
    }
    const messages = [];
    for (const s of active) {
      messages.push(ccMsg(s.ch, s.num, s.on));
      messages.push(ccMsg(s.ch, s.num, s.off));
    }
    return {
      sw, modeLabel: 'MOMENTARY', sectionLabel: '', on: null,
      messages,
    };
  }

  if (id === 'macros') {
    const p = { ...DEFAULT_SW_PARAMS('macros'), ...(userParams || {}) };
    const slots = parseMslots(p.mslots || '');
    const messages = [];
    for (const s of slots) {
      if (s.ch < 1 || s.ch > 16) continue;
      const v = nowOn ? s.on : s.off;
      if (v < 0) continue;  // -1 = OFF/pula direcao pra esse slot
      messages.push(s.t === 1 ? pcMsg(s.ch, v) : ccMsg(s.ch, s.num, v));
    }
    return {
      sw, modeLabel: 'MACROS', sectionLabel: '', on: nowOn,
      messages,
    };
  }

  if (id === 'tap_tempo') {
    const p = { ...DEFAULT_SW_PARAMS('tap_tempo'), ...(userParams || {}) };
    if (section === 0) {
      const slots = parseTapSlots(p.tslots || '');
      const messages = [];
      for (const s of slots) {
        if (s.ch < 1 || s.ch > 16) continue;
        messages.push(ccMsg(s.ch, s.num, 127));
        if (s.mode === 2) messages.push(ccMsg(s.ch, s.num, 0));
      }
      return {
        sw, modeLabel: 'TAP TEMPO', sectionLabel: 'TAP', on: null,
        messages,
      };
    }
    if (section === 1) {
      const lpCh = Number(p.lp_ch) || 0;
      if (lpCh < 1 || lpCh > 16) {
        return { sw, modeLabel: 'TAP TEMPO', sectionLabel: 'LONG PRESS',
                 on: nowOn, messages: [] };
      }
      const lpNum = Number(p.lp_num) || 0;
      const lpOn = typeof p.lp_on !== 'undefined' ? Number(p.lp_on) : 127;
      const lpOff = Number(p.lp_off) || 0;
      const val = nowOn ? lpOn : lpOff;
      return {
        sw, modeLabel: 'TAP TEMPO', sectionLabel: 'LONG PRESS', on: nowOn,
        messages: [ccMsg(lpCh, lpNum, val)],
      };
    }
    return null;
  }

  if (id === 'spin' && section === 1) {
    const p = { ...DEFAULT_SW_PARAMS('spin'), ...(userParams || {}) };
    const ch = Number(p.lp_ch) || 0;
    if (ch < 1 || ch > 16) {
      return { sw, modeLabel: 'SPIN', sectionLabel: 'LONG PRESS',
               on: nowOn, messages: [] };
    }
    const onValue = typeof p.lp_on !== 'undefined' ? Number(p.lp_on) : 127;
    const offValue = Number(p.lp_off) || 0;
    return {
      sw, modeLabel: 'SPIN', sectionLabel: 'LONG PRESS', on: nowOn,
      messages: [ccMsg(ch, Number(p.lp_num) || 0, nowOn ? onValue : offValue)],
    };
  }

  if (id === 'spin' && section === 0) {
    // SPIN — nowOn carrega o stateIndex (0/1/2). Cada estado dispara
    // TODOS os slots configurados (ate 3 CCs simultaneos).
    const p = { ...DEFAULT_SW_PARAMS('spin'), ...(userParams || {}) };
    const stIdx = typeof nowOn === 'number' ? clamp(nowOn, 0, 2) : 0;
    const vKey = stIdx === 0 ? 'v1' : stIdx === 1 ? 'v2' : 'v3';
    const parsed = parseSpinSlots(p.spin_slots || '');
    const hasAny = parsed.some((s) => s.ch >= 1 && s.ch <= 16);
    const slots = parsed.slice();
    if (!hasAny && Number(p.ch) >= 1 && Number(p.ch) <= 16) {
      slots[0] = {
        ch: Number(p.ch), num: Number(p.num) || 0,
        v1: Number(p.val1) || 0,
        v2: typeof p.val2 !== 'undefined' ? Number(p.val2) : 64,
        v3: typeof p.val3 !== 'undefined' ? Number(p.val3) : 127,
      };
    }
    const active = slots.filter((s) => s.ch >= 1 && s.ch <= 16);
    if (active.length === 0) {
      return { sw, modeLabel: 'SPIN', sectionLabel: 'PIXEL ' + (stIdx + 1),
               on: null, messages: [] };
    }
    return {
      sw, modeLabel: 'SPIN',
      sectionLabel: 'PIXEL ' + (stIdx + 1),
      on: null,
      messages: active.map((s) => ccMsg(s.ch, s.num, s[vKey] || 0)),
    };
  }

  if (id === 'ramp' && section === 0) {
    // RAMP — usa liveOn[i] como toggle (direcao do sweep). Cada press
    // flipa, e o evento mostra o valor extremo daquela direcao. O sweep
    // continuo acontece no device — o monitor so loga o gatilho.
    const p = { ...DEFAULT_SW_PARAMS('ramp'), ...(userParams || {}) };
    const ch = Number(p.ch) || 0;
    if (ch < 1 || ch > 16) {
      return { sw, modeLabel: 'RAMP', sectionLabel: '', on: nowOn,
               messages: [] };
    }
    const num = Number(p.num) || 0;
    const target = nowOn
      ? (typeof p.max_val !== 'undefined' ? Number(p.max_val) : 127)
      : Number(p.min_val) || 0;
    const curveLabels = ['LINEAR', 'EXP', 'LOG', 'SINE'];
    const dur = nowOn ? (Number(p.up_ms) || 1000) : (Number(p.down_ms) || 1000);
    return {
      sw, modeLabel: 'RAMP',
      sectionLabel: (nowOn ? '↑ ' : '↓ ') + (curveLabels[Number(p.curve) || 0]
        || 'LINEAR') + ` (${dur}ms)`,
      on: nowOn,
      messages: [ccMsg(ch, num, target)],
    };
  }

  if (id === 'single' && section >= 0 && section <= 2) {
    const p = { ...DEFAULT_SW_PARAMS('single'), ...(userParams || {}) };
    const slotField = section === 1 ? 'lslots' : section === 2 ? 'rslots' : 'sslots';
    const slotsFromSslots = parseSingleSlots(p[slotField] || '');
    const sslotsHasAny = slotsFromSslots.some((s) => s.ch >= 1 && s.ch <= 16);
    const slots = slotsFromSslots.slice();
    if (section === 0 && !sslotsHasAny && Number(p.ch) >= 1 && Number(p.ch) <= 16) {
      slots[0] = {
        t: Number(p.as_pc) === 1 ? 1 : 0,
        ch: Number(p.ch),
        num: Number(p.num) || 0,
        val: Number(p.as_pc) === 1
          ? (Number(p.pc) || 0)
          : (Number(p.on) || 127),
      };
    }
    const messages = slots
      .filter((s) => s.ch >= 1 && s.ch <= 16)
      .map((s) => s.t === 1 ? pcMsg(s.ch, s.val) : ccMsg(s.ch, s.num, s.val));
    return {
      sw, modeLabel: 'SINGLE',
      sectionLabel: section === 1 ? 'LONGO' : section === 2 ? 'DUPLO' : '',
      on: null,
      messages,
    };
  }

  return null;
}

// Footswitch (pedal de stomp) — cap arredondado + pescoco + base em 2
// niveis. Reutilizado por FX1/FX2/FX3; a diferenca entre eles esta no
// comportamento (ver SW_MODES), nao no desenho.
function swFootswitch() {
  return (
    <>
      <rect className="bf-tab-shape" x="8" y="2.5" width="8" height="8" rx="3" />
      <path className="bf-tab-shape" d="M10 10.5 L10 12.5 M14 10.5 L14 12.5" />
      <rect className="bf-tab-shape" x="6.5" y="12.5" width="11" height="3" rx="0.6" />
      <rect className="bf-tab-shape" x="4" y="15.5" width="16" height="4" rx="0.8" />
    </>
  );
}

function swIcoSvg(children) {
  return (
    <svg viewBox="0 0 24 24" className="bf-tab-ico" strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true">{children}</svg>
  );
}

// Icone line-art de cada modo de SW. Mesmo estilo dos demais icones do
// app (bf-tab-shape = traco, bf-tab-dot = preenchido).
function SwModeIcon({ id }) {
  switch (id) {
    case 'mute':  // alto-falante mudo — SW silencioso (padrao)
      return swIcoSvg(<>
        <path className="bf-tab-shape" d="M3.5 9.5 L7 9.5 L11 6 L11 18 L7 14.5 L3.5 14.5 Z" />
        <path className="bf-tab-shape" d="M14.5 9 L20 15 M20 9 L14.5 15" />
      </>);
    case 'fx1':  // STOMP — click
    case 'fx2':  // DUAL STOMP — click + long click
    case 'fx3':  // TRIAL STOMP — click + long click + reclick
      return swIcoSvg(swFootswitch());
    case 'spin':  // knob + ponteiro + ticks radiais
      return swIcoSvg(<>
        <circle className="bf-tab-shape" cx="12" cy="12" r="6" />
        <path className="bf-tab-shape" d="M12 12 L15.5 8.5" />
        <path className="bf-tab-shape" d="M19.5 12 L21.5 12 M17.3 6.7 L18.7 5.3 M12 4.5 L12 2.5 M6.7 6.7 L5.3 5.3 M4.5 12 L2.5 12 M6.7 17.3 L5.3 18.7 M12 19.5 L12 21.5 M17.3 17.3 L18.7 18.7" />
      </>);
    case 'ramp':  // triangulo com hipotenusa tracejada
      return swIcoSvg(<>
        <path className="bf-tab-shape" d="M4 19 L20 19 L20 5" />
        <path className="bf-tab-shape" strokeDasharray="3 2.4" d="M4 19 L20 5" />
      </>);
    case 'momentary':  // sinaleiro / luz de alerta
      return swIcoSvg(<>
        <path className="bf-tab-shape" d="M9 18.5 L15 18.5 L15.7 20.8 L8.3 20.8 Z" />
        <path className="bf-tab-shape" d="M9 18.5 L9 13.5 C9 10.2 10.3 9 12 9 C13.7 9 15 10.2 15 13.5 L15 18.5" />
        <path className="bf-tab-shape" d="M12 7 L12 4.5 M7.7 8.3 L6 6.6 M16.3 8.3 L18 6.6 M6.3 12 L4 11.3 M17.7 12 L20 11.3" />
      </>);
    case 'favorite':  // estrela
      return swIcoSvg(
        <path className="bf-tab-shape" d="M12 2.5 L14.85 8.9 L21.5 9.6 L16.5 14.1 L18 20.7 L12 17.3 L6 20.7 L7.5 14.1 L2.5 9.6 L9.15 8.9 Z" />
      );
    case 'macros':  // 3 faders verticais
      return swIcoSvg(<>
        <path className="bf-tab-shape" d="M7 4 L7 20 M12 4 L12 20 M17 4 L17 20" />
        <rect className="bf-tab-dot" x="4.8" y="7" width="4.4" height="2.6" rx="0.7" />
        <rect className="bf-tab-dot" x="9.8" y="12.5" width="4.4" height="2.6" rx="0.7" />
        <rect className="bf-tab-dot" x="14.8" y="9.5" width="4.4" height="2.6" rx="0.7" />
      </>);
    case 'tap_tempo':  // relogio com linhas de movimento
      return swIcoSvg(<>
        <circle className="bf-tab-shape" cx="12" cy="12" r="6.5" />
        <path className="bf-tab-shape" d="M12 12 L12 7.8 M12 12 L15 13.5" />
        <path className="bf-tab-shape" d="M4 8 C2.6 12 2.6 12 4 16 M20 8 C21.4 12 21.4 12 20 16" />
      </>);
    case 'single':  // moldura de foco + circulo central
      return swIcoSvg(<>
        <path className="bf-tab-shape" d="M3.5 8 L3.5 4.5 L7 4.5 M17 4.5 L20.5 4.5 L20.5 8 M20.5 16 L20.5 19.5 L17 19.5 M7 19.5 L3.5 19.5 L3.5 16" />
        <circle className="bf-tab-shape" cx="12" cy="12" r="4" />
      </>);
    default:  // sem modo definido — placeholder pontilhado
      return swIcoSvg(
        <circle className="bf-tab-shape" cx="12" cy="12" r="7" strokeDasharray="2.5 3" opacity="0.45" />
      );
  }
}

// Uma secao do editor STOMP 2/3 — mesma estrutura do SwFx1Editor, mas
// parametrizada pelo `section`: 0 = click curto (chaves num/ch/...), 1 =
// click longo (chaves num2/ch2/...), 2 = reclick/duplo-click (chaves
// num3/ch3/...). O `onChange` recebido ja aponta pro modo do SW; aqui so
// prefixamos as chaves. `litArcsOn` define quais arcos do FootswitchArc
// acendem quando testOn (mapeamento do pixel no firmware).
function SwStompSection({ sw, section, label, litArcsOn,
                          params, onChange, ledPreviewLive, liveOn,
                          presetCount, hideStart, noLed, hideAtPreset }) {
  const { t } = useBfI18n();
  const suf = section === 0 ? '' : section === 1 ? '2' : '3';
  const k = (base) => base + suf;
  const num = params[k('num')];
  const ch = params[k('ch')];
  const on = params[k('on')];
  const off = params[k('off')];
  const start = params[k('start')];
  const color = params[k('color')];
  // INVERTER LED: inverte o indicador visual (LED + tile) da secao — acende
  // no OFF logico. So visual; o MIDI enviado nao muda.
  const invLed = Number(params[k('inv')]) === 1;
  const isCustom = params[k('custom')] === 1;
  // Modo PC (aspc<suf>=1): a secao manda PC em vez de CC. Reusa on/off
  // como valores de PC logico (ON/OFF do toggle), igual MACROS. -1 = pula.
  const isPc = Number(params[k('aspc')]) === 1;
  const isFav = Number(params[k('fav')]) === 1;
  const favBank = clamp(Number(params[k('fav_bank')]) || 0, 0, BANK_LETTER_COUNT - 1);
  const favPreset = clamp(Number(params[k('fav_preset')]) || 1, 1,
                          presetCount || 6);
  const favMode = Number(params[k('fav_mode')]) === 1 ? 1 : 0;
  // Layer alvo do favorito (so faz sentido em modo LIVE). 0 = L1, 1 = L2.
  const favLayer = Number(params[k('fav_layer')]) === 1 ? 1 : 0;
  const bankLetters = BANK_LETTERS;
  // at_preset: dispara MIDI na chamada do preset? Default 1 quando
  // ausente (dados antigos do STOMP, que sempre disparavam).
  const atPreset = (typeof params[k('at_preset')] !== 'undefined')
    ? params[k('at_preset')] === 1
    : true;
  const numOptions = Array.from({ length: 128 }, (_, n) => n);
  // Estado de teste local: o botao MIDI TEST alterna on/off, dispara o CC
  // efetivo daquele estado no dispositivo e reflete no preview do LED.
  // Inicia no estado live do firmware (so a secao A o recebe) ou, na
  // falta, no `start` configurado. Reinicia por SW (key no LiveModePanel).
  const [testOn, setTestOn] = useState(
    typeof liveOn === 'boolean' ? liveOn : start === 1);
  useEffect(() => {
    setTestOn(typeof liveOn === 'boolean' ? liveOn : start === 1);
  }, [sw, section, liveOn, start]);
  const midiTest = async () => {
    const next = !testOn;
    setTestOn(next);
    const body = new URLSearchParams();
    body.set('sw', String(sw));
    body.set('on', next ? '1' : '0');
    body.set('color', String(color));
    body.set('section', String(section));
    if (ch >= 1 && ch <= 16) {
      if (isPc) {
        // PC: ON/OFF do toggle = on/off salvos (PC logico). -1 pula a direcao.
        const pcv = next ? Number(on) : Number(off);
        if (pcv >= 0) {
          body.set('ch', String(ch));
          body.set('as_pc', '1');
          body.set('pc', String(pcv));
        }
      } else {
        // Valor efetivo do CC: custom usa on/off salvos, senao 127/0.
        const value = isCustom ? (next ? on : off) : (next ? 127 : 0);
        body.set('ch', String(ch));
        body.set('cc', String(num));
        body.set('value', String(value));
      }
    }
    try { await apiCall('POST', '/midi/cc', body); } catch {/* preview/offline */}
  };
  // Preview do LED (FootswitchArc): reflete o estado INICIAL salvo da
  // secao. START ON (chave start/start2/start3 conforme a secao) -> acende
  // os arcos definidos em `litArcsOn` (o parent decide o mapeamento
  // conforme o modo/tier). testOn (legado) tambem forca aceso.
  const startKey = section === 0 ? 'start' : section === 1 ? 'start2' : 'start3';
  const startOn = Number((params || {})[startKey]) === 1;
  const logicalOn = testOn || startOn;
  // INVERTER LED: o preview do arco reflete o estado invertido (acende no OFF).
  const isOn = invLed ? !logicalOn : logicalOn;
  const ledLitArcs = isOn ? (litArcsOn || []) : [];
  const ledDimmed = false;
  // Toggle CC/PC — em PC a secao manda PC (on/off do toggle viram valores de
  // PC logico). Posicionado ao lado do CANAL em PC (CC + CUSTOM somem) ou na
  // linha do CUSTOM em CC. Definido uma vez e reusado nos dois layouts.
  const ccPcToggle = (
    <button
      type="button"
      className={'bf-input bf-input-num bf-macros-slot-type' +
                 (isPc ? ' is-pc' : ' is-cc')}
      onClick={() => {
        if (isPc) {
          onChange({ [k('aspc')]: 0 });
        } else {
          // Ao ligar PC, semeia on/off se ausentes (senao o firmware
          // assume -1 = pula as duas direcoes e nada e enviado).
          const patch = { [k('aspc')]: 1 };
          if (typeof params[k('on')] === 'undefined') patch[k('on')] = 0;
          if (typeof params[k('off')] === 'undefined') patch[k('off')] = -1;
          onChange(patch);
        }
      }}
      aria-pressed={isPc}
      aria-label={isPc ? t('sw.slot.aria.isPc') : t('sw.slot.aria.isCc')}
      title={isPc ? t('sw.slot.title.isPc') : t('sw.slot.title.isCc')}
    >{isPc ? t('sw.sendPc') : t('sw.sendCc')}</button>
  );
  return (
    <div className="bf-sw-fx1">
      {label && <div className="bf-section-label">{label}</div>}
      {isFav ? (
        // ─── FAVORITE MODE — substitui os campos MIDI por um seletor
        // visual de banco/preset/modo no mesmo estilo da pagina GLOBAL
        // (.bf-seg pro toggle BANK/LIVE + .bf-cycle pros cards grandes).
        // Ao pisar o SW, o firmware carrega esse preset, opcionalmente
        // entrando em LIVE MODE.
        <div className="bf-fav-picker">
          <div className="bf-seg">
            <button
              type="button"
              className={favMode === 0 ? 'is-active' : ''}
              onClick={() => onChange({ [k('fav_mode')]: 0 })}
              aria-pressed={favMode === 0}
              title={t('bank.recallPresetMode')}
            >{t('sw.bank')}</button>
            <button
              type="button"
              className={favMode === 1 ? 'is-active' : ''}
              onClick={() => onChange({ [k('fav_mode')]: 1 })}
              aria-pressed={favMode === 1}
              title={t('bank.recallLiveMode')}
            >LIVE</button>
          </div>
          {/* LAYER alvo — so em modo LIVE. Em BANK o layer e irrelevante.
              Se o preset DESTINO nao tiver LAYER 2 habilitado (meta.layer2)
              o firmware ignora e cai no L1 (gate em presetLayer2Enabled). */}
          {favMode === 1 && (
            <div className="bf-seg">
              <button
                type="button"
                className={favLayer === 0 ? 'is-active' : ''}
                onClick={() => onChange({ [k('fav_layer')]: 0 })}
                aria-pressed={favLayer === 0}
                title="Carrega no Layer 1"
              >LAYER 1</button>
              <button
                type="button"
                className={favLayer === 1 ? 'is-active' : ''}
                onClick={() => onChange({ [k('fav_layer')]: 1 })}
                aria-pressed={favLayer === 1}
                title="Carrega no Layer 2"
              >LAYER 2</button>
            </div>
          )}
          <div className="bf-cycle">
            <button
              type="button"
              className="is-on"
              onClick={() => onChange({ [k('fav_bank')]: (favBank + 1) % BANK_LETTER_COUNT })}
              aria-label={t('sw.aria.favBank', { letter: bankLetters[favBank] })}
              title={t('bank.cycleLetter')}
            >
              <span className="cap">{t('sw.bank')}</span>{bankLetters[favBank]}
            </button>
            <button
              type="button"
              className="is-on"
              onClick={() => onChange({ [k('fav_preset')]: (favPreset % (presetCount || 6)) + 1 })}
              aria-label={t('sw.aria.favPreset', { n: favPreset })}
              title={t('bank.cycle')}
            >
              <span className="cap">PRESET</span>{favPreset}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="bf-extras-row">
            {!isPc && (
            <label className="bf-extras-cell">
              <span className="bf-field-label">CC</span>
              <div className="bf-select-wrap">
                <BfSelect
                  className="bf-input bf-select"
                  value={num}
                  onChange={(e) => {
                    const nv = clamp(Number(e.target.value), 0, CC_NUM_MAX);
                    onChange({ [k('num')]: nv,
                               [k('on')]: kemperSnapValue(on, ch, nv),
                               [k('off')]: kemperSnapValue(off, ch, nv) });
                  }}
                  aria-label={t('sw.aria.ccNum')}
                >
                  {midiOptionElems(numOptions, 'cc', num, ch)}
                </BfSelect>
                <span className="bf-select-chev">▾</span>
              </div>
            </label>
            )}
            <label className="bf-extras-cell">
              <span className="bf-field-label">{t('sw.channel')}</span>
              <div className="bf-select-wrap">
                <BfSelect
                  className={'bf-input bf-select' + (ch === 0 ? ' is-mute' : '')}
                  value={ch}
                  onChange={(e) => onChange({ [k('ch')]: Number(e.target.value) })}
                  aria-label={t('sw.aria.midiCh')}
                >
                  {channelOptionElems()}
                </BfSelect>
                <span className="bf-select-chev">▾</span>
              </div>
            </label>
            {/* PC: o toggle ocupa a 2a coluna (CC sumiu). Label espacador
                alinha o botao com o select do CANAL ao lado. */}
            {isPc && (
            <div className="bf-extras-cell">
              <span className="bf-field-label" aria-hidden="true">&nbsp;</span>
              {ccPcToggle}
            </div>
            )}
          </div>
          {/* CC: toggle + CUSTOM em linha propria. Em PC o toggle ja subiu
              pra linha do CANAL e o CUSTOM nao se aplica. */}
          {!isPc && (
          <div className="bf-extras-row">
            {ccPcToggle}
            <button
              type="button"
              className={'bf-input bf-input-num' + (isCustom ? ' is-active' : '')}
              onClick={() => onChange({ [k('custom')]: isCustom ? 0 : 1 })}
              aria-pressed={isCustom}
              aria-label={t('sw.aria.customState', { state: isCustom ? t('sw.on') : t('sw.off') })}
              title={t('sw.aria.ownOnOff')}
            >
              CUSTOM
            </button>
          </div>
          )}
          {/* START ON / DISPARA NO PRESET migraram pro card "Opções" abaixo. */}
        </>
      )}
      {!isFav && isCustom && (
        <div className="bf-extras-row">
          <label className="bf-extras-cell">
            <span className="bf-field-label">{t('sw.valOn')}</span>
            <div className="bf-select-wrap">
              <BfSelect
                className="bf-input bf-select"
                value={on}
                onChange={(e) => onChange({ [k('on')]: clamp(Number(e.target.value), 0, 127) })}
                aria-label={t('sw.aria.ccValOn')}
              >
                {kemperValueOptionElems(on, ch, num)}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
          <label className="bf-extras-cell">
            <span className="bf-field-label">{t('sw.valOff')}</span>
            <div className="bf-select-wrap">
              <BfSelect
                className="bf-input bf-select"
                value={off}
                onChange={(e) => onChange({ [k('off')]: clamp(Number(e.target.value), 0, 127) })}
                aria-label={t('sw.aria.ccValOff')}
              >
                {kemperValueOptionElems(off, ch, num)}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
        </div>
      )}
      {!isFav && isPc && (
        <div className="bf-extras-row">
          <label className="bf-extras-cell">
            <span className="bf-field-label">PC ON</span>
            <div className="bf-select-wrap">
              <BfSelect
                className="bf-input bf-select"
                value={on}
                onChange={(e) => onChange({ [k('on')]: Number(e.target.value) })}
                aria-label={t('sw.aria.pcStateOn')}
              >
                <option value={-1}>OFF</option>
                {midiOptionElems(numOptions, 'pc', on, ch)}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
          <label className="bf-extras-cell">
            <span className="bf-field-label">PC OFF</span>
            <div className="bf-select-wrap">
              <BfSelect
                className="bf-input bf-select"
                value={off}
                onChange={(e) => onChange({ [k('off')]: Number(e.target.value) })}
                aria-label={t('sw.aria.pcStateOff')}
              >
                <option value={-1}>OFF</option>
                {midiOptionElems(numOptions, 'pc', off, ch)}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
        </div>
      )}
      {/* Card "Opções" — toggles iOS (DISPARA NO PRESET / COMEÇA ON) +
          tile FAVORITO (a estrela, exclusiva do STOMP: carrega banco/preset
          em vez de mandar CC) + tile do LED. Os toggles somem em modo
          FAVORITE (a secao deixa de mandar CC) e quando hideStart. noLed
          (switch externo) esconde o tile do LED. */}
      <div className="bf-sw-studio bf-sw-opt-card">
        <div className="bf-sw-studio-head">
          <span className="bf-sw-studio-title">{t('sw.opt.title')}</span>
          <span className="bf-sw-studio-eyebrow">{t('sw.opt.eyebrow')}</span>
        </div>
        <div className="bf-sw-opt-body has-fav">
          {!hideStart && !isFav && (
            <div className="bf-sw-opt-toggles">
              {!hideAtPreset && (
              <div className="bf-sw-opt-row">
                <div className="bf-sw-opt-text">
                  <span className="bf-sw-opt-name">{t('sw.opt.firesPreset')}</span>
                  <span className="bf-sw-opt-sub">{t('sw.opt.firesSub')}</span>
                </div>
                <BfToggle
                  on={atPreset}
                  onClick={() => onChange({ [k('at_preset')]: atPreset ? 0 : 1 })}
                  ariaLabel={t('sw.opt.firesAria')}
                  title={t('sw.opt.firesTitle')}
                />
              </div>
              )}
              <div className="bf-sw-opt-row">
                <div className="bf-sw-opt-text">
                  <span className="bf-sw-opt-name">{t('sw.opt.startOn')}</span>
                  <span className="bf-sw-opt-sub">{t('sw.opt.startSub')}</span>
                </div>
                <BfToggle
                  on={start === 1}
                  onClick={() => onChange({ [k('start')]: start === 1 ? 0 : 1 })}
                  ariaLabel={t('sw.opt.startAria')}
                  title={t('sw.opt.startTitle')}
                />
              </div>
            </div>
          )}
          <button
            type="button"
            className={'bf-sw-opt-fav' + (isFav ? ' is-active' : '')}
            onClick={() => onChange({ [k('fav')]: isFav ? 0 : 1 })}
            aria-pressed={isFav}
            title={isFav ? t('sw.opt.favOn') : t('sw.opt.favOff')}
          >
            <svg viewBox="0 0 24 24" className="bf-sw-opt-fav-ico" aria-hidden="true">
              <path d="M12 2.5 L14.7 9 L21.5 9.6 L16.3 14.2 L17.9 21 L12 17.3 L6.1 21 L7.7 14.2 L2.5 9.6 L9.3 9 Z" />
            </svg>
            <span className="bf-sw-opt-fav-label">{t('sw.favorite')}</span>
          </button>
          {/* noLed: switches externos (dual switch) nao tem anel — esconde o
              preview/seletor de cor de LED. */}
          {!noLed && (
            <div className="bf-sw-opt-led">
              <div className={'bf-sw-fx1-led' + (ledDimmed ? ' is-off' : '')}>
                <FootswitchArc
                  label="LED"
                  colorId={color}
                  onChange={(id) => onChange({ [k('color')]: id })}
                  litArcs={ledLitArcs}
                />
              </div>
              <button
                type="button"
                className={'bf-sw-opt-invled' + (invLed ? ' is-active' : '')}
                onClick={() => onChange({ [k('inv')]: invLed ? 0 : 1 })}
                aria-pressed={invLed}
                aria-label={t('sw.opt.invLedAria')}
                title={t('sw.opt.invLedTitle')}
              >{t('sw.opt.invLed')}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Editor de parametros do modo STOMP 2 (fx2). Duas secoes iguais a do
// STOMP 1: click curto (secao A, chaves sem sufixo) e click longo (secao
// B, chaves com sufixo 2). Pra nao alongar demais o card, mostra so uma
// secao por vez — um toggle segmentado CLICK CURTO / CLICK LONGO alterna
// qual secao esta visivel. Edicao local — persistencia no SAVE do rodape.
function SwFx2Editor({ sw, params, onChange, ledPreviewLive, liveOn, presetCount }) {
  const { t } = useBfI18n();
  const [activeSection, setActiveSection] = useState(0);
  // Mapeamento pixel -> arco do FootswitchArc:
  //   pixel 1 e 3 (firmware) = arcos superiores esquerdo (1) e direito (2)
  //   pixel 2 (firmware central) = arco inferior (0)
  const litArcsBySection = [[1, 2], [0]];
  // So a secao A recebe o estado live (vem de sw_live_on); B cai no `start`.
  const liveBySection = [liveOn, undefined];
  return (
    <div className="bf-sw-fx2">
      <div className="bf-seg bf-sw-fx2-tabs" role="tablist"
           aria-label={t('sw.aria.stompSection2')}>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 0}
          className={activeSection === 0 ? 'is-active' : ''}
          onClick={() => setActiveSection(0)}
        >{t('sw.clickShort')}</button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 1}
          className={activeSection === 1 ? 'is-active' : ''}
          onClick={() => setActiveSection(1)}
        >{t('sw.clickLong')}</button>
      </div>
      <SwStompSection
        key={activeSection}
        sw={sw} section={activeSection}
        litArcsOn={litArcsBySection[activeSection]}
        params={params} onChange={onChange}
        ledPreviewLive={ledPreviewLive}
        liveOn={liveBySection[activeSection]}
        presetCount={presetCount}
      />
    </div>
  );
}

// Editor unificado do modo STOMP (fx1). Tres tabs (CLICK CURTO / CLICK
// LONGO / RECLICK), cada um configurando uma secao independente. O
// comportamento de uso e o layout do LED adaptam conforme quantas secoes
// tem canal valido:
//   so A      -> STOMP classico (3 pixels, tap toggle + momentaneo).
//   A + B     -> DUAL STOMP (pixels externos = A, central = B).
//   A + B + C -> TRIAL STOMP (pixel 1 = A, pixel 2 = B, pixel 3 = C).
// Pixel -> arco no FootswitchArc: 0 = inferior, 1 = sup esq, 2 = sup dir.
// Tambem serve o legado fx3 (mesmas chaves).
function SwStompEditor({ sw, params, onChange, ledPreviewLive, liveOn, presetCount, hideStart, noLed, hideAtPreset }) {
  const { t } = useBfI18n();
  const [activeSection, setActiveSection] = useState(0);
  const chOK = (v) => {
    const n = Number(v);
    return n >= 1 && n <= 16;
  };
  // Secao "esta ativa" se tem canal valido OU se esta como FAVORITE
  // (FAVORITE ignora os campos de CC e despacha carregamento de preset).
  const hasB = chOK(params.ch2) || Number(params.fav2) === 1;
  const hasC = chOK(params.ch3) || Number(params.fav3) === 1;
  // Preview do LED adapta o mapeamento pixel -> arco conforme o tier.
  const litArcsBySection = hasC
    ? [[1], [0], [2]]            // tier 3: 1 arco por secao
    : hasB
      ? [[1, 2], [0], []]         // tier 2: A externos, B central
      : [[0, 1, 2], [], []];     // tier 1: A acende os 3 arcos
  // So a secao A recebe o estado live (vem de sw_live_on); B e C caem
  // no `start` configurado.
  const liveBySection = [liveOn, undefined, undefined];
  const labels = [t('sw.clickShort'), t('sw.clickLong'), t('sw.clickRe')];
  return (
    <div className="bf-sw-fx2">
      <div className="bf-seg bf-sw-fx2-tabs" role="tablist"
           aria-label={t('sw.aria.stompSection')}>
        {labels.map((label, idx) => (
          <button
            key={idx}
            type="button"
            role="tab"
            aria-selected={activeSection === idx}
            className={activeSection === idx ? 'is-active' : ''}
            onClick={() => setActiveSection(idx)}
          >{label}</button>
        ))}
      </div>
      <SwStompSection
        key={activeSection}
        sw={sw} section={activeSection}
        litArcsOn={litArcsBySection[activeSection]}
        params={params} onChange={onChange}
        ledPreviewLive={ledPreviewLive}
        liveOn={liveBySection[activeSection]}
        presetCount={presetCount}
        hideStart={hideStart}
        noLed={noLed}
        hideAtPreset={hideAtPreset}
      />
    </div>
  );
}

// MACROS — uma linha (slot) do editor. Mostra:
//   - Toggle CC / PC (decide quais campos aparecem).
//   - Canal (OFF/1..16).
//   - CC: CC# + valor ON + valor OFF (cada valor pode ser OFF/-1 = skip).
//   - PC: PC ON + PC OFF (cada pode ser OFF/-1 = skip).
// `slot` = { t, ch, num, on, off }. `onChange(patch)` recebe um patch
// parcial que e fundido pelo pai.
function SwMacrosSlot({ idx, slot, onChange }) {
  const { t } = useBfI18n();
  const isPc = slot.t === 1;
  const numOptions = Array.from({ length: 128 }, (_, n) => n);
  // Selects de valor incluem "OFF" (=-1) no topo. Em canal Kemper com CC
  // rotulado (Transpose/enums), os valores ganham figuras (ver kemper_values).
  const valueOptionElems = (current) => (
    <>
      <option value={-1}>OFF</option>
      {kemperValueOptionElems(current, slot.ch, slot.num)}
    </>
  );
  // PC ON/OFF: OFF(-1) no topo + valores de PC com o nome do pedal ativo.
  // `current` garante que o valor salvo nunca seja ocultado no modo omitir.
  const pcValueOptionElems = (current) => (
    <>
      <option value={-1}>OFF</option>
      {midiOptionElems(numOptions, 'pc', current, slot.ch)}
    </>
  );
  return (
    <div className="bf-macros-slot">
      <div className="bf-slot-title">Slot {idx + 1}</div>
      <div className="bf-macros-slot-head">
        <button
          type="button"
          className={'bf-input bf-input-num bf-macros-slot-type' +
                     (isPc ? ' is-pc' : ' is-cc')}
          onClick={() => onChange({ t: isPc ? 0 : 1 })}
          aria-pressed={isPc}
          aria-label={isPc ? t('sw.slot.aria.isPc') : t('sw.slot.aria.isCc')}
          title={isPc ? t('sw.slot.title.isPc') : t('sw.slot.title.isCc')}
        >{isPc ? t('sw.sendPc') : t('sw.sendCc')}</button>
        <div className="bf-select-wrap bf-macros-slot-ch">
          <BfSelect
            className={'bf-input bf-select' + (slot.ch === 0 ? ' is-mute' : '')}
            value={slot.ch}
            onChange={(e) => onChange({ ch: Number(e.target.value) })}
            aria-label={t('sw.aria.chSlot')}
          >
            {channelOptionElems('CH OFF', 'CH ')}
          </BfSelect>
          <span className="bf-select-chev">▾</span>
        </div>
      </div>
      {!isPc ? (
        <div className={'bf-extras-row bf-macros-slot-fields' + (isPc ? ' is-pc' : '')}>
          <label className="bf-extras-cell">
            <span className="bf-field-label">CC</span>
            <div className="bf-select-wrap">
              <BfSelect
                className="bf-input bf-select"
                value={slot.num}
                onChange={(e) => {
                  const nv = clamp(Number(e.target.value), 0, CC_NUM_MAX);
                  onChange({ num: nv,
                             on: kemperSnapValue(slot.on, slot.ch, nv),
                             off: kemperSnapValue(slot.off, slot.ch, nv) });
                }}
                aria-label={t('sw.aria.ccNum')}
              >
                {midiOptionElems(numOptions, 'cc', slot.num, slot.ch)}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
          <label className="bf-extras-cell">
            <span className="bf-field-label">ON</span>
            <div className="bf-select-wrap">
              <BfSelect
                className="bf-input bf-select"
                value={slot.on}
                onChange={(e) => onChange({ on: Number(e.target.value) })}
                aria-label={t('sw.aria.ccStateOn')}
              >{valueOptionElems(slot.on)}</BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
          <label className="bf-extras-cell">
            <span className="bf-field-label">OFF</span>
            <div className="bf-select-wrap">
              <BfSelect
                className="bf-input bf-select"
                value={slot.off}
                onChange={(e) => onChange({ off: Number(e.target.value) })}
                aria-label={t('sw.aria.ccStateOff')}
              >{valueOptionElems(slot.off)}</BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
        </div>
      ) : (
        <div className={'bf-extras-row bf-macros-slot-fields' + (isPc ? ' is-pc' : '')}>
          <label className="bf-extras-cell">
            <span className="bf-field-label">PC ON</span>
            <div className="bf-select-wrap">
              <BfSelect
                className="bf-input bf-select"
                value={slot.on}
                onChange={(e) => onChange({ on: Number(e.target.value) })}
                aria-label={t('sw.aria.pcStateOn')}
              >{pcValueOptionElems(slot.on)}</BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
          <label className="bf-extras-cell">
            <span className="bf-field-label">PC OFF</span>
            <div className="bf-select-wrap">
              <BfSelect
                className="bf-input bf-select"
                value={slot.off}
                onChange={(e) => onChange({ off: Number(e.target.value) })}
                aria-label={t('sw.aria.pcStateOff')}
              >{pcValueOptionElems(slot.off)}</BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}

// MACROS — secao unica. 4 slots + botao START (dispara com preset) +
// LED color + botao FIRE de teste. Mantida parametrizada (section/suf)
// como vestigio do design antigo de 3 secoes; hoje so usa section=0.
const MACROS_MAX_SLOTS = 4;
function SwMacrosSection({ sw, section, label, litArcsOn,
                          params, onChange, ledPreviewLive, liveOn, hideStart, hideAtPreset, noLed }) {
  const { t } = useBfI18n();
  const suf = section === 0 ? '' : section === 1 ? '2' : '3';
  const k = (base) => base + suf;
  const slots = parseMslots(params[k('mslots')]);
  const atPreset = params[k('at_preset')] === 1;
  const startOn = params[k('start')] === 1;
  const colorVal = params[k('color')];
  // INVERTER LED: inverte o indicador visual (LED + tile) — acende no OFF
  // logico. So visual; o MIDI enviado nao muda.
  const invLed = Number(params[k('inv')]) === 1;

  // Quantos slots ja tem dado (canal valido) — pelo menos 1 sempre visivel.
  const configuredCount = slots.filter((s) => s.ch >= 1 && s.ch <= 16).length;
  const minVisible = Math.max(1, configuredCount);
  const [visibleCount, setVisibleCount] = useState(
    Math.min(MACROS_MAX_SLOTS, minVisible));
  useEffect(() => {
    setVisibleCount((v) => Math.min(MACROS_MAX_SLOTS, Math.max(v, minVisible)));
  }, [minVisible]);

  const updateSlot = (idx, patch) => {
    const next = slots.map((s, i) => i === idx ? { ...s, ...patch } : s);
    onChange({ [k('mslots')]: serializeMslots(next) });
  };

  // testOn: estado simulado do toggle da secao. Reinicia conforme `start`
  // (estado inicial logico — independente do at_preset) ou conforme o
  // liveOn vindo do firmware (so a secao A o recebe).
  const [testOn, setTestOn] = useState(
    typeof liveOn === 'boolean' ? liveOn : startOn);
  useEffect(() => {
    setTestOn(typeof liveOn === 'boolean' ? liveOn : startOn);
  }, [sw, section, liveOn, startOn]);

  // FIRE — alterna o estado simulado e dispara cada slot da secao.
  const fireSection = async () => {
    const next = !testOn;
    setTestOn(next);
    for (const slot of slots) {
      if (slot.ch < 1 || slot.ch > 16) continue;
      const val = next ? slot.on : slot.off;
      if (val < 0) continue;  // OFF/skip
      const body = new URLSearchParams();
      body.set('ch', String(slot.ch));
      body.set('as_pc', slot.t === 1 ? '1' : '0');
      if (slot.t === 1) {
        body.set('pc', String(val));
      } else {
        body.set('cc', String(slot.num));
        body.set('value', String(val));
      }
      try { await apiCall('POST', '/midi/cc', body); } catch {/* preview */}
    }
  };

  // MACROS reflete startOn salvo — START ON => LED aceso na chamada do
  // preset. testOn (legado) mantem para callers que ainda passem.
  const logicalOn = testOn || startOn;
  // INVERTER LED: o preview do arco reflete o estado invertido (acende no OFF).
  const isOn = invLed ? !logicalOn : logicalOn;
  const ledLitArcs = isOn ? (litArcsOn || []) : [];
  const ledDimmed = false;

  return (
    <div className="bf-sw-fx1 bf-sw-macros">
      {label && <div className="bf-section-label">{label}</div>}
      {slots.slice(0, visibleCount).map((s, i) => (
        <SwMacrosSlot key={i} idx={i} slot={s}
          onChange={(patch) => updateSlot(i, patch)} />
      ))}
      {(visibleCount > 1 || visibleCount < MACROS_MAX_SLOTS) && (
        <div className="bf-tap-slot-actions">
          {visibleCount > 1 && (
            <button
              type="button"
              className="bf-tap-action bf-tap-action-remove"
              onClick={() => {
                const last = visibleCount - 1;
                const cur = slots[last];
                if (cur && (cur.ch !== 0 || cur.num !== 0 ||
                            cur.on !== 127 || cur.off !== 0 || cur.t !== 0)) {
                  updateSlot(last, emptyMslot());
                }
                setVisibleCount(visibleCount - 1);
              }}
              aria-label={t('sw.aria.removeLastSlot')}
              title={t('sw.aria.removeLastSlot')}
            >{t('sw.removeSlot')}</button>
          )}
          {visibleCount < MACROS_MAX_SLOTS && (
            <button
              type="button"
              className="bf-tap-action bf-tap-action-add"
              onClick={() => setVisibleCount(visibleCount + 1)}
              aria-label={t('sw.aria.addSlot')}
              title={t('sw.aria.addSlot')}
            >{t('sw.addSlot')}</button>
          )}
        </div>
      )}
      {/* Card "Opções" — toggles DISPARA NO PRESET / COMEÇA ON + tile do
          LED. Mesmo card do STOMP, sem a estrela FAVORITO. */}
      <div className="bf-sw-studio bf-sw-opt-card">
        <div className="bf-sw-studio-head">
          <span className="bf-sw-studio-title">{t('sw.opt.title')}</span>
          <span className="bf-sw-studio-eyebrow">{t('sw.opt.eyebrow')}</span>
        </div>
        <div className="bf-sw-opt-body">
          {!hideStart && (
            <div className="bf-sw-opt-toggles">
              {!hideAtPreset && (
              <div className="bf-sw-opt-row">
                <div className="bf-sw-opt-text">
                  <span className="bf-sw-opt-name">{t('sw.opt.firesPreset')}</span>
                  <span className="bf-sw-opt-sub">{t('sw.opt.firesSub')}</span>
                </div>
                <BfToggle
                  on={atPreset}
                  onClick={() => onChange({ [k('at_preset')]: atPreset ? 0 : 1 })}
                  ariaLabel={t('sw.opt.firesAria')}
                  title={t('sw.opt.firesTitle')}
                />
              </div>
              )}
              <div className="bf-sw-opt-row">
                <div className="bf-sw-opt-text">
                  <span className="bf-sw-opt-name">{t('sw.opt.startOn')}</span>
                  <span className="bf-sw-opt-sub">{t('sw.opt.startSub')}</span>
                </div>
                <BfToggle
                  on={startOn}
                  onClick={() => onChange({ [k('start')]: startOn ? 0 : 1 })}
                  ariaLabel={t('sw.opt.startAria')}
                  title={t('sw.opt.startTitle')}
                />
              </div>
            </div>
          )}
          {/* noLed: switches externos (dual switch) nao tem anel — esconde o
              preview/seletor de cor de LED. */}
          {!noLed && (
            <div className="bf-sw-opt-led">
              <div className={'bf-sw-fx1-led' + (ledDimmed ? ' is-off' : '')}>
                <FootswitchArc
                  label="LED"
                  colorId={colorVal}
                  onChange={(id) => onChange({ [k('color')]: id })}
                  litArcs={ledLitArcs}
                />
              </div>
              <button
                type="button"
                className={'bf-sw-opt-invled' + (invLed ? ' is-active' : '')}
                onClick={() => onChange({ [k('inv')]: invLed ? 0 : 1 })}
                aria-pressed={invLed}
                aria-label={t('sw.opt.invLedAria')}
                title={t('sw.opt.invLedTitle')}
              >{t('sw.opt.invLed')}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// MACROS — uma unica secao com 4 slots (CC ou PC) + START + LED. Sem
// tabs (foram removidos junto com os modos LONGO e RECLICK).
function SwMacrosEditor({ sw, params, onChange, ledPreviewLive, liveOn, hideStart, hideAtPreset, noLed }) {
  return (
    <SwMacrosSection
      sw={sw} section={0}
      litArcsOn={[0, 1, 2]}
      params={params} onChange={onChange}
      ledPreviewLive={ledPreviewLive}
      liveOn={liveOn}
      hideStart={hideStart}
      hideAtPreset={hideAtPreset}
      noLed={noLed}
    />
  );
}

// Editor do modo MOMENTARY — mesma estrutura de uma secao do STOMP
// (reusa SwStompSection com prefix '' / section=0). Sem tabs, sem
// estado live (cada press manda um pulse ON+OFF; o firmware nao
// mantem liveOn pra momentary). O MIDI TEST aqui ainda alterna em
// dois cliques (heranca do SwStompSection) — pra um pulse de teste
// rapido, basta clicar duas vezes seguido.
// MOMENTARY — um slot do editor. Cada slot pulsa CC com par ON/OFF.
function SwMomentarySlot({ idx, slot, onChange }) {
  const { t } = useBfI18n();
  const numOptions = Array.from({ length: 128 }, (_, n) => n);
  return (
    <div className="bf-macros-slot bf-tap-slot bf-mom-slot">
      <div className="bf-slot-title">Slot {idx + 1}</div>
      {/* Linha 1: CC + Canal */}
      <div className="bf-extras-row bf-tap-slot-row bf-mom-slot-row">
        <label className="bf-extras-cell">
          <span className="bf-field-label">CC</span>
          <div className="bf-select-wrap">
            <BfSelect
              className="bf-input bf-select"
              value={slot.num}
              onChange={(e) => {
                const nv = clamp(Number(e.target.value), 0, CC_NUM_MAX);
                onChange({ num: nv,
                           on: kemperSnapValue(slot.on, slot.ch, nv),
                           off: kemperSnapValue(slot.off, slot.ch, nv) });
              }}
              aria-label={t('sw.aria.ccNum')}
            >
              {midiOptionElems(numOptions, 'cc', slot.num, slot.ch)}
            </BfSelect>
            <span className="bf-select-chev">▾</span>
          </div>
        </label>
        <label className="bf-extras-cell">
          <span className="bf-field-label">{t('sw.channel')}</span>
          <div className="bf-select-wrap">
            <BfSelect
              className={'bf-input bf-select' + (slot.ch === 0 ? ' is-mute' : '')}
              value={slot.ch}
              onChange={(e) => onChange({ ch: Number(e.target.value) })}
              aria-label={t('sw.aria.chSlot')}
            >
              {channelOptionElems()}
            </BfSelect>
            <span className="bf-select-chev">▾</span>
          </div>
        </label>
      </div>
      {/* Linha 2: valores ON + OFF */}
      <div className="bf-extras-row bf-tap-slot-row bf-mom-slot-row2">
        <label className="bf-extras-cell">
          <span className="bf-field-label">ON</span>
          <div className="bf-select-wrap">
            <BfSelect
              className="bf-input bf-select"
              value={slot.on}
              onChange={(e) => onChange({ on: clamp(Number(e.target.value), 0, 127) })}
              aria-label={t('sw.aria.pulseValOn')}
            >
              {kemperValueOptionElems(slot.on, slot.ch, slot.num)}
            </BfSelect>
            <span className="bf-select-chev">▾</span>
          </div>
        </label>
        <label className="bf-extras-cell">
          <span className="bf-field-label">OFF</span>
          <div className="bf-select-wrap">
            <BfSelect
              className="bf-input bf-select"
              value={slot.off}
              onChange={(e) => onChange({ off: clamp(Number(e.target.value), 0, 127) })}
              aria-label={t('sw.aria.pulseValOff')}
            >
              {kemperValueOptionElems(slot.off, slot.ch, slot.num)}
            </BfSelect>
            <span className="bf-select-chev">▾</span>
          </div>
        </label>
      </div>
    </div>
  );
}

// MOMENTARY — editor com ate 4 slots em `mom_slots`. Cada press do SW
// dispara TODOS os slots como pulse (ON, delay, OFF). Sem estado
// persistente. Migracao automatica: dados legados (campos `ch`/`num`/
// `on`/`off` soltos) sao mostrados como slot 1 ate o user salvar.
function SwMomentaryEditor({ sw, params, onChange, ledPreviewLive }) {
  const { t } = useBfI18n();
  const slotsFromMom = parseMomSlots(params.mom_slots || '');
  const momHasAny = slotsFromMom.some((s) => s.ch >= 1 && s.ch <= 16);
  const slots = slotsFromMom.slice();
  // Fallback legado: se mom_slots vazio e ha ch/num soltos, vira slot 1.
  if (!momHasAny && Number(params.ch) >= 1 && Number(params.ch) <= 16) {
    slots[0] = {
      ch: Number(params.ch),
      num: Number(params.num) || 0,
      on: Number(params.custom) === 1 ? (Number(params.on) || 127) : 127,
      off: Number(params.custom) === 1 ? (Number(params.off) || 0) : 0,
    };
  }
  const configuredCount = slots.filter((s) => s.ch >= 1 && s.ch <= 16).length;
  const minVisible = Math.max(1, configuredCount);
  const [visibleCount, setVisibleCount] = useState(
    Math.min(MOM_MAX_SLOTS, minVisible));
  useEffect(() => {
    setVisibleCount((v) => Math.min(MOM_MAX_SLOTS, Math.max(v, minVisible)));
  }, [minVisible]);

  const updateSlot = (idx, patch) => {
    const next = slots.map((s, i) => i === idx ? { ...s, ...patch } : s);
    onChange({ mom_slots: serializeMomSlots(next) });
  };

  const [testFired, setTestFired] = useState(false);
  const firePulse = async () => {
    setTestFired(true);
    setTimeout(() => setTestFired(false), 200);
    for (const s of slots) {
      if (s.ch < 1 || s.ch > 16) continue;
      const onBody = new URLSearchParams();
      onBody.set('ch', String(s.ch));
      onBody.set('as_pc', '0');
      onBody.set('cc', String(s.num));
      onBody.set('value', String(s.on));
      try { await apiCall('POST', '/midi/cc', onBody); } catch {/* preview */}
      const offBody = new URLSearchParams();
      offBody.set('ch', String(s.ch));
      offBody.set('as_pc', '0');
      offBody.set('cc', String(s.num));
      offBody.set('value', String(s.off));
      try { await apiCall('POST', '/midi/cc', offBody); } catch {/* preview */}
    }
  };

  return (
    <div className="bf-sw-fx1 bf-sw-macros bf-sw-single bf-sw-tap">
      {slots.slice(0, visibleCount).map((s, i) => (
        <SwMomentarySlot key={i} idx={i} slot={s}
          onChange={(patch) => updateSlot(i, patch)} />
      ))}
      <div className="bf-extras-row bf-sw-fx1-test">
        <button
          type="button"
          className={'bf-input bf-input-num' + (testFired ? ' is-active' : '')}
          onClick={firePulse}
          aria-label={t('sw.aria.pulseTitle')}
        >
          {t('sw.pulse')}
        </button>
        <div className="bf-sw-fx1-led">
          <FootswitchArc
            label="LED"
            colorId={params.color}
            onChange={(id) => onChange({ color: id })}
            litArcs={testFired ? [0, 1, 2] : []}
          />
        </div>
      </div>
      {(visibleCount > 1 || visibleCount < MOM_MAX_SLOTS) && (
        <div className="bf-tap-slot-actions">
          {visibleCount > 1 && (
            <button
              type="button"
              className="bf-tap-action bf-tap-action-remove"
              onClick={() => {
                const last = visibleCount - 1;
                const cur = slots[last];
                if (cur && (cur.ch !== 0 || cur.num !== 0 ||
                            cur.on !== 127 || cur.off !== 0)) {
                  updateSlot(last, emptyMomSlot());
                }
                setVisibleCount(visibleCount - 1);
              }}
              aria-label={t('sw.aria.removeLastSlot')}
              title={t('sw.aria.removeLastSlot')}
            >{t('sw.removeSlot')}</button>
          )}
          {visibleCount < MOM_MAX_SLOTS && (
            <button
              type="button"
              className="bf-tap-action bf-tap-action-add"
              onClick={() => setVisibleCount(visibleCount + 1)}
              aria-label={t('sw.aria.addSlot')}
              title={t('sw.aria.addSlot')}
            >{t('sw.addSlot')}</button>
          )}
        </div>
      )}
    </div>
  );
}

// TAP TEMPO — um slot: canal + CC# + mode. mode 1 = so CC+127 (classico);
// mode 2 = CC+127 seguido de CC+0 (pulse).
function SwTapTempoSlot({ idx, slot, onChange }) {
  const { t } = useBfI18n();
  const numOptions = Array.from({ length: 128 }, (_, n) => n);
  const mode = slot.mode === 2 ? 2 : 1;
  return (
    <div className="bf-macros-slot bf-tap-slot">
      <div className="bf-slot-title">Slot {idx + 1}</div>
      {/* Linha 1: CC + Canal */}
      <div className="bf-extras-row bf-tap-slot-row bf-tap-cc-row">
        <label className="bf-extras-cell">
          <span className="bf-field-label">CC</span>
          <div className="bf-select-wrap">
            <BfSelect
              className="bf-input bf-select"
              value={slot.num}
              onChange={(e) => onChange({ num: clamp(Number(e.target.value), 0, CC_NUM_MAX) })}
              aria-label={t('sw.aria.ccNum')}
            >
              {midiOptionElems(numOptions, 'cc', slot.num, slot.ch)}
            </BfSelect>
            <span className="bf-select-chev">▾</span>
          </div>
        </label>
        <label className="bf-extras-cell">
          <span className="bf-field-label">{t('sw.channel')}</span>
          <div className="bf-select-wrap">
            <BfSelect
              className={'bf-input bf-select' + (slot.ch === 0 ? ' is-mute' : '')}
              value={slot.ch}
              onChange={(e) => onChange({ ch: Number(e.target.value) })}
              aria-label={t('sw.aria.chSlot')}
            >
              {channelOptionElems()}
            </BfSelect>
            <span className="bf-select-chev">▾</span>
          </div>
        </label>
      </div>
      {/* Linha 2: modo do disparo (CC+127 vs CC+127 → CC+0) */}
      <div className="bf-extras-row bf-tap-slot-row bf-tap-mode-row">
        <button
          type="button"
          className={'bf-tap-mode-btn is-mode-' + mode}
          onClick={() => onChange({ mode: mode === 1 ? 2 : 1 })}
          aria-label={t('sw.tap.aria.slotMode', {
            desc: mode === 1 ? t('sw.tap.desc.mode1') : t('sw.tap.desc.mode2') })}
          title={mode === 1 ? t('sw.tap.title.mode1') : t('sw.tap.title.mode2')}
        >MODE {mode}</button>
      </div>
    </div>
  );
}

// ─── SPIN ─────────────────────────────────────────────────────────
// Barra horizontal estilo meter — gradient laranja no preenchimento,
// fundo escuro com marcas de tick, porcentagem no centro. Largura
// segue o pai (mesma proporcao do campo de valor).
// Editor do modo SPIN. Um CC com 3 valores fixos; cada press cicla
// estado 1 -> 2 -> 3 -> 1, com o pixel correspondente aceso. Quando
// at_preset=ON, o preset call entra em estado 1 (val1 disparado).
// Quando at_preset=OFF, fica em "awaiting" (pixel 1 piscando) ate o
// primeiro press, que entao firma val1.
function SwSpinEditor({ sw, params, onChange, ledPreviewLive, hideStart, hideAtPreset, noLed }) {
  const { t } = useBfI18n();
  const p = { ...DEFAULT_SW_PARAMS('spin'), ...(params || {}) };
  const numOptions = Array.from({ length: 128 }, (_, n) => n);

  // Carrega os 3 slots; se spin_slots vazio mas ha campos legados (ch/
  // num/val1/val2/val3 soltos), vira slot 1 pro user reaproveitar.
  const parsedSlots = parseSpinSlots(p.spin_slots || '');
  const slotsHasAny = parsedSlots.some((s) => s.ch >= 1 && s.ch <= 16);
  const slots = parsedSlots.slice();
  if (!slotsHasAny && Number(p.ch) >= 1 && Number(p.ch) <= 16) {
    slots[0] = {
      ch: Number(p.ch),
      num: Number(p.num) || 0,
      v1: Number(p.val1) || 0,
      v2: typeof p.val2 !== 'undefined' ? Number(p.val2) : 64,
      v3: typeof p.val3 !== 'undefined' ? Number(p.val3) : 127,
    };
  }

  const [activeSlot, setActiveSlot] = useState(0);
  const updateSlot = (idx, patch) => {
    const next = slots.map((s, i) => i === idx ? { ...s, ...patch } : s);
    onChange({ spin_slots: serializeSpinSlots(next) });
  };
  const slot = slots[activeSlot] || emptySpinSlot();

  // LONG PRESS — slot fixo (toggle ON/OFF ao segurar ~300ms), independente do
  // ciclo de 3 estados. Mesmas chaves lp_* do TAP TEMPO.
  const lpCh = Number(p.lp_ch) || 0;
  const lpNum = clamp(Number(p.lp_num) || 0, 0, 127);
  const lpOn = clamp(typeof p.lp_on !== 'undefined' ? Number(p.lp_on) : 127, 0, 127);
  const lpOff = clamp(Number(p.lp_off) || 0, 0, 127);
  // NÃO usar `|| 1`: a cor 0 (VERMELHO) é válida e `0 || 1` viraria 1 (bug —
  // não dava pra selecionar o vermelho). Guard explícito contra NaN.
  const lpColorId = Number.isFinite(Number(p.lp_color)) ? Number(p.lp_color) : 1;

  const [testStage, setTestStage] = useState(0);
  const fireTest = async () => {
    const next = (testStage + 1) % 3;
    setTestStage(next);
    const vKey = next === 0 ? 'v1' : next === 1 ? 'v2' : 'v3';
    // Dispara TODOS os slots simultaneamente (com canal valido).
    for (const s of slots) {
      if (s.ch < 1 || s.ch > 16) continue;
      const body = new URLSearchParams();
      body.set('ch', String(s.ch));
      body.set('as_pc', '0');
      body.set('cc', String(s.num));
      body.set('value', String(s[vKey] || 0));
      try { await apiCall('POST', '/midi/cc', body); } catch {/* preview */}
    }
  };
  const stateToArc = [1, 0, 2];
  const litArcs = [stateToArc[testStage] ?? 1];

  // Marca tabs com bullet quando o slot tem canal valido.
  const slotConfigured = (idx) =>
    slots[idx] && slots[idx].ch >= 1 && slots[idx].ch <= 16;

  return (
    <div className="bf-sw-fx1 bf-sw-spin">
      {/* Tabs SLOT 1 / SLOT 2 / SLOT 3 — disparados SIMULTANEAMENTE
          em cada press. Bullet "•" indica slot com canal configurado. */}
      <div className="bf-seg bf-sw-fx2-tabs bf-spin-tabs" role="tablist"
           aria-label={t('sw.aria.spinSlot')}>
        {[0, 1, 2].map((idx) => (
          <button key={idx}
            type="button"
            role="tab"
            aria-selected={activeSlot === idx}
            className={activeSlot === idx ? 'is-active' : ''}
            onClick={() => setActiveSlot(idx)}
          >SLOT {idx + 1}{slotConfigured(idx) ? ' •' : ''}</button>
        ))}
      </div>

      {/* Card: Mensagem MIDI (CC + Canal do slot ativo) */}
      <div className="bf-sw-studio">
        <div className="bf-sw-studio-head">
          <span className="bf-sw-studio-title">{t('sw.studio.midiMsg')}</span>
          <span className="bf-sw-studio-eyebrow">CC · {t('sw.channel')}</span>
        </div>
        <div className="bf-extras-row">
          <label className="bf-extras-cell">
            <span className="bf-field-label">CC</span>
            <div className="bf-select-wrap">
              <BfSelect className="bf-input bf-select" value={slot.num}
                      onChange={(e) => {
                        const nv = clamp(Number(e.target.value), 0, CC_NUM_MAX);
                        updateSlot(activeSlot, { num: nv,
                          v1: kemperSnapValue(slot.v1, slot.ch, nv),
                          v2: kemperSnapValue(slot.v2, slot.ch, nv),
                          v3: kemperSnapValue(slot.v3, slot.ch, nv) });
                      }}
                      aria-label={t('sw.aria.slotCcNum')}>
                {midiOptionElems(numOptions, 'cc', slot.num, slot.ch)}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
          <label className="bf-extras-cell">
            <span className="bf-field-label">{t('sw.channel')}</span>
            <div className="bf-select-wrap">
              <BfSelect className={'bf-input bf-select' + (slot.ch === 0 ? ' is-mute' : '')}
                      value={slot.ch}
                      onChange={(e) => updateSlot(activeSlot, { ch: Number(e.target.value) })}
                      aria-label={t('sw.aria.chSlot')}>
                {channelOptionElems()}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
        </div>
      </div>

      {/* Card: Ciclo de 3 estados (VAL 1/2/3 do slot ativo). Clicar no
          rotulo PX previsualiza aquele estado (so o LED + highlight da
          linha; nao dispara MIDI nem grava nada). */}
      <div className="bf-sw-studio">
        <div className="bf-sw-studio-head">
          <span className="bf-sw-studio-title">{t('sw.spin.cycle3')}</span>
          <span className="bf-sw-studio-eyebrow">PX 1 → 2 → 3</span>
        </div>
        {[1, 2, 3].map((idx) => {
          const key = 'v' + idx;
          const value = Number(slot[key]) || 0;
          // Range válido do fader: 0..127 normal, ou [min,max] do CC rotulado
          // (Kemper Transpose 28..100, ou enum de pedal), pra não passar valor inválido.
          const vdef = valueLabelsFor(slot.ch, slot.num);
          const vmin = vdef ? vdef.min : 0;
          const vmax = vdef ? vdef.max : 127;
          const pct = Math.round(((value - vmin) / (vmax - vmin || 1)) * 100);
          const isActive = testStage === (idx - 1);
          return (
            <div className={'bf-spin-cyc-row' + (isActive ? ' is-active' : '')} key={idx}>
              <button type="button" className="bf-spin-cyc-px"
                      onClick={() => setTestStage(idx - 1)}
                      aria-pressed={isActive}
                      aria-label={t('sw.spin.aria.previewPixel', { n: idx })}>
                <span className="bf-spin-cyc-dot" aria-hidden="true" />PX {idx}
              </button>
              <div className="bf-select-wrap bf-spin-cyc-sel">
                <BfSelect className="bf-input bf-select" value={value}
                        onChange={(e) => updateSlot(activeSlot, { [key]: clamp(Number(e.target.value), vmin, vmax) })}
                        aria-label={t('sw.spin.aria.valForState', { n: idx })}>
                  {kemperValueOptionElems(value, slot.ch, slot.num)}
                </BfSelect>
                <span className="bf-select-chev">▾</span>
              </div>
              <input
                type="range"
                className="bf-spin-slider bf-spin-cyc-slider"
                min={vmin} max={vmax} step={1}
                value={value}
                style={{ '--pct': pct + '%' }}
                onChange={(e) => updateSlot(activeSlot, { [key]: clamp(Number(e.target.value), vmin, vmax) })}
                aria-label={t('sw.spin.aria.faderVal', { n: idx })}
              />
              <span className="bf-spin-cyc-pct">{pct}%</span>
            </div>
          );
        })}

        {/* AT_PRESET */}
        {!hideStart && !hideAtPreset && (
          <button
            type="button"
            className={'bf-input bf-input-num bf-spin-atpreset' +
                       (Number(p.at_preset) === 1 ? ' is-active' : '')}
            onClick={() => onChange({ at_preset: Number(p.at_preset) === 1 ? 0 : 1 })}
            aria-pressed={Number(p.at_preset) === 1}
            title={Number(p.at_preset) === 1
              ? t('sw.spin.title.atPresetOn')
              : t('sw.spin.title.atPresetOff')}
          >
            {Number(p.at_preset) === 1 ? t('sw.startOnPreset') : t('sw.waitingLive')}
          </button>
        )}
      </div>

      {/* Card: LED (cor do pixel ativo). noLed (dual switch externo): sem anel. */}
      {!noLed && (
      <div className="bf-sw-studio bf-spin-card-led">
        <div className="bf-sw-studio-head">
          <span className="bf-sw-studio-title">LED</span>
          <span className="bf-sw-studio-eyebrow">{t('sw.spin.activePixelColor')}</span>
        </div>
        <div className="bf-spin-led-body">
          <div className="bf-sw-fx1-led">
            <FootswitchArc
              label={t('sw.spin.arcActive')}
              colorId={Number(p.color)}
              onChange={(id) => onChange({ color: id })}
              litArcs={litArcs}
            />
          </div>
          <p className="bf-spin-led-desc">{t('sw.spin.cycleDesc')}</p>
        </div>
      </div>
      )}

      {/* Card: Long Press — dispara um CC (toggle ON/OFF) ao SEGURAR o SW
          (~300ms), independente do ciclo de 3 estados. Mesmas chaves lp_* do
          TAP TEMPO (o firmware reusa swLiveFireTapLongPress). */}
      <div className="bf-sw-studio">
        <div className="bf-sw-studio-head">
          <span className="bf-sw-studio-title">{t('sw.longPress')}</span>
          <span className="bf-sw-studio-eyebrow">CC · {t('sw.channel')}</span>
        </div>
        <div className="bf-extras-row">
          <label className="bf-extras-cell">
            <span className="bf-field-label">CC</span>
            <div className="bf-select-wrap">
              <BfSelect className="bf-input bf-select" value={lpNum}
                      onChange={(e) => onChange({ lp_num: clamp(Number(e.target.value), 0, 127) })}
                      aria-label={t('sw.aria.longPressCc')}>
                {/* allowSpecial=false: o firmware do long-press so manda CC
                    0..127 (swLiveFireTapLongPress) — oferecer »/◆ aqui fazia
                    o clamp salvar 127 silenciosamente. */}
                {midiOptionElems(numOptions, 'cc', lpNum, lpCh, false)}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
          <label className="bf-extras-cell">
            <span className="bf-field-label">{t('sw.channel')}</span>
            <div className="bf-select-wrap">
              <BfSelect className={'bf-input bf-select' + (lpCh === 0 ? ' is-mute' : '')}
                      value={lpCh}
                      onChange={(e) => onChange({ lp_ch: Number(e.target.value) })}
                      aria-label={t('sw.aria.longPressCh')}>
                {channelOptionElems()}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
        </div>
        <div className="bf-extras-row">
          <label className="bf-extras-cell">
            <span className="bf-field-label">ON</span>
            <div className="bf-select-wrap">
              <BfSelect className="bf-input bf-select" value={lpOn}
                      onChange={(e) => onChange({ lp_on: clamp(Number(e.target.value), 0, 127) })}
                      aria-label={t('sw.aria.holdValOn')}>
                {kemperValueOptionElems(lpOn, lpCh, lpNum)}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
          <label className="bf-extras-cell">
            <span className="bf-field-label">OFF</span>
            <div className="bf-select-wrap">
              <BfSelect className="bf-input bf-select" value={lpOff}
                      onChange={(e) => onChange({ lp_off: clamp(Number(e.target.value), 0, 127) })}
                      aria-label={t('sw.aria.releaseValOff')}>
                {kemperValueOptionElems(lpOff, lpCh, lpNum)}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
        </div>

        {/* START ON / dispara-no-preset do LONG PRESS (igual ao TAP TEMPO).
            Some no SW GLOBAL (hideStart), que vive fora dos presets. */}
        {!hideStart && (
          <div className="bf-sw-opt-toggles" style={{ marginTop: 4 }}>
            {!hideAtPreset && (
              <div className="bf-sw-opt-row">
                <div className="bf-sw-opt-text">
                  <span className="bf-sw-opt-name">{t('sw.opt.firesPreset')}</span>
                  <span className="bf-sw-opt-sub">{t('sw.opt.firesSub')}</span>
                </div>
                <BfToggle
                  on={Number(p.lp_at_preset) === 1}
                  onClick={() => onChange({ lp_at_preset: Number(p.lp_at_preset) === 1 ? 0 : 1 })}
                  ariaLabel={t('sw.opt.firesAria')}
                  title={t('sw.opt.firesTitle')}
                />
              </div>
            )}
            <div className="bf-sw-opt-row">
              <div className="bf-sw-opt-text">
                <span className="bf-sw-opt-name">{t('sw.opt.startOn')}</span>
                <span className="bf-sw-opt-sub">{t('sw.opt.startSub')}</span>
              </div>
              <BfToggle
                on={Number(p.lp_start) === 1}
                onClick={() => onChange({ lp_start: Number(p.lp_start) === 1 ? 0 : 1 })}
                ariaLabel={t('sw.opt.startAria')}
                title={t('sw.opt.startTitle')}
              />
            </div>
          </div>
        )}

        {/* LED do LONG PRESS: os 2 pixels que o SPIN NÃO está usando acendem
            nesta cor quando o long-press está ON. noLed (dual switch): sem anel. */}
        {!noLed && (
        <div className="bf-spin-led-body" style={{ marginTop: 12 }}>
          <div className="bf-sw-fx1-led">
            <FootswitchArc
              label={t('sw.longPress')}
              colorId={lpColorId}
              onChange={(id) => onChange({ lp_color: id })}
              litArcs={[0, 1, 2].filter((a) => a !== (stateToArc[testStage] ?? 1))}
            />
          </div>
          <p className="bf-spin-led-desc">{t('sw.spin.lpLedDesc')}</p>
        </div>
        )}
      </div>
    </div>
  );
}

// ─── RAMP ─────────────────────────────────────────────────────────
// Editor do modo RAMPA. Sweep gradual de CC entre min/max com curva e
// tempo configuraveis. Inspirado em controladoras tipo expression
// volume/wah, Boss FS-1, Strymon MultiSwitch e mapping de expressao
// do Helix. Slots: 1 (mono — pode-se estender pra multi-secao depois).
function SwRampEditor({ sw, params, onChange, ledPreviewLive, noLed }) {
  const { t } = useBfI18n();
  const p = { ...DEFAULT_SW_PARAMS('ramp'), ...(params || {}) };
  const numOptions = Array.from({ length: 128 }, (_, n) => n);
  const curves = [
    { id: 0, label: 'LINEAR' },
    { id: 1, label: 'EXP' },
    { id: 2, label: 'LOG' },
    { id: 3, label: 'SINE' },
  ];
  const triggers = [
    { id: 0, label: 'TOGGLE', sub: t('sw.ramp.toggleSub') },
    { id: 1, label: 'HOLD',   sub: t('sw.ramp.holdSub') },
    { id: 2, label: 'LOOP',   sub: t('sw.ramp.loopSub') },
  ];

  const [testFired, setTestFired] = useState(false);
  const [testDir, setTestDir] = useState(Number(p.start_on) === 1);
  const fireRamp = async () => {
    // Preview simples: pisca o LED e manda os 2 extremos (sem animacao).
    // O dispositivo real faz o sweep continuo.
    if (Number(p.ch) < 1 || Number(p.ch) > 16) return;
    setTestFired(true);
    setTimeout(() => setTestFired(false), 400);
    const next = !testDir;
    setTestDir(next);
    const body = new URLSearchParams();
    body.set('ch', String(p.ch));
    body.set('as_pc', '0');
    body.set('cc', String(p.num));
    body.set('value', String(next ? p.max_val : p.min_val));
    try { await apiCall('POST', '/midi/cc', body); } catch {/* preview */}
  };

  return (
    <div className="bf-sw-fx1 bf-sw-macros bf-sw-single bf-sw-ramp">
      {/* Linha 1: CC + Canal */}
      <div className="bf-extras-row">
        <label className="bf-extras-cell">
          <span className="bf-field-label">CC</span>
          <div className="bf-select-wrap">
            <BfSelect className="bf-input bf-select" value={Number(p.num) || 0}
                    onChange={(e) => onChange({ num: clamp(Number(e.target.value), 0, 127) })}
                    aria-label={t('sw.aria.ccNum')}>
              {/* RAMP varre o CC continuamente — comandos especiais nao fazem
                  sentido aqui (allowSpecial=false). */}
              {midiOptionElems(numOptions, 'cc', Number(p.num) || 0, Number(p.ch) || 0, false)}
            </BfSelect>
            <span className="bf-select-chev">▾</span>
          </div>
        </label>
        <label className="bf-extras-cell">
          <span className="bf-field-label">{t('sw.channel')}</span>
          <div className="bf-select-wrap">
            <BfSelect className={'bf-input bf-select' + (Number(p.ch) === 0 ? ' is-mute' : '')}
                    value={Number(p.ch) || 0}
                    onChange={(e) => onChange({ ch: Number(e.target.value) })}
                    aria-label={t('sw.aria.midiCh')}>
              {channelOptionElems()}
            </BfSelect>
            <span className="bf-select-chev">▾</span>
          </div>
        </label>
      </div>

      {/* Linha 2: MIN + MAX */}
      <div className="bf-extras-row">
        <label className="bf-extras-cell">
          <span className="bf-field-label">MIN</span>
          <div className="bf-select-wrap">
            <BfSelect className="bf-input bf-select" value={Number(p.min_val) || 0}
                    onChange={(e) => onChange({ min_val: clamp(Number(e.target.value), 0, 127) })}
                    aria-label={t('sw.aria.sweepMin')}>
              {numOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </BfSelect>
            <span className="bf-select-chev">▾</span>
          </div>
        </label>
        <label className="bf-extras-cell">
          <span className="bf-field-label">MAX</span>
          <div className="bf-select-wrap">
            <BfSelect className="bf-input bf-select"
                    value={typeof p.max_val !== 'undefined' ? Number(p.max_val) : 127}
                    onChange={(e) => onChange({ max_val: clamp(Number(e.target.value), 0, 127) })}
                    aria-label={t('sw.aria.sweepMax')}>
              {numOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </BfSelect>
            <span className="bf-select-chev">▾</span>
          </div>
        </label>
      </div>

      {/* SUBIDA / DESCIDA — input numerico + fader deslizante (100..3000ms).
          Lado a lado na mesma linha; cada coluna empilha input em cima e
          fader embaixo. */}
      <div className="bf-ramp-time-grid">
        {[
          { key: 'up_ms',   label: t('sw.rampUp'),  ariaIn: t('sw.ramp.aria.upIn'),
            ariaSl: t('sw.ramp.aria.upFader') },
          { key: 'down_ms', label: t('sw.rampDown'), ariaIn: t('sw.ramp.aria.downIn'),
            ariaSl: t('sw.ramp.aria.downFader') },
        ].map((f) => {
          const v = clamp(Number(p[f.key]) || 1000, 100, 3000);
          return (
            <div className="bf-ramp-time-col" key={f.key}>
              <label className="bf-extras-cell">
                <span className="bf-field-label">{f.label}</span>
                <input type="number" className="bf-input bf-input-num"
                       min={100} max={3000} step={10} value={v}
                       onChange={(e) => onChange({ [f.key]: clamp(Number(e.target.value) || 1000, 100, 3000) })}
                       aria-label={f.ariaIn} />
              </label>
              <input
                type="range"
                className="bf-spin-slider bf-ramp-time-slider"
                min={100} max={3000} step={10}
                value={v}
                onChange={(e) => onChange({ [f.key]: clamp(Number(e.target.value), 100, 3000) })}
                aria-label={f.ariaSl}
              />
            </div>
          );
        })}
      </div>

      {/* Linha 4: CURVA (botoes segmented) */}
      <div className="bf-extras-row bf-ramp-segmented">
        {curves.map((c) => (
          <button key={c.id} type="button"
            className={'bf-input bf-input-num' +
                       (Number(p.curve) === c.id ? ' is-active' : '')}
            onClick={() => onChange({ curve: c.id })}
            aria-pressed={Number(p.curve) === c.id}
            title={t('sw.ramp.aria.curve', { c: c.label })}
          >{c.label}</button>
        ))}
      </div>

      {/* Linha 5: TRIGGER MODE */}
      <div className="bf-extras-row bf-ramp-segmented">
        {triggers.map((t) => (
          <button key={t.id} type="button"
            className={'bf-input bf-input-num' +
                       (Number(p.trigger) === t.id ? ' is-active' : '')}
            onClick={() => onChange({ trigger: t.id })}
            aria-pressed={Number(p.trigger) === t.id}
            title={t.sub}
          >{t.label}</button>
        ))}
      </div>

      {/* START direction fixo em OFF (comeca em MIN) — sem expor no UI.
          RESOLUCAO ms fica fixa em 25ms no codigo (fallback do firmware). */}

      {/* RAMP nao tem START ON PRESET — opera SO em LIVE MODE por design.
          O preset apenas carrega a config; o sweep so comeca quando o
          usuario pisar no footswitch em LIVE. */}

      {/* SWEEP test + LED. noLed (dual switch externo): sem anel — só o teste. */}
      <div className="bf-extras-row bf-sw-fx1-test">
        <button
          type="button"
          className={'bf-input bf-input-num' + (testFired ? ' is-active' : '')}
          onClick={fireRamp}
          aria-label={t('sw.aria.sweepTitle')}
        >
          SWEEP
        </button>
        {!noLed && (
          <div className={'bf-sw-fx1-led' + (testFired ? '' : ' is-off')}>
            <FootswitchArc
              label="LED"
              colorId={Number(p.color)}
              onChange={(id) => onChange({ color: id })}
              litArcs={testFired ? [0, 1, 2] : []}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Toggle iOS reutilizavel (atomo). on = trilho laranja + knob a direita.
// Usado nos cards "Opções" dos editores de SW (ex.: START ON / dispara
// no preset). role=switch + aria-checked pra acessibilidade.
function BfToggle({ on, onClick, ariaLabel, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={ariaLabel}
      title={title}
      className={'bf-toggle' + (on ? ' is-on' : '')}
      onClick={onClick}
    >
      <span className="bf-toggle-knob" aria-hidden="true" />
    </button>
  );
}

// Editor do modo TAP TEMPO — ate 4 slots de CC. Cada press do SW dispara
// todos os slots com valor 127, e o firmware calcula o tempo entre os
// dois ultimos taps. O LED no device anima conforme: idle (sem tempo
// batido) cicla pixel 1 -> 2 -> 3; com tempo batido pisca no intervalo.
function SwTapTempoEditor({ sw, params, onChange, ledPreviewLive, hideStart, hideAtPreset, noLed }) {
  const { t } = useBfI18n();
  const slots = parseTapSlots(params.tslots || '');
  const configuredCount = slots.filter((s) => s.ch >= 1 && s.ch <= 16).length;
  const minVisible = Math.max(1, configuredCount);
  const [visibleCount, setVisibleCount] = useState(
    Math.min(TAP_MAX_SLOTS, minVisible));
  useEffect(() => {
    setVisibleCount((v) => Math.min(TAP_MAX_SLOTS, Math.max(v, minVisible)));
  }, [minVisible]);

  const updateSlot = (idx, patch) => {
    const next = slots.map((s, i) => i === idx ? { ...s, ...patch } : s);
    onChange({ tslots: serializeTapSlots(next) });
  };

  const [testFired, setTestFired] = useState(false);
  const fireTap = async () => {
    setTestFired(true);
    setTimeout(() => setTestFired(false), 150);  // flash visual breve
    for (const s of slots) {
      if (s.ch < 1 || s.ch > 16) continue;
      const body = new URLSearchParams();
      body.set('ch', String(s.ch));
      body.set('as_pc', '0');
      body.set('cc', String(s.num));
      body.set('value', '127');
      try { await apiCall('POST', '/midi/cc', body); } catch {/* preview */}
    }
  };

  const ledLitArcs = testFired ? [0, 1, 2] : [];
  const ledDimmed = !testFired;

  const lpCh = Number(params.lp_ch) || 0;
  const lpNum = clamp(Number(params.lp_num) || 0, 0, 127);
  const lpOn = clamp(typeof params.lp_on !== 'undefined'
    ? Number(params.lp_on) : 127, 0, 127);
  const lpOff = clamp(Number(params.lp_off) || 0, 0, 127);
  const numOptions = Array.from({ length: 128 }, (_, n) => n);

  return (
    <div className="bf-sw-fx1 bf-sw-macros bf-sw-single bf-sw-tap">
      {slots.slice(0, visibleCount).map((s, i) => (
        <SwTapTempoSlot key={i} idx={i} slot={s}
          onChange={(patch) => updateSlot(i, patch)} />
      ))}

      {/* Slot fixo de LONG PRESS — dispara um CC quando o usuario segura
          o SW (~300ms). Independente dos slots de tap. */}
      <div className="bf-macros-slot bf-tap-slot bf-tap-lp-slot">
        <div className="bf-tap-lp-title">{t('sw.longPress')}</div>
        {/* Linha 1: CC + Canal */}
        <div className="bf-extras-row bf-tap-slot-row bf-tap-lp-row">
          <label className="bf-extras-cell">
            <span className="bf-field-label">CC</span>
            <div className="bf-select-wrap">
              <BfSelect
                className="bf-input bf-select"
                value={lpNum}
                onChange={(e) => onChange({ lp_num: clamp(Number(e.target.value), 0, 127) })}
                aria-label={t('sw.aria.longPressCc')}
              >
                {/* allowSpecial=false — mesmo motivo do LP do SPIN: o
                    long-press so manda CC 0..127, »/◆ viravam 127 no clamp. */}
                {midiOptionElems(numOptions, 'cc', lpNum, lpCh, false)}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
          <label className="bf-extras-cell">
            <span className="bf-field-label">{t('sw.channel')}</span>
            <div className="bf-select-wrap">
              <BfSelect
                className={'bf-input bf-select' + (lpCh === 0 ? ' is-mute' : '')}
                value={lpCh}
                onChange={(e) => onChange({ lp_ch: Number(e.target.value) })}
                aria-label={t('sw.aria.longPressCh')}
              >
                {channelOptionElems()}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
        </div>
        {/* Linha 2: valores ON + OFF */}
        <div className="bf-extras-row bf-tap-slot-row bf-tap-lp-row2">
          <label className="bf-extras-cell">
            <span className="bf-field-label">ON</span>
            <div className="bf-select-wrap">
              <BfSelect
                className="bf-input bf-select"
                value={lpOn}
                onChange={(e) => onChange({ lp_on: clamp(Number(e.target.value), 0, 127) })}
                aria-label={t('sw.aria.holdValOn')}
              >
                {numOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
          <label className="bf-extras-cell">
            <span className="bf-field-label">OFF</span>
            <div className="bf-select-wrap">
              <BfSelect
                className="bf-input bf-select"
                value={lpOff}
                onChange={(e) => onChange({ lp_off: clamp(Number(e.target.value), 0, 127) })}
                aria-label={t('sw.aria.releaseValOff')}
              >
                {numOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
        </div>
        {/* START ON / dispara-no-preset migraram pro card "Opções" abaixo. */}
      </div>

      {/* Card "Opções" — toggles iOS de START ON e dispara-no-preset (do
          LONG PRESS) + tile do LED do TAP. Sem START (hideStart) o card
          vira so o tile do LED. Espelha o visual studio dos demais cards. */}
      <div className="bf-sw-studio">
        <div className="bf-sw-studio-head">
          <span className="bf-sw-studio-title">{t('sw.opt.title')}</span>
          <span className="bf-sw-studio-eyebrow">{t('sw.opt.eyebrow')}</span>
        </div>
        <div className="bf-sw-opt-body">
          {!hideStart && (
            <div className="bf-sw-opt-toggles">
              {!hideAtPreset && (
              <div className="bf-sw-opt-row">
                <div className="bf-sw-opt-text">
                  <span className="bf-sw-opt-name">{t('sw.opt.firesPreset')}</span>
                  <span className="bf-sw-opt-sub">{t('sw.opt.firesSub')}</span>
                </div>
                <BfToggle
                  on={params.lp_at_preset === 1}
                  onClick={() => onChange({ lp_at_preset: params.lp_at_preset === 1 ? 0 : 1 })}
                  ariaLabel={t('sw.opt.firesAria')}
                  title={t('sw.opt.firesTitle')}
                />
              </div>
              )}
              <div className="bf-sw-opt-row">
                <div className="bf-sw-opt-text">
                  <span className="bf-sw-opt-name">{t('sw.opt.startOn')}</span>
                  <span className="bf-sw-opt-sub">{t('sw.opt.startSub')}</span>
                </div>
                <BfToggle
                  on={params.lp_start === 1}
                  onClick={() => onChange({ lp_start: params.lp_start === 1 ? 0 : 1 })}
                  ariaLabel={t('sw.opt.startAria')}
                  title={t('sw.opt.startTitle')}
                />
              </div>
            </div>
          )}
          {/* noLed (dual switch externo): sem anel — esconde a cor de LED. */}
          {!noLed && (
            <div className="bf-sw-opt-led">
              <div className={'bf-sw-fx1-led' + (ledDimmed ? ' is-off' : '')}>
                <FootswitchArc
                  label="LED"
                  colorId={params.color}
                  onChange={(id) => onChange({ color: id })}
                  litArcs={ledLitArcs}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      {(visibleCount > 1 || visibleCount < TAP_MAX_SLOTS) && (
        <div className="bf-tap-slot-actions">
          {visibleCount > 1 && (
            <button
              type="button"
              className="bf-tap-action bf-tap-action-remove"
              onClick={() => {
                const last = visibleCount - 1;
                if (slots[last] && (slots[last].ch !== 0 || slots[last].num !== 0)) {
                  updateSlot(last, { ch: 0, num: 0 });
                }
                setVisibleCount(visibleCount - 1);
              }}
              aria-label={t('sw.aria.removeLastSlot')}
              title={t('sw.aria.removeLastSlot')}
            >{t('sw.remove')}</button>
          )}
          {visibleCount < TAP_MAX_SLOTS && (
            <button
              type="button"
              className="bf-tap-action bf-tap-action-add"
              onClick={() => setVisibleCount(visibleCount + 1)}
              aria-label={t('sw.aria.addTapSlot')}
              title={t('sw.aria.addTapSlot')}
            >{t('sw.addTap')}</button>
          )}
        </div>
      )}
    </div>
  );
}

// SINGLE — um slot do editor (semelhante ao SwMacrosSlot mas mais
// simples: um valor unico por slot, sem ON/OFF). Slot { t, ch, num, val }.
function SwSingleSlot({ idx, slot, onChange }) {
  const { t } = useBfI18n();
  const isPc = slot.t === 1;
  const numOptions = Array.from({ length: 128 }, (_, n) => n);
  return (
    <div className="bf-macros-slot">
      <div className="bf-slot-title">Slot {idx + 1}</div>
      <div className="bf-macros-slot-head">
        <button
          type="button"
          className={'bf-input bf-input-num bf-macros-slot-type' +
                     (isPc ? ' is-pc' : ' is-cc')}
          onClick={() => onChange({ t: isPc ? 0 : 1 })}
          aria-pressed={isPc}
          aria-label={isPc ? t('sw.slot.aria.isPc') : t('sw.slot.aria.isCc')}
          title={isPc ? t('sw.slot.title.isPc') : t('sw.slot.title.isCc')}
        >{isPc ? t('sw.sendPc') : t('sw.sendCc')}</button>
        <div className="bf-select-wrap bf-macros-slot-ch">
          <BfSelect
            className={'bf-input bf-select' + (slot.ch === 0 ? ' is-mute' : '')}
            value={slot.ch}
            onChange={(e) => onChange({ ch: Number(e.target.value) })}
            aria-label={t('sw.aria.chSlot')}
          >
            {channelOptionElems('CH OFF', 'CH ')}
          </BfSelect>
          <span className="bf-select-chev">▾</span>
        </div>
      </div>
      {!isPc ? (
        <div className="bf-extras-row bf-macros-slot-fields is-pc">
          <label className="bf-extras-cell">
            <span className="bf-field-label">CC</span>
            <div className="bf-select-wrap">
              <BfSelect
                className="bf-input bf-select"
                value={slot.num}
                onChange={(e) => {
                  const nv = clamp(Number(e.target.value), 0, CC_NUM_MAX);
                  onChange({ num: nv, val: kemperSnapValue(slot.val, slot.ch, nv) });
                }}
                aria-label={t('sw.aria.ccNum')}
              >
                {midiOptionElems(numOptions, 'cc', slot.num, slot.ch)}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
          <label className="bf-extras-cell">
            <span className="bf-field-label">{t('sw.value')}</span>
            <div className="bf-select-wrap">
              <BfSelect
                className="bf-input bf-select"
                value={slot.val}
                onChange={(e) => onChange({ val: clamp(Number(e.target.value), 0, 127) })}
                aria-label={t('sw.aria.ccVal')}
              >
                {kemperValueOptionElems(slot.val, slot.ch, slot.num)}
              </BfSelect>
              <span className="bf-select-chev">▾</span>
            </div>
          </label>
        </div>
      ) : (
        <div className="bf-extras-row bf-macros-slot-fields is-pc">
          <label className="bf-extras-cell">
            <span className="bf-field-label">PC</span>
            <input
              type="number"
              className="bf-input"
              min={0}
              max={16383}
              value={slot.val}
              onChange={(e) => onChange({ val: clamp(Number(e.target.value) || 0, 0, 16383) })}
              aria-label={t('sw.aria.pcNum')}
            />
          </label>
        </div>
      )}
    </div>
  );
}

// Editor do modo SINGLE — disparo unico (sem estado on/off). Comeca com
// 1 slot visivel; botao "+" na ponta inferior direita revela mais ate
// totalizar 4 slots. Cada slot e independente (CC ou PC, canal, valor).
// Toggle "DISPARA COM PRESET" / "AGUARDA LIVE" e color do LED sao
// globais do SW (todos os slots compartilham). Quando o SW e pressionado
// em LIVE, TODOS os slots configurados disparam (e o LED acende).
// Ícone de GESTO do SINGLE — identidade visual dos 3 disparos:
//   curto   = 1 toque  (dedo + 1 onda)
//   longo   = segurar  (dedo + anel de tempo 3/4)
//   reclick = 2 toques (dedo + 2 ondas)
// Usado nos cabeçalhos dos blocos do editor (principal / LONG / RECLICK).
function SwSingleGestureIcon({ kind }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
    'aria-hidden': true, className: 'bf-gesture-ico' };
  if (kind === 'longo') {
    return (
      <svg {...common}>
        <circle cx="12" cy="13" r="4" fill="currentColor" stroke="none" />
        {/* anel 3/4 = "segurando" (tempo passando) */}
        <path d="M12 4.5 A8.5 8.5 0 1 1 4.2 9.5" />
      </svg>
    );
  }
  if (kind === 'reclick') {
    return (
      <svg {...common}>
        <circle cx="9" cy="15" r="3.4" fill="currentColor" stroke="none" />
        <circle cx="16.5" cy="15" r="2.2" fill="currentColor" stroke="none" opacity="0.55" />
        <path d="M5.5 8.5 Q9 4.5 12.5 8.5" />
        <path d="M12.5 6.5 Q16 2.5 19.5 6.5" />
      </svg>
    );
  }
  // curto (default): 1 toque
  return (
    <svg {...common}>
      <circle cx="12" cy="15" r="4" fill="currentColor" stroke="none" />
      <path d="M7 8 Q12 3 17 8" />
    </svg>
  );
}

// Grupo AUXILIAR do SINGLE (LONG PRESS / RECLICK): até 4 slots no mesmo
// formato do principal (SwSingleSlot), gravados em outro campo do blob
// (`lslots`/`rslots`). O firmware ADAPTA o timing do disparo principal
// conforme esses grupos existirem (SW_LIVE.h, dispatch mode==10): nada
// extra = press imediato; só LONG = release; RECLICK = janela do duplo.
function SwSingleExtraGroup({ title, eyebrow, hint, value, onChange, colorId, onColorChange, icon }) {
  const { t } = useBfI18n();
  const slots = parseSingleSlots(value || '');
  const configuredCount = slots.filter((s) => s.ch >= 1 && s.ch <= 16).length;
  const minVisible = Math.max(1, configuredCount);
  const [visibleCount, setVisibleCount] = useState(minVisible);
  useEffect(() => {
    setVisibleCount((v) => Math.max(v, minVisible));
  }, [minVisible]);
  const updateSlot = (idx, patch) => {
    const next = slots.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange(serializeSingleSlots(next));
  };
  return (
    <div className="bf-sw-studio bf-single-extra">
      <div className="bf-sw-studio-head bf-single-gesture-head">
        <span className="bf-sw-studio-title">
          <SwSingleGestureIcon kind={icon} />
          {title}
        </span>
        <span className="bf-sw-studio-eyebrow">{eyebrow}</span>
      </div>
      <div className="bf-single-extra-hint">{hint}</div>
      {slots.slice(0, visibleCount).map((s, i) => (
        <SwSingleSlot key={i} idx={i} slot={s}
          onChange={(patch) => updateSlot(i, patch)} />
      ))}
      {(visibleCount > 1 || visibleCount < 4) && (
        <div className="bf-tap-slot-actions">
          {visibleCount > 1 && (
            <button
              type="button"
              className="bf-tap-action bf-tap-action-remove"
              onClick={() => {
                const last = visibleCount - 1;
                const cur = slots[last];
                if (cur && (cur.ch !== 0 || cur.num !== 0 ||
                            cur.val !== 0 || cur.t !== 0)) {
                  updateSlot(last, emptySingleSlot());
                }
                setVisibleCount(visibleCount - 1);
              }}
              aria-label={t('sw.aria.removeLastSlot')}
              title={t('sw.aria.removeLastSlot')}
            >{t('sw.removeSlot')}</button>
          )}
          {visibleCount < 4 && (
            <button
              type="button"
              className="bf-tap-action bf-tap-action-add"
              onClick={() => setVisibleCount(visibleCount + 1)}
              aria-label={t('sw.aria.addSlot')}
              title={t('sw.aria.addSlot')}
            >{t('sw.addSlot')}</button>
          )}
        </div>
      )}
      {/* Cor do anel quando ESTE gesto foi o ultimo disparado no SW ativo. */}
      {onColorChange && (
        <div className="bf-sw-opt-led bf-single-extra-led">
          <div className="bf-sw-fx1-led">
            <FootswitchArc
              label="LED"
              colorId={colorId}
              onChange={onColorChange}
              litArcs={[0, 1, 2]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SwSingleEditor({ sw, params, onChange, ledPreviewLive, isActiveSingle, hideStart, noLed, hideAtPreset, hideExtras, externalVisualState }) {
  const { t } = useBfI18n();
  // Slots vem do `sslots`. Se vazio E havia config legada (single antigo
  // de 1 slot em num/ch/on/pc/as_pc), migra slot[0] dos campos legados
  // pra UI ficar coerente. Save sobrescreve `sslots`; campos legados
  // permanecem mas o firmware ignora quando `sslots` esta presente.
  const slotsFromSslots = parseSingleSlots(params.sslots || '');
  const sslotsHasAny = slotsFromSslots.some((s) => s.ch >= 1 && s.ch <= 16);
  const legacyCh = Number(params.ch) || 0;
  const slots = slotsFromSslots.slice();
  if (!sslotsHasAny && legacyCh >= 1 && legacyCh <= 16) {
    slots[0] = {
      t: Number(params.as_pc) === 1 ? 1 : 0,
      ch: legacyCh,
      num: Number(params.num) || 0,
      val: Number(params.as_pc) === 1
        ? (Number(params.pc) || 0)
        : (Number(params.on) || 127),
    };
  }
  const configuredCount = slots.filter((s) => s.ch >= 1 && s.ch <= 16).length;
  const minVisible = Math.max(1, configuredCount);
  const [visibleCount, setVisibleCount] = useState(minVisible);
  useEffect(() => {
    setVisibleCount((v) => Math.max(v, minVisible));
  }, [minVisible]);

  // at_preset substitui o `start` antigo do SINGLE. Pra dados legados
  // que ainda guardam `start`, usamos como fallback.
  const fireOnPreset = (typeof params.at_preset !== 'undefined')
    ? params.at_preset === 1
    : params.start === 1;
  const externalStartOn = Number(params.start) === 1;
  const externalRememberState = Number(params.remember_state) === 1;
  const [testFired, setTestFired] = useState(false);
  useEffect(() => {
    if (isActiveSingle) setTestFired(true);
  }, [sw, isActiveSingle]);

  const updateSlot = (idx, patch) => {
    const next = slots.map((s, i) => i === idx ? { ...s, ...patch } : s);
    onChange({ sslots: serializeSingleSlots(next) });
  };

  const fireTest = async () => {
    setTestFired(true);
    let firedAny = false;
    for (const slot of slots) {
      if (slot.ch < 1 || slot.ch > 16) continue;
      firedAny = true;
      const body = new URLSearchParams();
      body.set('ch', String(slot.ch));
      body.set('as_pc', slot.t === 1 ? '1' : '0');
      if (slot.t === 1) {
        body.set('pc', String(slot.val));
      } else {
        body.set('cc', String(slot.num));
        body.set('value', String(slot.val));
      }
      try { await apiCall('POST', '/midi/cc', body); } catch {/* preview */}
    }
    if (!firedAny) setTestFired(false);
  };

  const ledLitArcs = testFired ? [0, 1, 2] : [];
  const ledDimmed = !testFired;

  return (
    <div className="bf-sw-fx1 bf-sw-macros bf-sw-single">
      {/* Cabeçalho do gesto PRINCIPAL (toque curto) — mesma identidade
          visual dos cards LONG/RECLICK (ícone + sigla). */}
      <div className="bf-sw-studio-head bf-single-gesture-head bf-single-main-head">
        <span className="bf-sw-studio-title">
          <SwSingleGestureIcon kind="curto" />
          CURTO
        </span>
        <span className="bf-sw-studio-eyebrow">1 TOQUE</span>
      </div>
      {slots.slice(0, visibleCount).map((s, i) => (
        <SwSingleSlot key={i} idx={i} slot={s}
          onChange={(patch) => updateSlot(i, patch)} />
      ))}
      {(visibleCount > 1 || visibleCount < 4) && (
        <div className="bf-tap-slot-actions">
          {visibleCount > 1 && (
            <button
              type="button"
              className="bf-tap-action bf-tap-action-remove"
              onClick={() => {
                const last = visibleCount - 1;
                const cur = slots[last];
                if (cur && (cur.ch !== 0 || cur.num !== 0 ||
                            cur.val !== 0 || cur.t !== 0)) {
                  updateSlot(last, emptySingleSlot());
                }
                setVisibleCount(visibleCount - 1);
              }}
              aria-label={t('sw.aria.removeLastSlot')}
              title={t('sw.aria.removeLastSlot')}
            >{t('sw.removeSlot')}</button>
          )}
          {visibleCount < 4 && (
            <button
              type="button"
              className="bf-tap-action bf-tap-action-add"
              onClick={() => setVisibleCount(visibleCount + 1)}
              aria-label={t('sw.aria.addSlot')}
              title={t('sw.aria.addSlot')}
            >{t('sw.addSlot')}</button>
          )}
        </div>
      )}
      {/* Card "Opções" — toggle DISPARA NO PRESET + tile do LED. Sem START
          (hideStart) ou em switch externo (noLed) o card encolhe pro que
          sobrar. Mesmo card do STOMP, sem a estrela FAVORITO. */}
      {(!hideStart || !noLed || externalVisualState) && (
        <div className="bf-sw-studio bf-sw-opt-card">
          <div className="bf-sw-studio-head">
            <span className="bf-sw-studio-title">{t('sw.opt.title')}</span>
            <span className="bf-sw-studio-eyebrow">{t('sw.opt.eyebrow')}</span>
          </div>
          <div className="bf-sw-opt-body">
            {externalVisualState && (
              <div className="bf-sw-opt-toggles">
                <div className="bf-sw-opt-row">
                  <div className="bf-sw-opt-text">
                    <span className="bf-sw-opt-name">INICIAR ON</span>
                    <span className="bf-sw-opt-sub">Define o indicador visual inicial do External SW.</span>
                  </div>
                  <BfToggle
                    on={externalStartOn}
                    onClick={() => onChange({ start: externalStartOn ? 0 : 1 })}
                    ariaLabel="Iniciar o indicador do External SW em ON"
                    title="Define se o indicador inicia ON ou OFF"
                  />
                </div>
                <div className="bf-sw-opt-row">
                  <div className="bf-sw-opt-text">
                    <span className="bf-sw-opt-name">LEMBRAR ESTADO</span>
                    <span className="bf-sw-opt-sub">Alterna o indicador ON/OFF a cada toque, sem alterar o MIDI.</span>
                  </div>
                  <BfToggle
                    on={externalRememberState}
                    onClick={() => onChange({ remember_state: externalRememberState ? 0 : 1 })}
                    ariaLabel="Alternar o estado visual do External SW a cada toque"
                    title="Lembra e alterna o estado visual ON/OFF"
                  />
                </div>
              </div>
            )}
            {!hideStart && !hideAtPreset && (
              <div className="bf-sw-opt-toggles">
                <div className="bf-sw-opt-row">
                  <div className="bf-sw-opt-text">
                    <span className="bf-sw-opt-name">{t('sw.opt.firesPreset')}</span>
                    <span className="bf-sw-opt-sub">{t('sw.opt.firesSub')}</span>
                  </div>
                  <BfToggle
                    on={fireOnPreset}
                    onClick={() => onChange({ at_preset: fireOnPreset ? 0 : 1 })}
                    ariaLabel={t('sw.opt.firesAria')}
                    title={t('sw.opt.firesTitle')}
                  />
                </div>
              </div>
            )}
            {/* noLed: switches externos (dual switch) nao tem anel — esconde o LED. */}
            {!noLed && (
              <div className="bf-sw-opt-led">
                <div className={'bf-sw-fx1-led' + (ledDimmed ? ' is-off' : '')}>
                  <FootswitchArc
                    label="LED"
                    colorId={params.color}
                    onChange={(id) => onChange({ color: id })}
                    litArcs={ledLitArcs}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Grupos auxiliares: LONG PRESS (segurar) e RECLICK (duplo-toque).
          O firmware adapta o timing do principal conforme configurados.
          hideExtras: SW GLOBAL / dual externo reusam este editor mas o
          firmware deles (SW_GLOBAL.h / EXT_DUAL_SWITCH.h) ainda nao
          implementa long/reclick no SINGLE — esconde pra nao configurar
          algo sem efeito. */}
      {!hideExtras && (
      <SwSingleExtraGroup
        title="LONG PRESS"
        icon="longo"
        eyebrow="SEGURAR · ~300 MS"
        hint="Segurar o pé (~300 ms) dispara estes slots. Com LONG configurado, o disparo principal passa a acontecer ao SOLTAR o pé."
        value={params.lslots || ''}
        onChange={(v) => onChange({ lslots: v })}
        colorId={typeof params.lp_color !== 'undefined' ? params.lp_color : 5}
        onColorChange={(id) => onChange({ lp_color: id })}
      />
      )}
      {!hideExtras && (
      <SwSingleExtraGroup
        title="RECLICK"
        icon="reclick"
        eyebrow="2 TOQUES"
        hint="Dois toques rápidos disparam estes slots. Com RECLICK configurado, o disparo principal espera a janela do duplo-toque (~350 ms)."
        value={params.rslots || ''}
        onChange={(v) => onChange({ rslots: v })}
        colorId={typeof params.rc_color !== 'undefined' ? params.rc_color : 9}
        onColorChange={(id) => onChange({ rc_color: id })}
      />
      )}
    </div>
  );
}

// Resolve um colorId da DISPLAY_PALETTE pra um CSS background string.
// SOLIDS viram hex; gradientes viram linear-gradient via paletteBackground
// (reusa a logica do ColorBar pra fidelidade visual com o resto do app).
// Transparentes viram 'transparent'.
function paletteCss(colorId) {
  const id = clamp(colorId, 0, DISPLAY_PALETTE.length - 1);
  const c = DISPLAY_PALETTE[id];
  if (!c || c.type === DISP_TYPE.TRANSPARENT) return 'transparent';
  return paletteBackground(c, id);
}
// Versao "solida" pra contextos onde o gradiente nao funciona (ex.: cor
// de texto, sombras, cor do icone tingido via CSS mask — esses precisam
// de uma cor unica). Pega o primeiro stop do gradiente.
function paletteCssSolid(colorId) {
  const id = clamp(colorId, 0, DISPLAY_PALETTE.length - 1);
  const c = DISPLAY_PALETTE[id];
  if (!c || c.type === DISP_TYPE.TRANSPARENT) return 'transparent';
  return hexToCss(c.hex);
}

// Renderiza um icone PNG mascarado com cor arbitraria via CSS mask-image.
// O PNG e a forma; a cor vem do background. Browsers modernos (Safari
// iOS 14+, Chrome 4+, Firefox 53+) suportam isso de forma simples.
function SwIconImg({ iconId, color, size }) {
  // Subscreve no icon store pra re-render quando um slot de upload carrega.
  useIconStore();
  const rawId = parseInt(iconId, 10) || 1;
  const sz85 = Math.round(size * 0.85);
  // SLOT DE UPLOAD (PNG no LittleFS): imagem real via blob (cross-origin ok).
  // Tratado ANTES do clamp — o id (200+) nao cabe em SW_ICONS.length.
  if (isUploadIcon(rawId)) {
    const blob = iconStoreBlobOrLoad(iconUploadSlotOfId(rawId));
    if (!blob) {
      // Carregando (ou slot vazio): placeholder transparente do mesmo tamanho.
      return (
        <span className="bf-sw-icon-img" aria-hidden="true"
              style={{ display: 'inline-block', width: sz85 + 'px', height: sz85 + 'px' }} />
      );
    }
    return (
      <img
        className="bf-sw-icon-img bf-sw-icon-img-color"
        src={blob}
        alt=""
        aria-hidden="true"
        style={{ display: 'block', width: sz85 + 'px', height: sz85 + 'px', objectFit: 'contain' }}
      />
    );
  }
  const id = Math.max(1, Math.min(SW_ICONS.length, rawId));
  const url = `./icons/sw/ICO${id}.png`;
  // COLORIDO (pedal): imagem real, sem tinta. So o PNG; o background/borda do
  // tile (desenhados pelo pai) e que mudam de cor. object-fit:contain preserva
  // o aspecto proprio (pedais sao retrato), espelhando o fit do firmware.
  if (isColorIcon(id)) {
    return (
      <img
        className="bf-sw-icon-img bf-sw-icon-img-color"
        src={url}
        alt=""
        aria-hidden="true"
        style={{
          // 85% pra dar respiro e nao encostar na borda do tile — espelha o
          // encolhimento dos coloridos no firmware (ICONS_RENDER.h).
          display: 'block',
          width: sz85 + 'px',
          height: sz85 + 'px',
          objectFit: 'contain',
        }}
      />
    );
  }
  // TINGIDO: o PNG e a forma; a cor vem do background via CSS mask-image.
  return (
    <span
      className="bf-sw-icon-img"
      style={{
        display: 'inline-block',
        width: size + 'px',
        height: Math.round(size * 72 / 95) + 'px',  // mantem aspecto 95:72
        background: color,
        WebkitMask: `url('${url}') no-repeat center / contain`,
        mask: `url('${url}') no-repeat center / contain`,
      }}
      aria-hidden="true"
    />
  );
}

// Tile de SW com moldura (background) + borda + icone OU texto centralizado.
// Reusado em LIVE MODE (botoes SW1..SW6) e no preview do editor display.
// `on` decide entre cores OFF e ON. footerInfo (opcional) e exibido no
// rodape DENTRO da moldura: { swNum, modeLabel, ledColorHex }. No editor
// e omitido — quem usa e o painel LIVE pra mostrar "SW1 - STOMP - O".
function SwDisplayTile({ disp, on, spinState, size, footerInfo, isActive }) {
  let d = { ...DEFAULT_SW_DISPLAY(), ...(disp || {}) };
  // Modo SPIN: spinState 0/1/2 seleciona qual sub-config (spin[i]) usar.
  // Cada estado tem icone + sigla + cores ON proprios. State -1 (awaiting)
  // cai no estado 1 como fallback (primeiro press confirma o valor 1).
  if (typeof spinState === 'number') {
    const spin = Array.isArray(d.spin) ? d.spin : [];
    const idx = spinState >= 0 && spinState <= 2 ? spinState : 0;
    const s = { ...DEFAULT_SW_SPIN_STATE(), ...(spin[idx] || {}) };
    d = {
      ...d,
      icon_id: s.icon_id,
      sigla: s.sigla || d.sigla,
      mode: s.mode || 'icon',
      ic_on: s.ic_on, ic_off: s.ic_on,
      bg_on: s.bg_on, bg_off: s.bg_on,
      br_on: s.br_on, br_off: s.br_on,
    };
    on = true;  // SPIN sempre "on" — o estado escolhe a cor, nao off/on.
  }
  // BACK e BORDER aceitam gradiente (paletteCss devolve linear-gradient
  // quando aplicavel). ICON e tinta solida — CSS mask-image so pinta com
  // background-color, gradiente nao funciona; cai pra cor unica.
  const icColor  = paletteCssSolid(on ? d.ic_on : d.ic_off);
  // Cor da SIGLA (nome): cor propria quando definida (sg>=0); senao segue o
  // ICON (sentinela -1) — espelha o firmware (0xFF). Vale p/ icone colorido.
  const sgColor  = (d.sg != null && d.sg >= 0) ? paletteCssSolid(d.sg) : icColor;
  const bgColor  = paletteCss(on ? d.bg_on  : d.bg_off);
  const brColor  = paletteCss(on ? d.br_on  : d.br_off);
  // Pra borda, o `border-color` tambem nao aceita gradiente — usa solid
  // como fallback. Se for gradient, a borda pega so a primeira cor.
  const brColorSolid = paletteCssSolid(on ? d.br_on : d.br_off);
  const isText   = d.mode === 'text';
  const sigla    = String(d.sigla || '').trim();
  // Moldura quadrada-ish; iconSize ~70% da moldura.
  // Icone ocupa ~82% da largura da moldura — proximo das bordas mas com
  // folga pequena pra nao colar. Sigla embaixo (quando tem) toma o resto.
  const iconW = Math.round(size * 0.82);
  return (
    <div
      className={'bf-sw-tile' + (isActive ? ' is-active-frame' : '')}
      style={{
        width: size + 'px',
        height: size + 'px',
        background: bgColor === 'transparent' ? undefined : bgColor,
        borderColor: brColorSolid === 'transparent' ? undefined : brColorSolid,
        borderWidth: brColorSolid === 'transparent' ? undefined : '2px',
        borderStyle: brColorSolid === 'transparent' ? undefined : 'solid',
      }}
    >
      {isText ? (
        // TEXT mode: 3 chars grandes centralizados, na cor do ICON (icColor).
        // Fonte ~38% do tile pra preencher visualmente sem encostar na borda.
        <span
          className="bf-sw-tile-text"
          style={{ color: icColor, fontSize: Math.round(size * 0.38) + 'px' }}
        >
          {(sigla || '—').slice(0, 3)}
        </span>
      ) : (
        <>
          <SwIconImg iconId={d.icon_id} color={icColor} size={iconW} />
          {sigla && (
            <span className="bf-sw-tile-sigla" style={{ color: sgColor }}>
              {sigla}
            </span>
          )}
        </>
      )}
      {footerInfo && (
        <span className="bf-sw-tile-footer" style={{ color: icColor }}>
          <span className="bf-sw-tile-footer-text">
            SW{footerInfo.swNum} · {footerInfo.modeLabel}
          </span>
          <span
            className="bf-sw-tile-footer-dot"
            style={{ background: footerInfo.ledColorHex }}
            aria-label={`LED color ${footerInfo.ledColorHex}`}
          />
        </span>
      )}
    </div>
  );
}

// Modal picker dos icones (SW_ICONS) + uma celula "TEXT" coringa como
// primeiro item (id=0). Selecionar TEXT manda o mode pra 'text' no editor
// (mostra so a sigla centralizada, sem icone). Selecionar um icone manda pra
// 'icon'. Grid 6 colunas, tinta usando a cor on/selecionada.
//   allowText (default true): se false, omite a celula TEXT — usado em
//   contextos onde TEXT nao faz sentido (ex.: sub-estados do SPIN/STOMP
//   que sao puramente visuais).
function SwIconPicker({ open, onClose, currentId, currentMode, previewColor, onPick, allowText = false }) {
  const { t } = useBfI18n();
  const iconStore = useIconStore();
  // Atualiza a lista de slots de upload toda vez que o picker abre.
  useEffect(() => { if (open) iconStoreFetchList().catch(() => {}); }, [open]);
  if (!open) return null;
  return ReactDOM.createPortal(
    <div className="bf-modal-backdrop" onClick={onClose}>
      <div
        className="bf-modal bf-sw-icon-picker"
        role="dialog"
        aria-label={t('sw.aria.chooseIcon')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bf-modal-head">
          <span className="bf-modal-title">{t('sw.chooseIcon')}</span>
          <button type="button" className="bf-modal-close"
                  onClick={onClose} aria-label={t('common.close')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                 stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M5 5 L19 19 M19 5 L5 19" />
            </svg>
          </button>
        </div>
        <div className="bf-sw-icon-grid">
          {allowText && (
            <button
              key="text"
              type="button"
              className={'bf-sw-icon-cell bf-sw-icon-cell-text' +
                         (currentMode === 'text' ? ' is-active' : '')}
              onClick={() => { onPick(0); onClose(); }}
              aria-label={t('sw.aria.textMode')}
              title={t('sw.aria.textModeTitle')}
            >
              <span style={{ color: previewColor || '#fff' }}>{t('sw.text')}</span>
            </button>
          )}
          {SW_ICONS.map((_, i) => {
            const id = i + 1;
            const isActive = currentMode !== 'text' && id === currentId;
            return (
              <button
                key={id}
                type="button"
                className={'bf-sw-icon-cell' + (isActive ? ' is-active' : '')}
                onClick={() => { onPick(id); onClose(); }}
                aria-label={t('sw.aria.iconN', { n: id })}
                title={`ICO${id}`}
              >
                <SwIconImg iconId={id} color={previewColor || '#fff'} size={44} />
              </button>
            );
          })}
          {/* Slots de upload PREENCHIDOS (PNG enviado pelo editor). Vazios nao
              aparecem aqui — o upload e feito no card de GLOBAL>DISPLAY. */}
          {iconStore.slots.map((s, slot) => {
            if (!s.exists) return null;
            const id = iconUploadIdOfSlot(slot);
            const isActive = currentMode !== 'text' && id === currentId;
            return (
              <button
                key={`up${slot}`}
                type="button"
                className={'bf-sw-icon-cell' + (isActive ? ' is-active' : '')}
                onClick={() => { onPick(id); onClose(); }}
                aria-label={t('sw.aria.iconUploadedN', { n: slot + 1 })}
                title={`Upload ${slot + 1}`}
              >
                <SwIconImg iconId={id} color={previewColor || '#fff'} size={44} />
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}

// Editor de display SPIN — 3 abas (SPIN1/SPIN2/SPIN3), cada uma com seu
// proprio icone + cor ON dos 3 elementos (ICON/BACK/BORDER) + sigla.
// SPIN nao tem OFF — o estado SEM press cai no estado 1 por convencao.
// gestureTabs (opcional): array de 3 labels — modo SINGLE reusa este editor
// pros 3 GESTOS (CURTO/LONG PRESS/RECLICK), que mapeiam 1:1 nos sub-configs
// spin[0..2] do blob (tags 1..3 — reuso de chaves entre modos, um SW roda um
// modo por vez). Com gestureTabs a aba extra de LONG PRESS do SPIN (spinlp)
// some (o SINGLE nao usa esse slot).
function SwDisplaySpinEditor({ sw, disp, onChange, gestureTabs }) {
  const { t } = useBfI18n();
  const [activeIdx, setActiveIdx] = useState(0);  // 0/1/2
  const [pickerOpen, setPickerOpen] = useState(false);
  const spin = Array.isArray(disp.spin) ? disp.spin : [];
  // activeIdx 0/1/2 = estados do ciclo; 3 = LONG PRESS (disp.spinlp), mostrado
  // no tile quando o long-press do SPIN esta ON.
  const isLp = activeIdx === 3;
  // SEGURAR (long-press): 1 ícone/sigla COMPARTILHADO + cores OFF/ON (igual o
  // STOMP). previewOn = qual estado de cor previsualizar no tile (as cores OFF
  // e ON são editadas lado a lado nas linhas abaixo).
  const [previewOn, setPreviewOn] = useState(true);
  const SPINLP_DEF = { icon_id: 1, mode: 'icon', sigla: '',
                       ic_off: 3, ic_on: 15, bg_off: 0, bg_on: 0, br_off: 3, br_on: 15 };
  const s = isLp
    ? { ...SPINLP_DEF, ...(disp.spinlp || {}) }
    : { ...DEFAULT_SW_SPIN_STATE(), ...(spin[activeIdx] || {}) };

  // Atualiza so o alvo ativo (estado do ciclo OU o long-press), preserva o resto.
  const setState = (patch) => {
    if (isLp) {
      onChange({ ...disp,
        spinlp: { ...SPINLP_DEF, ...(disp.spinlp || {}), ...patch } });
      return;
    }
    const next = [
      { ...DEFAULT_SW_SPIN_STATE(), ...(spin[0] || {}) },
      { ...DEFAULT_SW_SPIN_STATE(), ...(spin[1] || {}) },
      { ...DEFAULT_SW_SPIN_STATE(), ...(spin[2] || {}) },
    ];
    next[activeIdx] = { ...next[activeIdx], ...patch };
    onChange({ ...disp, spin: next });
  };

  // Tile preview: spin states usam a cor ON única; o SEGURAR previsualiza OFF
  // ou ON conforme previewOn (cada estado tem cor própria, ícone/sigla é a mesma).
  const pIc = isLp ? (previewOn ? s.ic_on : s.ic_off) : s.ic_on;
  const pBg = isLp ? (previewOn ? s.bg_on : s.bg_off) : s.bg_on;
  const pBr = isLp ? (previewOn ? s.br_on : s.br_off) : s.br_on;
  const previewDisp = {
    ...disp,
    icon_id: s.icon_id,
    sigla: s.sigla,
    mode: s.mode || 'icon',
    ic_on: pIc, ic_off: pIc,
    bg_on: pBg, bg_off: pBg,
    br_on: pBr, br_off: pBr,
  };

  const colorCell = (label, key) => (
    <div className="bf-sw-disp-color-cell">
      <span className="bf-sw-disp-color-state">{label}</span>
      <ColorBar label={label} colorId={s[key]} excludeImages
                onChange={(id) => setState({ [key]: id })} />
    </div>
  );

  return (
    <div className="bf-sw-disp">
      {/* 3 abas SPIN1/SPIN2/SPIN3 — cada uma edita o seu estado */}
      <div className="bf-seg bf-sw-disp-spin-tabs" role="tablist"
           aria-label={t('sw.aria.spinState')}>
        {(gestureTabs ? [0, 1, 2] : [0, 1, 2, 3]).map((i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={activeIdx === i}
            className={activeIdx === i ? 'is-active' : ''}
            onClick={() => setActiveIdx(i)}
          >{gestureTabs ? gestureTabs[i]
              : (i < 3 ? `SPIN ${i + 1}` : t('sw.longPress'))}</button>
        ))}
      </div>

      {/* Toggle de PREVIEW OFF/ON do long-press (só previsualiza o tile; as
          cores OFF e ON são editadas lado a lado nas linhas abaixo). O ícone e
          a sigla são COMPARTILHADOS entre OFF/ON — só as cores mudam. */}
      {isLp && (
        <div className="bf-seg bf-sw-disp-spin-tabs" role="tablist"
             aria-label={t('sw.longPress')} style={{ marginTop: 6 }}>
          <button type="button" role="tab" aria-selected={!previewOn}
            className={!previewOn ? 'is-active' : ''}
            onClick={() => setPreviewOn(false)}>OFF</button>
          <button type="button" role="tab" aria-selected={previewOn}
            className={previewOn ? 'is-active' : ''}
            onClick={() => setPreviewOn(true)}>ON</button>
        </div>
      )}

      {/* Linhas de cor ICON/BACK/BORDER. Estados do ciclo = 1 swatch ON; o
          SEGURAR (long-press) = OFF + ON lado a lado (igual o STOMP). */}
      <div className="bf-sw-disp-colors">
        {/* ICON colorido (pedal) nao tinge: esconde a cor do ICON; so BACK/
            BORDER. Modo TEXT mantem (ICON = cor do texto). */}
        {(s.mode === 'text' || !isColorIcon(s.icon_id)) && (
          <div className="bf-sw-disp-color">
            <div className="bf-sw-disp-color-label">{t('sw.colIcon')}</div>
            <div className="bf-sw-disp-color-swatches">
              {isLp ? <>{colorCell('OFF', 'ic_off')}{colorCell('ON', 'ic_on')}</> : colorCell('ON', 'ic_on')}
            </div>
          </div>
        )}
        <div className="bf-sw-disp-color">
          <div className="bf-sw-disp-color-label">{t('sw.colBack')}</div>
          <div className="bf-sw-disp-color-swatches">
            {isLp ? <>{colorCell('OFF', 'bg_off')}{colorCell('ON', 'bg_on')}</> : colorCell('ON', 'bg_on')}
          </div>
        </div>
        <div className="bf-sw-disp-color">
          <div className="bf-sw-disp-color-label">{t('sw.colBorder')}</div>
          <div className="bf-sw-disp-color-swatches">
            {isLp ? <>{colorCell('OFF', 'br_off')}{colorCell('ON', 'br_on')}</> : colorCell('ON', 'br_on')}
          </div>
        </div>
      </div>

      <div className="bf-sw-disp-preview-row">
        <button
          type="button"
          className="bf-sw-disp-preview"
          onClick={() => setPickerOpen(true)}
          aria-label={t('sw.aria.swapIconSpin')}
          title={t('sw.aria.swapIcon')}
        >
          <SwDisplayTile disp={previewDisp} on={true} size={96} />
        </button>
        <div className="bf-sw-disp-toggles">
          <div className="bf-sw-disp-sigla-row">
            <label className="bf-field bf-sw-disp-sigla">
              <span className="bf-field-label">{t('sw.iconNameSigla')}</span>
              <input
                type="text"
                className="bf-input"
                value={s.sigla}
                maxLength={6}
                onChange={(e) => setState({ sigla: e.target.value.slice(0, 6) })}
                placeholder={isLp ? 'LP' : `S${activeIdx + 1}`}
              />
            </label>
            <label className="bf-field bf-sw-disp-sigla-color">
              <span className="bf-field-label">{t('sw.siglaColor')}</span>
              <ColorBar label="sg" colorId={disp.sg >= 0 ? disp.sg : s.ic_on} excludeImages
                        onChange={(id) => onChange({ ...disp, sg: id })} />
            </label>
          </div>
        </div>
      </div>

      <SwIconPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        currentId={s.icon_id}
        currentMode={s.mode}
        allowText={true}
        previewColor={(() => {
          const c = paletteCss(s.ic_on);
          return c === 'transparent' ? '#cfcfd6' : c;
        })()}
        onPick={(id) => {
          if (id === 0) setState({ mode: 'text' });
          else setState({ icon_id: id, mode: 'icon' });
        }}
      />
    </div>
  );
}

// Editor de display STOMP — tabs por (secao × estado). Secao A (curto)
// usa o config principal (ic_off/ic_on/bg_off/.../br_on). Secao B (longo)
// e secao C (reclick) usam stomp[0..3] = B_off, B_on, C_off, C_on.
// Tabs sao filtradas pra mostrar so as secoes habilitadas (ch2>0 → B,
// ch3>0 → C, lidas dos params fx1 do SW).
function SwDisplayStompEditor({ sw, disp, onChange, swParams }) {
  const { t } = useBfI18n();
  const fxParams = (swParams && swParams[sw] && swParams[sw].fx1)
                   || DEFAULT_SW_PARAMS('fx1');
  // Espelha o editor de PARAMETROS (SwStompEditor): a secao existe se tem canal
  // MIDI valido OU esta marcada como FAVORITE. Sem o `fav`, uma secao B/C em
  // FAVORITE (ch=0) ficava com a aba de ICONE desabilitada aqui — editavel nos
  // parametros mas inacessivel no display.
  const hasB = (Number(fxParams.ch2) >= 1 && Number(fxParams.ch2) <= 16) ||
               Number(fxParams.fav2) === 1;
  const hasC = (Number(fxParams.ch3) >= 1 && Number(fxParams.ch3) <= 16) ||
               Number(fxParams.fav3) === 1;

  // Tabs de SECAO no topo (CLICK CURTO/LONGO/RECLICK). Dentro de cada
  // secao, o layout ESPELHA o editor basico: 3 linhas de cor com OFF/ON
  // lado a lado, botao PREVIEW OFF/ON, preview + sigla.
  const [secaoIdx, setSecaoIdx] = useState(0);
  const [previewOn, setPreviewOn] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (secaoIdx === 1 && !hasB) setSecaoIdx(0);
    if (secaoIdx === 2 && !hasC) setSecaoIdx(0);
  }, [hasB, hasC, secaoIdx]);

  const stomp = Array.isArray(disp.stomp) && disp.stomp.length === 4
                ? disp.stomp
                : [DEFAULT_SW_STOMP_SUB(false), DEFAULT_SW_STOMP_SUB(true),
                   DEFAULT_SW_STOMP_SUB(false), DEFAULT_SW_STOMP_SUB(true)];
  const isMain = secaoIdx === 0;
  // sub indices: B-off=0, B-on=1, C-off=2, C-on=3.
  const subBase = secaoIdx === 1 ? 0 : secaoIdx === 2 ? 2 : -1;
  const subOff = isMain ? null : stomp[subBase];
  const subOn  = isMain ? null : stomp[subBase + 1];

  // Sigla POR SECAO: A usa a principal (disp.sigla); B/C usam a sigla guardada
  // no slot OFF da secao (canonico, igual ao icone). Vazio = herda a principal.
  const sectionSigla = isMain ? (disp.sigla || '') : ((subOff && subOff.sigla) || '');
  const setSectionSigla = (val) => {
    const v = val.slice(0, 8);
    if (isMain) { onChange({ ...disp, sigla: v }); return; }
    const next = stomp.map((s, i) => (i === subBase
      ? { ...DEFAULT_SW_STOMP_SUB((i & 1) === 1), ...s, sigla: v } : s));
    onChange({ ...disp, stomp: next });
  };
  // Cor da sigla POR SECAO (-1 = segue a cor do ICON). A usa disp.sg; B/C usam
  // o slot OFF da secao (canonico, igual a sigla).
  const sectionSg = isMain ? (disp.sg != null ? disp.sg : -1)
                           : ((subOff && subOff.sg != null) ? subOff.sg : -1);
  const setSectionSg = (id) => {
    if (isMain) { onChange({ ...disp, sg: id }); return; }
    const next = stomp.map((s, i) => (i === subBase
      ? { ...DEFAULT_SW_STOMP_SUB((i & 1) === 1), ...s, sg: id } : s));
    onChange({ ...disp, stomp: next });
  };

  // Le um campo do estado atual (off ou on) da secao ativa.
  // icon_id e mode sao COMPARTILHADOS entre OFF/ON (1 icone por secao);
  // sempre lemos do slot OFF como canonico. Cores (ic/bg/br) variam por
  // estado. Em presets legados onde os 2 slots tinham icones diferentes,
  // mostramos o OFF — alteracao subsequente sincroniza ambos.
  const getField = (field, on) => {
    if (isMain) {
      if (field === 'icon_id') return disp.icon_id;
      if (field === 'mode') return disp.mode || 'icon';
      if (field === 'ic') return on ? disp.ic_on : disp.ic_off;
      if (field === 'bg') return on ? disp.bg_on : disp.bg_off;
      if (field === 'br') return on ? disp.br_on : disp.br_off;
    }
    if (field === 'icon_id') return (subOff && subOff.icon_id) || 1;
    if (field === 'mode')    return (subOff && subOff.mode) || 'icon';
    const sub = on ? subOn : subOff;
    if (!sub) return null;
    return sub[field];
  };

  // Atualiza campos do estado especificado (on=true/false) na secao ativa.
  // Aceita patch obj pra fazer multiplas mudancas atomicas (icon_id + mode
  // no mesmo click do picker, sem stale closure).
  const setStateFields = (on, patch) => {
    if (isMain) {
      const mapped = {};
      for (const [field, value] of Object.entries(patch)) {
        const key = field === 'icon_id' ? 'icon_id'
                  : field === 'mode' ? 'mode'
                  : field === 'ic' ? (on ? 'ic_on' : 'ic_off')
                  : field === 'bg' ? (on ? 'bg_on' : 'bg_off')
                  : field === 'br' ? (on ? 'br_on' : 'br_off')
                  : null;
        if (key) mapped[key] = value;
      }
      onChange({ ...disp, ...mapped });
    } else {
      // Sub-secao B/C: idx 0/2 = OFF, idx 1/3 = ON. icon_id/mode sao
      // COMPARTILHADOS entre os 2 estados (1 icone por secao); so
      // cores (ic/bg/br) diferem entre OFF/ON. Sem isso, mudar o
      // icone com PREVIEW ON gravava num slot e PREVIEW OFF noutro,
      // efetivamente permitindo 2 icones por secao — bug.
      const offIdx = subBase;
      const onIdx  = subBase + 1;
      const shared = {};
      const stateOnly = {};
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'icon_id' || k === 'mode') shared[k] = v;
        else stateOnly[k] = v;
      }
      const next = stomp.map((s, i) => {
        if (i === offIdx) {
          // OFF: aplica shared (icon/mode) sempre + stateOnly so se on=false
          return on
            ? { ...DEFAULT_SW_STOMP_SUB(false), ...s, ...shared }
            : { ...DEFAULT_SW_STOMP_SUB(false), ...s, ...shared, ...stateOnly };
        }
        if (i === onIdx) {
          // ON: aplica shared sempre + stateOnly so se on=true
          return on
            ? { ...DEFAULT_SW_STOMP_SUB(true), ...s, ...shared, ...stateOnly }
            : { ...DEFAULT_SW_STOMP_SUB(true), ...s, ...shared };
        }
        return s;
      });
      onChange({ ...disp, stomp: next });
    }
  };

  // Preview reflete previewOn (igual basico).
  const curIcon = getField('icon_id', previewOn);
  const curMode = getField('mode', previewOn);
  const curIc   = getField('ic', previewOn);
  const curBg   = getField('bg', previewOn);
  const curBr   = getField('br', previewOn);

  const previewDisp = {
    ...disp,
    icon_id: curIcon,
    mode: curMode,
    sigla: sectionSigla,  // preview reflete a sigla da secao ativa
    sg: sectionSg,        // ... e a cor da sigla da secao ativa
    ic_on: curIc, ic_off: curIc,
    bg_on: curBg, bg_off: curBg,
    br_on: curBr, br_off: curBr,
  };

  // Mesma helper do editor basico: 1 linha = label + (OFF cell — ON cell).
  // OFF e ON editam o mesmo campo (ic/bg/br) so que em estados diferentes.
  const colorCell = (stateLabel, on, field) => (
    <div className="bf-sw-disp-color-cell">
      <span className="bf-sw-disp-color-state">{stateLabel}</span>
      <ColorBar label={`${field} ${stateLabel}`} colorId={getField(field, on)} excludeImages
                onChange={(id) => setStateFields(on, { [field]: id })} />
    </div>
  );
  const colorRow = (label, field) => (
    <div className="bf-sw-disp-color">
      <div className="bf-sw-disp-color-label">{label}</div>
      <div className="bf-sw-disp-color-swatches">
        {colorCell('OFF', false, field)}
        <span className="bf-sw-disp-color-sep">—</span>
        {colorCell('ON',  true,  field)}
      </div>
    </div>
  );

  const secoes = [
    { idx: 0, label: t('sw.clickShort'), enabled: true },
    { idx: 1, label: t('sw.clickLong'), enabled: hasB },
    { idx: 2, label: t('sw.clickRe'), enabled: hasC },
  ];

  return (
    <div className="bf-sw-disp">
      {/* Tabs de SECAO (3 colunas, mesmo visual do editor de params) */}
      <div className="bf-seg bf-sw-fx2-tabs" role="tablist"
           aria-label={t('sw.aria.stompSection')}>
        {secoes.map((s) => (
          <button
            key={s.idx}
            type="button"
            role="tab"
            aria-selected={secaoIdx === s.idx}
            disabled={!s.enabled}
            className={secaoIdx === s.idx ? 'is-active' : ''}
            onClick={() => s.enabled && setSecaoIdx(s.idx)}
            title={s.enabled ? s.label
                  : t('sw.disp.sectionDisabled', { n: s.idx === 1 ? '2' : '3' })}
          >{s.label}</button>
        ))}
      </div>

      {/* Body = mesmo layout do editor basico (3 linhas OFF/ON + preview + sigla) */}
      <div className="bf-sw-disp-colors">
        {/* ICON colorido (pedal) nao tinge: esconde a cor do ICON. */}
        {(getField('mode') === 'text' || !isColorIcon(getField('icon_id'))) &&
          colorRow(t('sw.colIcon'),   'ic')}
        {colorRow(t('sw.colBack'),   'bg')}
        {colorRow(t('sw.colBorder'), 'br')}
      </div>

      <div className="bf-sw-disp-preview-row">
        <button
          type="button"
          className="bf-sw-disp-preview"
          onClick={() => setPickerOpen(true)}
          aria-label={t('sw.aria.swapIcon')}
          title={t('sw.aria.swapIcon')}
        >
          <SwDisplayTile disp={previewDisp} on={true} size={96} />
        </button>
        <div className="bf-sw-disp-toggles">
          <button
            type="button"
            className={'bf-input bf-input-num' + (previewOn ? ' is-active' : '')}
            onClick={() => setPreviewOn((v) => !v)}
            aria-pressed={previewOn}
            title={t('sw.aria.previewToggleSection')}
          >
            {previewOn ? t('sw.previewOn') : t('sw.previewOff')}
          </button>
          <div className="bf-sw-disp-sigla-row">
            <label className="bf-field bf-sw-disp-sigla">
              <span className="bf-field-label">{t('sw.iconNameSigla')}</span>
              <input
                type="text"
                className="bf-input"
                value={sectionSigla}
                maxLength={8}
                onChange={(e) => setSectionSigla(e.target.value)}
                placeholder="STOMP"
              />
            </label>
            <label className="bf-field bf-sw-disp-sigla-color">
              <span className="bf-field-label">{t('sw.siglaColor')}</span>
              <ColorBar label="sg" colorId={sectionSg >= 0 ? sectionSg : curIc} excludeImages
                        onChange={(id) => setSectionSg(id)} />
            </label>
          </div>
        </div>
      </div>

      <SwIconPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        currentId={curIcon}
        currentMode={curMode}
        allowText={true}
        previewColor={(() => {
          const c = paletteCss(curIc);
          return c === 'transparent' ? '#cfcfd6' : c;
        })()}
        onPick={(id) => {
          // O icone/mode aplicam pro estado atualmente em preview (OFF ou ON).
          if (id === 0) setStateFields(previewOn, { mode: 'text' });
          else setStateFields(previewOn, { icon_id: id, mode: 'icon' });
        }}
      />
    </div>
  );
}

// Editor de display TAP TEMPO. 2 abas: TAP (estado unico, igual SPIN) e
// LONG PRESS (OFF/ON, igual STOMP secao).
function SwDisplayTapEditor({ sw, disp, onChange }) {
  const { t } = useBfI18n();
  // tabIdx: 0=TAP, 1=LONG PRESS
  const [tabIdx, setTabIdx] = useState(0);
  const [previewOn, setPreviewOn] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const tap = Array.isArray(disp.tap) && disp.tap.length === 3
              ? disp.tap
              : [DEFAULT_SW_STOMP_SUB(true), DEFAULT_SW_STOMP_SUB(false),
                 DEFAULT_SW_STOMP_SUB(true)];

  // TAP usa tap[0] (estado unico). LP usa tap[1]=off / tap[2]=on.
  const isLp = tabIdx === 1;
  const lpSubIdx = isLp ? (previewOn ? 2 : 1) : 0;
  const activeSub = tap[lpSubIdx] || DEFAULT_SW_STOMP_SUB(lpSubIdx !== 1);

  const setSubFields = (subIdx, patch) => {
    const next = tap.map((s, i) => i === subIdx
      ? { ...DEFAULT_SW_STOMP_SUB(i !== 1), ...s, ...patch }
      : s);
    onChange({ ...disp, tap: next });
  };

  const previewDisp = {
    ...disp,
    icon_id: activeSub.icon_id,
    mode: activeSub.mode || 'icon',
    ic_on: activeSub.ic, ic_off: activeSub.ic,
    bg_on: activeSub.bg, bg_off: activeSub.bg,
    br_on: activeSub.br, br_off: activeSub.br,
  };

  // colorCell: pra TAP (1 swatch) ou LP (2 swatches OFF/ON).
  const colorCellLp = (label, on, field) => {
    const sub = tap[on ? 2 : 1] || DEFAULT_SW_STOMP_SUB(on);
    return (
      <div className="bf-sw-disp-color-cell">
        <span className="bf-sw-disp-color-state">{label}</span>
        <ColorBar label={`${field} ${label}`} colorId={sub[field]} excludeImages
                  onChange={(id) => setSubFields(on ? 2 : 1, { [field]: id })} />
      </div>
    );
  };
  const colorCellTap = (field) => (
    <div className="bf-sw-disp-color-cell">
      <span className="bf-sw-disp-color-state">TAP</span>
      <ColorBar label={field} colorId={(tap[0] || DEFAULT_SW_STOMP_SUB())[field]} excludeImages
                onChange={(id) => setSubFields(0, { [field]: id })} />
    </div>
  );

  const colorRow = (label, field) => (
    <div className="bf-sw-disp-color">
      <div className="bf-sw-disp-color-label">{label}</div>
      <div className="bf-sw-disp-color-swatches">
        {isLp ? (
          <>
            {colorCellLp('OFF', false, field)}
            <span className="bf-sw-disp-color-sep">—</span>
            {colorCellLp('ON',  true,  field)}
          </>
        ) : (
          colorCellTap(field)
        )}
      </div>
    </div>
  );

  return (
    <div className="bf-sw-disp">
      {/* Tabs TAP / LONG PRESS */}
      <div className="bf-seg bf-sw-fx2-tabs" role="tablist"
           aria-label={t('sw.aria.tapSection')}>
        <button
          type="button" role="tab"
          aria-selected={tabIdx === 0}
          className={tabIdx === 0 ? 'is-active' : ''}
          onClick={() => setTabIdx(0)}
        >TAP</button>
        <button
          type="button" role="tab"
          aria-selected={tabIdx === 1}
          className={tabIdx === 1 ? 'is-active' : ''}
          onClick={() => setTabIdx(1)}
        >{t('sw.longPress')}</button>
      </div>

      <div className="bf-sw-disp-colors">
        {/* ICON colorido (pedal) nao tinge: esconde a cor do ICON. */}
        {((activeSub.mode || 'icon') === 'text' || !isColorIcon(activeSub.icon_id)) &&
          colorRow(t('sw.colIcon'),   'ic')}
        {colorRow(t('sw.colBack'),   'bg')}
        {colorRow(t('sw.colBorder'), 'br')}
      </div>

      <div className="bf-sw-disp-preview-row">
        <button
          type="button"
          className="bf-sw-disp-preview"
          onClick={() => setPickerOpen(true)}
          aria-label={t('sw.aria.swapIcon')}
          title={t('sw.aria.swapIcon')}
        >
          <SwDisplayTile disp={previewDisp} on={true} size={96} />
        </button>
        <div className="bf-sw-disp-toggles">
          {isLp && (
            <button
              type="button"
              className={'bf-input bf-input-num' + (previewOn ? ' is-active' : '')}
              onClick={() => setPreviewOn((v) => !v)}
              aria-pressed={previewOn}
              title={t('sw.aria.previewToggleLong')}
            >
              {previewOn ? t('sw.previewOn') : t('sw.previewOff')}
            </button>
          )}
          <div className="bf-sw-disp-sigla-row">
            <label className="bf-field bf-sw-disp-sigla">
              <span className="bf-field-label">{t('sw.iconNameSigla')}</span>
              <input
                type="text"
                className="bf-input"
                value={disp.sigla || ''}
                maxLength={8}
                onChange={(e) => onChange({ ...disp, sigla: e.target.value.slice(0, 8) })}
                placeholder="TAP"
              />
            </label>
            <label className="bf-field bf-sw-disp-sigla-color">
              <span className="bf-field-label">{t('sw.siglaColor')}</span>
              <ColorBar label="sg" colorId={disp.sg >= 0 ? disp.sg : disp.ic_on} excludeImages
                        onChange={(id) => onChange({ ...disp, sg: id })} />
            </label>
          </div>
        </div>
      </div>

      <SwIconPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        currentId={activeSub.icon_id}
        currentMode={activeSub.mode}
        allowText={true}
        previewColor={(() => {
          const c = paletteCss(activeSub.ic);
          return c === 'transparent' ? '#cfcfd6' : c;
        })()}
        onPick={(id) => {
          if (id === 0) setSubFields(lpSubIdx, { mode: 'text' });
          else setSubFields(lpSubIdx, { icon_id: id, mode: 'icon' });
        }}
      />
    </div>
  );
}

// Editor da aba DISPLAY do card de SW.
// - Modo NAO-especial: 3 linhas de cor (ICON/BACK/BORDER × OFF/ON), preview
//   clicavel pro picker, PREVIEW ON/OFF, sigla.
// - Modo SPIN: delega pra SwDisplaySpinEditor (3 abas SPIN1/2/3).
// - Modo STOMP (fx1): delega pra SwDisplayStompEditor (tabs CLICK CURTO/
//   LONGO/RECLICK conforme secoes habilitadas + body igual basico).
// - Modo TAP TEMPO: delega pra SwDisplayTapEditor (tabs TAP/LONG PRESS).
function SwDisplayEditor({ sw, disp, onChange, swMode, swParams }) {
  const { t } = useBfI18n();
  const d = { ...DEFAULT_SW_DISPLAY(), ...(disp || {}) };
  if (!Array.isArray(d.spin) || d.spin.length !== 3) {
    d.spin = [DEFAULT_SW_SPIN_STATE(), DEFAULT_SW_SPIN_STATE(), DEFAULT_SW_SPIN_STATE()];
  }
  if (!Array.isArray(d.stomp) || d.stomp.length !== 4) {
    // [0]=B_off,[1]=B_on,[2]=C_off,[3]=C_on -> impar = ON (vermelho).
    d.stomp = [DEFAULT_SW_STOMP_SUB(false), DEFAULT_SW_STOMP_SUB(true),
               DEFAULT_SW_STOMP_SUB(false), DEFAULT_SW_STOMP_SUB(true)];
  }
  if (!Array.isArray(d.tap) || d.tap.length !== 3) {
    // [0]=TAP (ativo), [1]=LP_off, [2]=LP_on.
    d.tap = [DEFAULT_SW_STOMP_SUB(true), DEFAULT_SW_STOMP_SUB(false),
             DEFAULT_SW_STOMP_SUB(true)];
  }
  const isSpin = swMode === 'spin';
  const isStomp = swMode === 'fx1';
  const isTap = swMode === 'tap_tempo';
  const isSingle = swMode === 'single';

  if (isSpin) {
    return <SwDisplaySpinEditor sw={sw} disp={d} onChange={onChange} />;
  }
  if (isSingle) {
    // SINGLE: tile mostra o ícone do ÚLTIMO GESTO (curto/long/reclick),
    // sempre "ativo" (sem OFF) — mesmos sub-configs spin[0..2] do blob.
    return <SwDisplaySpinEditor sw={sw} disp={d} onChange={onChange}
             gestureTabs={['CURTO', 'LONG PRESS', 'RECLICK']} />;
  }
  if (isStomp) {
    return <SwDisplayStompEditor sw={sw} disp={d} onChange={onChange} swParams={swParams} />;
  }
  if (isTap) {
    return <SwDisplayTapEditor sw={sw} disp={d} onChange={onChange} />;
  }

  const [previewOn, setPreviewOn] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const set = (patch) => onChange({ ...d, ...patch });

  const colorCell = (stateLabel, key) => (
    <div className="bf-sw-disp-color-cell">
      <span className="bf-sw-disp-color-state">{stateLabel}</span>
      <ColorBar label={`${key}`} colorId={d[key]} excludeImages
                onChange={(id) => set({ [key]: id })} />
    </div>
  );

  const colorRow = (label, offKey, onKey) => (
    <div className="bf-sw-disp-color">
      <div className="bf-sw-disp-color-label">{label}</div>
      <div className="bf-sw-disp-color-swatches">
        {colorCell('OFF', offKey)}
        <span className="bf-sw-disp-color-sep">—</span>
        {colorCell('ON', onKey)}
      </div>
    </div>
  );

  return (
    <div className="bf-sw-disp">
      <div className="bf-sw-disp-colors">
        {/* ICON colorido (pedal) nao tinge — esconde o seletor de cor do ICON;
            so BACK/BORDER mudam. No modo TEXT, ICON e a cor do texto: mantem. */}
        {((d.mode || 'icon') === 'text' || !isColorIcon(d.icon_id)) &&
          colorRow(t('sw.colIcon'),   'ic_off', 'ic_on')}
        {colorRow(t('sw.colBack'),   'bg_off', 'bg_on')}
        {colorRow(t('sw.colBorder'), 'br_off', 'br_on')}
      </div>

      <div className="bf-sw-disp-preview-row">
        <button
          type="button"
          className="bf-sw-disp-preview"
          onClick={() => setPickerOpen(true)}
          aria-label={t('sw.aria.swapIcon')}
          title={t('sw.aria.swapIcon')}
        >
          <SwDisplayTile disp={d} on={previewOn} size={96} />
        </button>
        <div className="bf-sw-disp-toggles">
          <button
            type="button"
            className={'bf-input bf-input-num' + (previewOn ? ' is-active' : '')}
            onClick={() => setPreviewOn((v) => !v)}
            aria-pressed={previewOn}
            title={t('sw.aria.previewToggle')}
          >
            {previewOn ? t('sw.previewOn') : t('sw.previewOff')}
          </button>
          <div className="bf-sw-disp-sigla-row">
            <label className="bf-field bf-sw-disp-sigla">
              <span className="bf-field-label">{t('sw.iconNameSigla')}</span>
              <input
                type="text"
                className="bf-input"
                value={d.sigla}
                maxLength={8}
                onChange={(e) => set({ sigla: e.target.value.slice(0, 8) })}
                placeholder="STOMP"
              />
            </label>
            <label className="bf-field bf-sw-disp-sigla-color">
              <span className="bf-field-label">{t('sw.siglaColor')}</span>
              <ColorBar label="sg" colorId={d.sg >= 0 ? d.sg : d.ic_on} excludeImages
                        onChange={(id) => set({ sg: id })} />
            </label>
          </div>
        </div>
      </div>

      <SwIconPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        currentId={d.icon_id}
        currentMode={d.mode}
        allowText={true}
        previewColor={(() => {
          // Fallback pra branco se a cor escolhida for transparente —
          // senao os icones do picker ficariam invisiveis.
          const c = paletteCss(previewOn ? d.ic_on : d.ic_off);
          return c === 'transparent' ? '#cfcfd6' : c;
        })()}
        onPick={(id) => {
          if (id === 0) set({ mode: 'text' });
          else set({ icon_id: id, mode: 'icon' });
        }}
      />
    </div>
  );
}

function LiveModePanel({ presetCount, swModes, onSetSwMode, swParams, onSetSwParam, ledPreviewLive, swLiveOn, lastSingleSw, swSpinState, swDisplay, onSetSwDisplay, swGridTarget, portalTarget, switchMode, onSetSwitchMode, isDesktop,
  // Controlled-optional: quando passados pelo pai, sobrescrevem o state interno.
  // Usado pelo Studio redesign (mobile) — SwPreviewGrid em pages/bank.jsx
  // compartilha a selecao com o editor do SW que mora aqui dentro.
  selectedSw: extSelectedSw, onSetSelectedSw: extSetSelectedSw,
  // Controlled-optional tambem pro tab do card (gear/display) — deixa o
  // PresetDashboard (mobile) abrir direto na aba DISPLAY ao clicar no icone.
  cardTab: extCardTab, onSetCardTab: extSetCardTab,
}) {
  const { t } = useBfI18n();
  const [intSelectedSw, setIntSelectedSw] = useState(null);  // 1..N ou null
  const isControlled = extSelectedSw !== undefined && typeof extSetSelectedSw === 'function';
  const selectedSw = isControlled ? extSelectedSw : intSelectedSw;
  const setSelectedSw = isControlled ? extSetSelectedSw : setIntSelectedSw;
  const [intCardTab, setIntCardTab] = useState('gear');      // 'gear' | 'display'
  const isCardTabControlled = extCardTab !== undefined && typeof extSetCardTab === 'function';
  const cardTab = isCardTabControlled ? extCardTab : intCardTab;
  const setCardTab = isCardTabControlled ? extSetCardTab : setIntCardTab;
  const [pickerOpen, setPickerOpen] = useState(false); // popup de selecao de modo
  // Clipboard pra COPY/PASTE entre SWs — { modeId, params, display } do SW
  // copiado. `display` carrega TUDO do visual (icon_id, mode text/icon,
  // sigla, cores ic_off/on, bg_off/on, br_off/on + sub-configs spin/stomp/
  // tap). Vive enquanto a pagina LIVE estiver aberta; perdido ao trocar de
  // page.
  const [swClipboard, setSwClipboard] = useState(null);
  const [copyFlash, setCopyFlash] = useState(false);
  const switches = Array.from({ length: presetCount }, (_, i) => i + 1);

  // Modo de um SW: o que estiver salvo, ou STOMP (fx1) como padrao quando
  // nada foi salvo ainda — SW nao configurado entra em STOMP (espelha o
  // default do firmware sw_modes=1,1,1,1,1,1). MUTE so quando explicito.
  const modeOf = (n) => swModes[n] || 'fx1';

  // Copia modo + params + DISPLAY (icone, cores, sigla, sub-configs) do
  // SW selecionado pro clipboard interno.
  const copyFromSelected = () => {
    if (selectedSw === null) return;
    const modeId = modeOf(selectedSw);
    if (modeId === 'mute') return;
    const params = (swParams && swParams[selectedSw] && swParams[selectedSw][modeId])
      ? swParams[selectedSw][modeId]
      : DEFAULT_SW_PARAMS(modeId);
    const display = (swDisplay && swDisplay[selectedSw])
      ? swDisplay[selectedSw]
      : DEFAULT_SW_DISPLAY();
    // Clona profundo pra desacoplar do state vivo do SW de origem.
    setSwClipboard({
      modeId,
      params:  JSON.parse(JSON.stringify(params)),
      display: JSON.parse(JSON.stringify(display)),
    });
    setCopyFlash(true);
    setTimeout(() => setCopyFlash(false), 800);
  };

  // Cola o clipboard no SW selecionado: troca modo + sobrescreve params
  // + sobrescreve display (icone + cores + sigla + sub-configs). Clipboard
  // legado (sem `display`) cai no caminho seguro: nao mexe no display do
  // destino (preserva o atual em vez de zerar).
  const pasteIntoSelected = () => {
    if (selectedSw === null || !swClipboard) return;
    onSetSwMode(selectedSw, swClipboard.modeId);
    onSetSwParam(selectedSw, swClipboard.modeId,
      JSON.parse(JSON.stringify(swClipboard.params)));
    if (swClipboard.display && onSetSwDisplay) {
      onSetSwDisplay(selectedSw,
        JSON.parse(JSON.stringify(swClipboard.display)));
    }
  };

  const selectSw = (n) => {
    setPickerOpen(false);
    // Clicar num SW no PRESET MODE alterna a app pra LIVE MODE automaticamente
    // — o SW preview e visivel em ambos os modos no desktop, e o editor do SW
    // so faz sentido em LIVE, entao a transicao e implicita.
    if (switchMode === 'preset' && onSetSwitchMode) onSetSwitchMode('live');
    if (selectedSw === n) return;  // re-clicar no SW ativo mantem o card aberto
    setSelectedSw(n);
    setCardTab('gear');  // o card sempre abre em modo engrenagem
  };

  // Modo do SW aberto — sempre definido (MUTE quando nada salvo).
  const currentMode = SW_MODES.find((m) => m.id === modeOf(selectedSw));

  return (
    <>
      {maybePortal(
      <div className="bf-card bf-sw-grid-card">
      <div className="bf-sw-row">
        {switches.map((n) => {
          const disp = (swDisplay && swDisplay[n]) || DEFAULT_SW_DISPLAY();
          const ledOn = Array.isArray(swLiveOn) ? !!swLiveOn[n - 1] : false;
          const activeMode = modeOf(n);
          const modeEntry = SW_MODES.find((m) => m.id === activeMode);
          const modeLabel = (modeEntry && modeEntry.title) || activeMode.toUpperCase();
          // Cor do LED do modo ativo (campo `color` nos params do modo).
          // Se nao tem params salvos, usa o default do modo. mute = OFF.
          let ledColorId = 14;  // OFF default
          if (activeMode !== 'mute') {
            const params = (swParams && swParams[n] && swParams[n][activeMode])
              || DEFAULT_SW_PARAMS(activeMode);
            if (params && typeof params.color === 'number') ledColorId = params.color;
          }
          const ledColorHex = (LED_COLORS[ledColorId] || LED_COLORS[14]).hex;
          // Para SPIN, passa o spinState atual (0/1/2 ou -1 awaiting) pra
          // o tile pintar com a cor do estado correto. Outros modos usam
          // on/off do swLiveOn como sempre.
          const spinStateForTile = activeMode === 'spin' && Array.isArray(swSpinState)
            ? swSpinState[n - 1] : null;
          return (
            <button
              key={n}
              type="button"
              className={'bf-sw-btn bf-sw-btn-tile' + (selectedSw === n ? ' is-active' : '')}
              onClick={() => selectSw(n)}
            >
              <SwDisplayTile disp={disp} on={ledOn} spinState={spinStateForTile} size={120} />
              <span className="bf-sw-btn-info-line">
                SW · {n} ·
                <span
                  className="bf-sw-btn-info-dot"
                  style={{ background: ledColorHex }}
                  aria-label={`LED ${ledColorHex}`}
                />
              </span>
              <span className="bf-sw-btn-mode">{modeLabel}</span>
            </button>
          );
        })}
      </div>
      </div>
      , swGridTarget)}

      {selectedSw !== null && switchMode === 'live' && maybePortal(
        <div className="bf-sw-card">
          {/* Navegacao SW 1..N (SO MOBILE — no desktop o SwPreviewGrid da
              coluna direita ja faz a selecao). Botoes pequenos pra trocar o
              SW editado sem o grid de miniaturas. */}
          <div className="bf-sw-nav" role="tablist" aria-label="Selecionar SW">
            {switches.map((n) => (
              <button
                key={n}
                type="button"
                role="tab"
                aria-selected={selectedSw === n}
                className={'bf-sw-nav-btn' + (selectedSw === n ? ' is-active' : '')}
                onClick={() => setSelectedSw(n)}
                aria-label={`SW${n}`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="bf-sw-card-tabs" aria-label={t('sw.live.cardAria', { n: selectedSw })}>
            <div className="bf-sw-card-iconrow">
            <button
              type="button"
              role="tab"
              aria-selected={cardTab === 'gear'}
              className={'bf-sw-card-tab' + (cardTab === 'gear' ? ' is-active' : '')}
              onClick={() => setCardTab('gear')}
              aria-label={t('sw.live.settings')}
            >
              <svg viewBox="0 0 24 24" className="bf-tab-ico" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {/* Engrenagem (cog) — outline classico de configuracoes */}
                <circle className="bf-tab-shape" cx="12" cy="12" r="3" />
                <path className="bf-tab-shape" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            {/* Aba DISPLAY (edicao de icone) — SO DESKTOP. No MOBILE foi
                substituida pela miniatura do icone a direita (.bf-sw-icon-thumb),
                que ao ser clicada abre as mesmas opcoes (cardTab='display'). */}
            {isDesktop && (
            <button
              type="button"
              role="tab"
              aria-selected={cardTab === 'display'}
              className={'bf-sw-card-tab' + (cardTab === 'display' ? ' is-active' : '')}
              onClick={() => setCardTab('display')}
              aria-label="Display"
            >
              <svg viewBox="0 0 24 24" className="bf-tab-ico" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {/* Monitor com EQ bars — mesmo icone da aba DISPLAY do preset */}
                <rect className="bf-tab-shape" x="2.5" y="4.5" width="19" height="12" rx="1.6" />
                <rect className="bf-tab-dot" x="6"  y="11" width="1.6" height="3.5" />
                <rect className="bf-tab-dot" x="9"  y="9"  width="1.6" height="5.5" />
                <rect className="bf-tab-dot" x="12" y="7"  width="1.6" height="7.5" />
                <rect className="bf-tab-dot" x="15" y="10" width="1.6" height="4.5" />
                <rect className="bf-tab-dot" x="18" y="12" width="1.6" height="2.5" />
                <path className="bf-tab-shape" d="M9 21h6 M12 16.5v4.5" />
              </svg>
            </button>
            )}
            {/* COPY / PASTE — coluna estreita com 2 botoes empilhados,
                mesma largura dos icones de aba mas cada um com metade da
                altura. Permite copiar a config inteira (modo + params) de
                um SW e colar em outro. */}
            <div className="bf-sw-card-copypaste">
              <button
                type="button"
                className={'bf-sw-card-cp bf-sw-card-cp-copy' +
                           (copyFlash ? ' is-flash' : '')}
                onClick={copyFromSelected}
                disabled={modeOf(selectedSw) === 'mute'}
                title={t('sw.live.copyTitle')}
                aria-label={t('sw.live.copyAria')}
              >
                <svg viewBox="0 0 24 24" className="bf-tab-ico"
                     strokeLinecap="round" strokeLinejoin="round"
                     aria-hidden="true">
                  {/* Icone clipboard duplicado: 2 retangulos sobrepostos */}
                  <rect className="bf-tab-shape" x="8" y="8" width="11" height="13" rx="2" />
                  <path className="bf-tab-shape" d="M16 8V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h1" />
                </svg>
              </button>
              <button
                type="button"
                className="bf-sw-card-cp bf-sw-card-cp-paste"
                onClick={pasteIntoSelected}
                disabled={!swClipboard}
                title={swClipboard
                  ? `${t('sw.live.pasteTitle')} (${swClipboard.modeId.toUpperCase()})`
                  : t('sw.live.pasteTitleEmpty')}
                aria-label={t('sw.live.pasteAria')}
              >
                <svg viewBox="0 0 24 24" className="bf-tab-ico"
                     strokeLinecap="round" strokeLinejoin="round"
                     aria-hidden="true">
                  {/* Icone clipboard com seta pra dentro */}
                  <path className="bf-tab-shape" d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  <rect className="bf-tab-shape" x="8" y="2" width="8" height="4" rx="1" />
                  <path className="bf-tab-shape" d="M12 11v6 M9 14l3 3 3-3" />
                </svg>
              </button>
            </div>
            </div>
            <button
              type="button"
              className="bf-sw-mode-field"
              onClick={() => setPickerOpen(true)}
              aria-label={t('sw.live.modeAria', { title: currentMode.title })}
            >
              <SwModeIcon id={modeOf(selectedSw)} />
              <span className="bf-sw-mode-field-name">{currentMode.title}</span>
            </button>
            {/* Miniatura do icone (SO MOBILE) — ancorada no canto sup. direito
                da area de abas. Clique -> abre as opcoes de edicao do icone
                (cardTab='display'), substituindo a aba DISPLAY do desktop. */}
            {!isDesktop && (
              <button
                type="button"
                className={'bf-sw-icon-thumb' + (cardTab === 'display' ? ' is-active' : '')}
                onClick={() => setCardTab('display')}
                aria-pressed={cardTab === 'display'}
                aria-label={`Editar icone do SW${selectedSw}`}
                title="Editar icone"
              >
                <SwDisplayTile
                  disp={(swDisplay && swDisplay[selectedSw]) || DEFAULT_SW_DISPLAY()}
                  on={Array.isArray(swLiveOn) ? !!swLiveOn[selectedSw - 1] : false}
                  spinState={modeOf(selectedSw) === 'spin' && Array.isArray(swSpinState)
                    ? swSpinState[selectedSw - 1] : null}
                  size={96}
                />
              </button>
            )}
          </div>

          <div className="bf-sw-card-body">
            {cardTab === 'gear' && (
              (modeOf(selectedSw) === 'fx1' || modeOf(selectedSw) === 'fx3') ? (
                <SwStompEditor
                  key={selectedSw}
                  sw={selectedSw}
                  params={(swParams && swParams[selectedSw] && swParams[selectedSw][modeOf(selectedSw)])
                    || DEFAULT_SW_PARAMS(modeOf(selectedSw))}
                  onChange={(patch) => onSetSwParam(selectedSw, modeOf(selectedSw), patch)}
                  ledPreviewLive={ledPreviewLive}
                  liveOn={Array.isArray(swLiveOn) ? swLiveOn[selectedSw - 1] : undefined}
                  presetCount={presetCount}
                />
              ) : modeOf(selectedSw) === 'fx2' ? (
                <SwFx2Editor
                  key={selectedSw}
                  sw={selectedSw}
                  params={(swParams && swParams[selectedSw] && swParams[selectedSw].fx2)
                    || DEFAULT_SW_PARAMS('fx2')}
                  onChange={(patch) => onSetSwParam(selectedSw, 'fx2', patch)}
                  ledPreviewLive={ledPreviewLive}
                  liveOn={Array.isArray(swLiveOn) ? swLiveOn[selectedSw - 1] : undefined}
                  presetCount={presetCount}
                />
              ) : modeOf(selectedSw) === 'momentary' ? (
                <SwMomentaryEditor
                  key={selectedSw}
                  sw={selectedSw}
                  params={(swParams && swParams[selectedSw] && swParams[selectedSw].momentary)
                    || DEFAULT_SW_PARAMS('momentary')}
                  onChange={(patch) => onSetSwParam(selectedSw, 'momentary', patch)}
                  ledPreviewLive={ledPreviewLive}
                />
              ) : modeOf(selectedSw) === 'macros' ? (
                <SwMacrosEditor
                  key={selectedSw}
                  sw={selectedSw}
                  params={(swParams && swParams[selectedSw] && swParams[selectedSw].macros)
                    || DEFAULT_SW_PARAMS('macros')}
                  onChange={(patch) => onSetSwParam(selectedSw, 'macros', patch)}
                  ledPreviewLive={ledPreviewLive}
                  liveOn={Array.isArray(swLiveOn) ? swLiveOn[selectedSw - 1] : undefined}
                />
              ) : modeOf(selectedSw) === 'tap_tempo' ? (
                <SwTapTempoEditor
                  key={selectedSw}
                  sw={selectedSw}
                  params={(swParams && swParams[selectedSw] && swParams[selectedSw].tap_tempo)
                    || DEFAULT_SW_PARAMS('tap_tempo')}
                  onChange={(patch) => onSetSwParam(selectedSw, 'tap_tempo', patch)}
                  ledPreviewLive={ledPreviewLive}
                />
              ) : modeOf(selectedSw) === 'single' ? (
                <SwSingleEditor
                  key={selectedSw}
                  sw={selectedSw}
                  params={(swParams && swParams[selectedSw] && swParams[selectedSw].single)
                    || DEFAULT_SW_PARAMS('single')}
                  onChange={(patch) => onSetSwParam(selectedSw, 'single', patch)}
                  ledPreviewLive={ledPreviewLive}
                  isActiveSingle={lastSingleSw === selectedSw - 1}
                />
              ) : modeOf(selectedSw) === 'ramp' ? (
                <SwRampEditor
                  key={selectedSw}
                  sw={selectedSw}
                  params={(swParams && swParams[selectedSw] && swParams[selectedSw].ramp)
                    || DEFAULT_SW_PARAMS('ramp')}
                  onChange={(patch) => onSetSwParam(selectedSw, 'ramp', patch)}
                  ledPreviewLive={ledPreviewLive}
                />
              ) : modeOf(selectedSw) === 'spin' ? (
                <SwSpinEditor
                  key={selectedSw}
                  sw={selectedSw}
                  params={(swParams && swParams[selectedSw] && swParams[selectedSw].spin)
                    || DEFAULT_SW_PARAMS('spin')}
                  onChange={(patch) => onSetSwParam(selectedSw, 'spin', patch)}
                  ledPreviewLive={ledPreviewLive}
                />
              ) : (
                <div className="bf-sw-card-empty">
                  SW{selectedSw} · {currentMode.title} — {t('sw.live.comingSoon')}
                </div>
              )
            )}
            {cardTab === 'display' && (
              <SwDisplayEditor
                sw={selectedSw}
                disp={(swDisplay && swDisplay[selectedSw]) || DEFAULT_SW_DISPLAY()}
                onChange={(next) => onSetSwDisplay && onSetSwDisplay(selectedSw, next)}
                swMode={modeOf(selectedSw)}
                swParams={swParams}
              />
            )}
          </div>
        </div>
      , portalTarget)}

      {pickerOpen && selectedSw !== null && ReactDOM.createPortal(
        <div className="bf-modal-backdrop" onClick={() => setPickerOpen(false)}>
          <div
            className="bf-modal"
            role="dialog"
            aria-label={t('sw.live.modeOpAria', { n: selectedSw })}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bf-modal-head">
              <span className="bf-modal-title">{t('sw.live.modeOpTitle', { n: selectedSw })}</span>
              <button
                type="button"
                className="bf-modal-close"
                onClick={() => setPickerOpen(false)}
                aria-label={t('common.close')}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M5 5 L19 19 M19 5 L5 19" />
                </svg>
              </button>
            </div>
            <div className="bf-sw-mode-grid">
              {SW_MODES.filter((m) => !m.hidden).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={'bf-sw-mode' + (modeOf(selectedSw) === m.id ? ' is-active' : '')}
                  onClick={() => { onSetSwMode(selectedSw, m.id); setPickerOpen(false); }}
                >
                  <SwModeIcon id={m.id} />
                  <span className="bf-sw-mode-title">{m.title}</span>
                  <span className="bf-sw-mode-sub">{m.sub}</span>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// Descricao curta (PT) do que cada MODO de SW faz — mostrada no dashboard de
// resumo em vez do MIDI cru. Chave = id do modo (SW_MODES).
const SW_MODE_DESC = {
  fx1:       'Liga e desliga efeitos a cada toque.',
  fx2:       'Stomp duplo: duas seções liga/desliga.',
  fx3:       'Stomp triplo: três seções liga/desliga.',
  spin:      'Cicla entre até 3 estados a cada toque.',
  ramp:      'Varre um valor gradualmente entre mín e máx.',
  momentary: 'Pulso momentâneo a cada toque (ON/OFF).',
  macros:    'Dispara um grupo de comandos de uma vez.',
  tap_tempo: 'Marca o tempo (tap) com os toques.',
  single:    'Disparo único de comandos.',
  favorite:  'Carrega um banco/preset alvo.',
  mute:      'Sem função.',
};

// ─── PRESET DASHBOARD ───────────────────────────────────────────────
// Resumo (somente leitura) de cada footswitch do preset. Em PRESET mode,
// abaixo do card MAIN. Usa o estado de TRABALHO (swModes/swParams), entao
// reflete edicoes ainda NAO salvas. Mostra so a DESCRICAO do modo configurado
// (sem detalhes MIDI), com a cor do LED como destaque.
function PresetDashboard({ swModes, swParams, swLiveOn, presetCount, swDisplay, swSpinState, onSelectSw, onEditIcon }) {
  const clickable = typeof onSelectSw === 'function';
  const iconClickable = typeof onEditIcon === 'function';
  const count = Math.min(Number(presetCount) || 6, 6);
  const cards = Array.from({ length: count }, (_, i) => {
    const sw = i + 1;
    const id = (swModes && swModes[sw]) || 'fx1';
    const params = swParams && swParams[sw] && swParams[sw][id];
    const modeLabel = (SW_MODES.find((m) => m.id === id) || {}).title || id.toUpperCase();
    // Cor de destaque = cor do LED do modo ativo (mesma logica do preview).
    let colorId = 14;
    if (id !== 'mute' && params && typeof params.color === 'number') colorId = params.color;
    const accent = (LED_COLORS[colorId] || LED_COLORS[14]).hex;
    const isOn = Array.isArray(swLiveOn) ? !!swLiveOn[i] : false;
    // Miniatura do icone configurado (mesma logica do studioTiles): usa o
    // swDisplay real + estado SPIN. Renderizada so no MOBILE (CSS esconde no
    // desktop, onde o SwPreviewGrid ja mostra os icones).
    const disp = (swDisplay && swDisplay[sw]) || DEFAULT_SW_DISPLAY();
    const spinStateForTile = id === 'spin' && Array.isArray(swSpinState)
      ? swSpinState[sw - 1] : null;
    return { sw, id, modeLabel, accent, isOn, disp, spinStateForTile };
  });
  return (
    <section className="bf-preset-dash">
      <div className="bf-preset-dash-grid">
        {cards.map((c) => {
          // Conteudo da zona principal: SW# no topo, estado "(ON)"/"(OFF)" e
          // o nome do modo embaixo, empilhados (layout do mock). O icone fica
          // ancorado no topo-direito (absoluto via CSS), na mesma linha do SW#.
          const mainInner = (
            <>
              {/* Zona superior (SW#) — fica a esquerda do icone (topo-direito),
                  com altura minima pra empurrar o nome do modo pra baixo dele. */}
              <span className="bf-preset-dash-top">
                <span className="bf-preset-dash-sw">SW{c.sw}</span>
              </span>
              {/* Nome do modo: cor do LED quando ON, neutro (preto/cinza) quando
                  OFF — espelha o feedback do preview. */}
              <p className={'bf-preset-dash-mode-name' + (c.isOn ? ' is-on' : ' is-off')}>
                {c.modeLabel}
              </p>
            </>
          );
          return (
          <div key={c.sw}
            className="bf-preset-dash-card"
            style={{ '--dash-accent': c.accent }}>
            <span className="bf-preset-dash-accent" aria-hidden="true" />
            {/* Zona principal: SW# + estado + modo. Clique -> editor (aba
                CONFIG). E um <button> irmao do botao do icone (nunca aninhados). */}
            {clickable ? (
              <button type="button"
                className="bf-preset-dash-main is-clickable"
                onClick={() => onSelectSw(c.sw)}
                title={`Editar SW${c.sw}`}
                aria-label={`Editar SW${c.sw} — ${c.modeLabel}`}>
                {mainInner}
              </button>
            ) : (
              <div className="bf-preset-dash-main">{mainInner}</div>
            )}
            {/* Miniatura do icone (so MOBILE via CSS). Clique -> editor na aba
                DISPLAY (edicao de icone). Botao irmao do principal. */}
            {iconClickable ? (
              <button type="button"
                className="bf-preset-dash-icon is-clickable"
                onClick={() => onEditIcon(c.sw)}
                title={`Editar icone do SW${c.sw}`}
                aria-label={`Editar icone do SW${c.sw}`}>
                <SwDisplayTile disp={c.disp} on={c.isOn} spinState={c.spinStateForTile} size={48} />
              </button>
            ) : (
              <div className="bf-preset-dash-icon" aria-hidden="true">
                <SwDisplayTile disp={c.disp} on={c.isOn} spinState={c.spinStateForTile} size={48} />
              </div>
            )}
          </div>
          );
        })}
      </div>
    </section>
  );
}

function PagePresetConfig({
  onOpenWifi,
  bankLetterIndex, presetNumber, bankData, bankDisplayName, bankState, deviceState,
  usbState, onToggleUsb,
  connectionMode, onToggleConnectionMode,
  presetCount, onNextLetter, onPrevLetter, onSelectPreset, onDisplayNameChange,
  onRegisterPresetSave,
  switchMode, onSetSwitchMode, modeSync, onToggleModeSync,
  systemTheme, onToggleTheme,
  swModes, savedSwModes, onSetSwMode,
  swParams, savedSwParams, onSetSwParam, swLiveOn, lastSingleSw,
  swSpinState,
  swDisplay, onSetSwDisplay,
  ledPreviewLive,
  editorLayer, onSetEditorLayer, layer2Enabled,
  hasExtIndicators,
  presetReloadToken,
}) {
  const { t } = useBfI18n();
  const letters = BANK_LETTERS;
  const tag = `${letters[bankLetterIndex]}${presetNumber}`;
  // Placas 4S/MICRO (presetCount<=4): mostra os 6 botoes de preset sempre —
  // os excedentes (n>presetCount) ficam APAGADOS (escuros/off) e sem clique.
  // Mesma ideia dos tiles de SW (studioTiles).
  const presetSlotCount = presetCount <= 4 ? 6 : presetCount;
  const presets = Array.from({ length: presetSlotCount }, (_, i) => i + 1);

  // --tile-color e setado no nivel do .bf-screen (App.jsx) baseado no
  // banco/preset ativo — bank-tile e preset.is-active herdam dele.

  // Layout unificado: Studio redesign (mobile-first single-column) em
  // todos os viewports. O grid de 3 colunas que existia no desktop foi
  // descontinuado — desktop usa o mesmo fluxo Studio centralizado (com
  // max-width via CSS). isDesktop ainda existe pra ajustar pequenos
  // detalhes (ex: layer switch placement), mas nao gateia o render dos
  // componentes principais.
  const isDesktop = useMediaQuery('(min-width: 900px)');
  const [tabsSlot, setTabsSlot] = useState(null);
  const [paramsSlot, setParamsSlot] = useState(null);
  const [monitorSlot, setMonitorSlot] = useState(null);
  // Slot da COLUNA CENTRAL (desktop). O editor do SW (.bf-sw-card) do
  // LiveModePanel e portado pra ca em LIVE mode pra ocupar o meio do layout
  // de 3 colunas (tiles | center | swprev). No mobile o portalTarget e null
  // -> o editor cai inline embaixo (ordem mobile preservada).
  const [centerSlot, setCenterSlot] = useState(null);

  // SW selecionado pro editor — state vivia em LiveModePanel; lifted pra ca
  // pra que o SwPreviewGrid (Studio redesign, mobile) compartilhe a selecao
  // e clicar nele abra o editor que o LiveModePanel monta. No desktop o
  // grid antigo (.bf-sw-grid-card no tabsSlot) continua sendo o clicavel —
  // LiveModePanel le/escreve via os mesmos props controlados.
  const [selectedSw, setSelectedSw] = useState(null);

  // Ao ENTRAR em LIVE mode no desktop sem nenhum SW selecionado, carrega o
  // SW1 por padrao pra a coluna central nao aparecer vazia. So dispara na
  // transicao (deps switchMode/isDesktop) e so quando cur === null, entao
  // uma deselecao manual posterior continua valendo ate trocar de modo.
  // Gated a desktop -> mobile (Studio: editor inline) fica inalterado.
  // Ao entrar em LIVE sem SW selecionado, carrega o SW1 por padrao. Antes era
  // gated a desktop; agora roda tambem no MOBILE porque o grid de miniaturas
  // foi removido la — o editor (com os botoes SW 1..N) so monta com um SW
  // selecionado, entao precisa de um default pra aparecer.
  useEffect(() => {
    if (switchMode === 'live') {
      setSelectedSw((cur) => (cur === null ? 1 : cur));
    }
  }, [switchMode, isDesktop]);

  // Nomes salvos dos presets do banco atual — usados SO no DESKTOP pra
  // rotular cada tile (no lugar do texto fixo "PRESET"). O preset ATIVO usa
  // bankDisplayName (ao vivo, reflete edicao nao salva); os demais vem deste
  // fetch. No mobile o rotulo continua "PRESET" (este efeito nem roda).
  // Re-busca ao trocar a letra do banco ou apos paste (presetReloadToken).
  const [presetNames, setPresetNames] = useState({});
  useEffect(() => {
    if (!isDesktop) return;
    if (!DEVICE_API && !_transport.usbConnected) return;
    let cancelled = false;
    (async () => {
      const letter = letters[bankLetterIndex];
      const names = {};
      for (let n = 1; n <= presetSlotCount; n++) {
        const ptag = `${letter}${n}`;
        try {
          const json = await apiCall('GET', `/bank/preset?bank=${encodeURIComponent(ptag)}`);
          names[n] = (json && json.meta && json.meta.name) ? json.meta.name : '';
        } catch { names[n] = ''; }
        if (cancelled) return;
      }
      if (!cancelled) setPresetNames(names);
    })();
    return () => { cancelled = true; };
  }, [bankLetterIndex, isDesktop, presetSlotCount, presetReloadToken]);

  // Captura meta + update do PresetEditorCard via o handle de registro pra
  // que o NowPlayingCard (Studio mobile) absorva os campos PC + CANAL +
  // NOME do preset (que antes so existiam na aba PRESET do PARAMETROS).
  // Em PRESET mode tem PresetEditorCard montado -> meta vem; em LIVE mode
  // o card nao monta e meta volta a null (pills caem pra "—" gracefully).
  const [presetMeta, setPresetMeta] = useState(null);
  const presetUpdateRef = useRef(null);
  const onRegisterPresetSaveLocal = useCallback((handle) => {
    if (handle && handle.meta && handle.update) {
      setPresetMeta(handle.meta);
      presetUpdateRef.current = handle.update;
    } else {
      setPresetMeta(null);
      presetUpdateRef.current = null;
    }
    if (onRegisterPresetSave) onRegisterPresetSave(handle);
  }, [onRegisterPresetSave]);
  const onPresetUpdate = useCallback((patch) => {
    if (presetUpdateRef.current) presetUpdateRef.current(patch);
  }, []);
  // LAYER 2 efetivo no editor (POR PRESET — meta.layer2). Em PRESET mode
  // vale a working copy (o icone L2 destrava o switch LAYER 1/2 antes
  // mesmo do SAVE); em LIVE (PresetEditorCard desmontado, presetMeta null)
  // cai pro flag do preset ativo vindo do App. O reset do editorLayer pra
  // 1 quando o flag desliga vive num effect do App (via registerPresetSave).
  const layer2On = presetMeta ? !!presetMeta.layer2 : layer2Enabled;
  const onToggleLayer2 = presetMeta
    ? () => onPresetUpdate({ layer2: !presetMeta.layer2 })
    : null;
  const extIndicOn = presetMeta ? presetMeta.extIndicEnabled !== false : true;
  const onToggleExtIndic = presetMeta
    ? () => onPresetUpdate({ extIndicEnabled: !extIndicOn })
    : null;
  // Click no preview Studio (mobile): se estamos em PRESET mode, alterna pra
  // LIVE — mesmo comportamento do selectSw interno do LiveModePanel.
  // Aba do editor do SW (gear/display) — lifted pra ca igual ao selectedSw,
  // pra que o PresetDashboard (mobile) consiga abrir direto na aba DISPLAY
  // ao clicar no icone do SW (atalho pra edicao de icone).
  const [editorTab, setEditorTab] = useState('gear');
  const selectSwFromPreview = useCallback((n) => {
    if (switchMode === 'preset' && onSetSwitchMode) onSetSwitchMode('live');
    // Re-clicar no SW JA ativo nao fecha o card de configuracoes — apenas
    // seleciona (nunca volta a null). Mantem o editor sempre visivel.
    setSelectedSw(n);
    setEditorTab('gear');  // corpo do card -> abre em CONFIGURACOES
  }, [switchMode, onSetSwitchMode]);
  // Atalho do icone no PresetDashboard (mobile): vai pra LIVE, seleciona o
  // SW e abre direto a aba DISPLAY (onde mora o picker de icone).
  const editSwIcon = useCallback((n) => {
    if (switchMode === 'preset' && onSetSwitchMode) onSetSwitchMode('live');
    setSelectedSw(n);
    setEditorTab('display');
  }, [switchMode, onSetSwitchMode]);

  // Tiles pro SwPreviewGrid no mobile — usa SwDisplayTile (icone real do
  // swDisplay) com a sigla renderizada DENTRO do tile. A grade Studio e
  // sempre compacta (sem rodape externo — ver SwPreviewGrid), entao a
  // sigla NAO pode ser suprimida: no modo TEXT ela e o proprio conteudo do
  // tile, no modo ICON aparece abaixo do icone. Cor do LED vem do params
  // do modo ativo (igual ao calculo do bf-sw-grid-card no LiveModePanel).
  // Placas de 4 switches (4S/MICRO, presetCount<=4): em vez de ESCONDER os
  // SW5/SW6, mostra os 6 tiles sempre — os excedentes (n>presetCount) vem
  // PINTADOS DE PRETO e sem clique (disabled). Espelha boardIsFourSwitch do
  // firmware (que so omite o feedback visual desses SWs).
  const gridSwCount = presetCount <= 4 ? 6 : presetCount;
  const studioTiles = Array.from({ length: gridSwCount }, (_, idx) => {
        const n = idx + 1;
        // SW alem do que a placa expoe -> miniatura preta, nao clicavel.
        if (n > presetCount) {
          const blackSize = isDesktop ? 100 : 92;
          const blackNode = (
            <div className="bf-sw-tile bf-sw-tile-blackout" style={{
              width: blackSize + 'px', height: blackSize + 'px',
              background: '#000', borderColor: 'rgba(255,255,255,0.10)',
              borderWidth: '2px', borderStyle: 'solid',
            }} />
          );
          return { sw: n, sigla: `SW${n}`, modeLabel: '', color: '#3a3a40', on: false, iconNode: blackNode, disabled: true };
        }
        const disp = (swDisplay && swDisplay[n]) || DEFAULT_SW_DISPLAY();
        const sigla = String(disp.sigla || '').trim();
        // SW nao configurado -> STOMP (fx1) por padrao (espelha modeOf).
        const activeMode = (swModes && swModes[n]) || 'fx1';
        const modeEntry = SW_MODES.find((m) => m.id === activeMode);
        const modeLabel = (modeEntry && modeEntry.title) || activeMode.toUpperCase();
        const ledOn = Array.isArray(swLiveOn) ? !!swLiveOn[n - 1] : false;
        let ledColorId = 14; // OFF default
        if (activeMode !== 'mute') {
          const p = (swParams && swParams[n] && swParams[n][activeMode])
            || DEFAULT_SW_PARAMS(activeMode);
          if (p && typeof p.color === 'number') ledColorId = p.color;
        }
        const ledColorHex = (LED_COLORS[ledColorId] || LED_COLORS[14]).hex;
        const spinStateForTile = activeMode === 'spin' && Array.isArray(swSpinState)
          ? swSpinState[n - 1] : null;
        // Mantem a sigla DENTRO do tile (a grade Studio e compacta, sem
        // rodape externo): no modo TEXT a sigla e o conteudo do tile, no
        // modo ICON aparece abaixo do icone — igual ao preview do editor.
        const tileDisp = { ...disp };
        // No DESKTOP o preview vive na coluna da direita do layout de 3
        // colunas — icones (100) pra casar visualmente com os presets
        // da esquerda. No MOBILE mantem 92 (grade 3+3 compacta — inalterado).
        const iconNode = (
          <SwDisplayTile disp={tileDisp} on={ledOn} spinState={spinStateForTile} size={isDesktop ? 100 : 92} />
        );
        return {
          sw: n,
          sigla: sigla || `SW${n}`,
          modeLabel,
          color: ledColorHex,
          on: ledOn || spinStateForTile !== null,
          iconNode,
        };
      });

  // Toggle PRESET MODE / LIVE MODE (+ botao sync). No desktop sobe pro
  // centro do header (centerSlot do PageHeader); no mobile fica no topo da
  // coluna de params, como antes.
  const modeSwitchEl = (
    <div className="bf-mode-switch-wrap">
      <div className="bf-seg bf-mode-switch">
        <button
          className={switchMode === 'live' ? '' : 'is-active'}
          onClick={() => onSetSwitchMode && onSetSwitchMode('preset')}
        >{t('preset.modePreset')}</button>
        <button
          className={switchMode === 'live' ? 'is-active' : ''}
          onClick={() => onSetSwitchMode && onSetSwitchMode('live')}
        >{t('preset.modeLive')}</button>
      </div>
      <button
        type="button"
        className={'bf-mode-sync' + (modeSync ? ' is-active' : '')}
        onClick={() => onToggleModeSync && onToggleModeSync()}
        aria-pressed={modeSync}
        aria-label={`Sync PRESET/LIVE com a controladora: ${modeSync ? 'ligado' : 'desligado'}`}
        title={modeSync
          ? 'Sync ON — alternar aqui troca o modo na controladora'
          : 'Sync OFF — alternar aqui nao troca o modo na controladora'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none"
             stroke="currentColor" strokeWidth="2.2"
             strokeLinecap="round" strokeLinejoin="round">
          {modeSync ? (
            <>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </>
          ) : (
            <>
              <path d="M9.5 13.5 L13 17 a4 4 0 0 1-5.66 0 a4 4 0 0 1 0-5.66 L9 9.5" />
              <path d="M14.5 10.5 L11 7 a4 4 0 0 1 5.66 0 a4 4 0 0 1 0 5.66 L15 14.5" />
              <path d="M4 4 L20 20" />
            </>
          )}
        </svg>
      </button>
    </div>
  );

  // LAYER 1 / LAYER 2 — escolhe qual conjunto de funcoes (modo + params +
  // display por SW) esta sendo editado. So habilitado com Layer 2 ligado
  // NO PRESET (icone L2 do card PRINCIPAL). No desktop fica no topo da
  // col-2 (acima de params); no mobile no topo da col-3 (acima do monitor).
  const layerSwitchEl = (
    <div className="bf-mode-switch-wrap bf-layer-switch-wrap">
      <div className="bf-seg bf-mode-switch bf-layer-switch">
        <button
          className={editorLayer === 1 ? 'is-active' : ''}
          onClick={() => onSetEditorLayer && onSetEditorLayer(1)}
          title={t('sw.aria.editLayer1')}
        >LAYER 1</button>
        <button
          className={editorLayer === 2 ? 'is-active' : ''}
          onClick={() => layer2On && onSetEditorLayer && onSetEditorLayer(2)}
          disabled={!layer2On}
          title={layer2On
            ? 'Edita o conjunto de funcoes do Layer 2'
            : 'Layer 2 desligado neste preset — ative no icone L2 do card PRINCIPAL'}
        >LAYER 2</button>
      </div>
    </div>
  );

  // Toggle PRESET/LIVE com o badge de LAYER central. Renderizado em DOIS
  // lugares: no centerSlot do header (visivel so no DESKTOP) e na linha
  // .bf-studio-toggle-row-top do corpo (visivel so no MOBILE). O CSS troca
  // a visibilidade por viewport — os dois compartilham o mesmo estado
  // (switchMode/editorLayer), entao clicar em qualquer um funciona igual.
  const modeToggleEl = (
    <StudioToggle
      value={switchMode}
      onChange={(v) => onSetSwitchMode && onSetSwitchMode(v)}
      optionA={{ value: 'preset', label: t('preset.modePreset') }}
      optionB={{ value: 'live',   label: t('preset.modeLive') }}
      ariaLabel="Modo de operacao: preset ou live"
      centerNode={
        <button
          type="button"
          className={'bf-studio-layer-badge'
            + (editorLayer === 2 ? ' is-l2' : '')
            + (layer2On ? '' : ' is-locked')}
          onClick={() => layer2On && onSetEditorLayer
            && onSetEditorLayer(editorLayer === 2 ? 1 : 2)}
          disabled={!layer2On}
          aria-label={layer2On
            ? `Layer ${editorLayer} — clique para trocar`
            : 'Layer 2 desligado neste preset — ative no icone L2 do card PRINCIPAL'}
          title={layer2On
            ? `Layer ${editorLayer} — trocar para ${editorLayer === 2 ? 1 : 2}`
            : 'Layer 2 desligado neste preset — ative no icone L2 do card PRINCIPAL'}
        >{editorLayer}</button>
      }
    />
  );

  return (
    <div className="bf-content bf-content-bank" key="bank">
      <PageHeader
        title={t('preset.title')}
        onOpenWifi={onOpenWifi}
        deviceState={deviceState}
        usbState={usbState}
        onToggleUsb={onToggleUsb}
        connectionMode={connectionMode}
        onToggleConnectionMode={onToggleConnectionMode}
        systemTheme={systemTheme}
        onToggleTheme={onToggleTheme}
        centerSlot={modeToggleEl}
      />

      <div className="bf-bank-col bf-bank-col-1">
      <div className="bf-bank-row">
        {/* Tile de banco: toque no corpo AVANÇA a letra; o sub-botão ◀◀ na
            base VOLTA. Div com role=button (e não <button>) porque HTML não
            permite botão aninhado — o ◀◀ é um <button> real dentro dele. */}
        <div
          role="button"
          tabIndex={0}
          className={'bf-bank-tile' + (bankState === 'loading' ? ' is-loading' : bankState === 'error' ? ' is-error' : '')}
          onClick={onNextLetter}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNextLetter(); }
          }}
          aria-label={`Bank ${letters[bankLetterIndex]} (${tag}) — toque para avançar a letra`}
          title={`${tag} · ${bankState === 'loading' ? 'LOADING' : bankState === 'error' ? 'ERROR' : 'LOADED'}`}
        >
          <span className="led" />
          <span className="letter">{letters[bankLetterIndex]}</span>
          <button
            type="button"
            className="bf-bank-back"
            onClick={(e) => { e.stopPropagation(); if (onPrevLetter) onPrevLetter(); }}
            aria-label="Voltar letra do banco"
            title="Banco anterior"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
              <path d="M12.5 12 L21 6.6 v10.8 Z" />
              <path d="M3.5 12 L12 6.6 v10.8 Z" />
            </svg>
          </button>
        </div>
        {presets.map((n) => {
          // 4S/MICRO: preset 5/6 fica apagado (n>presetCount), sem clique.
          const presetDisabled = n > presetCount;
          // DESKTOP: rotula com o nome salvo do preset (ativo = ao vivo via
          // bankDisplayName; demais = presetNames do fetch). Mobile: "PRESET".
          const savedName = isDesktop
            ? (n === presetNumber
                ? (bankDisplayName && bankDisplayName.trim())
                : (presetNames[n] && presetNames[n].trim()))
            : '';
          return (
          <button
            key={n}
            type="button"
            className={'bf-preset' + (n === presetNumber ? ' is-active' : '') + (presetDisabled ? ' is-disabled' : '')}
            onClick={() => { if (!presetDisabled) onSelectPreset(n); }}
            disabled={presetDisabled}
            aria-disabled={presetDisabled}
          >
            <span className="led" />
            <span className="num">{n}</span>
            <span className="label" title={savedName || 'PRESET'}>{savedName || 'PRESET'}</span>
          </button>
          );
        })}
      </div>
      {/* Studio redesign — render em TODOS os viewports (desktop + mobile).
          Card "Tocando agora" + LAYER switch + grid de preview dos SWs.
          O toggle PRESET/LIVE agora vive ACIMA do NowPlayingCard (linha
          dedicada, igual referencia visual). */}
      <>
          <div className="bf-studio-toggle-row bf-studio-toggle-row-top">
            {modeToggleEl}
          </div>
          {switchMode === 'preset' && (
          <div className="bf-bank-center-stack">
          <NowPlayingCard
            tag={tag}
            displayName={bankDisplayName}
            presetCount={presetCount}
            cardTitle={t('bank.nowplaying')}
            i18n={{
              layerSwitch: (n) => t('bank.layerSwitch', { n }),
              layer2On: t('bank.layer2On'),
              layer2Off: t('bank.layer2Off'),
              extIndicLabel: t('bank.extIndicLabel'),
              extIndicHint: t('bank.extIndicHint'),
              extIndicOn: t('bank.extIndicOn'),
              extIndicOff: t('bank.extIndicOff'),
              displayConfigAria: t('bank.displayConfigAria'),
              displayConfigTitle: t('bank.displayConfigTitle'),
              addExtraPc: t('bank.addExtraPc'),
              addExtraLimit: t('bank.addExtraLimit'),
              nameAria: t('bank.nameAria'),
              pcAria: t('bank.pcAria'),
              chAria: t('bank.chAria'),
              channelLabel: t('common.channel'),
              removeMainAria: t('bank.removeMainAria'),
              removeMainTitle: t('bank.removeMainTitle'),
              extraPcAria: (n) => t('bank.extraPcAria', { n }),
              extraChAria: (n) => t('bank.extraChAria', { n }),
              removeExtraAria: (n) => t('bank.removeExtraAria', { n }),
              removeExtraTitle: t('bank.removeExtraTitle'),
              extraCcAria: (n) => t('bank.extraCcAria', { n }),
              extraCcChAria: (n) => t('bank.extraCcChAria', { n }),
              extraTypeToCc: t('bank.extraTypeToCc'),
              extraTypeToPc: t('bank.extraTypeToPc'),
              extraTypeLimitCc: t('bank.extraTypeLimitCc'),
              extraTypeLimitPc: t('bank.extraTypeLimitPc'),
              extraCcValAria: (n) => t('bank.extraCcValAria', { n }),
              extraCcValTitle: t('bank.extraCcValTitle'),
            }}
            editorLayer={editorLayer}
            onSetEditorLayer={onSetEditorLayer}
            layer2Enabled={layer2On}
            onToggleLayer2={onToggleLayer2}
            hasExtIndicators={hasExtIndicators}
            extIndicEnabled={extIndicOn}
            onToggleExtIndic={onToggleExtIndic}
            switchMode={switchMode}
            onSetSwitchMode={onSetSwitchMode}
            pcValue={presetMeta ? presetMeta.bank : null}
            channelValue={presetMeta ? presetMeta.channel : null}
            onPcChange={presetMeta
              ? (v) => onPresetUpdate({ bank: clamp(Number(v), 0, 600) })
              : null}
            onChannelChange={presetMeta
              ? (v) => onPresetUpdate({ channel: Number(v) })
              : null}
            pcOptions={presetMeta
              ? midiOptionElems(PC_VALUES_601, 'pc', presetMeta.bank, presetMeta.channel)
              : null}
            channelOptions={presetMeta ? channelOptionElems() : null}
            nameValue={presetMeta ? presetMeta.name : ''}
            onNameChange={presetMeta
              ? (v) => onPresetUpdate({ name: String(v).slice(0, 16) })
              : null}
            extras={presetMeta ? [
              // PCs primeiro, CCs depois — mesma ordem em que o firmware
              // dispara no apply (swBankSendHeaderMidi: extra_pcs -> extra_ccs).
              // Linhas CC enviam VALOR FIXO (toggle ON=127/OFF=0 no card).
              ...(Array.isArray(presetMeta.extraPcs) ? presetMeta.extraPcs : [])
                .map((p, i) => ({ type: 'pc', idx: i, ch: p.ch, program: p.program }))
                .filter((p) => p.ch !== 0),
              ...(Array.isArray(presetMeta.extraCcs) ? presetMeta.extraCcs : [])
                .map((c, i) => ({ type: 'cc', idx: i, ch: c.ch, ctrl: c.ctrl, value: c.value }))
                .filter((c) => c.ch !== 0),
            ] : []}
            canAddExtra={presetMeta
              ? ((presetMeta.extraPcs || []).some((p) => p.ch === 0)
                || (presetMeta.extraCcs || []).some((c) => c.ch === 0))
              : false}
            canExtraToCc={presetMeta
              ? (presetMeta.extraCcs || []).some((c) => c.ch === 0)
              : false}
            canExtraToPc={presetMeta
              ? (presetMeta.extraPcs || []).some((p) => p.ch === 0)
              : false}
            onAddExtra={presetMeta ? () => {
              // "+" adiciona um PC extra enquanto houver slot; esgotados os
              // 4 PCs, cai pros 2 slots de CC extra (valor fixo ON=127).
              const pcs = (presetMeta.extraPcs || []).slice();
              const pcSlot = pcs.findIndex((p) => p.ch === 0);
              if (pcSlot >= 0) {
                pcs[pcSlot] = { ch: 1, program: 0 };
                onPresetUpdate({ extraPcs: pcs });
                return;
              }
              const ccs = (presetMeta.extraCcs || []).slice();
              const ccSlot = ccs.findIndex((c) => c.ch === 0);
              if (ccSlot < 0) return;
              ccs[ccSlot] = { ch: 1, ctrl: 0, value: 127 };
              onPresetUpdate({ extraCcs: ccs });
            } : null}
            onUpdateExtra={presetMeta ? (entry, patch) => {
              const key = entry.type === 'cc' ? 'extraCcs' : 'extraPcs';
              const list = (presetMeta[key] || []).slice();
              if (!list[entry.idx]) return;
              list[entry.idx] = { ...list[entry.idx], ...patch };
              // Trocou o CC de um extra CC: encaixa o valor salvo no range
              // rotulado do CC novo (Kemper/UAFX) — mesma regra dos editores
              // de SW (kemperSnapValue; no-op sem labels).
              if (entry.type === 'cc' && typeof patch.ctrl !== 'undefined') {
                list[entry.idx].value = kemperSnapValue(
                  list[entry.idx].value, list[entry.idx].ch, patch.ctrl);
              }
              onPresetUpdate({ [key]: list });
            } : null}
            onRemoveExtra={presetMeta ? (entry) => {
              // Convencao do firmware: ch=0 desativa o slot. Zera tambem os
              // demais campos pra evitar valor "fantasma" se reativar.
              const key = entry.type === 'cc' ? 'extraCcs' : 'extraPcs';
              const list = (presetMeta[key] || []).slice();
              if (!list[entry.idx]) return;
              list[entry.idx] = entry.type === 'cc'
                ? { ch: 0, ctrl: 0, value: 0 }
                : { ch: 0, program: 0 };
              onPresetUpdate({ [key]: list });
            } : null}
            onToggleExtraType={presetMeta ? (entry) => {
              // Converte o envio extra PC<->CC preservando canal e numero
              // (program<->ctrl, subset 0..127 dos dois lados). Precisa de
              // slot livre do tipo destino — o botao desabilita sem ele.
              // CC novo nasce ON (127); o patch atualiza os DOIS arrays num
              // unico update (evita render intermediario inconsistente).
              const pcs = (presetMeta.extraPcs || []).slice();
              const ccs = (presetMeta.extraCcs || []).slice();
              if (entry.type === 'cc') {
                const slot = pcs.findIndex((p) => p.ch === 0);
                if (slot < 0 || !ccs[entry.idx]) return;
                pcs[slot] = { ch: entry.ch, program: clamp(Number(entry.ctrl) || 0, 0, 127) };
                ccs[entry.idx] = { ch: 0, ctrl: 0, value: 0 };
              } else {
                const slot = ccs.findIndex((c) => c.ch === 0);
                if (slot < 0 || !pcs[entry.idx]) return;
                ccs[slot] = { ch: entry.ch, ctrl: clamp(Number(entry.program) || 0, 0, 127), value: 127 };
                pcs[entry.idx] = { ch: 0, program: 0 };
              }
              onPresetUpdate({ extraPcs: pcs, extraCcs: ccs });
            } : null}
            onRemoveMain={presetMeta ? () => {
              // Promove o primeiro extra ativo (ch !== 0) pra main slot:
              //   meta.bank / meta.channel <- first.program / first.ch
              //   first slot <- { ch:0, program:0 } (libera)
              // Nota: PC main aceita 0..600 (PC_VALUES_601); extra so 0..127
              //   (MIDI_VALUES_128). Promover de extra->main preserva o
              //   valor numerico (0..127), que e subset valido de 0..600.
              //   Inverso (main->extra) nao acontece aqui — main e sempre
              //   o "head" do trem.
              const list = (presetMeta.extraPcs || []).slice();
              const i = list.findIndex((p) => p && p.ch !== 0);
              if (i < 0) return;  // sem extras: nada a promover
              const first = list[i];
              list[i] = { ch: 0, program: 0 };
              onPresetUpdate({
                bank: clamp(Number(first.program) || 0, 0, 600),
                channel: Number(first.ch) || 0,
                extraPcs: list,
              });
            } : null}
            buildExtraPcOptions={(program, ch) =>
              midiOptionElems(MIDI_VALUES_128, 'pc', program, ch)}
            buildExtraCcOptions={(ctrl, ch) =>
              // allowSpecial=false: o header MIDI sai via send_midi_cc direto
              // (sem swCcOrSpecial), entao comandos de navegacao 128+ nao
              // fazem sentido aqui — e estourariam o &0x7F do firmware.
              midiOptionElems(MIDI_VALUES_128, 'cc', ctrl, ch, false)}
            buildExtraChannelOptions={() => channelOptionElems()}
            buildExtraCcValueOptions={(value, ch, cc) =>
              // Valor do CC extra: 0..127 cru, ou a lista rotulada quando o
              // canal resolve pra um pedal com labels de valor (Kemper/UAFX).
              kemperValueOptionElems(value, ch, cc)}
          >
            {/* Em PRESET mode: a aba TELA do PARAMETROS card sobe pra
                dentro do NowPlayingCard — visualmente 1 unico card.
                noFrame={true} -> sem wrapper proprio (.bf-preset-card-attached
                no app.css achata bordas/background). hidePresetTab esconde a
                aba PRESET (absorvida pelos pills PC/CANAL acima).
                hideExtrasTab esconde a aba EXTRAS (PC extras agora viram
                linhas extras via "+", e CCs extras foram eliminados). */}
            {switchMode === 'preset' && (
              <PresetEditorCard tag={tag} onDisplayNameChange={onDisplayNameChange}
                onRegisterSave={onRegisterPresetSaveLocal}
                savedSwModes={savedSwModes} savedSwParams={savedSwParams}
                reloadToken={presetReloadToken}
                paramsTarget={null} hidePresetTab hideExtrasTab noFrame />
            )}
          </NowPlayingCard>
          {/* Dashboard de resumo do preset — abaixo do MAIN em PRESET mode.
              Read-only. Desktop: preenche a coluna central e rola dentro.
              Mobile: card normal no fluxo, abaixo do MAIN. */}
          <PresetDashboard swModes={swModes} swParams={swParams} swLiveOn={swLiveOn} presetCount={presetCount} swDisplay={swDisplay} swSpinState={swSpinState} onSelectSw={selectSwFromPreview} onEditIcon={editSwIcon} />
          </div>
          )}
          {/* Preview dos 6 SWs (2 colunas x 3 linhas no desktop) — tambem e o
              seletor de SW pro editor. SO no DESKTOP (coluna da direita do
              layout de 3 colunas, nos dois modos). No MOBILE foi removido: em
              LIVE a selecao vem dos botoes SW 1..N no topo do editor
              (.bf-sw-nav); em PRESET o card de preset/dashboard ja cobre. */}
          {isDesktop && (
            <SwPreviewGrid
              tiles={studioTiles}
              selectedSw={selectedSw}
              onSelectSw={selectSwFromPreview}
              switchMode={switchMode}
              twoRows
            />
          )}
          {/* Slot da coluna CENTRAL (desktop): o editor do SW e portado pra ca
              em LIVE mode. Vazio (e escondido via :empty) em PRESET mode e no
              mobile (onde o editor renderiza inline embaixo). */}
          <div ref={setCenterSlot} className="bf-bank-slot bf-bank-slot-center" />
        </>

      <div ref={setTabsSlot} className="bf-bank-slot bf-bank-slot-tabs" />
      </div>

      <div className="bf-bank-col bf-bank-col-2">
      {/* No desktop o PRESET/LIVE sobe pro header e o LAYER vai pra col-1;
          a col-2 fica so com os PARAMETERS. No mobile o PRESET/LIVE agora
          vive dentro do NowPlayingCard (Studio redesign — refactor2), entao
          o modeSwitchEl nao e mais renderizado aqui. (O modeSync — toggle
          de chain — fica acessivel so no desktop por enquanto.) */}
      <div ref={setParamsSlot} className="bf-bank-slot bf-bank-slot-params" />
      </div>

      <div className="bf-bank-col bf-bank-col-3">
      {/* Slot de monitor — agora inline (sem portal). MonitorView renderiza
          aqui via flow normal. */}
      <div ref={setMonitorSlot} className="bf-bank-slot bf-bank-slot-monitor" />
      </div>

      {/* LiveModePanel — so renderiza em LIVE mode (em PRESET mode o grid
          antigo .bf-sw-grid-card foi substituido pelo SwPreviewGrid acima).
          DESKTOP: o editor do SW e portado pro slot CENTRAL (coluna do meio).
          MOBILE: portalTarget=null -> editor renderiza inline embaixo (ordem
          mobile preservada). */}
      {switchMode === 'live' && (
        <LiveModePanel presetCount={presetCount} swModes={swModes} onSetSwMode={onSetSwMode}
          swParams={swParams} onSetSwParam={onSetSwParam} ledPreviewLive={ledPreviewLive}
          swLiveOn={swLiveOn} lastSingleSw={lastSingleSw}
          swSpinState={swSpinState}
          swDisplay={swDisplay} onSetSwDisplay={onSetSwDisplay}
          swGridTarget={null}
          portalTarget={isDesktop ? centerSlot : null}
          switchMode={switchMode} onSetSwitchMode={onSetSwitchMode}
          selectedSw={selectedSw}
          onSetSelectedSw={setSelectedSw}
          cardTab={editorTab}
          onSetCardTab={setEditorTab}
          isDesktop={isDesktop} />
      )}
      {/* PresetEditorCard standalone removido — agora SEMPRE vive dentro do
          NowPlayingCard (noFrame) em PRESET mode. */}
    </div>
  );
}

// MONITOR persistente — comportamento depende do modo do app:
//   PRESET MODE -> mostra o snapshot da CHAMADA DE PRESET (header MIDI +
//                  lista dos modos dos SWs).
//   LIVE MODE   -> mostra o disparo MAIS RECENTE de um SW (eventos
//                  acumulam so dentro do mesmo press; o proximo press
//                  substitui o anterior).
// Formata uma mensagem MIDI estruturada em texto curto pra copia/share.
function formatMsgText(m) {
  const when = m.when ? `[${m.when}] ` : '';
  if (m.kind === 'pc') return `${when}PC ${m.pc} · CH ${m.ch}`;
  return `${when}CC ${m.num} = ${m.val} · CH ${m.ch}`;
}

// Monta o texto do MONITOR (PRESET) — usado pelo botao de copiar.
function buildPresetMonitorText(entry) {
  if (!entry) return '';
  const lines = [];
  lines.push(`[${entry.time}] ${entry.tag} - ${entry.name}`);
  lines.push(`HEADER = PC ${entry.pc} - CH ${entry.ch}`);
  (entry.extraPcs || []).forEach((pc) => {
    lines.push(`PC EXTRA ${pc.slot} = PC ${pc.program} - CH ${pc.ch}`);
  });
  (entry.extraCcs || []).forEach((cc) => {
    lines.push(`CC EXTRA ${cc.slot} = CC ${cc.ctrl} - VAL ${cc.value} - CH ${cc.ch}`);
  });
  (entry.swEntries || []).forEach((sw) => {
    lines.push('');
    lines.push(`SW-${sw.sw} ${sw.modeLabel}`);
    if (!sw.sections || sw.sections.length === 0) {
      lines.push('  (sem MIDI configurado)');
      return;
    }
    sw.sections.forEach((sec) => {
      const head = [sec.label, ...(sec.flags || [])].filter(Boolean).join(' · ');
      if (head) lines.push(`  ${head}`);
      (sec.messages || []).forEach((m) => lines.push(`    ${formatMsgText(m)}`));
    });
  });
  return lines.join('\n');
}

// Monta o texto do MONITOR (LIVE) — usado pelo botao de copiar.
function buildLiveMonitorText(events) {
  if (!events || events.length === 0) return '';
  const lines = [];
  events.forEach((ev) => {
    const parts = [`SW-${ev.sw}`, ev.modeLabel || 'STOMP'];
    if (ev.sectionLabel) parts.push(ev.sectionLabel);
    if (ev.on === true) parts.push('ON');
    else if (ev.on === false) parts.push('OFF');
    lines.push(parts.join(' · '));
    const msgs = Array.isArray(ev.messages) ? ev.messages : [];
    if (msgs.length === 0) {
      lines.push('  (nenhum MIDI disparado)');
    } else {
      msgs.forEach((m) => lines.push(`  ${formatMsgText(m)}`));
    }
  });
  return lines.join('\n');
}

function MonitorCopyButton({ getText }) {
  const { t } = useBfI18n();
  const [copied, setCopied] = React.useState(false);
  const onClick = async () => {
    const text = (getText() || '').trim();
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (e) { /* noop */ }
  };
  return (
    <button type="button"
            className={'bf-monitor-copy' + (copied ? ' is-copied' : '')}
            onClick={onClick}
            title={t('mon.copyHint')}>
      {copied ? t('mon.copied') : t('mon.copy')}
    </button>
  );
}

// MONITOR MIDI — popup unico, centralizado, com blur no fundo (igual aos
// pickers de cor). Renderiza SO o evento MAIS RECENTE (sem historico):
//   monitorKind === 'preset' -> snapshot da ultima CHAMADA DE PRESET
//   monitorKind === 'live'   -> ultimo DISPARO de SW ao vivo
// Independente do modo do app — imprime o que aconteceu por ultimo. Fecha
// pelo backdrop, pelo X ou (efeito) ESC, voltando ao app normalmente.
function MonitorView({ monitorKind, monitorEntry, liveEvents }) {
  const { t } = useBfI18n();
  const events = Array.isArray(liveEvents) ? liveEvents : [];
  const isLive = monitorKind === 'live';
  const subtitle = isLive ? t('mon.subLive') : t('mon.subPreset');
  const hasContent = isLive ? events.length > 0 : !!monitorEntry;
  const getCopyText = () =>
    isLive ? buildLiveMonitorText(events) : buildPresetMonitorText(monitorEntry);

  // ── Corpo: snapshot do preset ──
  const presetBody = (
    !monitorEntry ? (
      <div className="bf-monitor-empty">{t('mon.waitPreset')}</div>
    ) : (
      <>
        <div key={monitorEntry.tag + '@' + monitorEntry.time}
             className="bf-monitor-entry">
          <div className="bf-monitor-line">
            <span className="bf-monitor-time">{monitorEntry.time}</span>
            <span className="bf-monitor-tag">{monitorEntry.tag}</span>
            <span className="bf-monitor-sep">-</span>
            <span className="bf-monitor-name">{monitorEntry.name}</span>
          </div>
          <div className="bf-monitor-line bf-monitor-header">
            HEADER = PC {monitorEntry.pc} - CH {monitorEntry.ch}
          </div>
          {(monitorEntry.extraPcs || []).map((pc) => (
            <div key={'pc' + pc.slot}
                 className="bf-monitor-line bf-monitor-header">
              PC EXTRA {pc.slot} = PC {pc.program} - CH {pc.ch}
            </div>
          ))}
          {(monitorEntry.extraCcs || []).map((cc) => (
            <div key={'cc' + cc.slot}
                 className="bf-monitor-line bf-monitor-header">
              CC EXTRA {cc.slot} = CC {cc.ctrl} - VAL {cc.value} - CH {cc.ch}
            </div>
          ))}
        </div>
        <div className="bf-monitor-sw-list">
          {(monitorEntry.swEntries || []).map((entry, i) => (
            <div key={i} className="bf-monitor-ev">
              <div className="bf-monitor-ev-head">
                <span className="bf-monitor-ev-sw">SW-{entry.sw}</span>
                <span className="bf-monitor-ev-mode">{entry.modeLabel}</span>
              </div>
              {(!entry.sections || entry.sections.length === 0) ? (
                <div className="bf-monitor-ev-msg bf-monitor-ev-msg-empty">
                  {t('mon.noMidiCfg')}
                </div>
              ) : (
                entry.sections.map((sec, j) => (
                  <div key={j} className="bf-monitor-section">
                    {(sec.label || (sec.flags && sec.flags.length > 0)) && (
                      <div className="bf-monitor-section-head">
                        {sec.label && (
                          <span className="bf-monitor-ev-sec">{sec.label}</span>
                        )}
                        {(sec.flags || []).map((f, k) => (
                          <span key={k} className="bf-monitor-flag">{f}</span>
                        ))}
                      </div>
                    )}
                    <div className="bf-monitor-ev-msgs">
                      {(sec.messages || []).map((m, k) => (
                        <div key={k} className="bf-monitor-ev-msg">
                          {m.when && (
                            <span className="bf-msg-when">{m.when}</span>
                          )}
                          {m.kind === 'pc' ? (
                            <>
                              <span className="bf-msg-type is-pc">PC</span>
                              <span className="bf-msg-num">{m.pc}</span>
                              <span className="bf-msg-sep">·</span>
                              <span className="bf-msg-ch">CH {m.ch}</span>
                            </>
                          ) : (
                            <>
                              <span className="bf-msg-type is-cc">CC</span>
                              <span className="bf-msg-num">{m.num}</span>
                              <span className="bf-msg-eq">=</span>
                              <span className="bf-msg-val">{m.val}</span>
                              <span className="bf-msg-sep">·</span>
                              <span className="bf-msg-ch">CH {m.ch}</span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </>
    )
  );

  // ── Corpo: disparo de SW ao vivo ──
  const liveBody = (
    <div className="bf-monitor-events-section">
      {events.length === 0 ? (
        <div className="bf-monitor-event-empty">
          {t('mon.noTriggers')}
        </div>
      ) : (
        events.map((ev, i) => {
          const msgs = Array.isArray(ev.messages) ? ev.messages : [];
          return (
            <div key={i} className="bf-monitor-ev">
              <div className="bf-monitor-ev-head">
                <span className="bf-monitor-ev-sw">SW-{ev.sw}</span>
                <span className="bf-monitor-ev-mode">{ev.modeLabel || 'STOMP'}</span>
                {ev.sectionLabel && (
                  <span className="bf-monitor-ev-sec">{ev.sectionLabel}</span>
                )}
                {(ev.on === true || ev.on === false) && (
                  <span className={'bf-monitor-ev-state is-' + (ev.on ? 'on' : 'off')}>
                    {ev.on ? 'ON' : 'OFF'}
                  </span>
                )}
              </div>
              {msgs.length > 0 ? (
                <div className="bf-monitor-ev-msgs">
                  {msgs.map((m, j) => (
                    <div key={j} className="bf-monitor-ev-msg">
                      {m.kind === 'pc' ? (
                        <>
                          <span className="bf-msg-type is-pc">PC</span>
                          <span className="bf-msg-num">{m.pc}</span>
                          <span className="bf-msg-sep">·</span>
                          <span className="bf-msg-ch">CH {m.ch}</span>
                        </>
                      ) : m.kind === 'fav' ? (
                        <>
                          <span className="bf-msg-type is-fav">FAV</span>
                          <span className="bf-msg-num">{m.bank}{m.preset}</span>
                          <span className="bf-msg-sep">·</span>
                          <span className="bf-msg-ch">{m.mode}</span>
                        </>
                      ) : (
                        <>
                          <span className="bf-msg-type is-cc">CC</span>
                          <span className="bf-msg-num">{m.num}</span>
                          <span className="bf-msg-eq">=</span>
                          <span className="bf-msg-val">{m.val}</span>
                          <span className="bf-msg-sep">·</span>
                          <span className="bf-msg-ch">CH {m.ch}</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bf-monitor-ev-msg bf-monitor-ev-msg-empty">
                  {t('mon.noMidiFired')}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  // Inline (conteudo de card no SYSTEM > PRINCIPAL). Cabecalho compacto com
  // o tipo (PRESET/AO VIVO) + botao copiar; corpo rolavel.
  return (
    <div className="bf-monitor-inline">
      <div className="bf-monitor-inline-head">
        <span className={'bf-monitor-pop-sub' + (isLive ? ' is-live' : '')}>
          {subtitle}
        </span>
        {hasContent && <MonitorCopyButton getText={getCopyText} />}
      </div>
      <div className="bf-monitor-pop-body bf-monitor-inline-body">
        <div className="bf-live-monitor-body">
          {isLive ? liveBody : presetBody}
        </div>
      </div>
    </div>
  );
}

// ─── ImageEditor — modal canvas com crop + zoom + brightness + texto ──
//
// Crop: zoom (1.0..3.0) + pan (-1..+1 nos 2 eixos). A janela de crop tem
// SEMPRE o aspect do display alvo (targetWidth/Height) — usuario nunca
// consegue exportar com aspect errado.
//
// Brightness/Contrast: aplicados via ctx.filter (suporte amplo, sem JS).
//
// Texto: 1 caixa, posicao por sliders X/Y, cor por <input type=color>,
// 2 estilos (regular/bold), tamanho slider.
//
// SAVE: canvas final renderiza em targetWidth x targetHeight, exporta JPEG
// q=0.7. CANCEL: descarta. Source URL e revogada pelo caller (CardUploadImages).
// Fontes disponíveis pro texto sobreposto. O canvas "assa" o texto no JPEG de
// forma síncrona, então só fontes de SISTEMA (sempre prontas no browser) —
// nada de @font-face/webfont (renderizaria no fallback silenciosamente sem
// erro). `id` é o que persiste no estado do texto; `css` é a font-family.
const FONT_OPTIONS = [
  { id: 'sans',      label: 'Sans',      css: '"Segoe UI", "Inter", Arial, sans-serif' },
  { id: 'arial',     label: 'Arial',     css: 'Arial, Helvetica, sans-serif' },
  { id: 'verdana',   label: 'Verdana',   css: 'Verdana, Geneva, sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet', css: '"Trebuchet MS", Tahoma, sans-serif' },
  { id: 'georgia',   label: 'Georgia',   css: 'Georgia, "Times New Roman", serif' },
  { id: 'times',     label: 'Times',     css: '"Times New Roman", Georgia, serif' },
  { id: 'courier',   label: 'Courier',   css: '"Courier New", monospace' },
  { id: 'impact',    label: 'Impact',    css: 'Impact, "Arial Black", sans-serif' },
];
function fontCss(id) {
  const f = FONT_OPTIONS.find((x) => x.id === id);
  return f ? f.css : FONT_OPTIONS[0].css;
}
const MAX_TEXTS = 5;

function ImageEditor({ slot, sourceUrl, targetWidth, targetHeight, onCancel, onSave }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [imgReady, setImgReady] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const { t } = useBfI18n();

  // Estado do crop e ajustes. Defaults: imagem inteira centrada (zoom=1,
  // pan zero), brilho/contraste neutros, texto vazio.
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  // Múltiplos textos sobrepostos (até MAX_TEXTS). Cada item:
  //   { id, content, color, bold, outline, size, x, y, font }
  // x/y em 0..1 (centro do texto). activeTextId = qual item os controles
  // editam (e o último tocado por gesto). textIdRef gera ids estáveis.
  const [texts, setTexts] = useState([]);
  const [activeTextId, setActiveTextId] = useState(null);
  const textIdRef = useRef(0);
  const activeText = texts.find((tt) => tt.id === activeTextId) || null;
  const addText = () => {
    if (texts.length >= MAX_TEXTS) return;
    const id = ++textIdRef.current;
    setTexts((arr) => [...arr, {
      id, content: 'TEXTO', color: '#ffffff', bold: true, outline: true,
      size: Math.round(targetHeight * 0.18), x: 0.5, y: 0.5, font: FONT_OPTIONS[0].id,
    }]);
    setActiveTextId(id);
  };
  const updateActiveText = (patch) => setTexts((arr) =>
    arr.map((tt) => (tt.id === activeTextId ? { ...tt, ...patch } : tt)));
  const removeActiveText = () => {
    setTexts((arr) => arr.filter((tt) => tt.id !== activeTextId));
    setActiveTextId(null);
  };

  // Carrega a source. Quando imgReady, useEffect de render dispara.
  useEffect(() => {
    setImgReady(false);
    setImgError(false);
    const img = new Image();
    img.onload = () => { imgRef.current = img; setImgReady(true); };
    img.onerror = () => { setImgError(true); };
    img.src = sourceUrl;
  }, [sourceUrl]);

  // Render do preview canvas. Re-roda em qualquer mudanca de slider.
  useEffect(() => {
    if (!imgReady || !canvasRef.current || !imgRef.current) return;
    renderEditorCanvas(canvasRef.current, imgRef.current, {
      targetW: targetWidth, targetH: targetHeight,
      zoom, panX, panY, brightness, contrast, texts,
    });
  }, [imgReady, targetWidth, targetHeight,
      zoom, panX, panY, brightness, contrast, texts]);

  const handleSave = async () => {
    if (!canvasRef.current || busy) return;
    setBusy(true);
    setSaveErr('');
    try {
      // toBlob assincrono pra evitar travar UI em imagens grandes. q=0.7
      // bate com o budget de ~30KB definido em IMAGE_MAX_PER_FILE_BYTES.
      const blob = await new Promise((resolve, reject) => {
        canvasRef.current.toBlob(
          (b) => b ? resolve(b) : reject(new Error('toBlob retornou null')),
          'image/jpeg', 0.7);
      });
      await onSave(blob);
      // Sucesso: onSave fecha o editor (unmount) — nao resetar busy aqui.
    } catch (err) {
      // onSave RE-LANCA o erro de upload (quota/HTTP/timeout). Sem isto o
      // busy ficava preso em true e o modal travava no "SALVANDO…" (todos os
      // botoes de saida sao disabled={busy}).
      console.warn('save image failed', err);
      setSaveErr(String(err && err.message ? err.message : err));
      setBusy(false);
    }
  };

  // Aspect ratio do canvas pro CSS controlar o tamanho exibido. O canvas
  // mantem dimensoes intrinsecas targetW/H (output) mas o tamanho NA TELA
  // e responsivo via max-width:100% + aspect-ratio. Layout fica sempre
  // empilhado (preview em cima, controles embaixo) pra caber em mobile.
  const aspectStyle = `${targetWidth} / ${targetHeight}`;

  // Gestos no preview (Pointer Events + wheel): unifica mouse, toque e caneta.
  //   - Hit-test no PointerDown decide o alvo: o `id` do texto sob o ponteiro
  //     (topo primeiro) ou 'image'. Tocar num texto também o seleciona (ativo).
  //   - 1 ponteiro arrastando: pan (imagem) ou move o centro do texto alvo.
  //   - 2 ponteiros pinça: zoom de imagem (1..3x) ou tamanho do texto alvo.
  //   - Wheel (mouse): zoom in/out do alvo sob o cursor, hit-test por evento.
  // Estado vivo em ref pra não re-render por evento; valores comitam em
  // setZoom/setPanX/setPanY (imagem) ou setTexts (item alvo, por id).
  const previewRef = useRef(null);
  const gestureRef = useRef({ pointers: new Map(), start: null, target: null });

  // Mapeia coordenadas do cliente pra coordenadas internas do canvas.
  // Retorna null se o canvas nao esta visivel/montado.
  const clientToCanvas = (clientX, clientY) => {
    const c = canvasRef.current;
    if (!c) return null;
    const rect = c.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: (clientX - rect.left) * (c.width / rect.width),
      y: (clientY - rect.top) * (c.height / rect.height),
    };
  };

  // Hit-test dos textos desenhados: bbox aproximada centrada em (x*W, y*H).
  // Itera do TOPO pra baixo (último desenhado = mais acima) e retorna o `id`
  // do primeiro acertado, ou null. Largura ~= len*size*0.64, altura ~= size*1.4;
  // margem extra pra facilitar toque em mobile (~12 px de canvas).
  const hitTestTextId = (clientX, clientY) => {
    if (!canvasRef.current || texts.length === 0) return null;
    const c = canvasRef.current;
    const pt = clientToCanvas(clientX, clientY);
    if (!pt) return null;
    for (let i = texts.length - 1; i >= 0; i--) {
      const tt = texts[i];
      if (!tt.content) continue;
      const cx = tt.x * c.width;
      const cy = tt.y * c.height;
      const halfW = Math.max(tt.content.length * tt.size * 0.32, 24) + 12;
      const halfH = tt.size * 0.7 + 12;
      if (Math.abs(pt.x - cx) <= halfW && Math.abs(pt.y - cy) <= halfH) return tt.id;
    }
    return null;
  };

  const captureGestureStart = () => {
    const pts = [...gestureRef.current.pointers.values()];
    if (pts.length === 0) { gestureRef.current.start = null; return; }
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const distance = pts.length >= 2
      ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    const tgt = gestureRef.current.target || 'image';
    const tText = tgt !== 'image' ? texts.find((tt) => tt.id === tgt) : null;
    gestureRef.current.start = {
      target: tgt,
      panX, panY, zoom,
      textX: tText ? tText.x : 0.5,
      textY: tText ? tText.y : 0.5,
      textSize: tText ? tText.size : 0,
      mx, my, distance,
    };
  };

  const onPreviewPointerDown = (e) => {
    if (!imgReady) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Primeiro ponteiro define o alvo do gesto (id de um texto vs 'image');
    // ponteiros adicionais herdam pra completar a pinça/zoom no mesmo alvo.
    if (gestureRef.current.pointers.size === 0) {
      const hitId = hitTestTextId(e.clientX, e.clientY);
      gestureRef.current.target = hitId != null ? hitId : 'image';
      if (hitId != null) setActiveTextId(hitId);  // toque seleciona o texto
    }
    gestureRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    captureGestureStart();
  };

  const onPreviewPointerMove = (e) => {
    if (!gestureRef.current.pointers.has(e.pointerId)) return;
    gestureRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const start = gestureRef.current.start;
    const pts = [...gestureRef.current.pointers.values()];
    if (!start || pts.length === 0) return;
    const rect = previewRef.current ? previewRef.current.getBoundingClientRect() : null;
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dx = mx - start.mx;
    const dy = my - start.my;

    if (start.target !== 'image') {
      // Alvo é um texto (id). Pan move o centro (x/y 0..1); pinça redimensiona.
      const nx = clamp(start.textX + dx / rect.width, 0, 1);
      const ny = clamp(start.textY + dy / rect.height, 0, 1);
      let nsize = null;
      if (pts.length >= 2 && start.distance > 0) {
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const maxSize = Math.max(60, Math.round(targetHeight * 0.5));
        nsize = clamp(Math.round(start.textSize * (dist / start.distance)), 8, maxSize);
      }
      setTexts((arr) => arr.map((tt) => (tt.id === start.target
        ? { ...tt, x: nx, y: ny, ...(nsize != null ? { size: nsize } : {}) }
        : tt)));
      return;
    }

    // Alvo padrao: imagem.
    let newZoom = start.zoom;
    if (pts.length >= 2 && start.distance > 0) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      newZoom = clamp(start.zoom * (dist / start.distance), 1, 3);
      setZoom(newZoom);
    }
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;
    const denom = Math.max(0.001, newZoom);
    setPanX(clamp(start.panX - (dx / halfW) / denom, -1, 1));
    setPanY(clamp(start.panY - (dy / halfH) / denom, -1, 1));
  };

  const onPreviewPointerEnd = (e) => {
    if (gestureRef.current.pointers.delete(e.pointerId)) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    }
    if (gestureRef.current.pointers.size === 0) gestureRef.current.target = null;
    captureGestureStart();
  };

  // Wheel = zoom do alvo sob o cursor. Listener nao-passivo via useEffect
  // pra poder chamar preventDefault e impedir scroll da pagina enquanto
  // ajusta. ~8% por tick; deltaY < 0 (scroll up) = zoom in.
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !imgReady) return;
    const onWheel = (ev) => {
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? 1.08 : 1 / 1.08;
      const hitId = hitTestTextId(ev.clientX, ev.clientY);
      if (hitId != null) {
        const maxSize = Math.max(60, Math.round(targetHeight * 0.5));
        setTexts((arr) => arr.map((tt) => (tt.id === hitId
          ? { ...tt, size: clamp(Math.round(tt.size * factor), 8, maxSize) } : tt)));
      } else {
        setZoom((z) => clamp(z * factor, 1, 3));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [imgReady, texts, targetHeight]);

  return ReactDOM.createPortal(
    <div className="bf-modal-backdrop bf-modal-backdrop-strong">
      <div
        className="bf-modal bf-image-editor"
        role="dialog"
        aria-label={`Editor de imagem — slot ${slot + 1}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bf-modal-head">
          <span className="bf-modal-title">
            EDITOR · slot {slot + 1} · {targetWidth}×{targetHeight}
          </span>
          <button
            type="button"
            className="bf-modal-close"
            onClick={onCancel}
            disabled={busy}
            aria-label={t('common.close')}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M5 5 L19 19 M19 5 L5 19" />
            </svg>
          </button>
        </div>

        <div className="bf-image-editor-body">
          <div
            className="bf-image-editor-preview-wrap"
            ref={previewRef}
            onPointerDown={onPreviewPointerDown}
            onPointerMove={onPreviewPointerMove}
            onPointerUp={onPreviewPointerEnd}
            onPointerCancel={onPreviewPointerEnd}
            style={{ touchAction: 'none' }}
          >
            {!imgReady && !imgError && (
              <div className="bf-image-editor-loading">{t('glob.edit.loading')}</div>
            )}
            {imgError && (
              <div className="bf-image-editor-loading" style={{ color: '#ff7a1a' }}>
                {t('glob.edit.loadFail')}
              </div>
            )}
            <canvas
              ref={canvasRef}
              width={targetWidth}
              height={targetHeight}
              className="bf-image-editor-canvas"
              style={{
                aspectRatio: aspectStyle,
                display: imgReady ? 'block' : 'none',
              }}
            />
            {imgReady && (
              <div className="bf-image-editor-gesture-hint" aria-hidden="true">
                {texts.length ? t('glob.edit.gestureText') : t('glob.edit.gesturePlain')}
              </div>
            )}
          </div>

          <div className="bf-image-editor-tools">
            <details className="bf-image-editor-section">
              <summary className="bf-image-editor-section-title">
                <span>{t('glob.edit.crop')}</span>
                <span className="bf-image-editor-chevron" aria-hidden="true">▾</span>
              </summary>
              <div className="bf-image-editor-section-body">
                <EditorSlider label="Zoom" value={zoom} min={1} max={3} step={0.05}
                  onChange={setZoom} format={(v) => v.toFixed(2) + '×'} />
                <EditorSlider label="Pan X" value={panX} min={-1} max={1} step={0.02}
                  onChange={setPanX} format={(v) => (v * 100).toFixed(0) + '%'} />
                <EditorSlider label="Pan Y" value={panY} min={-1} max={1} step={0.02}
                  onChange={setPanY} format={(v) => (v * 100).toFixed(0) + '%'} />
              </div>
            </details>

            <details className="bf-image-editor-section">
              <summary className="bf-image-editor-section-title">
                <span>{t('glob.edit.lighting')}</span>
                <span className="bf-image-editor-chevron" aria-hidden="true">▾</span>
              </summary>
              <div className="bf-image-editor-section-body">
                <EditorSlider label={t('glob.edit.brightness')} value={brightness} min={0} max={200} step={2}
                  onChange={setBrightness} format={(v) => v.toFixed(0) + '%'} />
                <EditorSlider label={t('glob.edit.contrast')} value={contrast} min={0} max={200} step={2}
                  onChange={setContrast} format={(v) => v.toFixed(0) + '%'} />
              </div>
            </details>

            <details className="bf-image-editor-section">
              <summary className="bf-image-editor-section-title">
                <span>{t('glob.edit.textOpt')}</span>
                <span className="bf-image-editor-chevron" aria-hidden="true">▾</span>
              </summary>
              <div className="bf-image-editor-section-body">
                <div className="bf-image-editor-text-tabs">
                  {texts.map((tt, i) => (
                    <button
                      key={tt.id}
                      type="button"
                      className={'bf-image-editor-text-chip' + (tt.id === activeTextId ? ' is-active' : '')}
                      onClick={() => setActiveTextId(tt.id)}
                    >
                      {t('glob.edit.textN', { n: i + 1 })}
                    </button>
                  ))}
                  {texts.length < MAX_TEXTS && (
                    <button type="button" className="bf-image-editor-text-add" onClick={addText}>
                      + {t('glob.edit.addText')}
                    </button>
                  )}
                </div>
                {activeText && (
                  <>
                    <label className="bf-image-editor-field">
                      <span>{t('glob.edit.content')}</span>
                      <input
                        type="text"
                        className="bf-input"
                        value={activeText.content}
                        onChange={(e) => updateActiveText({ content: e.target.value.slice(0, 40) })}
                        placeholder={t('glob.edit.noText')}
                        maxLength={40}
                      />
                    </label>
                    <label className="bf-image-editor-field">
                      <span>{t('glob.edit.font')}</span>
                      <select
                        className="bf-input"
                        value={activeText.font}
                        onChange={(e) => updateActiveText({ font: e.target.value })}
                      >
                        {FONT_OPTIONS.map((f) => (
                          <option key={f.id} value={f.id} style={{ fontFamily: f.css }}>{f.label}</option>
                        ))}
                      </select>
                    </label>
                    <div className="bf-image-editor-text-row">
                      <label className="bf-image-editor-field">
                        <span>{t('glob.edit.color')}</span>
                        <input
                          type="color"
                          className="bf-input bf-image-editor-color"
                          value={activeText.color}
                          onChange={(e) => updateActiveText({ color: e.target.value })}
                        />
                      </label>
                      <button
                        type="button"
                        className={'bf-image-editor-toggle' + (activeText.bold ? ' is-on' : '')}
                        onClick={() => updateActiveText({ bold: !activeText.bold })}
                        title={t('glob.edit.bold')}
                      >
                        <strong>B</strong>
                      </button>
                      <button
                        type="button"
                        className={'bf-image-editor-toggle' + (activeText.outline ? ' is-on' : '')}
                        onClick={() => updateActiveText({ outline: !activeText.outline })}
                        title={t('glob.edit.outline')}
                      >
                        ⌧
                      </button>
                      <button
                        type="button"
                        className="bf-image-editor-toggle bf-image-editor-text-del"
                        onClick={removeActiveText}
                        title={t('glob.edit.removeText')}
                        aria-label={t('glob.edit.removeText')}
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6L18 18M18 6L6 18" /></svg>
                      </button>
                    </div>
                    <EditorSlider label={t('glob.edit.size')} value={activeText.size} min={8} max={Math.max(60, Math.round(targetHeight * 0.5))} step={1}
                      onChange={(v) => updateActiveText({ size: v })} format={(v) => v.toFixed(0) + 'px'} />
                    <EditorSlider label={t('glob.edit.posX')} value={activeText.x} min={0} max={1} step={0.01}
                      onChange={(v) => updateActiveText({ x: v })} format={(v) => (v * 100).toFixed(0) + '%'} />
                    <EditorSlider label={t('glob.edit.posY')} value={activeText.y} min={0} max={1} step={0.01}
                      onChange={(v) => updateActiveText({ y: v })} format={(v) => (v * 100).toFixed(0) + '%'} />
                  </>
                )}
              </div>
            </details>
          </div>
        </div>

        {saveErr && (
          <p style={{ fontSize: 12, color: 'var(--accent-warn, #ff7a1a)',
                      margin: '12px 4px 0', lineHeight: 1.4 }}>
            {t('glob.edit.saveFail')}: {saveErr}
          </p>
        )}
        <div className="bf-image-editor-actions">
          <button
            type="button"
            className="bf-action bf-action-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {t('glob.edit.cancel')}
          </button>
          <button
            type="button"
            className="bf-action bf-action-primary"
            onClick={handleSave}
            disabled={busy || !imgReady}
          >
            {busy ? t('glob.edit.saving') : t('glob.edit.saveSlot', { n: slot + 1 })}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Helper de slider — label, valor formatado, slider HTML range.
function EditorSlider({ label, value, min, max, step, onChange, format }) {
  return (
    <label className="bf-image-editor-slider">
      <span className="bf-image-editor-slider-label">
        <span>{label}</span>
        <span className="bf-image-editor-slider-value">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

// Render do canvas alvo. Calcula a janela de crop respeitando o aspect do
// display + zoom + pan, aplica filtro de brilho/contraste, desenha o texto.
// Fora do ImageEditor pra facilitar leitura/teste isolado.
function renderEditorCanvas(canvas, sourceImg, o) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const srcW = sourceImg.naturalWidth || sourceImg.width;
  const srcH = sourceImg.naturalHeight || sourceImg.height;
  if (!srcW || !srcH) return;

  // Janela base (zoom=1) com o aspect do alvo, encaixada na source via
  // "cover" — o maior retangulo do aspect alvo que cabe na source.
  const targetAspect = o.targetW / o.targetH;
  const srcAspect = srcW / srcH;
  let baseW, baseH;
  if (srcAspect > targetAspect) {
    baseH = srcH;
    baseW = baseH * targetAspect;
  } else {
    baseW = srcW;
    baseH = baseW / targetAspect;
  }
  const cropW = baseW / o.zoom;
  const cropH = baseH / o.zoom;

  // Pan -1..+1 mapeia pra deslocamento maximo (centro da source +/- (src-crop)/2).
  const cx = srcW / 2 + o.panX * (srcW - cropW) * 0.5;
  const cy = srcH / 2 + o.panY * (srcH - cropH) * 0.5;
  const sx = Math.max(0, Math.min(srcW - cropW, cx - cropW / 2));
  const sy = Math.max(0, Math.min(srcH - cropH, cy - cropH / 2));

  ctx.save();
  ctx.filter = `brightness(${o.brightness}%) contrast(${o.contrast}%)`;
  ctx.drawImage(sourceImg, sx, sy, cropW, cropH, 0, 0, W, H);
  ctx.restore();

  // Textos sobrepostos — desenhados na ordem do array (índice maior = mais
  // acima), cada um com sua fonte/tamanho/cor/contorno.
  if (o.texts && o.texts.length) {
    for (const tt of o.texts) {
      if (!tt.content) continue;
      ctx.save();
      ctx.font = `${tt.bold ? 'bold ' : ''}${tt.size}px ${fontCss(tt.font)}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tx = tt.x * W;
      const ty = tt.y * H;
      if (tt.outline) {
        // Outline preto pra legibilidade — espessura ~1/12 do tamanho.
        ctx.lineWidth = Math.max(2, tt.size / 12);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(tt.content, tx, ty);
      }
      ctx.fillStyle = tt.color;
      ctx.fillText(tt.content, tx, ty);
      ctx.restore();
    }
  }
}

// ─── Normalização de mídia pra upload em LOTE (sem abrir o editor) ───
// Reaproveita a MESMA matemática dos editores pra processar vários arquivos
// de uma vez: imagem de fundo = "cover" no tamanho do display
// (renderEditorCanvas, zoom=1/pan=0/sem texto) -> JPEG q=0.7, idêntico ao
// ImageEditor; ícone = "contain" em 100x100 PNG transparente, idêntico ao
// IconEditor. Cada arquivo vira um Blob pronto pro *StoreUpload.
function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { try { URL.revokeObjectURL(url); } catch {} reject(new Error('imagem inválida')); };
    img.src = url;
  });
}

async function imageFileToJpegBlob(file, targetW, targetH) {
  const { img, url } = await loadImageElement(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = targetW; canvas.height = targetH;
    renderEditorCanvas(canvas, img, {
      targetW, targetH, zoom: 1, panX: 0, panY: 0,
      brightness: 100, contrast: 100, texts: [],
    });
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob null')), 'image/jpeg', 0.7);
    });
  } finally {
    try { URL.revokeObjectURL(url); } catch {}
  }
}

async function iconFileToPngBlob(file) {
  const { img, url } = await loadImageElement(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_EDIT_SIZE; canvas.height = ICON_EDIT_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, ICON_EDIT_SIZE, ICON_EDIT_SIZE);  // mantém transparência
    const base = Math.min(ICON_EDIT_SIZE / img.width, ICON_EDIT_SIZE / img.height);
    const dw = img.width * base, dh = img.height * base;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (ICON_EDIT_SIZE - dw) / 2, (ICON_EDIT_SIZE - dh) / 2, dw, dh);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob null')), 'image/png');
    });
  } finally {
    try { URL.revokeObjectURL(url); } catch {}
  }
}

// ─── Gerenciar mídia: seleção múltipla, excluir tudo, upload em LOTE ──
// Hook compartilhado por CardUploadImages e CardUploadIcons (estrutura idêntica).
// Recebe o store + funções de upload/delete dele + um normalizador (arquivo ->
// Blob já no formato/tamanho certo). Concentra aqui o estado de seleção/progresso
// pros dois cards não duplicarem. NÃO sobrescreve no lote: o que exceder os
// slots livres vira aviso (decisão do usuário).
function useMediaManager({ store, slotCount, uploadFn, deleteFn, normalizeFn }) {
  const { t } = useBfI18n();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');   // progresso / aviso (neutro)
  const [error, setError] = useState('');

  const filledCount = store.slots.reduce((n, s) => n + (s.exists ? 1 : 0), 0);
  const reset = () => { setStatus(''); setError(''); };

  const toggleSelectMode = () => {
    setSelected(new Set());
    setSelectMode((v) => !v);
    reset();
  };

  const toggleSelected = (slot) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot); else next.add(slot);
      return next;
    });
  };

  // Auto-ajuste: sobe vários arquivos nos próximos slots LIVRES, sem editor.
  const runBatch = async (fileList) => {
    if (busy) return;
    const files = [...(fileList || [])];
    if (!files.length) return;
    reset();
    const images = files.filter((f) => /^image\//.test(f.type));
    const skipped = files.length - images.length;
    const free = [];
    for (let i = 0; i < slotCount; i++) {
      const s = store.slots[i];
      if (!s || !s.exists) free.push(i);
    }
    const usable = Math.min(images.length, free.length);
    const overflow = images.length - usable;
    let ok = 0;
    const failed = [];
    setBusy(true);
    try {
      for (let k = 0; k < usable; k++) {
        setStatus(t('glob.upload.batchSending', { done: k + 1, total: usable }));
        try {
          const blob = await normalizeFn(images[k]);
          await uploadFn(free[k], blob);
          ok++;
        } catch (e) {
          failed.push(images[k].name || ('#' + (k + 1)));
        }
      }
    } finally {
      setBusy(false);
    }
    const parts = [];
    if (ok) parts.push(t('glob.upload.batchLoaded', { n: ok }));
    if (overflow) parts.push(t('glob.upload.batchOverflow', { n: overflow }));
    if (skipped) parts.push(t('glob.upload.batchSkipped', { n: skipped }));
    setStatus(parts.join(' · '));
    if (failed.length) setError(t('glob.upload.batchFailed', { names: failed.join(', ') }));
  };

  // Exclui em série uma lista de slots; devolve quantos falharam.
  const deleteSlots = async (slots) => {
    let fail = 0;
    setBusy(true);
    setStatus(t('glob.upload.deleting'));
    try {
      for (const slot of slots) {
        try { await deleteFn(slot); } catch { fail++; }
      }
    } finally {
      setBusy(false);
      setStatus('');
    }
    return fail;
  };

  const runDeleteSelected = async () => {
    if (busy || selected.size === 0) return;
    if (!window.confirm(t('glob.upload.confirmDelSelected', { n: selected.size }))) return;
    reset();
    const fail = await deleteSlots([...selected].sort((a, b) => a - b));
    setSelected(new Set());
    setSelectMode(false);
    if (fail) setError(t('glob.upload.batchFailed', { names: String(fail) }));
  };

  const runDeleteAll = async () => {
    if (busy) return;
    const slots = store.slots.map((s, i) => (s.exists ? i : -1)).filter((i) => i >= 0);
    if (slots.length === 0) return;
    if (!window.confirm(t('glob.upload.confirmDelAll', { n: slots.length }))) return;
    reset();
    const fail = await deleteSlots(slots);
    setSelected(new Set());
    setSelectMode(false);
    if (fail) setError(t('glob.upload.batchFailed', { names: String(fail) }));
  };

  return {
    selectMode, selected, busy, status, error, filledCount,
    toggleSelectMode, toggleSelected, runBatch, runDeleteSelected, runDeleteAll,
  };
}

// Barra de ações em lote (mesma pros 2 cards). onPickBatch abre o seletor
// de arquivos múltiplo do card pai.
function MediaManageBar({ mgr, onPickBatch }) {
  const { t } = useBfI18n();
  const { selectMode, selected, busy, status, error, filledCount } = mgr;
  return (
    <div className="bf-media-bar">
      <div className="bf-media-bar-row">
        <button type="button" className="bf-media-bar-btn" onClick={onPickBatch} disabled={busy}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 20h14" />
          </svg>
          {t('glob.upload.batchLoad')}
        </button>
        <button
          type="button"
          className={'bf-media-bar-btn' + (selectMode ? ' is-on' : '')}
          onClick={mgr.toggleSelectMode}
          disabled={busy || (!selectMode && filledCount === 0)}
        >
          {selectMode ? t('glob.upload.selectCancel') : t('glob.upload.select')}
        </button>
        {selectMode ? (
          <button type="button" className="bf-media-bar-btn is-danger" onClick={mgr.runDeleteSelected} disabled={busy || selected.size === 0}>
            {t('glob.upload.delSelected')}{selected.size ? ` (${selected.size})` : ''}
          </button>
        ) : (
          <button type="button" className="bf-media-bar-btn is-danger" onClick={mgr.runDeleteAll} disabled={busy || filledCount === 0}>
            {t('glob.upload.delAll')}
          </button>
        )}
      </div>
      {(error || status || (selectMode && filledCount > 0)) && (
        <p className={'bf-media-bar-msg' + (error ? ' is-error' : '')}>
          {error || status || t('glob.upload.selectHint')}
        </p>
      )}
    </div>
  );
}

// ─── BACK IMAGES — card + editor ────────────────────────────────────
//
// CardUploadImages renderiza os IMAGE_SLOT_COUNT slots em grid. Cada slot:
//   - Vazio  -> placeholder com '+' clicavel; click abre file picker.
//   - Cheio  -> thumbnail da imagem; click abre o editor pra REPLACE;
//               botao X no canto faz delete (com confirm).
//
// Fluxo de upload: file picker -> blob URL -> ImageEditor (crop+sliders+texto)
// -> SAVE renderiza canvas final (dims = display real) -> toBlob('image/jpeg',
// 0.7) -> imageStoreUpload(slot, blob). Edicao de slot ja gravado NAO recupera
// o original (advisor); "edit" e "replace com nova imagem".
function CardUploadImages({ boardName }) {
  const store = useImageStore();
  const fileInputRef = useRef(null);
  const [pickerSlot, setPickerSlot] = useState(null);
  const [editor, setEditor] = useState(null); // { slot, sourceUrl }
  const [busySlot, setBusySlot] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const { t } = useBfI18n();

  const dispRes = displayResolutionFor(boardName);

  const batchInputRef = useRef(null);
  const mgr = useMediaManager({
    store,
    slotCount: IMAGE_SLOT_COUNT,
    uploadFn: imageStoreUpload,
    deleteFn: imageStoreDelete,
    normalizeFn: (file) => imageFileToJpegBlob(file, dispRes.w, dispRes.h),
  });
  const openBatchPicker = () => {
    if (batchInputRef.current) { batchInputRef.current.value = ''; batchInputRef.current.click(); }
  };
  const onBatchChosen = (e) => {
    // Materializa os File num array ANTES de limpar o input: e.target.files é
    // um FileList VIVO — resetar value='' o esvazia e runBatch receberia zero.
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    mgr.runBatch(files);
  };

  const openFilePicker = (slot) => {
    setErrorMsg('');
    setPickerSlot(slot);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const onFileChosen = (e) => {
    const file = e.target && e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || pickerSlot == null) return;
    if (!/^image\//.test(file.type)) {
      setErrorMsg(t('glob.upload.pickImage'));
      return;
    }
    const url = URL.createObjectURL(file);
    setEditor({ slot: pickerSlot, sourceUrl: url });
    setPickerSlot(null);
  };

  // Revoga sourceUrl no cleanup do effect: pega tanto closeEditor explicito
  // (setEditor(null) -> editor muda -> cleanup) quanto unmount do card (user
  // troca de pagina com editor aberto -> cleanup). Antes era so imperativo
  // em closeEditor — unmount vazava o blob URL.
  useEffect(() => {
    if (!editor || !editor.sourceUrl) return;
    const url = editor.sourceUrl;
    return () => { try { URL.revokeObjectURL(url); } catch {} };
  }, [editor]);
  const closeEditor = () => { setEditor(null); };

  const handleSave = async (jpegBlob) => {
    const slot = editor && editor.slot;
    if (slot == null) return;
    setBusySlot(slot);
    setErrorMsg('');
    try {
      await imageStoreUpload(slot, jpegBlob);
      closeEditor();
    } finally {
      setBusySlot(null);
    }
    // Erro de upload NAO e engolido aqui: propaga pro ImageEditor.handleSave,
    // que exibe a msg e libera o modal (senao ele travaria no "SALVANDO…").
  };

  const handleDelete = async (slot) => {
    if (!window.confirm(t('glob.upload.confirmDelImage', { n: slot + 1 }))) return;
    setBusySlot(slot);
    setErrorMsg('');
    try {
      await imageStoreDelete(slot);
    } catch (err) {
      setErrorMsg(String(err && err.message ? err.message : err));
    } finally {
      setBusySlot(null);
    }
  };

  const totalKb = (store.meta.total / 1024).toFixed(1);
  const maxKb = (store.meta.maxTotal / 1024).toFixed(0);

  return (
    <>
      <div className="bf-card">
        <div className="bf-card-head">
          <h3>{t('glob.upload.images')}</h3>
          <span className="meta">{totalKb} / {maxKb} KB</span>
        </div>
        <MediaManageBar mgr={mgr} onPickBatch={openBatchPicker} />
        <div className="bf-img-grid">
          {store.slots.map((s, i) => {
            const url = s.exists ? imageStoreBlobOrLoad(i) : null;
            const isBusy = busySlot === i || mgr.busy;
            const isSel = mgr.selectMode && mgr.selected.has(i);
            return (
              <div key={i} className={'bf-img-slot' + (s.exists ? ' is-filled' : ' is-empty') + (isBusy ? ' is-busy' : '') + (isSel ? ' is-selected' : '')}>
                <button
                  type="button"
                  className="bf-img-slot-tile"
                  onClick={() => mgr.selectMode ? (s.exists && mgr.toggleSelected(i)) : openFilePicker(i)}
                  disabled={isBusy || (mgr.selectMode && !s.exists)}
                  style={url ? { backgroundImage: `url("${url}")` } : undefined}
                  aria-label={s.exists ? t('glob.upload.replaceImage', { n: i + 1 }) : t('glob.upload.addImage', { n: i + 1 })}
                  title={s.exists ? t('glob.upload.replaceSlot', { n: i + 1 }) : t('glob.upload.addSlot', { n: i + 1 })}
                >
                  {!url && <span className="bf-img-slot-plus">+</span>}
                  <span className="bf-img-slot-num">{i + 1}</span>
                  {isSel && (
                    <span className="bf-img-slot-check">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                    </span>
                  )}
                </button>
                {s.exists && !mgr.selectMode && (
                  <button
                    type="button"
                    className="bf-img-slot-del"
                    onClick={() => handleDelete(i)}
                    disabled={isBusy}
                    aria-label={t('glob.upload.delImage', { n: i + 1 })}
                    title={t('glob.upload.delete')}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <path d="M6 6L18 18M18 6L6 18" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {errorMsg && (
          <p style={{ fontSize: 12, color: 'var(--accent-warn, #ff7a1a)', margin: '12px 4px 0' }}>
            {errorMsg}
          </p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onFileChosen}
        />
        <input
          ref={batchInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={onBatchChosen}
        />
      </div>

      {editor && (
        <ImageEditor
          slot={editor.slot}
          sourceUrl={editor.sourceUrl}
          targetWidth={dispRes.w}
          targetHeight={dispRes.h}
          onCancel={closeEditor}
          onSave={handleSave}
        />
      )}
    </>
  );
}

// ─── IconEditor — modal 100x100 PNG transparente (ajuste de icone) ───
// Area de ajuste FIXA em 100x100 — casa com a normalizacao do firmware
// (drawPngFile escala 100 -> tile). Fundo TRANSPARENTE: so o BG/borda do tile
// mudam de cor no device. Zoom + pan por sliders; exporta PNG via toBlob.
// onSave RE-LANCA o erro (igual ImageEditor) pra nao travar no "SALVANDO…".
const ICON_EDIT_SIZE = 100;
function IconEditor({ slot, sourceUrl, onCancel, onSave }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [imgReady, setImgReady] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const { t } = useBfI18n();
  const previewRef = useRef(null);
  const gestureRef = useRef({ pointers: new Map(), start: null });

  useEffect(() => {
    setImgReady(false); setImgError(false);
    const img = new Image();
    img.onload = () => { imgRef.current = img; setImgReady(true); };
    img.onerror = () => setImgError(true);
    img.src = sourceUrl;
  }, [sourceUrl]);

  useEffect(() => {
    if (!imgReady || !canvasRef.current || !imgRef.current) return;
    const c = canvasRef.current;
    c.width = ICON_EDIT_SIZE; c.height = ICON_EDIT_SIZE;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, ICON_EDIT_SIZE, ICON_EDIT_SIZE);  // mantem transparencia
    const img = imgRef.current;
    const base = Math.min(ICON_EDIT_SIZE / img.width, ICON_EDIT_SIZE / img.height);
    const s = base * zoom;
    const dw = img.width * s, dh = img.height * s;
    const cx = ICON_EDIT_SIZE / 2 + panX * (ICON_EDIT_SIZE / 2);
    const cy = ICON_EDIT_SIZE / 2 + panY * (ICON_EDIT_SIZE / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  }, [imgReady, zoom, panX, panY]);

  const handleSave = async () => {
    if (!canvasRef.current || busy) return;
    setBusy(true); setSaveErr('');
    try {
      const blob = await new Promise((resolve, reject) => {
        canvasRef.current.toBlob(
          (b) => b ? resolve(b) : reject(new Error('toBlob retornou null')),
          'image/png');  // PNG preserva alpha (transparencia do pedal)
      });
      await onSave(blob);
      // Sucesso: onSave fecha o editor (unmount) — nao resetar busy aqui.
    } catch (err) {
      setSaveErr(String(err && err.message ? err.message : err));
      setBusy(false);
    }
  };

  // Gestos no preview (Pointer Events + wheel), só imagem (sem texto):
  //   - 1 ponteiro arrastando = pan (segue o dedo).
  //   - 2 ponteiros pinça = zoom (1..4x).
  //   - Wheel (mouse) = zoom. Estado vivo em ref, comita em setZoom/setPan*.
  // ATENÇÃO: aqui panX/panY DESLOCAM a posição do desenho (cx = SIZE/2 +
  // panX*SIZE/2), então pra a imagem seguir o dedo o sinal é "+ dx" — OPOSTO
  // do ImageEditor (que move a janela de crop na source, usa "- dx").
  const captureGestureStart = () => {
    const pts = [...gestureRef.current.pointers.values()];
    if (pts.length === 0) { gestureRef.current.start = null; return; }
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const distance = pts.length >= 2
      ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gestureRef.current.start = { panX, panY, zoom, mx, my, distance };
  };

  const onPreviewPointerDown = (e) => {
    if (!imgReady) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gestureRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    captureGestureStart();
  };

  const onPreviewPointerMove = (e) => {
    if (!gestureRef.current.pointers.has(e.pointerId)) return;
    gestureRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const start = gestureRef.current.start;
    const pts = [...gestureRef.current.pointers.values()];
    if (!start || pts.length === 0) return;
    const rect = previewRef.current ? previewRef.current.getBoundingClientRect() : null;
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dx = mx - start.mx;
    const dy = my - start.my;
    if (pts.length >= 2 && start.distance > 0) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setZoom(clamp(start.zoom * (dist / start.distance), 1, 4));
    }
    setPanX(clamp(start.panX + 2 * dx / rect.width, -1, 1));
    setPanY(clamp(start.panY + 2 * dy / rect.height, -1, 1));
  };

  const onPreviewPointerEnd = (e) => {
    if (gestureRef.current.pointers.delete(e.pointerId)) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    }
    captureGestureStart();
  };

  // Wheel = zoom. Listener não-passivo via useEffect pra poder preventDefault
  // e bloquear o scroll da página enquanto ajusta. ~8% por tick.
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !imgReady) return;
    const onWheel = (ev) => {
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? 1.08 : 1 / 1.08;
      setZoom((z) => clamp(z * factor, 1, 4));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [imgReady]);

  // Xadrez sutil atras do canvas pra indicar transparencia.
  const checker = {
    backgroundColor: '#3a3a40',
    backgroundImage:
      'linear-gradient(45deg,#2a2a30 25%,transparent 25%),' +
      'linear-gradient(-45deg,#2a2a30 25%,transparent 25%),' +
      'linear-gradient(45deg,transparent 75%,#2a2a30 75%),' +
      'linear-gradient(-45deg,transparent 75%,#2a2a30 75%)',
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
  };

  return ReactDOM.createPortal(
    <div className="bf-modal-backdrop bf-modal-backdrop-strong">
      <div className="bf-modal bf-image-editor" role="dialog"
           aria-label={t('glob.edit.adjustIcon', { n: slot + 1 })}
           onClick={(e) => e.stopPropagation()}>
        <div className="bf-modal-head">
          <span className="bf-modal-title">{t('glob.upload.icons').toUpperCase()} · slot {slot + 1} · 100×100</span>
          <button type="button" className="bf-modal-close" onClick={onCancel}
                  disabled={busy} aria-label={t('common.close')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                 strokeWidth="2.4" strokeLinecap="round"><path d="M5 5 L19 19 M19 5 L5 19" /></svg>
          </button>
        </div>

        <div className="bf-image-editor-body">
          <div
            className="bf-image-editor-preview-wrap"
            ref={previewRef}
            onPointerDown={onPreviewPointerDown}
            onPointerMove={onPreviewPointerMove}
            onPointerUp={onPreviewPointerEnd}
            onPointerCancel={onPreviewPointerEnd}
            style={{ ...checker, touchAction: 'none' }}
          >
            {!imgReady && !imgError && (
              <div className="bf-image-editor-loading">{t('glob.edit.loading')}</div>
            )}
            {imgError && (
              <div className="bf-image-editor-loading" style={{ color: '#ff7a1a' }}>
                {t('glob.edit.loadFail')}
              </div>
            )}
            <canvas
              ref={canvasRef}
              width={ICON_EDIT_SIZE}
              height={ICON_EDIT_SIZE}
              className="bf-image-editor-canvas"
              style={{ aspectRatio: '1 / 1', display: imgReady ? 'block' : 'none' }}
            />
            {imgReady && (
              <div className="bf-image-editor-gesture-hint" aria-hidden="true">
                {t('glob.edit.gesturePlain')}
              </div>
            )}
          </div>

          <div className="bf-image-editor-tools">
            <div className="bf-image-editor-section-body">
              <EditorSlider label="Zoom" value={zoom} min={1} max={4} step={0.05}
                onChange={setZoom} format={(v) => v.toFixed(2) + '×'} />
              <EditorSlider label={t('glob.edit.posX')} value={panX} min={-1} max={1} step={0.02}
                onChange={setPanX} format={(v) => (v * 100).toFixed(0) + '%'} />
              <EditorSlider label={t('glob.edit.posY')} value={panY} min={-1} max={1} step={0.02}
                onChange={setPanY} format={(v) => (v * 100).toFixed(0) + '%'} />
            </div>
          </div>
        </div>

        {saveErr && (
          <p style={{ fontSize: 12, color: 'var(--accent-warn, #ff7a1a)',
                      margin: '12px 4px 0', lineHeight: 1.4 }}>
            {t('glob.edit.saveFail')}: {saveErr}
          </p>
        )}
        <div className="bf-image-editor-actions">
          <button type="button" className="bf-action bf-action-ghost"
                  onClick={onCancel} disabled={busy}>{t('glob.edit.cancel')}</button>
          <button type="button" className="bf-action bf-action-primary"
                  onClick={handleSave} disabled={busy || !imgReady}>
            {busy ? t('glob.edit.saving') : t('glob.edit.saveSlot', { n: slot + 1 })}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// CardUploadIcons — grid dos slots de ICONE de upload (PNG com alpha). Mesmo
// padrao do CardUploadImages: vazio -> '+', cheio -> thumb + X de delete.
// Upload: file picker -> IconEditor (ajuste 100x100) -> toBlob PNG ->
// iconStoreUpload. Os icones aparecem no picker do SW (modo 'icon').
function CardUploadIcons() {
  const store = useIconStore();
  const fileInputRef = useRef(null);
  const [pickerSlot, setPickerSlot] = useState(null);
  const [editor, setEditor] = useState(null);  // { slot, sourceUrl }
  const [busySlot, setBusySlot] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const { t } = useBfI18n();

  const batchInputRef = useRef(null);
  const mgr = useMediaManager({
    store,
    slotCount: ICON_UPLOAD_SLOT_COUNT,
    uploadFn: iconStoreUpload,
    deleteFn: iconStoreDelete,
    normalizeFn: iconFileToPngBlob,
  });
  const openBatchPicker = () => {
    if (batchInputRef.current) { batchInputRef.current.value = ''; batchInputRef.current.click(); }
  };
  const onBatchChosen = (e) => {
    // Materializa os File num array ANTES de limpar o input: e.target.files é
    // um FileList VIVO — resetar value='' o esvazia e runBatch receberia zero.
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    mgr.runBatch(files);
  };

  const openFilePicker = (slot) => {
    setErrorMsg('');
    setPickerSlot(slot);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const onFileChosen = (e) => {
    const file = e.target && e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || pickerSlot == null) return;
    if (!/^image\//.test(file.type)) {
      setErrorMsg(t('glob.upload.pickImage'));
      return;
    }
    const url = URL.createObjectURL(file);
    setEditor({ slot: pickerSlot, sourceUrl: url });
    setPickerSlot(null);
  };

  // Mesmo pattern do CardUploadImages: cleanup do effect cobre close + unmount.
  useEffect(() => {
    if (!editor || !editor.sourceUrl) return;
    const url = editor.sourceUrl;
    return () => { try { URL.revokeObjectURL(url); } catch {} };
  }, [editor]);
  const closeEditor = () => { setEditor(null); };

  const handleSave = async (pngBlob) => {
    const slot = editor && editor.slot;
    if (slot == null) return;
    setBusySlot(slot);
    setErrorMsg('');
    try {
      await iconStoreUpload(slot, pngBlob);
      closeEditor();
    } finally {
      setBusySlot(null);
    }
    // Erro de upload NAO e engolido aqui: propaga pro IconEditor.handleSave.
  };

  const handleDelete = async (slot) => {
    if (!window.confirm(t('glob.upload.confirmDelIcon', { n: slot + 1 }))) return;
    setBusySlot(slot);
    setErrorMsg('');
    try {
      await iconStoreDelete(slot);
    } catch (err) {
      setErrorMsg(String(err && err.message ? err.message : err));
    } finally {
      setBusySlot(null);
    }
  };

  const totalKb = (store.meta.total / 1024).toFixed(1);
  const maxKb = (store.meta.maxTotal / 1024).toFixed(0);

  return (
    <>
      <div className="bf-card">
        <div className="bf-card-head">
          <h3>{t('glob.upload.icons')}</h3>
          <span className="meta">{totalKb} / {maxKb} KB</span>
        </div>
        <MediaManageBar mgr={mgr} onPickBatch={openBatchPicker} />
        <div className="bf-img-grid">
          {store.slots.map((s, i) => {
            const url = s.exists ? iconStoreBlobOrLoad(i) : null;
            const isBusy = busySlot === i || mgr.busy;
            const isSel = mgr.selectMode && mgr.selected.has(i);
            return (
              <div key={i} className={'bf-img-slot bf-img-slot-icon' + (s.exists ? ' is-filled' : ' is-empty') + (isBusy ? ' is-busy' : '') + (isSel ? ' is-selected' : '')}>
                <button
                  type="button"
                  className="bf-img-slot-tile"
                  onClick={() => mgr.selectMode ? (s.exists && mgr.toggleSelected(i)) : openFilePicker(i)}
                  disabled={isBusy || (mgr.selectMode && !s.exists)}
                  style={url ? { backgroundImage: `url("${url}")`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' } : undefined}
                  aria-label={s.exists ? t('glob.upload.replaceIcon', { n: i + 1 }) : t('glob.upload.addIcon', { n: i + 1 })}
                  title={s.exists ? t('glob.upload.replaceSlot', { n: i + 1 }) : t('glob.upload.addSlot', { n: i + 1 })}
                >
                  {!url && <span className="bf-img-slot-plus">+</span>}
                  <span className="bf-img-slot-num">{i + 1}</span>
                  {isSel && (
                    <span className="bf-img-slot-check">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                    </span>
                  )}
                </button>
                {s.exists && !mgr.selectMode && (
                  <button
                    type="button"
                    className="bf-img-slot-del"
                    onClick={() => handleDelete(i)}
                    disabled={isBusy}
                    aria-label={t('glob.upload.delIcon', { n: i + 1 })}
                    title={t('glob.upload.delete')}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <path d="M6 6L18 18M18 6L6 18" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {errorMsg && (
          <p style={{ fontSize: 12, color: 'var(--accent-warn, #ff7a1a)', margin: '12px 4px 0' }}>
            {errorMsg}
          </p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onFileChosen}
        />
        <input
          ref={batchInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={onBatchChosen}
        />
      </div>

      {editor && (
        <IconEditor
          slot={editor.slot}
          sourceUrl={editor.sourceUrl}
          onCancel={closeEditor}
          onSave={handleSave}
        />
      )}
    </>
  );
}

// ─── SW GLOBAL ──────────────────────────────────────────────────────
// Editor de UM switch fora dos presets (ver SW_GLOBAL.h no firmware).
// Reusa os MESMOS editores por modo dos 6 SWs (SwStompEditor, etc.), mas
// com estado local: `mode` + um mapa `paramsByMode` (so o modo ativo e
// persistido na NVS via /config/global). GLOBAL 1/2 tambem usam o mesmo
// editor DISPLAY (icone e cores) dos SW1..6.
function SwGlobalEditor({ mode, setMode, paramsByMode, setParamsByMode, display, setDisplay, presetCount, allowedModes, noLed, collapsed, picker = 'inline', hideStart = true, hideAtPreset = false, externalDual = false }) {
  const { t } = useBfI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cardTab, setCardTab] = useState('gear');
  // allowedModes (opcional): restringe o picker a esses ids (ex.: dual switch
  // externo = só STOMP/SINGLE). Sem ele, mostra todos os modos visiveis.
  const visibleModes = SW_MODES.filter(
    (m) => !m.hidden && (!allowedModes || allowedModes.includes(m.id)));
  const params = paramsByMode[mode] || DEFAULT_SW_PARAMS(mode);
  const resetOnPreset = Number(params.reset_on_preset) === 1;
  const onChange = (patch) => setParamsByMode((prev) => ({
    ...prev,
    [mode]: { ...(prev[mode] || DEFAULT_SW_PARAMS(mode)), ...patch },
  }));
  // hideStart: por padrao o SW GLOBAL nao dispara na chamada de preset, entao
  // os controles START / START ON PRESET ficam escondidos. O card SW GLOBAL da
  // pagina GLOBAL passa hideStart={false} pra exibir os mesmos controles do LIVE.
  // noLed: quando true (dual switch externo, sem anel), os editores escondem
  // o preview/seletor de cor de LED.
  // hideAtPreset: esconde so o controle "Dispara no preset" (START ON PRESET).
  // O SW GLOBAL vive fora dos presets, entao ele nunca dispara na chamada de
  // preset — o card passa hideAtPreset={true} pra omitir esse toggle em todos
  // os modos (mantendo "Começa ON" / estado inicial, que faz sentido).
  const ep = { sw: 0, params, onChange, ledPreviewLive: false, hideStart, noLed, hideAtPreset };
  const currentMode = SW_MODES.find((m) => m.id === mode) || SW_MODES[0];
  return (
    <>
      {/* picker='modal' (card SW GLOBAL da pagina GLOBAL): campo compacto de
          modo + popup, igual ao card de SW em LIVE. picker='inline' (dual
          switch externo): grade de botoes de modo sempre visivel. */}
      {picker === 'modal' ? (
        <div className="bf-sw-card-tabs">
          <div className="bf-sw-card-iconrow">
            <button type="button" role="tab" aria-selected={cardTab === 'gear'}
              className={'bf-sw-card-tab' + (cardTab === 'gear' ? ' is-active' : '')}
              onClick={() => setCardTab('gear')} aria-label={t('sw.live.settings')}>
              <svg viewBox="0 0 24 24" className="bf-tab-ico" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle className="bf-tab-shape" cx="12" cy="12" r="3" />
                <circle className="bf-tab-shape" cx="12" cy="12" r="8" />
              </svg>
            </button>
            <button type="button" role="tab" aria-selected={cardTab === 'display'}
              className={'bf-sw-card-tab' + (cardTab === 'display' ? ' is-active' : '')}
              onClick={() => setCardTab('display')} aria-label="Display">
              <svg viewBox="0 0 24 24" className="bf-tab-ico" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect className="bf-tab-shape" x="2.5" y="4.5" width="19" height="12" rx="1.6" />
                <path className="bf-tab-shape" d="M9 21h6 M12 16.5v4.5" />
                <path className="bf-tab-dot" d="M7 13v-3 M11 13V8 M15 13V9 M19 13v-2" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            className="bf-sw-mode-field"
            onClick={() => setPickerOpen(true)}
            aria-label={t('sw.live.modeAria', { title: currentMode.title })}
          >
            <SwModeIcon id={mode} />
            <span className="bf-sw-mode-field-name">{currentMode.title}</span>
          </button>
        </div>
      ) : (
        <div className="bf-sw-global-modes">
          {visibleModes.map((m) => (
            <button
              key={m.id}
              type="button"
              className={'bf-sw-global-mode' + (mode === m.id ? ' is-active' : '')}
              onClick={() => setMode(m.id)}
              title={m.sub}
            >
              <SwModeIcon id={m.id} />
              <span>{m.title}</span>
            </button>
          ))}
        </div>
      )}
      {/* key={mode} remonta o editor ao trocar de modo (reseta estado interno).
          collapsed=true esconde o editor (usado quando algum pai colapsa). */}
      {!collapsed && cardTab === 'gear' && (
      <div className="bf-sw-global-body" key={mode}>
        {mode === 'fx1' ? <SwStompEditor {...ep} liveOn={undefined} presetCount={presetCount} />
          : mode === 'momentary' ? <SwMomentaryEditor {...ep} />
          : mode === 'macros' ? <SwMacrosEditor {...ep} liveOn={undefined} />
          : mode === 'tap_tempo' ? <SwTapTempoEditor {...ep} />
          : mode === 'single' ? <SwSingleEditor {...ep} isActiveSingle={false} hideExtras externalVisualState={externalDual} />
          : mode === 'ramp' ? <SwRampEditor {...ep} />
          : mode === 'spin' ? <SwSpinEditor {...ep} />
          : <div className="bf-sw-card-empty">{t('sw.muteEmpty')}</div>}
      </div>
      )}
      {!collapsed && cardTab === 'gear' && mode === 'single' && !externalDual && (
        <div className="bf-sw-opt-row" style={{ marginTop: 12 }}>
          <div className="bf-sw-opt-text">
            <span className="bf-sw-opt-name">RESET AO CHAMAR PRESET</span>
            <span className="bf-sw-opt-sub">Volta o estado visual para OFF sem enviar MIDI.</span>
          </div>
          <BfToggle
            on={resetOnPreset}
            onClick={() => onChange({ reset_on_preset: resetOnPreset ? 0 : 1 })}
            ariaLabel="Resetar o estado visual do SW Global ao chamar preset"
            title="Reseta o estado visual do SW Global ao chamar preset"
          />
        </div>
      )}
      {!collapsed && picker === 'modal' && cardTab === 'display' && (
        <div className="bf-sw-global-body">
          <SwDisplayEditor
            sw={0}
            disp={display || DEFAULT_SW_DISPLAY()}
            onChange={(next) => setDisplay && setDisplay(next)}
            swMode={mode}
            swParams={{ 0: paramsByMode }}
          />
        </div>
      )}
      {/* Popup de selecao de modo (mesmo modal do SW em LIVE). */}
      {picker === 'modal' && pickerOpen && ReactDOM.createPortal(
        <div className="bf-modal-backdrop" onClick={() => setPickerOpen(false)}>
          <div
            className="bf-modal"
            role="dialog"
            aria-label={t('sw.global.modeOpAria')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bf-modal-head">
              <span className="bf-modal-title">{t('sw.global.modeOpTitle')}</span>
              <button
                type="button"
                className="bf-modal-close"
                onClick={() => setPickerOpen(false)}
                aria-label={t('common.close')}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M5 5 L19 19 M19 5 L5 19" />
                </svg>
              </button>
            </div>
            <div className="bf-sw-mode-grid">
              {visibleModes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={'bf-sw-mode' + (mode === m.id ? ' is-active' : '')}
                  onClick={() => { setMode(m.id); setPickerOpen(false); }}
                >
                  <SwModeIcon id={m.id} />
                  <span className="bf-sw-mode-title">{m.title}</span>
                  <span className="bf-sw-mode-sub">{m.sub}</span>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ─── DISPLAY section (Studio) ───────────────────────────────────────
// Reorganiza a aba GLOBAL > DISPLAY em 3 cards (Gig View / Layout LIVE /
// Imagens & Ícones), batendo com o handoff de Claude Design (refactor
// GLOBAL/v8-global-display.jsx). Os campos persistidos seguem os mesmos
// (gigView, namePresetLive/Bank, iconShape, liveLayout); só a UI mudou.
// Formatos de tile — o índice casa com os ICON_SHAPE_* do firmware
// (0=default/quadrado, 1=circle, 2=octagon).
const ICON_SHAPES = ['default', 'circle', 'octagon'];
const iconShapeToNum = (s) => { const i = ICON_SHAPES.indexOf(s); return i < 0 ? 0 : i; };
const numToIconShape = (n) => ICON_SHAPES[Number(n)] || 'default';

function GLayoutMiniSketch({ layout, selected, iconShape, custom = false, customLayout }) {
  // Mini-sketch dos 4 layouts do display LIVE (replica do GLayoutSketch
  // do design). Renderiza como SVG inline pra ficar leve e responder a
  // cor do estado selecionado. Quando o FORMATO DO ÍCONE e CÍRCULO, as
  // tiles dos SW viram circulos (espelha o display real); a faixa do nome
  // do preset (band) continua retangular.
  const w = 78, h = 50;
  const stroke = selected ? 'var(--accent)' : 'color-mix(in srgb, var(--text) 55%, transparent)';
  const fillCol = selected ? 'var(--accent)' : 'color-mix(in srgb, var(--text) 45%, transparent)';
  const op = selected ? 1 : 0.6;
  // Espelha os formatos do firmware. circle = recorta pra quadrado;
  // octagon = polígono chanfrado a 45%; default = round-rect.
  const tile = (x, y, tw, th, k) => {
    const common = { fill: 'none', stroke, strokeWidth: 0.9, opacity: op };
    if (iconShape === 'circle') {
      const r = Math.min(tw, th) / 2;
      return <circle key={k} cx={x + tw / 2} cy={y + th / 2} r={r} {...common}/>;
    }
    if (iconShape === 'octagon') {
      const c = Math.min(tw, th) * 0.29;  // chanfro ~29% (octógono regular)
      const pts = [
        [x + c, y], [x + tw - c, y], [x + tw, y + c], [x + tw, y + th - c],
        [x + tw - c, y + th], [x + c, y + th], [x, y + th - c], [x, y + c],
      ].map((p) => p.join(',')).join(' ');
      return <polygon key={k} points={pts} {...common}/>;
    }
    return <rect key={k} x={x} y={y} width={tw} height={th} rx="1.5" {...common}/>;
  };
  const band = (x, y, tw, th, k) => (
    <rect key={k} x={x} y={y} width={tw} height={th} rx="1"
      fill={fillCol} opacity={selected ? 0.9 : 0.5}/>
  );
  let content;
  if (custom) {
    const items = Array.isArray(customLayout) ? customLayout : makeDefaultCustomLayout();
    content = (<>
      {items.map((it, i) => {
        if (!it || !it.enabled) return null;
        const sz = h * clamp(it.size, CUSTOM_LAYOUT_MIN_SIZE, CUSTOM_LAYOUT_MAX_SIZE) / 100;
        const x = (w - sz) * clamp(it.x, 0, 100) / 100;
        const y = (h - sz) * clamp(it.y, 0, 100) / 100;
        return tile(x, y, sz, sz, 'c' + i);
      })}
    </>);
  } else if (layout === 0) {
    // "Nenhum" (modo PRESET): tela classica sem tiles de SW — so o nome/fundo.
    // Representado por um traco central discreto.
    content = (
      <line x1={w * 0.32} y1={h / 2} x2={w * 0.68} y2={h / 2}
        stroke={stroke} strokeWidth="1.4" strokeLinecap="round" opacity={op}/>
    );
  } else if (layout === 1) {
    content = (<>
      {[0,1,2].map(i => tile(4 + i*24, 4, 20, 14, 't'+i))}
      {band(4, 20, 70, 7)}
      {[0,1,2].map(i => tile(4 + i*24, 30, 20, 14, 'b'+i))}
    </>);
  } else if (layout === 2) {
    content = (<>
      {[0,1,2].map(i => tile(4 + i*24, 4, 20, 19, 't'+i))}
      {[0,1,2].map(i => tile(4 + i*24, 26, 20, 19, 'b'+i))}
    </>);
  } else if (layout === 3) {
    content = (<>
      {band(4, 4, 70, 13)}
      {[0,1,2,3,4,5].map(i => tile(4 + i*12, 20, 9, 25, 't'+i))}
    </>);
  } else if (layout === 5) {
    // LISTA (modo PRESET): nome atual ao centro (moldura) + proximos acima
    // e anteriores abaixo — linhas de texto representadas por bands finos.
    content = (<>
      {[0,1,2].map(i => band(24, 4.5 + i*5, 30, 2.5, 'u'+i))}
      <rect x={8} y={20.5} width={62} height={9} rx="2"
        fill="none" stroke={stroke} strokeWidth="1.1" opacity={op}/>
      {band(18, 23.5, 42, 3, 'c')}
      {[0,1,2].map(i => band(24, 33 + i*5, 30, 2.5, 'd'+i))}
    </>);
  } else {
    content = (<>
      {band(4, 4, 70, 10)}
      {[0,1,2,3,4,5].map(i => tile(4 + i*12, 16, 9, 13, 'l1'+i))}
      {[0,1,2,3,4,5].map(i => tile(4 + i*12, 31, 9, 13, 'l2'+i))}
    </>);
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <rect x="0" y="0" width={w} height={h} rx="3"
        fill={selected ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'rgba(255,255,255,0.025)'}
        stroke={selected ? 'color-mix(in srgb, var(--accent) 50%, transparent)' : 'rgba(255,255,255,0.07)'}
        strokeWidth="0.8"/>
      {content}
    </svg>
  );
}

// Simulador visual da controladora. É alimentado pelo mesmo estado editado no
// webApp, portanto modelo, banco, preset, nomes, modos e LEDs aparecem sem
// qualquer equipamento físico conectado.
// Geometria dos layouts de icon_draw_live_layout() no firmware. As medidas
// seguem o framebuffer real: 480x320 nas BFMIDI-3 grandes e 320x240 nas
// BFMIDI-1/2 e BFMIDI-3 MICRO. Placas MICRO/4S usam a variante de 4 switches.
function demo480LayoutRects(layout, customLayout, presetMode,
  { screenW = 480, screenH = 320, is4sw = false } = {}) {
  const rects = [];
  const addRow = (switches, y, w, h, gapX, xStart, layer) => {
    switches.forEach((sw, col) => rects.push({
      sw, layer, x: xStart + col * (w + gapX), y, w, h, layout,
    }));
  };
  const useLG = screenW >= 400;
  const cols = is4sw ? 2 : 3;
  const rowSwitches = is4sw ? 4 : 6;
  if (layout === 1) {
    const w = useLG ? 150 : 100;
    const h = useLG ? 120 : 80;
    const stripH = useLG ? 56 : 40;
    const gapX = Math.trunc((screenW - cols * w) / (cols + 1));
    const gapY = Math.trunc((screenH - (2 * h + stripH)) / 4);
    const yStrip = gapY + h + gapY;
    addRow(is4sw ? [3, 4] : [4, 5, 6], gapY, w, h, gapX, gapX, 1);
    addRow(is4sw ? [1, 2] : [1, 2, 3], yStrip + stripH + gapY,
      w, h, gapX, gapX, 1);
  } else if (layout === 2) {
    const w = useLG ? 150 : 100;
    const h = useLG ? 150 : 100;
    const gapX = Math.trunc((screenW - cols * w) / (cols + 1));
    const gapY = Math.trunc((screenH - 2 * h) / 3);
    addRow(is4sw ? [3, 4] : [4, 5, 6], gapY, w, h, gapX, gapX, 1);
    addRow(is4sw ? [1, 2] : [1, 2, 3], gapY + h + gapY,
      w, h, gapX, gapX, 1);
  } else if (layout === 3) {
    const w = useLG ? 70 : 47;
    const h = useLG ? 70 : 47;
    const stripH = useLG ? 80 : 56;
    const gapX = Math.trunc((screenW - rowSwitches * w) / (rowSwitches + 1));
    const gapY = Math.trunc((screenH - stripH - h) / 3);
    addRow(Array.from({ length: rowSwitches }, (_, index) => index + 1),
      gapY + stripH + gapY + (presetMode ? 10 : 0),
      w, h, gapX, gapX, 1);
  } else if (layout === 4) {
    const w = useLG ? 70 : 47;
    const h = useLG ? 70 : 47;
    const stripH = useLG ? 56 : 40;
    const innerGapY = useLG ? 6 : 4;
    const gapX = Math.trunc((screenW - rowSwitches * w) / (rowSwitches + 1));
    const gapY = Math.trunc((screenH - (stripH + 2 * h + innerGapY)) / 3);
    const yStrip = gapY + 20;
    const yL1 = yStrip + stripH + gapY;
    const switches = Array.from({ length: rowSwitches }, (_, index) => index + 1);
    addRow(switches, yL1, w, h, gapX, gapX, 1);
    addRow(switches, yL1 + h + innerGapY, w, h, gapX, gapX, 2);
  } else {
    const items = Array.isArray(customLayout) ? customLayout : makeDefaultCustomLayout();
    items.slice(0, is4sw ? 4 : 6).forEach((item, index) => {
      if (!item?.enabled) return;
      const sizePct = clamp(item.size, CUSTOM_LAYOUT_MIN_SIZE, CUSTOM_LAYOUT_MAX_SIZE);
      const tile = Math.max(20, Math.min(screenH, Math.floor(screenH * sizePct / 100)));
      rects.push({
        sw: index + 1, layer: 1,
        x: Math.floor((screenW - tile) * clamp(item.x, 0, 100) / 100),
        y: Math.floor((screenH - tile) * clamp(item.y, 0, 100) / 100),
        w: tile, h: tile, layout: 2,
      });
    });
  }
  return rects;
}

function demo480NameArea(layout, presetMode, customMode,
  { screenW = 480, screenH = 320, is4sw = false } = {}) {
  if (presetMode || customMode) return { x: 0, y: 0, w: screenW, h: screenH };
  const useLG = screenW >= 400;
  const cols = is4sw ? (layout === 1 ? 2 : 4) : (layout === 1 ? 3 : 6);
  if (layout === 1) {
    const tileW = useLG ? 150 : 100, tileH = useLG ? 120 : 80;
    const stripH = useLG ? 56 : 40;
    const gapX = Math.trunc((screenW - cols * tileW) / (cols + 1));
    const gapY = Math.trunc((screenH - (2 * tileH + stripH)) / 4);
    return { x: gapX, y: gapY + tileH + gapY,
      w: cols * tileW + (cols - 1) * gapX, h: stripH };
  }
  if (layout === 3) {
    const tileW = useLG ? 70 : 47, tileH = tileW;
    const stripH = useLG ? 80 : 56;
    const gapX = Math.trunc((screenW - cols * tileW) / (cols + 1));
    const gapY = Math.trunc((screenH - stripH - tileH) / 3);
    return { x: gapX, y: gapY,
      w: cols * tileW + (cols - 1) * gapX, h: stripH };
  }
  if (layout === 4) {
    const tileW = useLG ? 70 : 47, tileH = tileW;
    const stripH = useLG ? 56 : 40, innerGapY = useLG ? 6 : 4;
    const gapX = Math.trunc((screenW - cols * tileW) / (cols + 1));
    const gapY = Math.trunc((screenH - (stripH + 2 * tileH + innerGapY)) / 3);
    return { x: gapX, y: gapY + 20,
      w: cols * tileW + (cols - 1) * gapX, h: stripH };
  }
  return null;
}

function demo480SubDisplay(base, sub) {
  const d = { ...base };
  if (!sub) return d;
  return {
    ...d,
    icon_id: sub.icon_id ?? d.icon_id,
    mode: sub.mode || d.mode,
    sigla: sub.sigla || d.sigla,
    sg: sub.sg ?? d.sg,
    ic_off: sub.ic ?? sub.ic_on ?? d.ic_off,
    ic_on: sub.ic ?? sub.ic_on ?? d.ic_on,
    bg_off: sub.bg ?? sub.bg_on ?? d.bg_off,
    bg_on: sub.bg ?? sub.bg_on ?? d.bg_on,
    br_off: sub.br ?? sub.br_on ?? d.br_off,
    br_on: sub.br ?? sub.br_on ?? d.br_on,
  };
}

// Espelha icon_disp_resolve_state(): o modo e o ultimo gesto determinam qual
// visual (principal, SPIN, STOMP B/C ou TAP) aparece no tile.
function demo480ResolveTile(disp, modeId, on, spinState, lastSection) {
  let d = { ...DEFAULT_SW_DISPLAY(), ...(disp || {}) };
  if (modeId === 'spin') {
    const idx = spinState >= 0 && spinState <= 2 ? spinState : 0;
    d = demo480SubDisplay(d, (d.spin || [])[idx] || DEFAULT_SW_SPIN_STATE());
    return { disp: d, on: true };
  }
  if (modeId === 'single') {
    d = demo480SubDisplay(d, (d.spin || [])[0]);
    return { disp: d, on: true };
  }
  if (modeId === 'tap_tempo') {
    d = demo480SubDisplay(d, (d.tap || [])[0]);
    return { disp: d, on: true };
  }
  if ((modeId === 'fx1' || modeId === 'fx2' || modeId === 'fx3') && lastSection > 0) {
    const offset = lastSection === 2 ? 2 : 0;
    d = demo480SubDisplay(d, (d.stomp || [])[offset + (on ? 1 : 0)]);
  }
  return { disp: d, on };
}

function Demo480Tile({ disp, on, shape, layoutId, width, height }) {
  const d = { ...DEFAULT_SW_DISPLAY(), ...(disp || {}) };
  const ic = paletteCssSolid(on ? d.ic_on : d.ic_off);
  const sg = d.sg != null && d.sg >= 0 ? paletteCssSolid(d.sg) : ic;
  const bg = paletteCss(on ? d.bg_on : d.bg_off);
  const br = paletteCssSolid(on ? d.br_on : d.br_off);
  const minDim = Math.min(width, height);
  const circle = shape === 'circle';
  const octagon = shape === 'octagon';
  const tileW = circle ? minDim : width;
  const tileH = circle ? minDim : height;
  const border = br === 'transparent' ? 0 : Math.max(2, Math.floor(minDim * 0.04)) + (bg === 'transparent' ? 1 : 0);
  const sigla = String(d.sigla || '').trim().slice(0, 8);
  const small = layoutId === 3 || layoutId === 4;
  const iconSize = Math.max(14, Math.floor(Math.min(tileW, tileH) * (sigla ? 0.63 : 0.78) * (circle ? 0.82 : octagon ? 0.90 : 1)));
  const style = {
    width: `${tileW}px`, height: `${tileH}px`,
    background: bg === 'transparent' ? 'transparent' : bg,
    border: border ? `${border}px solid ${br}` : 'none',
    borderRadius: circle ? '50%' : octagon ? 0 : `${Math.max(4, Math.floor(minDim * 0.18))}px`,
    clipPath: octagon ? 'polygon(29% 0,71% 0,100% 29%,100% 71%,71% 100%,29% 100%,0 71%,0 29%)' : undefined,
  };
  return (
    <div className="bf-demo-480-tile" style={style}>
      {d.mode === 'text' ? (
        <span className="bf-demo-480-tile-text" style={{ color: ic, fontSize: `${Math.floor(tileH * 0.38)}px` }}>
          {(sigla || '-').slice(0, 3)}
        </span>
      ) : (
        <>
          <SwIconImg iconId={d.icon_id} color={ic} size={iconSize} />
          {sigla && <span className={'bf-demo-480-tile-sigla' + (small ? ' is-small' : '')} style={{ color: sg }}>{sigla}</span>}
        </>
      )}
    </div>
  );
}

function Demo480Name({ meta, label, area, classic = false, big = true }) {
  if (!area) return null;
  const frameMeta = { ...DEFAULT_PRESET_META(), ...(meta || {}) };
  const style = npFrameStyle(frameMeta, 1,
    { x: frameMeta.nameX ?? 50, y: frameMeta.nameY ?? 50 }, classic ? big : false, false);
  if (!classic) {
    style.padding = '8px 14px';
    style.borderRadius = '10px';
    const borderId = clamp(frameMeta.nameBorderColorId, 0, DISPLAY_PALETTE.length - 1);
    if (DISPLAY_PALETTE[borderId]?.type !== DISP_TYPE.TRANSPARENT) {
      const color = paletteCssSolid(borderId);
      const ring = [];
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
        if (x || y) ring.push(`${color} ${x}px ${y}px 0`);
      }
      style.textShadow = ring.join(', ');
    }
  }
  return (
    <foreignObject x={area.x} y={area.y} width={area.w} height={area.h}>
      <div xmlns="http://www.w3.org/1999/xhtml" className="bf-demo-480-name-area">
        <div className="bf-demo-480-name-frame" style={style}>{label}</div>
      </div>
    </foreignObject>
  );
}

function demo480ListLabels(currentTag, currentLabel, bankLetterEnabled) {
  const snapshot = getDemoSnapshot();
  const tags = [];
  for (const [index, letter] of [...'ABCDEFGHIJ'].entries()) {
    if (Array.isArray(bankLetterEnabled) && !bankLetterEnabled[index] && letter !== currentTag[0]) continue;
    for (let n = 1; n <= 6; n++) tags.push(`${letter}${n}`);
  }
  const currentIndex = Math.max(0, tags.indexOf(currentTag));
  const nameFor = (presetTag) => {
    if (presetTag === currentTag) return currentLabel;
    const raw = snapshot?.presets?.[presetTag]?.meta;
    return String(raw?.name_raw ?? raw?.name ?? presetTag).trim() || presetTag;
  };
  return {
    current: nameFor(currentTag),
    next: [1, 2, 3].map((step) => nameFor(tags[(currentIndex + step) % tags.length])),
    previous: [1, 2, 3].map((step) => nameFor(tags[(currentIndex - step + tags.length) % tags.length])),
  };
}

function Bfmidi480Display({
  model, switchMode, gigView, tag, label, meta,
  liveLayout, presetLayout, liveCustomLayout, presetCustomLayout,
  namePresetLive, namePresetBank, iconShape, presetIconShape,
  layer1, layer2, editorLayer, bankLetterEnabled,
  activeLedPixels, spinStates, lastSections,
  bpmOverlay,
}) {
  useImageStore();
  const resolution = displayResolutionFor(model);
  const screenW = resolution.w;
  const screenH = resolution.h;
  const big = screenW >= 400;
  const modelInfo = MODELS.find((item) => item.id === model);
  const is4sw = Number(modelInfo?.switches) <= 4;
  const displayGeometry = { screenW, screenH, is4sw };
  const displayMode = gigView === 'preset' ? 'preset' : gigView === 'live' ? 'live' : switchMode;
  const presetMode = displayMode === 'preset';
  const layout = Number(presetMode ? presetLayout : liveLayout) || (presetMode ? 0 : 1);
  const customMode = (!presetMode && layout === 5) || (presetMode && layout === 6);
  const frameMeta = { ...DEFAULT_PRESET_META(), ...(meta || {}), name: label };
  const backgroundId = presetMode ? frameMeta.bgColorId : frameMeta.backLayersColorId;
  const background = paletteCss(backgroundId);
  const showName = presetMode ? namePresetBank : namePresetLive;
  const shape = presetMode ? presetIconShape : iconShape;
  const rects = (presetMode && layout === 0) || (presetMode && layout === 5)
    ? [] : demo480LayoutRects(layout, presetMode ? presetCustomLayout : liveCustomLayout,
      presetMode, displayGeometry);
  const list = presetMode && layout === 5 ? demo480ListLabels(tag, label, bankLetterEnabled) : null;
  const layerData = (layer) => layer === 2 ? layer2 : layer1;
  const listCenterH = Math.min(screenH, Math.max(34,
    Math.round((frameMeta.fontSize || 18) * 1.2) + (big ? 20 : 16)));
  const listRowH = Math.floor((screenH - listCenterH) / 6);
  const bpmW = big ? 280 : 200;
  const bpmH = big ? 132 : 92;
  const bpmX = (screenW - bpmW) / 2;
  const bpmY = (screenH - bpmH) / 2;
  return (
    <div className={`bf-demo-display ${big ? 'is-480' : 'is-320'}`}>
      <div className="bf-demo-display-glass" style={{ background: background === 'transparent' ? '#000' : background }}>
        <svg className="bf-demo-480-svg" viewBox={`0 0 ${screenW} ${screenH}`}
             preserveAspectRatio="none"
             aria-label={`Display ${model} ${screenW} por ${screenH} ${displayMode.toUpperCase()}`}>
          {rects.map((rect, index) => {
            // Layout 4 mostra os dois layers. Os demais seguem o layer ativo,
            // exatamente como currentLiveLayer no firmware.
            const source = layerData(rect.layout === 4 ? rect.layer : (editorLayer === 2 ? 2 : 1));
            const modeId = source?.modes?.[rect.sw] || 'mute';
            const section = lastSections?.[rect.sw] || 0;
            const arc = section === 1 ? 0 : section === 2 ? 2 : 1;
            const resolved = demo480ResolveTile(source?.display?.[rect.sw], modeId,
              !!activeLedPixels?.[rect.sw]?.[arc], spinStates?.[rect.sw], section);
            return (
              <foreignObject key={`${rect.layer}-${rect.sw}-${index}`} x={rect.x} y={rect.y} width={rect.w} height={rect.h}>
                <div xmlns="http://www.w3.org/1999/xhtml" className="bf-demo-480-tile-wrap">
                  <Demo480Tile disp={resolved.disp} on={resolved.on} shape={shape}
                    layoutId={rect.layout} width={rect.w} height={rect.h} />
                </div>
              </foreignObject>
            );
          })}
          {presetMode && layout === 0 && showName && (
            <Demo480Name meta={frameMeta} label={label}
              area={{ x: 0, y: 0, w: screenW, h: screenH }} classic big={big} />
          )}
          {list && (
            <foreignObject x="0" y="0" width={screenW} height={screenH}>
              <div xmlns="http://www.w3.org/1999/xhtml" className="bf-demo-480-list" style={{
                color: paletteCssSolid(frameMeta.nameColorId),
                fontWeight: frameMeta.fontBold ? 700 : 400,
                fontSize: `${big ? 18 : 15}px`,
                gridTemplateRows: `repeat(3, ${listRowH}px) ${listCenterH}px repeat(3, ${listRowH}px)`,
              }}>
                {[...list.next].reverse().map((name, i) => <span key={`n${i}`}>{name}</span>)}
                <strong style={{
                  color: paletteCssSolid(frameMeta.nameColorId),
                  background: paletteCss(frameMeta.tagColorId),
                  borderColor: paletteCssSolid(frameMeta.nameColorId),
                  fontSize: `${frameMeta.fontSize || 18}px`,
                  fontWeight: frameMeta.fontBold ? 700 : 400,
                }}>{list.current}</strong>
                {list.previous.map((name, i) => <span key={`p${i}`}>{name}</span>)}
              </div>
            </foreignObject>
          )}
          {!list && !(presetMode && layout === 0) && showName && (
            <Demo480Name meta={frameMeta} label={label}
              area={demo480NameArea(layout, presetMode, customMode, displayGeometry)} big={big} />
          )}
          {bpmOverlay?.visible && (
            <g className="bf-demo-bpm-overlay" role="status"
               aria-label={`${bpmOverlay.bpm} BPM`}>
              <rect x={bpmX} y={bpmY} width={bpmW} height={bpmH} rx={big ? 16 : 12}
                    fill="#000" stroke="#fff" strokeWidth="1" />
              <rect x={bpmX + 1} y={bpmY + 1} width={bpmW - 2} height={bpmH - 2}
                    rx={big ? 15 : 11}
                    fill="none" stroke="#fff" strokeWidth="1" />
              <text x={screenW / 2} y={bpmY + (big ? 10 : 7)}
                    textAnchor="middle" dominantBaseline="hanging"
                    fill="#888" fontFamily="Arial, Helvetica, sans-serif"
                    fontSize={big ? 17 : 12} fontWeight="700">BPM</text>
              <text x={screenW / 2} y={bpmY + bpmH / 2 + (big ? 12 : 9)}
                    textAnchor="middle" dominantBaseline="middle"
                    fill="#fff" fontFamily="Arial Black, Arial, Helvetica, sans-serif"
                    fontSize={big ? 75 : 48} fontWeight="800">{bpmOverlay.bpm}</text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

function demoMidiMonitorTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${
    String(now.getMinutes()).padStart(2, '0')}:${
    String(now.getSeconds()).padStart(2, '0')}`;
}

function demoMidiTargetName(channel) {
  return pedalNameForChannel(Number(channel)) || 'MIDI GLOBAL';
}

function demoMidiCcName(message) {
  const channel = Number(message.ch);
  const num = Number(message.num);
  if (isKemperChannel(channel)) {
    const special = KEMPER_NRPN_CCS.find((entry) => Number(entry.value) === num);
    if (special) return special.label;
  }
  const pedal = pedalEntryForChannel(channel);
  return pedal?.cc && CC_LABELS[pedal.cc]?.[num]
    ? CC_LABELS[pedal.cc][num] : `Controle ${num}`;
}

function demoMidiPcName(message) {
  const channel = Number(message.ch);
  const program = Number(message.pc);
  const pedal = pedalEntryForChannel(channel);
  return pedal?.pc && PC_LABELS[pedal.pc]?.[program]
    ? PC_LABELS[pedal.pc][program] : `Preset ${program}`;
}

function demoMidiValueName(message) {
  const def = valueLabelsFor(Number(message.ch), Number(message.num));
  const value = Number(message.val);
  return def?.labels?.[value] || (value === 127 ? 'ON' : value === 0 ? 'OFF' : String(value));
}

function demoMidiHex(bytes) {
  return bytes.map((value) => (Number(value) & 0xFF).toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

// Traduz a mensagem logica usada pelo editor para os bytes que o firmware
// realmente coloca no cabo. PC logico sempre vira CC#0 (bank MSB) + PC; a
// excecao VALETON GP5 usa somente CC#0, exatamente como swBankSendPcLogical.
function demoMidiRawPackets(message) {
  const ch = clamp(Number(message.ch) || 0, 0, 16);
  if (!ch) return [];
  const statusCc = 0xB0 | (ch - 1);
  const statusPc = 0xC0 | (ch - 1);
  if (message.kind === 'pc') {
    const logical = clamp(Number(message.pc) || 0, 0, 16383);
    if (/VALETON GP5/i.test(demoMidiTargetName(ch))) {
      if (logical > 99) return [];
      return [{ bytes: [statusCc, 0, logical], detail: `CC 0 = ${logical} · CH ${ch}` }];
    }
    return [
      { bytes: [statusCc, 0, Math.floor(logical / 128)], detail: `BANK MSB ${Math.floor(logical / 128)} · CH ${ch}` },
      { bytes: [statusPc, logical % 128], detail: `PC ${logical % 128} · CH ${ch}` },
    ];
  }
  if (message.kind !== 'cc') return [];
  const num = Number(message.num);
  const val = Number(message.val) & 0x7F;
  if (num >= 200 && num <= 321 && isKemperChannel(ch)) {
    return [{ bytes: null, detail: `NRPN KEMPER ${num} · VAL ${val} · CH ${ch}` }];
  }
  if (num < 0 || num > 127) return [];
  return [{ bytes: [statusCc, num, val], detail: `CC ${num} = ${val} · CH ${ch}` }];
}

function DemoMidiMonitorCard({ events, mode, onSetMode, onClear }) {
  const list = Array.isArray(events) ? events : [];
  return (
    <section className="bf-demo-midi-monitor" aria-label="Monitor MIDI da controladora virtual">
      <header className="bf-demo-midi-monitor-head">
        <div className="bf-demo-midi-monitor-title">
          <span className="bf-demo-midi-monitor-pulse" aria-hidden="true" />
          <div>
            <span>MONITOR MIDI</span>
            <small>Saída simulada da controladora</small>
          </div>
        </div>
        <div className="bf-demo-midi-monitor-actions">
          <div className="bf-demo-midi-monitor-modes" role="group" aria-label="Visualização do monitor MIDI">
            <button type="button" className={mode === 'friendly' ? 'is-on' : ''}
                    onClick={() => onSetMode('friendly')}>AMIGÁVEL</button>
            <button type="button" className={mode === 'raw' ? 'is-on' : ''}
                    onClick={() => onSetMode('raw')}>AVANÇADO · MIDI PURO</button>
          </div>
          <button type="button" className="bf-demo-midi-monitor-clear" onClick={onClear}
                  disabled={!list.length}>LIMPAR</button>
        </div>
      </header>

      <div className="bf-demo-midi-monitor-body" aria-live="polite">
        {!list.length ? (
          <div className="bf-demo-midi-monitor-empty">
            Acione um preset ou um switch para ver o MIDI enviado.
          </div>
        ) : list.map((event) => {
          const messages = Array.isArray(event.messages) ? event.messages : [];
          const state = event.on === true ? 'ON' : event.on === false ? 'OFF' : '';
          return (
            <article key={event.id} className={`bf-demo-midi-event is-${event.kind}`}>
              <div className="bf-demo-midi-event-time">{event.time}</div>
              <div className="bf-demo-midi-event-content">
                <div className="bf-demo-midi-event-headline">
                  {event.kind === 'preset' ? (
                    <><strong>PRESET {event.tag}</strong><span>{event.name}</span></>
                  ) : (
                    <>
                      <strong>SWITCH {event.sw}</strong>
                      <span>{event.modeLabel || 'MIDI'}</span>
                      {event.sectionLabel && <em>{event.sectionLabel}</em>}
                      {state && <b className={state === 'ON' ? 'is-on' : 'is-off'}>{state}</b>}
                    </>
                  )}
                </div>
                {event.kind === 'preset' && Number(event.triggerSw) > 0 && (
                  <div className="bf-demo-midi-event-trigger">Chamado pelo Switch {event.triggerSw}</div>
                )}
                {!messages.length ? (
                  <div className="bf-demo-midi-no-output">Nenhuma mensagem MIDI foi enviada.</div>
                ) : mode === 'friendly' ? (
                  <div className="bf-demo-midi-friendly-list">
                    {messages.map((message, index) => {
                      const device = demoMidiTargetName(message.ch);
                      const main = message.kind === 'pc'
                        ? demoMidiPcName(message) : demoMidiCcName(message);
                      const value = message.kind === 'cc' ? demoMidiValueName(message) : '';
                      return (
                        <div key={index} className="bf-demo-midi-friendly-row">
                          <span className={`bf-demo-midi-kind is-${message.kind}`}>{message.kind === 'pc' ? 'PC' : 'CC'}</span>
                          <span className="bf-demo-midi-friendly-main">
                            <strong>{message.source || main}</strong>
                            {message.source && <small>{main}</small>}
                          </span>
                          {value && <span className="bf-demo-midi-friendly-value">{value}</span>}
                          <span className="bf-demo-midi-friendly-target">CANAL {message.ch}<small>{device}</small></span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bf-demo-midi-raw-list">
                    {messages.flatMap((message, messageIndex) => {
                      const packets = demoMidiRawPackets(message);
                      return packets.map((packet, packetIndex) => (
                        <div key={`${messageIndex}-${packetIndex}`} className="bf-demo-midi-raw-row">
                          <code>{packet.bytes ? demoMidiHex(packet.bytes) : 'NRPN'}</code>
                          <span>{packet.detail}</span>
                          {message.source && <small>{message.source}</small>}
                        </div>
                      ));
                    })}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DemoControllerModal({
  open, onClose, model, switchMode, onSetSwitchMode,
  bankLetterIndex, presetNumber, bankDisplayName, presetCount,
  onSelectPreset, onPreviousBank, onNextBank,
  swModes, swParams, swDisplay, ledColorMode, letterLedColors, switchLedColors,
  liveLedColor, brightness,
  displayMeta, liveLayout, presetLayout, liveCustomLayout, presetCustomLayout,
  namePresetLive, namePresetBank, iconShape, presetIconShape, gigView,
  editorLayer, swModesL2, swParamsL2, swDisplayL2, bankLetterEnabled,
  layer2Enabled, onSetEditorLayer, bankChangeMode,
  switchOperationMode, hybridSwitchLayout,
  globalSwMode, globalSwParams, globalSwDisplay,
  layer2LedColor,
  livePinGlobal2, global2SwMode, global2SwParams, global2SwDisplay,
  bpmCardSecs, bpmCardAvg,
  nanoSw6Global,
}) {
  const emptyLedPixels = () => Array.from({ length: 9 }, () => [false, false, false]);
  const [activeLedPixels, setActiveLedPixels] = useState(emptyLedPixels);
  const [spinStates, setSpinStates] = useState(() => Array(9).fill(-1));
  const [lastSections, setLastSections] = useState(() => Array(9).fill(0));
  const [globalLedPixels, setGlobalLedPixels] = useState([false, false, false]);
  const [globalSpinState, setGlobalSpinState] = useState(-1);
  const [global2LedPixels, setGlobal2LedPixels] = useState([false, false, false]);
  const [global2SpinState, setGlobal2SpinState] = useState(-1);
  const [globalTapRuntime, setGlobalTapRuntime] = useState({ lastTapMs: 0, intervalMs: 0, phase: 0 });
  const [global2TapRuntime, setGlobal2TapRuntime] = useState({ lastTapMs: 0, intervalMs: 0, phase: 0 });
  const [liveTapRuntimes, setLiveTapRuntimes] = useState(() =>
    Array.from({ length: 9 }, () => ({ intervalMs: 0, phase: 0, nextAt: performance.now() + 300 })));
  const [bpmOverlay, setBpmOverlay] = useState({ visible: false, bpm: 0, untilMs: 0 });
  const [bankPreview, setBankPreview] = useState(null);
  const [pressedSwitch, setPressedSwitch] = useState(0);
  const [midiMonitorMode, setMidiMonitorMode] = useState('friendly');
  const [midiMonitorEvents, setMidiMonitorEvents] = useState([]);
  const midiMonitorSeqRef = useRef(0);
  const midiMonitorWasOpenRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const suppressClickRef = useRef(false);
  const clickTimersRef = useRef({});
  const globalTapLastMsRef = useRef(0);
  const global2TapLastMsRef = useRef(0);
  const liveTapLastMsRef = useRef(Array(9).fill(0));
  const bpmSequenceRef = useRef({ sumMs: 0, count: 0, lastIntervalMs: 0 });
  const modelInfo = MODELS.find((item) => item.id === model) || MODELS[0];
  const switchCount = Math.max(4, Math.min(8, Number(modelInfo?.switches) || 6));
  const displayWide = String(model).startsWith('BFMIDI-3');
  const modelName = String(model).trim();
  // Cada familia compartilha a mesma furacao fisica. As coordenadas abaixo
  // vieram diretamente dos viewBoxes fornecidos (centro real dos recortes).
  const artworkInfo = /^BFMIDI-3 7(?:S|SW\+?)$/i.test(modelName) ? {
    id: '7sw', file: '7SW.svg', viewW: 8853.8, viewH: 6898.93,
    display: { x: 2563.4, y: 410.5, w: 3741.1, h: 2493.9 },
    controlRadius: 515.9, ringRadius: 432, ringOutline: 190, ringFill: 154,
    controls: [
      { sw: 8, cx: 1164.92, cy: 1119.37, label: 'LIVE / MODE' },
      { sw: 7, cx: 7701.56, cy: 1119.37, label: 'SW GLOBAL · SW1/2 e EXP' },
      { sw: 4, cx: 1164.92, cy: 3483.35, label: 'Footswitch 4' },
      { sw: 5, cx: 4433.24, cy: 3496.91, label: 'Footswitch 5' },
      { sw: 6, cx: 7701.56, cy: 3496.91, label: 'Footswitch 6' },
      { sw: 1, cx: 1164.92, cy: 5890.22, label: 'Footswitch 1' },
      { sw: 2, cx: 4433.24, cy: 5890.22, label: 'Footswitch 2' },
      { sw: 3, cx: 7701.56, cy: 5890.22, label: 'Footswitch 3' },
    ],
  } : /NANO/i.test(modelName) ? {
    id: 'nano', file: 'NANO.svg', viewW: 89974.67, viewH: 55129.26,
    display: { x: 25645, y: 14420, w: 38330, h: 26180 },
    controlRadius: 5037.09, ringRadius: 4165, ringOutline: 1850, ringFill: 1500,
    controls: [
      { sw: 4, cx: 9999.87, cy: 7013.34, label: 'Footswitch 4' },
      { sw: 5, cx: 44800.45, cy: 7013.34, label: 'Footswitch 5' },
      { sw: 6, cx: 79501.16, cy: 7013.34, label: 'Footswitch 6' },
      { sw: 1, cx: 9958.93, cy: 46613.58, label: 'Footswitch 1' },
      { sw: 2, cx: 44748.82, cy: 46613.58, label: 'Footswitch 2' },
      { sw: 3, cx: 79501.16, cy: 46613.58, label: 'Footswitch 3' },
    ],
  } : /MICRO/i.test(modelName) ? {
    id: 'micro', file: 'MICRO.svg', viewW: 13533.28, viewH: 9692.56,
    display: { x: 4525, y: 3160, w: 4480, h: 3390 },
    controlRadius: 973.8, ringRadius: 805, ringOutline: 358, ringFill: 290,
    controls: [
      { sw: 3, cx: 1663.47, cy: 1349.05, label: 'Footswitch 3' },
      { sw: 4, cx: 11861.45, cy: 1349.05, label: 'Footswitch 4' },
      { sw: 1, cx: 1663.47, cy: 8086.67, label: 'Footswitch 1' },
      { sw: 2, cx: 11861.45, cy: 8086.67, label: 'Footswitch 2' },
    ],
  } : /(?: 6S| 6SW\+)$/i.test(modelName) ? {
    id: '6sw', file: '6SW.svg', viewW: 15381.74, viewH: 5339.98,
    display: { x: 680, y: 1095, w: 4560, h: 3055 },
    // O SVG tem recortes de raio 596,37. Antes o controle usava raio 421,7
    // e centros 174,67 acima, ficando menor e deslocado dentro dos recortes.
    // Mantem aqui as mesmas proporcoes visuais dos layouts NANO e MICRO.
    controlRadius: 596.37, ringRadius: 493, ringOutline: 219, ringFill: 178,
    controls: [
      { sw: 4, cx: 6499.5, cy: 1193.41, label: 'Footswitch 4' },
      { sw: 5, cx: 10425.74, cy: 1193.41, label: 'Footswitch 5' },
      { sw: 6, cx: 14367, cy: 1193.41, label: 'Footswitch 6' },
      { sw: 1, cx: 6499.5, cy: 4054.79, label: 'Footswitch 1' },
      { sw: 2, cx: 10425.74, cy: 4054.79, label: 'Footswitch 2' },
      { sw: 3, cx: 14367, cy: 4054.79, label: 'Footswitch 3' },
    ],
  } : null;
  const hasControllerArtwork = !!artworkInfo;
  const selectedTag = `${String.fromCharCode(65 + (bankLetterIndex || 0))}${presetNumber || 1}`;
  const visualBankIndex = bankPreview?.bank ?? bankLetterIndex ?? 0;
  const visualPresetNumber = bankPreview?.preset ?? presetNumber ?? 1;
  const letter = String.fromCharCode(65 + visualBankIndex);
  const tag = `${letter}${visualPresetNumber}`;
  const demoNames = ['CLEAN AMBIENT', 'CRUNCH', 'LEAD', 'MODULATION', 'DELAY', 'SOLO'];
  const previewRawMeta = bankPreview ? getDemoSnapshot()?.presets?.[tag]?.meta : null;
  const visualDisplayMeta = previewRawMeta ? metaFromApi(previewRawMeta) : displayMeta;
  const displayName = String(visualDisplayMeta?.name?.trim() || bankDisplayName ||
    demoNames[visualPresetNumber - 1] || `PRESET ${tag}`);
  const nextEnabledBank = (from, direction = 1) => {
    for (let step = 1; step <= BANK_LETTER_COUNT; step++) {
      const candidate = (from + direction * step + BANK_LETTER_COUNT * 2) % BANK_LETTER_COUNT;
      if (bankLetterEnabled?.[candidate]) return candidate;
    }
    return from;
  };
  const isHybridLiveSwitch = (sw) => switchMode === 'preset' && Number(switchOperationMode) === 1 &&
    (Number(hybridSwitchLayout) === 2 ? sw <= 3 : sw >= 4);
  const liveModeName = (sw) => {
    const modeId = swModes?.[sw] || 'mute';
    const mode = SW_MODES.find((item) => item.id === modeId);
    if (modeId === 'spin') {
      const state = spinStates[sw] >= 0 && spinStates[sw] <= 2 ? spinStates[sw] : 0;
      const spinDisplay = swDisplay?.[sw]?.spin?.[state];
      return spinDisplay?.sigla || `SPIN ${state + 1}`;
    }
    return swDisplay?.[sw]?.sigla || mode?.title || `SW ${sw}`;
  };
  const ledIndexFor = (sw) => {
    if (sw === 7) {
      const params = globalSwParams?.[globalSwMode] || DEFAULT_SW_PARAMS(globalSwMode || 'fx1');
      return Number(params?.color) || 1;
    }
    if (sw === 8 && livePinGlobal2) {
      const params = global2SwParams?.[global2SwMode] || DEFAULT_SW_PARAMS(global2SwMode || 'fx1');
      return Number(params?.color) || 1;
    }
    if (sw > 7) return editorLayer === 2 && layer2Enabled
      ? Number(layer2LedColor) || Number(liveLedColor) || 7
      : Number(liveLedColor) || 7;
    if (ledColorMode === 'numeros') return Number(switchLedColors?.[sw - 1]) || 7;
    return Number(letterLedColors?.[bankLetterIndex]) || 7;
  };
  const ledFor = (sw) => LED_COLORS[ledIndexFor(sw)]?.hex || '#ff7a1a';
  const modeParamsFor = (sw) => {
    const modeId = swModes?.[sw] || 'mute';
    return {
      modeId,
      params: (swParams?.[sw]?.[modeId]) || DEFAULT_SW_PARAMS(modeId) || {},
    };
  };
  const colorFromParam = (value, fallback) => {
    const id = Number(value);
    return Number.isFinite(id) && LED_COLORS[id] ? LED_COLORS[id].hex : fallback;
  };
  // Ordem visual dos arcos: 0=inferior (pixel 2), 1=superior esquerdo
  // (pixel 1), 2=superior direito (pixel 3). E a mesma usada no firmware.
  const ledArcColorsFor = (sw) => {
    const fallback = ledFor(sw);
    if (sw === 7) {
      const params = { ...DEFAULT_SW_PARAMS(globalSwMode || 'fx1'), ...(globalSwParams?.[globalSwMode] || {}) };
      return [colorFromParam(params.color2, fallback), fallback, colorFromParam(params.color3, fallback)];
    }
    if (sw === 8 && livePinGlobal2) {
      const params = { ...DEFAULT_SW_PARAMS(global2SwMode || 'fx1'), ...(global2SwParams?.[global2SwMode] || {}) };
      return [colorFromParam(params.color2, fallback), fallback, colorFromParam(params.color3, fallback)];
    }
    if ((switchMode !== 'live' && !isHybridLiveSwitch(sw)) || sw > 6) return [fallback, fallback, fallback];
    const { modeId, params } = modeParamsFor(sw);
    const colorA = colorFromParam(params.color, fallback);
    const colorB = colorFromParam(params.color2, colorA);
    const colorC = colorFromParam(params.color3, colorA);
    const hasB = (Number(params.ch2) >= 1 && Number(params.ch2) <= 16) || Number(params.fav2) === 1;
    const hasC = (Number(params.ch3) >= 1 && Number(params.ch3) <= 16) || Number(params.fav3) === 1;
    if ((modeId === 'fx1' || modeId === 'fx3') && hasC) return [colorB, colorA, colorC];
    if ((modeId === 'fx1' || modeId === 'fx3' || modeId === 'fx2') && hasB) {
      return [colorB, colorA, colorA];
    }
    if (modeId === 'fx2') return [colorB, colorA, colorA];
    return [colorA, colorA, colorA];
  };
  const primaryPixelMaskFor = (sw) => {
    const { modeId, params } = modeParamsFor(sw);
    const hasB = (Number(params.ch2) >= 1 && Number(params.ch2) <= 16) || Number(params.fav2) === 1;
    const hasC = (Number(params.ch3) >= 1 && Number(params.ch3) <= 16) || Number(params.fav3) === 1;
    if ((modeId === 'fx1' || modeId === 'fx3') && hasC) return [false, true, false];
    if ((modeId === 'fx1' || modeId === 'fx3' || modeId === 'fx2') && hasB) return [false, true, true];
    if (modeId === 'fx2') return [false, true, true];
    return [true, true, true];
  };
  const spinArcsForState = (state) => {
    // spinState 0/1/2 = pixel fisico 1/2/3. Na arte, esses pixels ficam
    // respectivamente nos arcos sup. esquerdo / inferior / sup. direito.
    if (state === 1) return [true, false, false];
    if (state === 2) return [false, false, true];
    return [false, true, false];
  };
  const activeSwitches = new Set(
    Array.from({ length: 6 }, (_, index) => index + 1)
      .filter((sw) => (swModes?.[sw] === 'spin') || activeLedPixels[sw]?.some(Boolean))
  );
  // swModes/swParams/swDisplay sempre guardam o layer que esta aberto no
  // editor; os objetos L2 sao o stash do outro. Reconstroi L1/L2 fisicos para
  // o layout 4 do display ficar igual ao firmware.
  const layer1 = editorLayer === 2
    ? { modes: swModesL2, params: swParamsL2, display: swDisplayL2 }
    : { modes: swModes, params: swParams, display: swDisplay };
  const layer2 = editorLayer === 2
    ? { modes: swModes, params: swParams, display: swDisplay }
    : { modes: swModesL2, params: swParamsL2, display: swDisplayL2 };

  const appendMidiMonitorEvent = (event) => {
    if (!event) return;
    midiMonitorSeqRef.current += 1;
    const nextEvent = {
      ...event,
      id: `${Date.now()}-${midiMonitorSeqRef.current}`,
      time: demoMidiMonitorTime(),
    };
    setMidiMonitorEvents((current) => [nextEvent, ...current].slice(0, 24));
  };

  const presetMonitorEvent = (targetPreset, targetBank, triggerSw = 0) => {
    const safeBank = clamp(Number(targetBank) || 0, 0, BANK_LETTER_COUNT - 1);
    const safePreset = clamp(Number(targetPreset) || 1, 1, presetCount);
    const targetTag = `${BANK_LETTERS[safeBank] || 'A'}${safePreset}`;
    const snapshot = getDemoSnapshot();
    const rawPreset = snapshot?.presets?.[targetTag] || null;
    const rawMeta = rawPreset?.meta || {};
    const meta = rawPreset ? metaFromApi(rawMeta) : visualDisplayMeta;
    const messages = [];
    const mainCh = Number(meta?.channel) || 0;
    if (mainCh >= 1 && mainCh <= 16) {
      messages.push({ ...pcMsg(mainCh, Number(meta?.bank) || 0), source: 'HEADER DO PRESET' });
    }
    (meta?.extraPcs || []).forEach((entry, index) => {
      const ch = Number(entry.ch);
      if (ch >= 1 && ch <= 16) {
        messages.push({ ...pcMsg(ch, Number(entry.program) || 0), source: `PC EXTRA ${index + 1}` });
      }
    });
    (meta?.extraCcs || []).forEach((entry, index) => {
      const ch = Number(entry.ch);
      if (ch >= 1 && ch <= 16) {
        messages.push({ ...ccMsg(ch, Number(entry.ctrl) || 0, Number(entry.value) || 0), source: `CC EXTRA ${index + 1}` });
      }
    });

    const parsedParams = rawPreset
      ? parseSwParamsObjByLayer(snapshot?.swParams?.[targetTag] || {})
      : { l1: layer1.params || {}, l2: layer2.params || {} };
    const modesL1 = rawPreset
      ? parseSwModesStr(rawMeta.sw_modes || '') : (layer1.modes || {});
    const modesL2 = rawPreset
      ? parseSwModesStr(rawMeta.sw_modes_l2 || '') : (layer2.modes || {});
    const addInitialLayerMidi = (modes, params, layerLabel) => {
      for (let sw = 1; sw <= 6; sw++) {
        const modeId = modes?.[sw] || 'mute';
        const modeParams = params?.[sw]?.[modeId];
        const entry = buildSnapshotSwEntry(sw, modeId, modeParams);
        (entry.sections || []).forEach((section) => {
          const reactiveOnly = (section.flags || []).some((flag) =>
            String(flag).includes('@ PRESS') || String(flag).includes('@ HOLD'));
          if (reactiveOnly) return;
          (section.messages || []).forEach((message) => {
            messages.push({
              ...message,
              source: `${layerLabel} · SWITCH ${sw} · ${entry.modeLabel}`,
            });
          });
        });
      }
    };
    addInitialLayerMidi(modesL1, parsedParams.l1, 'LAYER 1');
    if (Number(rawMeta.layer2 ?? meta?.layer2) === 1) {
      addInitialLayerMidi(modesL2, parsedParams.l2, 'LAYER 2');
    }
    return {
      kind: 'preset', tag: targetTag,
      name: String(meta?.name || targetTag), triggerSw, messages,
    };
  };

  const selectPresetWithMonitor = (targetPreset, targetBank, triggerSw = 0) => {
    appendMidiMonitorEvent(presetMonitorEvent(targetPreset, targetBank, triggerSw));
    return onSelectPreset(targetPreset, targetBank);
  };

  const navigateBankWithMonitor = (direction) => {
    const targetBank = nextEnabledBank(bankLetterIndex, direction);
    appendMidiMonitorEvent(presetMonitorEvent(presetNumber, targetBank));
    return direction > 0 ? onNextBank() : onPreviousBank();
  };

  const switchMonitorEvent = (sw, section, modeId, params, pixels, spinState) => {
    let nextState = null;
    if (modeId === 'spin' && section === 0) {
      nextState = spinState < 0 ? 0 : (spinState + 1) % 3;
    } else if (modeId === 'spin' && section === 1) {
      if (sw <= 6) {
        const activeArc = spinState === 1 ? 0 : spinState === 2 ? 2 : 1;
        nextState = !pixels?.some((value, arc) => arc !== activeArc && value);
      } else {
        nextState = !pixels?.some(Boolean);
      }
    } else if (modeId === 'fx1' || modeId === 'fx2' || modeId === 'fx3' ||
               modeId === 'macros' || modeId === 'ramp') {
      if (sw <= 6) {
        const mask = section === 1 ? [true, false, false]
          : section === 2 ? [false, false, true] : primaryPixelMaskFor(sw);
        nextState = !mask.every((enabled, arc) => !enabled || pixels?.[arc]);
      } else {
        nextState = !pixels?.some(Boolean);
      }
    } else if (modeId === 'tap_tempo' && section === 1) {
      nextState = !pixels?.some(Boolean);
    }
    const modes = { [sw]: modeId };
    const paramsMap = { [sw]: { [modeId]: params } };
    const event = buildLivePressEvent(sw, section, nextState, modes, paramsMap);
    if (!event) return null;
    const messages = (event.messages || []).filter((message) => {
      if (message.kind === 'pc' || message.kind === 'fav') return true;
      const num = Number(message.num);
      if (num >= 0 && num <= 127) return true;
      return num >= 200 && num <= 321 && isKemperChannel(Number(message.ch));
    });
    return { ...event, kind: 'switch', messages };
  };

  const liveButtonTap = () => {
    if (switchMode === 'preset') {
      onSetEditorLayer?.(1);
      onSetSwitchMode('live');
      return;
    }
    if (layer2Enabled) {
      onSetEditorLayer?.(editorLayer === 2 ? 1 : 2);
    } else {
      onSetSwitchMode('preset');
    }
  };

  const runSpecialCommand = (num) => {
    const command = Number(num);
    if (command === 128) { navigateBankWithMonitor(1); return true; }
    if (command === 129) { navigateBankWithMonitor(-1); return true; }
    if (command === 130) { selectPresetWithMonitor((presetNumber % presetCount) + 1, bankLetterIndex); return true; }
    if (command === 131) { selectPresetWithMonitor(((presetNumber + presetCount - 2) % presetCount) + 1, bankLetterIndex); return true; }
    if (command === 132) { onSetSwitchMode('preset'); return true; }
    if (command === 133) {
      if (switchMode === 'live' && layer2Enabled) onSetEditorLayer?.(editorLayer === 2 ? 1 : 2);
      return true;
    }
    if (command === 134) { liveButtonTap(); return true; }
    return false;
  };

  const specialNumbersFor = (modeId, params) => {
    if (modeId === 'macros') return parseMslots(params.mslots || '').filter((slot) => slot.t !== 1).map((slot) => slot.num);
    if (modeId === 'momentary') return parseMomSlots(params.mom_slots || '').map((slot) => slot.num).concat(params.num);
    if (modeId === 'single') return parseSingleSlots(params.sslots || '').filter((slot) => slot.t !== 1).map((slot) => slot.num)
      .concat(Number(params.as_pc) === 1 ? [] : [params.num]);
    if (modeId === 'tap_tempo') return parseTapSlots(params.tslots || '').map((slot) => slot.num);
    if (modeId === 'spin') return parseSpinSlots(params.spin_slots || '').map((slot) => slot.num).concat(params.num);
    return [params.num];
  };

  const runConfiguredSpecial = (modeId, params) => {
    let handled = false;
    for (const num of specialNumbersFor(modeId, params)) {
      if (runSpecialCommand(num)) handled = true;
    }
    return handled;
  };

  useEffect(() => {
    if (open && !midiMonitorWasOpenRef.current) {
      midiMonitorWasOpenRef.current = true;
      midiMonitorSeqRef.current = 0;
      setMidiMonitorMode('friendly');
      const initial = presetMonitorEvent(presetNumber, bankLetterIndex);
      setMidiMonitorEvents([{
        ...initial,
        id: `${Date.now()}-0`,
        time: demoMidiMonitorTime(),
      }]);
    } else if (!open) {
      midiMonitorWasOpenRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      clearTimeout(longPressTimerRef.current);
      Object.values(clickTimersRef.current).forEach(clearTimeout);
      clickTimersRef.current = {};
    };
  }, [open, onClose]);

  useEffect(() => {
    const nextPixels = emptyLedPixels();
    setLastSections(Array(9).fill(0));
    setBankPreview(null);
    liveTapLastMsRef.current = Array(9).fill(0);
    const tapStartMs = performance.now();
    setLiveTapRuntimes(Array.from({ length: 9 }, () => ({
      intervalMs: 0, phase: 0, nextAt: tapStartMs + 300,
    })));
    const nextSpinStates = Array(9).fill(-1);
    let lastSingle = -1;
    for (let sw = 1; sw <= 6; sw++) {
      const { modeId, params } = modeParamsFor(sw);
      if (modeId === 'spin') {
        // Espelha SW_BANK.h: at_preset ativo inicia no estado/pixel 1.
        // Sem ele, o firmware fica awaiting (-1), piscando o mesmo pixel 1.
        nextSpinStates[sw] = Number(params.at_preset) !== 0 ? 0 : -1;
      } else if (modeId === 'fx1' || modeId === 'fx2' || modeId === 'fx3') {
        const stateA = Number(params.fav) !== 1 && Number(params.ch) >= 1 && Number(params.ch) <= 16
          ? (Number(params.start) === 1) !== (Number(params.inv) === 1) : false;
        const hasB = Number(params.ch2) >= 1 && Number(params.ch2) <= 16 || Number(params.fav2) === 1;
        const hasC = modeId !== 'fx2' &&
          (Number(params.ch3) >= 1 && Number(params.ch3) <= 16 || Number(params.fav3) === 1);
        const stateB = Number(params.fav2) !== 1 && Number(params.ch2) >= 1 && Number(params.ch2) <= 16
          ? (Number(params.start2) === 1) !== (Number(params.inv2) === 1) : false;
        const stateC = Number(params.fav3) !== 1 && Number(params.ch3) >= 1 && Number(params.ch3) <= 16
          ? (Number(params.start3) === 1) !== (Number(params.inv3) === 1) : false;
        nextPixels[sw] = hasC ? [stateB, stateA, stateC]
          : hasB ? [stateB, stateA, stateA] : [stateA, stateA, stateA];
      } else if (modeId === 'macros') {
        const on = (Number(params.start) === 1) !== (Number(params.inv) === 1);
        nextPixels[sw] = [on, on, on];
      } else if (modeId === 'ramp') {
        const on = Number(params.start_on) === 1;
        nextPixels[sw] = [on, on, on];
      } else if (modeId === 'tap_tempo') {
        nextPixels[sw] = [false, true, false];
      } else if (modeId === 'single' && Number(params.at_preset) !== 0) {
        const configured = parseSingleSlots(params.sslots || '').some((slot) =>
          (slot.ch >= 1 && slot.ch <= 16) || (slot.t !== 1 && slot.num >= 128 && slot.num <= 134));
        if (configured || (Number(params.ch) >= 1 && Number(params.ch) <= 16)) lastSingle = sw;
      }
    }
    if (lastSingle > 0) nextPixels[lastSingle] = [true, true, true];
    setActiveLedPixels(nextPixels);
    setSpinStates(nextSpinStates);
  }, [selectedTag, swModes, swParams]);

  // O SW GLOBAL vive fora do preset e conserva seu estado entre trocas.
  // Ele so apaga quando a opcao RESET ON PRESET estiver habilitada, como no firmware.
  useEffect(() => {
    const resetGlobal = (modeId, paramsByMode, setPixels, setSpin) => {
      const params = { ...DEFAULT_SW_PARAMS(modeId), ...(paramsByMode?.[modeId] || {}) };
      if (modeId !== 'single' || Number(params.reset_on_preset) !== 1) return;
      setPixels([false, false, false]);
      setSpin(-1);
    };
    resetGlobal(globalSwMode, globalSwParams, setGlobalLedPixels, setGlobalSpinState);
    resetGlobal(global2SwMode, global2SwParams, setGlobal2LedPixels, setGlobal2SpinState);
  }, [selectedTag]);

  // O firmware reinicia o runtime do GLOBAL quando seu modo muda. Em TAP,
  // o estado ocioso ja nasce no pixel fisico 1 e continua ciclando 1/2/3.
  useEffect(() => {
    globalTapLastMsRef.current = 0;
    setGlobalTapRuntime({ lastTapMs: 0, intervalMs: 0, phase: 0 });
    setGlobalLedPixels(globalSwMode === 'tap_tempo'
      ? spinArcsForState(0) : [false, false, false]);
  }, [globalSwMode]);

  useEffect(() => {
    global2TapLastMsRef.current = 0;
    setGlobal2TapRuntime({ lastTapMs: 0, intervalMs: 0, phase: 0 });
    setGlobal2LedPixels(global2SwMode === 'tap_tempo'
      ? spinArcsForState(0) : [false, false, false]);
  }, [global2SwMode]);

  const tapLedOnMs = (intervalMs) => Math.max(60, Math.floor(intervalMs * 2 / 3));

  // TAP GLOBAL 1: sem BPM, um pixel por vez a cada 300ms; com BPM medido,
  // os tres pixels alternam ON/OFF uma vez por batida (ON = ~2/3 do tempo).
  useEffect(() => {
    if (!open || globalSwMode !== 'tap_tempo') return undefined;
    const { intervalMs, phase } = globalTapRuntime;
    setGlobalLedPixels(intervalMs > 0
      ? (phase === 1 ? [true, true, true] : [false, false, false])
      : spinArcsForState(phase));
    const onMs = tapLedOnMs(intervalMs);
    const delay = intervalMs > 0
      ? (phase === 1 ? onMs : Math.max(60, intervalMs - onMs))
      : 300;
    const timer = window.setTimeout(() => {
      setGlobalTapRuntime((current) => ({
        ...current,
        phase: current.intervalMs > 0 ? ((current.phase + 1) & 1) : ((current.phase + 1) % 3),
      }));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [open, globalSwMode, globalTapRuntime.intervalMs, globalTapRuntime.phase]);

  // GLOBAL 2 usa exatamente o mesmo motor quando o botao LIVE foi roteado
  // para a segunda funcao global.
  useEffect(() => {
    if (!open || global2SwMode !== 'tap_tempo') return undefined;
    const { intervalMs, phase } = global2TapRuntime;
    setGlobal2LedPixels(intervalMs > 0
      ? (phase === 1 ? [true, true, true] : [false, false, false])
      : spinArcsForState(phase));
    const onMs = tapLedOnMs(intervalMs);
    const delay = intervalMs > 0
      ? (phase === 1 ? onMs : Math.max(60, intervalMs - onMs))
      : 300;
    const timer = window.setTimeout(() => {
      setGlobal2TapRuntime((current) => ({
        ...current,
        phase: current.intervalMs > 0 ? ((current.phase + 1) & 1) : ((current.phase + 1) % 3),
      }));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [open, global2SwMode, global2TapRuntime.intervalMs, global2TapRuntime.phase]);

  // Os TAPs dos SW1..6 usam a mesma animacao do firmware. Um unico timer
  // atende todos os switches ativos e acorda apenas no proximo deadline.
  useEffect(() => {
    if (!open) return undefined;
    const active = Array.from({ length: 6 }, (_, index) => index + 1).filter((sw) =>
      swModes?.[sw] === 'tap_tempo' &&
      (switchMode === 'live' || (switchMode === 'preset' && Number(switchOperationMode) === 1 &&
        (Number(hybridSwitchLayout) === 2 ? sw <= 3 : sw >= 4))));
    if (!active.length) return undefined;
    const now = performance.now();
    const deadline = Math.min(...active.map((sw) => liveTapRuntimes[sw]?.nextAt || now));
    const timer = window.setTimeout(() => {
      const tickNow = performance.now();
      setLiveTapRuntimes((current) => current.map((runtime, sw) => {
        if (!active.includes(sw) || (runtime.nextAt || 0) > tickNow + 2) return runtime;
        const phase = runtime.intervalMs > 0
          ? ((runtime.phase + 1) & 1) : ((runtime.phase + 1) % 3);
        const onMs = tapLedOnMs(runtime.intervalMs);
        const step = runtime.intervalMs > 0
          ? (phase === 1 ? onMs : Math.max(60, runtime.intervalMs - onMs))
          : 300;
        let nextAt = (runtime.nextAt || tickNow) + step;
        const cycleMs = runtime.intervalMs > 0 ? runtime.intervalMs : 300;
        if (tickNow - nextAt > cycleMs) nextAt = tickNow + step;
        return { ...runtime, phase, nextAt };
      }));
    }, Math.max(1, deadline - now));
    return () => window.clearTimeout(timer);
  }, [open, switchMode, switchOperationMode, hybridSwitchLayout, swModes, liveTapRuntimes]);

  useEffect(() => {
    if (!open) return;
    setActiveLedPixels((current) => {
      const next = current.map((pixels) => [...pixels]);
      for (let sw = 1; sw <= 6; sw++) {
        const hybridLive = switchMode === 'preset' && Number(switchOperationMode) === 1 &&
          (Number(hybridSwitchLayout) === 2 ? sw <= 3 : sw >= 4);
        if (swModes?.[sw] !== 'tap_tempo' || (switchMode !== 'live' && !hybridLive)) continue;
        const runtime = liveTapRuntimes[sw];
        next[sw] = runtime.intervalMs > 0
          ? (runtime.phase === 1 ? [true, true, true] : [false, false, false])
          : spinArcsForState(runtime.phase);
      }
      return next;
    });
  }, [open, switchMode, switchOperationMode, hybridSwitchLayout, swModes, liveTapRuntimes]);

  // O card some no prazo configurado, contado a partir do ultimo intervalo
  // valido. Alterar a configuracao para OFF remove imediatamente o overlay.
  useEffect(() => {
    if (!bpmOverlay.visible) return undefined;
    if (Number(bpmCardSecs) <= 0) {
      setBpmOverlay({ visible: false, bpm: 0, untilMs: 0 });
      return undefined;
    }
    const remaining = Math.max(0, bpmOverlay.untilMs - performance.now());
    const timer = window.setTimeout(() => {
      setBpmOverlay((current) => current.untilMs === bpmOverlay.untilMs
        ? { ...current, visible: false } : current);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [bpmOverlay.visible, bpmOverlay.untilMs, bpmCardSecs]);

  const showBpmForInterval = (rawIntervalMs) => {
    const secs = clamp(Number(bpmCardSecs) || 0, 0, 30);
    if (secs <= 0) return;
    const intervalMs = clamp(Math.round(rawIntervalMs), 100, 3000);
    const now = performance.now();
    const sequence = bpmSequenceRef.current;
    if (sequence.count === 0 || now - sequence.lastIntervalMs > 2500) {
      sequence.sumMs = 0;
      sequence.count = 0;
    }
    sequence.sumMs += intervalMs;
    sequence.count += 1;
    sequence.lastIntervalMs = now;
    const shownMs = bpmCardAvg && sequence.count > 1
      ? Math.floor(sequence.sumMs / sequence.count) : intervalMs;
    const bpm = Math.floor((60000 + Math.floor(shownMs / 2)) / shownMs);
    setBpmOverlay({ visible: true, bpm, untilMs: now + secs * 1000 });
  };

  if (!open) return null;

  const flashPixels = (sw, mask = [true, true, true], duration = 170) => {
    setActiveLedPixels((current) => {
      const next = current.map((pixels) => [...pixels]);
      next[sw] = next[sw].map((value, arc) => mask[arc] ? true : value);
      return next;
    });
    window.setTimeout(() => setActiveLedPixels((current) => {
      const next = current.map((pixels) => [...pixels]);
      next[sw] = next[sw].map((value, arc) => mask[arc] ? false : value);
      return next;
    }), duration);
  };

  const toggleSection = (sw, section) => {
    const mask = section === 1 ? [true, false, false]
      : section === 2 ? [false, false, true] : primaryPixelMaskFor(sw);
    setLastSections((current) => {
      const next = [...current]; next[sw] = section; return next;
    });
    setActiveLedPixels((current) => {
      const next = current.map((pixels) => [...pixels]);
      const turnOn = !mask.every((enabled, arc) => !enabled || next[sw][arc]);
      next[sw] = next[sw].map((value, arc) => mask[arc] ? turnOn : value);
      return next;
    });
  };

  const configuredFavorite = (params, section, sw = 0) => {
    const suffix = section === 1 ? '2' : section === 2 ? '3' : '';
    if (Number(params[`fav${suffix}`]) !== 1) return false;
    const targetBank = clamp(params[`fav_bank${suffix}`], 0, BANK_LETTER_COUNT - 1);
    const targetPreset = clamp(params[`fav_preset${suffix}`] || 1, 1, presetCount);
    Promise.resolve(selectPresetWithMonitor(targetPreset, targetBank, sw)).then(() => {
      if (Number(params[`fav_mode${suffix}`]) === 1) {
        onSetSwitchMode('live');
        if (Number(params[`fav_layer${suffix}`]) === 1) onSetEditorLayer?.(2);
      } else {
        onSetSwitchMode('preset');
      }
    });
    return true;
  };

  const pressLiveSwitch = (sw, section = 0) => {
    const { modeId, params } = modeParamsFor(sw);
    if (modeId === 'mute') return;
    if ((modeId === 'fx1' || modeId === 'fx2' || modeId === 'fx3')) {
      if (configuredFavorite(params, section, sw)) return;
      const suffix = section === 1 ? '2' : section === 2 ? '3' : '';
      if (runSpecialCommand(params[`num${suffix}`])) return;
      appendMidiMonitorEvent(switchMonitorEvent(
        sw, section, modeId, params, activeLedPixels[sw], spinStates[sw]));
      toggleSection(sw, section);
      return;
    }
    if (section === 0) {
      const handled = runConfiguredSpecial(modeId, params);
      // Os slots MIDI/comandos fazem parte do toque, mas no TAP o mesmo gesto
      // tambem precisa alimentar o relogio e o card de BPM.
      if (handled && modeId !== 'tap_tempo') return;
    }
    if (modeId === 'spin') {
      if (section === 1) {
        if (runSpecialCommand(params.lp_num)) return;
        appendMidiMonitorEvent(switchMonitorEvent(
          sw, section, modeId, params, activeLedPixels[sw], spinStates[sw]));
        setLastSections((current) => { const next = [...current]; next[sw] = 1; return next; });
        setActiveLedPixels((current) => {
          const next = current.map((pixels) => [...pixels]);
          const activeArc = spinStates[sw] === 1 ? 0 : spinStates[sw] === 2 ? 2 : 1;
          const turnOn = !next[sw].some((value, arc) => arc !== activeArc && value);
          next[sw] = next[sw].map((value, arc) => arc === activeArc ? false : turnOn);
          return next;
        });
        return;
      }
      appendMidiMonitorEvent(switchMonitorEvent(
        sw, section, modeId, params, activeLedPixels[sw], spinStates[sw]));
      setSpinStates((current) => {
        const next = [...current];
        next[sw] = current[sw] < 0 ? 0 : (current[sw] + 1) % 3;
        return next;
      });
      return;
    }
    if (modeId === 'single') {
      if (section > 0) {
        const field = section === 1 ? 'lslots' : 'rslots';
        let handled = false;
        for (const slot of parseSingleSlots(params[field] || '')) {
          if (slot.t !== 1 && runSpecialCommand(slot.num)) handled = true;
        }
        if (handled) return;
      }
      appendMidiMonitorEvent(switchMonitorEvent(
        sw, section, modeId, params, activeLedPixels[sw], spinStates[sw]));
      setActiveLedPixels((current) => current.map((pixels, index) =>
        index > 0 && swModes?.[index] === 'single'
          ? (index === sw ? [true, true, true] : [false, false, false])
          : [...pixels]));
      setLastSections((current) => { const next = [...current]; next[sw] = section; return next; });
      return;
    }
    if (modeId === 'tap_tempo') {
      if (section === 1) {
        if (runSpecialCommand(params.lp_num)) return;
        appendMidiMonitorEvent(switchMonitorEvent(
          sw, section, modeId, params, activeLedPixels[sw], spinStates[sw]));
        return;
      }
      appendMidiMonitorEvent(switchMonitorEvent(
        sw, section, modeId, params, activeLedPixels[sw], spinStates[sw]));
      registerLiveTap(sw);
      return;
    }
    if (modeId === 'momentary') {
      appendMidiMonitorEvent(switchMonitorEvent(
        sw, section, modeId, params, activeLedPixels[sw], spinStates[sw]));
      flashPixels(sw);
      return;
    }
    if (modeId === 'ramp' && Number(params.trigger) === 1) {
      appendMidiMonitorEvent(switchMonitorEvent(
        sw, section, modeId, params, activeLedPixels[sw], spinStates[sw]));
      flashPixels(sw, [true, true, true], 240);
      return;
    }
    // STOMP/MACROS/RAMP toggle/loop: o estado permanece ate o proximo toque.
    appendMidiMonitorEvent(switchMonitorEvent(
      sw, section, modeId, params, activeLedPixels[sw], spinStates[sw]));
    toggleSection(sw, 0);
  };

  const registerLiveTap = (sw) => {
    const now = performance.now();
    const lastTapMs = liveTapLastMsRef.current[sw] || 0;
    liveTapLastMsRef.current[sw] = now;
    const elapsed = lastTapMs > 0 ? now - lastTapMs : 0;
    if (elapsed > 0 && elapsed <= 2500) {
      const intervalMs = clamp(Math.round(elapsed), 100, 3000);
      setLiveTapRuntimes((current) => current.map((runtime, index) => index === sw
        ? { ...runtime, intervalMs, phase: 1, nextAt: now + tapLedOnMs(intervalMs) }
        : runtime));
      showBpmForInterval(intervalMs);
      return;
    }
    setLiveTapRuntimes((current) => current.map((runtime, index) => index === sw
      ? { ...runtime, intervalMs: 0, nextAt: runtime.nextAt > now ? runtime.nextAt : now + 300 }
      : runtime));
  };

  const registerGlobalTap = (second = false) => {
    const now = performance.now();
    const lastRef = second ? global2TapLastMsRef : globalTapLastMsRef;
    const lastTapMs = lastRef.current;
    lastRef.current = now;
    const elapsed = lastTapMs > 0 ? now - lastTapMs : 0;
    const setRuntime = second ? setGlobal2TapRuntime : setGlobalTapRuntime;
    if (elapsed > 0 && elapsed <= 2500) {
      const intervalMs = clamp(Math.round(elapsed), 100, 3000);
      setRuntime({ lastTapMs: now, intervalMs, phase: 1 });
      showBpmForInterval(intervalMs);
      return;
    }
    // Primeiro toque (ou toque depois de 2,5s): volta ao ciclo ocioso.
    setRuntime((current) => ({ lastTapMs: now, intervalMs: 0, phase: current.phase % 3 }));
  };

  const pressGlobalSwitch = (section = 0, second = false) => {
    const modeId = (second ? global2SwMode : globalSwMode) || 'fx1';
    const paramsByMode = second ? global2SwParams : globalSwParams;
    const setPixels = second ? setGlobal2LedPixels : setGlobalLedPixels;
    const setSpin = second ? setGlobal2SpinState : setGlobalSpinState;
    const params = { ...DEFAULT_SW_PARAMS(modeId), ...(paramsByMode?.[modeId] || {}) };
    if (modeId === 'mute') return;
    if ((modeId === 'fx1' || modeId === 'fx2' || modeId === 'fx3')) {
      if (configuredFavorite(params, section, second ? 8 : 7)) return;
      const suffix = section === 1 ? '2' : section === 2 ? '3' : '';
      if (runSpecialCommand(params[`num${suffix}`])) return;
    } else if (section === 0) {
      const handled = runConfiguredSpecial(modeId, params);
      // TAP sempre registra a batida mesmo quando um slot executa um comando
      // interno. Nos demais modos, o comando especial encerra o gesto.
      if (handled && modeId !== 'tap_tempo') return;
    }
    const monitorSw = second ? 8 : 7;
    const monitorPixels = second ? global2LedPixels : globalLedPixels;
    const monitorSpin = second ? global2SpinState : globalSpinState;
    appendMidiMonitorEvent(switchMonitorEvent(
      monitorSw, section, modeId, params, monitorPixels, monitorSpin));
    if (modeId === 'spin') {
      if (section === 1) {
        if (runSpecialCommand(params.lp_num)) return;
        setPixels((pixels) => {
          const on = !pixels.some(Boolean); return [on, on, on];
        });
        return;
      }
      setSpin((state) => state < 0 ? 0 : (state + 1) % 3);
      setPixels([true, true, true]);
      return;
    }
    if (modeId === 'tap_tempo') {
      if (section === 1) {
        if (runSpecialCommand(params.lp_num)) return;
        return;
      }
      registerGlobalTap(second);
      return;
    }
    if (modeId === 'momentary' || modeId === 'single' ||
        (modeId === 'ramp' && Number(params.trigger) === 1)) {
      setPixels([true, true, true]);
      window.setTimeout(() => setPixels([false, false, false]), 180);
      return;
    }
    setPixels((pixels) => {
      const turnOn = !pixels.some(Boolean);
      return [turnOn, turnOn, turnOn];
    });
  };

  const selectPresetLikeFirmware = (sw) => {
    const previewMode = Number(bankChangeMode) === 3;
    if (bankPreview) {
      const targetBank = bankPreview.preset === sw
        ? nextEnabledBank(bankPreview.bank, 1) : bankPreview.bank;
      setBankPreview({ bank: targetBank, preset: sw });
      return;
    }
    if (previewMode) {
      setBankPreview({ bank: bankLetterIndex, preset: sw });
      return;
    }
    const targetBank = sw === presetNumber
      ? nextEnabledBank(bankLetterIndex, 1) : bankLetterIndex;
    selectPresetWithMonitor(sw, targetBank, sw);
  };

  const press = (sw) => {
    if (sw <= 6) {
      if (switchMode === 'preset' && !isHybridLiveSwitch(sw)) {
        if (sw <= presetCount) selectPresetLikeFirmware(sw);
      } else {
        pressLiveSwitch(sw, 0);
      }
      return;
    }
    if (sw === 7) pressGlobalSwitch(0);
    if (sw === 8) livePinGlobal2 ? pressGlobalSwitch(0, true) : liveButtonTap();
  };

  const longPress = (sw) => {
    if (sw === 8 && livePinGlobal2) {
      const modeId = global2SwMode || 'fx1';
      const params = { ...DEFAULT_SW_PARAMS(modeId), ...(global2SwParams?.[modeId] || {}) };
      const hasB = Number(params.ch2) >= 1 && Number(params.ch2) <= 16 || Number(params.fav2) === 1;
      if (modeId === 'fx1' || modeId === 'fx2' || modeId === 'fx3') {
        if (hasB) pressGlobalSwitch(1, true);
        else {
          pressGlobalSwitch(0, true);
          window.setTimeout(() => pressGlobalSwitch(0, true), 120);
        }
      } else {
        pressGlobalSwitch(1, true);
      }
      return;
    }
    if (sw === 8) {
      // LIVE_MODE_PIN: segurar em LIVE sempre volta ao BANK; em BANK entra LIVE.
      if (switchMode === 'preset') onSetEditorLayer?.(1);
      onSetSwitchMode(switchMode === 'live' ? 'preset' : 'live');
      return;
    }
    if (sw === 7) {
      const modeId = globalSwMode || 'fx1';
      const params = { ...DEFAULT_SW_PARAMS(modeId), ...(globalSwParams?.[modeId] || {}) };
      const hasB = Number(params.ch2) >= 1 && Number(params.ch2) <= 16 || Number(params.fav2) === 1;
      if (modeId === 'fx1' || modeId === 'fx2' || modeId === 'fx3') {
        if (hasB) pressGlobalSwitch(1);
        else {
          pressGlobalSwitch(0);
          window.setTimeout(() => pressGlobalSwitch(0), 120);
        }
      } else {
        pressGlobalSwitch(1);
      }
      return;
    }
    if (switchMode === 'preset' && !isHybridLiveSwitch(sw)) {
      if (Number(bankChangeMode) === 2) {
        if (sw === presetNumber) {
          onSetEditorLayer?.(1);
          onSetSwitchMode('live');
        }
        return;
      }
      if (bankPreview) {
        selectPresetWithMonitor(bankPreview.preset, bankPreview.bank, sw);
        setBankPreview(null);
      } else if (Number(bankChangeMode) === 3 || sw === presetNumber) {
        setBankPreview({ bank: bankLetterIndex, preset: sw });
      }
      return;
    }
    const { modeId, params } = modeParamsFor(sw);
    const hasB = Number(params.ch2) >= 1 && Number(params.ch2) <= 16 || Number(params.fav2) === 1;
    if (modeId === 'fx1' || modeId === 'fx2' || modeId === 'fx3') {
      if (hasB) pressLiveSwitch(sw, 1);
      else {
        // STOMP tier 1 e momentaneo no hold: liga no limite e reverte logo
        // apos a soltura. A animacao curta representa esse pulso no simulador.
        toggleSection(sw, 0);
        window.setTimeout(() => toggleSection(sw, 0), 120);
      }
    } else if (modeId === 'macros') {
      toggleSection(sw, 0);
      window.setTimeout(() => toggleSection(sw, 0), 120);
    } else if (modeId === 'tap_tempo' || modeId === 'spin' || modeId === 'single') {
      pressLiveSwitch(sw, 1);
    }
  };

  const needsDoubleClickWindow = (sw) => {
    if ((sw === 8 && !livePinGlobal2) || (sw <= 6 && switchMode === 'preset' && !isHybridLiveSwitch(sw))) return false;
    const global = sw === 7 || (sw === 8 && livePinGlobal2);
    const second = sw === 8;
    const modeId = global ? ((second ? global2SwMode : globalSwMode) || 'fx1') : modeParamsFor(sw).modeId;
    const params = global
      ? { ...DEFAULT_SW_PARAMS(modeId), ...((second ? global2SwParams : globalSwParams)?.[modeId] || {}) }
      : modeParamsFor(sw).params;
    if (modeId === 'fx3') return true;
    if (modeId === 'fx1') {
      return (Number(params.ch3) >= 1 && Number(params.ch3) <= 16) || Number(params.fav3) === 1;
    }
    if (modeId === 'single') {
      return parseSingleSlots(params.rslots || '').some((slot) =>
        (slot.ch >= 1 && slot.ch <= 16) || (slot.t !== 1 && slot.num >= 128 && slot.num <= 134));
    }
    return false;
  };

  const doublePress = (sw) => {
    if (sw <= 6) pressLiveSwitch(sw, 2);
    else if (sw === 7) pressGlobalSwitch(2);
    else if (sw === 8 && livePinGlobal2) pressGlobalSwitch(2, true);
  };

  const queueShortPress = (sw) => {
    if (!needsDoubleClickWindow(sw)) {
      press(sw);
      return;
    }
    if (clickTimersRef.current[sw]) {
      clearTimeout(clickTimersRef.current[sw]);
      delete clickTimersRef.current[sw];
      doublePress(sw);
      return;
    }
    clickTimersRef.current[sw] = window.setTimeout(() => {
      delete clickTimersRef.current[sw];
      press(sw);
    }, 350);
  };

  const handleSwitchPointerDown = (sw) => {
    setPressedSwitch(sw);
    suppressClickRef.current = false;
    clearTimeout(longPressTimerRef.current);
    const modeId = sw <= 6 ? modeParamsFor(sw).modeId
      : sw === 7 ? globalSwMode : livePinGlobal2 ? global2SwMode : '';
    const threshold = sw === 8 && !livePinGlobal2 ? 600 : modeId === 'tap_tempo' ? 650 : 300;
    longPressTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = true;
      longPress(sw);
    }, threshold);
  };

  const handleSwitchPointerUp = () => {
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    setPressedSwitch(0);
  };

  const handleSwitchClick = (sw) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    queueShortPress(sw);
  };

  const toggleLedArc = (sw, arc) => {
    if ((switchMode !== 'live' && !isHybridLiveSwitch(sw)) || sw < 1 || sw > 6) return;
    if (swModes?.[sw] === 'spin') {
      // Clique direto no arco tambem seleciona o estado SPIN correspondente.
      const stateByArc = [1, 0, 2];
      setSpinStates((current) => {
        const next = [...current];
        next[sw] = stateByArc[arc];
        return next;
      });
      return;
    }
    setActiveLedPixels((current) => {
      const next = current.map((pixels) => [...pixels]);
      next[sw][arc] = !next[sw][arc];
      return next;
    });
    setLastSections((current) => {
      const next = [...current];
      // Arcos visuais: superior esquerdo=A, inferior=B, superior direito=C.
      next[sw] = arc === 0 ? 1 : arc === 2 ? 2 : 0;
      return next;
    });
  };

  const ringSegmentPath = (cx, cy, angle, radius = 432, halfSpan = 54) => {
    const start = (angle - halfSpan) * Math.PI / 180;
    const end = (angle + halfSpan) * Math.PI / 180;
    const x1 = cx + radius * Math.cos(start);
    const y1 = cy + radius * Math.sin(start);
    const x2 = cx + radius * Math.cos(end);
    const y2 = cy + radius * Math.sin(end);
    return `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2}`;
  };
  const switchRadialPoint = (cx, cy, radius, angle) => {
    const rad = angle * Math.PI / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  // Coordenadas originais do viewBox 8853.8 x 6898.93 do 7SW.svg.
  // Na 7SW+, o controle 8 corresponde ao footswitch LIVE/MODE e o controle 7
  // representa o SW GLOBAL (marcado SW1/2 + EXP na arte da placa).
  const sevenSwitchControls = [
    { sw: 8, cx: 1164.92, cy: 1119.37, label: 'LIVE / MODE' },
    { sw: 7, cx: 7701.56, cy: 1119.37, label: 'SW GLOBAL · SW1/2 e EXP' },
    { sw: 4, cx: 1164.92, cy: 3483.35, label: 'Footswitch 4' },
    { sw: 5, cx: 4433.24, cy: 3496.91, label: 'Footswitch 5' },
    { sw: 6, cx: 7701.56, cy: 3496.91, label: 'Footswitch 6' },
    { sw: 1, cx: 1164.92, cy: 5890.22, label: 'Footswitch 1' },
    { sw: 2, cx: 4433.24, cy: 5890.22, label: 'Footswitch 2' },
    { sw: 3, cx: 7701.56, cy: 5890.22, label: 'Footswitch 3' },
  ];

  const virtualDisplay = (
    <Bfmidi480Display
      model={model} switchMode={switchMode} gigView={gigView}
      tag={tag} label={displayName} meta={visualDisplayMeta}
      liveLayout={liveLayout} presetLayout={presetLayout}
      liveCustomLayout={liveCustomLayout} presetCustomLayout={presetCustomLayout}
      namePresetLive={namePresetLive} namePresetBank={namePresetBank}
      iconShape={iconShape} presetIconShape={presetIconShape}
      layer1={layer1} layer2={layer2}
      editorLayer={editorLayer}
      bankLetterEnabled={bankLetterEnabled}
      activeLedPixels={activeLedPixels} spinStates={spinStates}
      lastSections={lastSections}
      bpmOverlay={bpmOverlay}
    />
  );

  return ReactDOM.createPortal(
    <div className="bf-demo-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="bf-demo-modal" role="dialog" aria-modal="true"
           aria-label={`Simulador ${model}`} onClick={(event) => event.stopPropagation()}>
        <div className="bf-demo-modal-head">
          <div>
            <span className="bf-demo-modal-kicker">CONTROLADORA VIRTUAL</span>
            <h2>{model}</h2>
          </div>
          <button type="button" className="bf-demo-modal-close" onClick={onClose}
                  aria-label="Fechar simulador">×</button>
        </div>

        <div className="bf-demo-toolbar">
          <div className="bf-demo-mode-switch" role="group" aria-label="Modo da controladora">
            <button type="button" className={switchMode === 'preset' ? 'is-on' : ''}
                    onClick={() => onSetSwitchMode('preset')}>PRESET</button>
            <button type="button" className={switchMode === 'live' ? 'is-on' : ''}
                    onClick={() => onSetSwitchMode('live')}>LIVE</button>
          </div>
          <div className="bf-demo-bank-controls">
            <button type="button" onClick={() => navigateBankWithMonitor(-1)} aria-label="Banco anterior">‹</button>
            <span>BANCO {letter}</span>
            <button type="button" onClick={() => navigateBankWithMonitor(1)} aria-label="Próximo banco">›</button>
          </div>
        </div>

        <div className={`bf-demo-controller is-${switchCount}sw${displayWide ? ' is-wide-display' : ''}${hasControllerArtwork ? ` is-seven-switch-artwork is-${artworkInfo.id}-artwork` : ''}`}
             style={{ '--demo-brightness': Math.max(0.25, Number(brightness || 72) / 100) }}>
          {hasControllerArtwork ? (
            <div className={`bf-demo-seven-switch-stage is-${artworkInfo.id}`}
                 style={{ aspectRatio: `${artworkInfo.viewW} / ${artworkInfo.viewH}` }}>
              <img className="bf-demo-seven-switch-art"
                   src={`icons/controllers/${artworkInfo.file}`}
                   alt={`Desenho da controladora ${modelName}`} draggable="false" />
              <div className="bf-demo-seven-switch-display" style={{
                left: `${artworkInfo.display.x / artworkInfo.viewW * 100}%`,
                top: `${artworkInfo.display.y / artworkInfo.viewH * 100}%`,
                width: `${artworkInfo.display.w / artworkInfo.viewW * 100}%`,
                height: `${artworkInfo.display.h / artworkInfo.viewH * 100}%`,
              }}>{virtualDisplay}</div>
              <svg className="bf-demo-seven-switch-controls"
                   viewBox={`0 0 ${artworkInfo.viewW} ${artworkInfo.viewH}`}
                   preserveAspectRatio="xMidYMid meet"
                   aria-label={`Controles interativos da ${modelName}`}>
                <defs>
                  <radialGradient id={`demo-switch-base-${artworkInfo.id}`} cx="35%" cy="24%" r="78%">
                    <stop offset="0" stopColor="#ffffff" />
                    <stop offset=".18" stopColor="#e9edef" />
                    <stop offset=".42" stopColor="#899297" />
                    <stop offset=".62" stopColor="#f8fafb" />
                    <stop offset=".78" stopColor="#747d82" />
                    <stop offset=".92" stopColor="#dce1e3" />
                    <stop offset="1" stopColor="#363c40" />
                  </radialGradient>
                  <linearGradient id={`demo-switch-nut-${artworkInfo.id}`} x1="8%" y1="5%" x2="92%" y2="95%">
                    <stop offset="0" stopColor="#ffffff" />
                    <stop offset=".2" stopColor="#747c81" />
                    <stop offset=".43" stopColor="#f7f9fa" />
                    <stop offset=".66" stopColor="#555d62" />
                    <stop offset=".84" stopColor="#eef1f2" />
                    <stop offset="1" stopColor="#8b9499" />
                  </linearGradient>
                  <radialGradient id={`demo-switch-cap-${artworkInfo.id}`} cx="38%" cy="28%" r="72%">
                    <stop offset="0" stopColor="#4c5052" />
                    <stop offset=".38" stopColor="#282b2d" />
                    <stop offset=".76" stopColor="#17191b" />
                    <stop offset="1" stopColor="#090a0b" />
                  </radialGradient>
                </defs>
                {artworkInfo.controls.map(({ sw, cx, cy, label }) => {
                  const actionSw = artworkInfo.id === 'nano' && sw === 6 && nanoSw6Global ? 7 : sw;
                  const disabled = actionSw <= 6 && actionSw > presetCount;
                  const litArcs = actionSw === 8
                    ? (livePinGlobal2 ? global2LedPixels
                      : [switchMode === 'live', switchMode === 'live', switchMode === 'live'])
                    : actionSw === 7
                      ? globalLedPixels
                      : switchMode === 'preset' && !isHybridLiveSwitch(actionSw)
                        ? [actionSw === visualPresetNumber, actionSw === visualPresetNumber, actionSw === visualPresetNumber]
                        : swModes?.[actionSw] === 'spin'
                          ? spinArcsForState(spinStates[actionSw]).map((value, arc) =>
                              value || !!activeLedPixels[actionSw]?.[arc])
                          : activeLedPixels[actionSw] || [false, false, false];
                  const arcColors = ledArcColorsFor(actionSw);
                  const isActive = litArcs.some(Boolean);
                  return (
                    <g key={sw} role="button" tabIndex={disabled ? -1 : 0}
                       aria-label={actionSw === 7 ? 'SW GLOBAL' : label}
                       aria-disabled={disabled ? 'true' : 'false'}
                       onPointerDown={() => !disabled && handleSwitchPointerDown(actionSw)}
                       onPointerUp={handleSwitchPointerUp}
                       onPointerCancel={handleSwitchPointerUp}
                       onClick={() => !disabled && handleSwitchClick(actionSw)}
                       onKeyDown={(event) => {
                         if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
                           event.preventDefault();
                           handleSwitchClick(actionSw);
                         }
                       }}>
                      <circle cx={cx} cy={cy} r={artworkInfo.controlRadius * .985}
                        className="bf-demo-switch-glass-ring" pointerEvents="none" />
                      <circle cx={cx} cy={cy} r={artworkInfo.controlRadius}
                        className={'bf-demo-seven-switch-control' + (isActive ? ' is-active' : '') +
                          (pressedSwitch === actionSw ? ' is-pressed' : '') + (disabled ? ' is-disabled' : '')}
                        style={{ '--led-color': ledFor(actionSw) }} />
                      {[90, 210, 330].map((angle, arc) => (
                        <g key={arc} className="bf-demo-led-segment"
                           onPointerDown={(event) => event.stopPropagation()}
                           onPointerUp={(event) => event.stopPropagation()}
                           onClick={(event) => {
                             event.stopPropagation();
                             if (!disabled) {
                               if ((switchMode === 'live' || isHybridLiveSwitch(actionSw)) && actionSw <= 6) toggleLedArc(actionSw, arc);
                               else handleSwitchClick(actionSw);
                             }
                           }}>
                          <path d={ringSegmentPath(cx, cy, angle, artworkInfo.ringRadius)}
                            className="bf-demo-led-segment-outline"
                            style={{ strokeWidth: artworkInfo.ringOutline }} />
                          <path d={ringSegmentPath(cx, cy, angle, artworkInfo.ringRadius)}
                            className={'bf-demo-led-segment-fill' + (litArcs[arc] ? ' is-on' : '')}
                            style={{ '--segment-color': arcColors[arc], strokeWidth: artworkInfo.ringFill }} />
                          <path d={ringSegmentPath(cx, cy, angle, artworkInfo.ringRadius, 48)}
                            className="bf-demo-led-segment-sheen"
                            style={{ strokeWidth: Math.max(2, artworkInfo.ringFill * .075) }} />
                        </g>
                      ))}
                      <g className={'bf-demo-switch-metal' +
                          (pressedSwitch === actionSw ? ' is-pressed' : '')}
                         pointerEvents="none">
                        <circle cx={cx} cy={cy} r={artworkInfo.controlRadius * .65}
                          className="bf-demo-switch-metal-shadow" />
                        <circle cx={cx} cy={cy} r={artworkInfo.controlRadius * .615}
                          fill={`url(#demo-switch-base-${artworkInfo.id})`}
                          className="bf-demo-switch-metal-plate"
                          strokeWidth={artworkInfo.controlRadius * .025} />
                        <circle cx={cx} cy={cy} r={artworkInfo.controlRadius * .445}
                          fill="#202427" stroke="#545c61"
                          strokeWidth={artworkInfo.controlRadius * .025} />
                        {[30, 150, 270].map((angle) => {
                          const inner = switchRadialPoint(cx, cy, artworkInfo.controlRadius * .43, angle);
                          const outer = switchRadialPoint(cx, cy, artworkInfo.controlRadius * .63, angle);
                          return (
                            <g key={angle}>
                              <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
                                className="bf-demo-switch-metal-divider"
                                strokeWidth={artworkInfo.controlRadius * .085} />
                              <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
                                className="bf-demo-switch-metal-divider-highlight"
                                strokeWidth={artworkInfo.controlRadius * .02} />
                            </g>
                          );
                        })}
                        <circle cx={cx} cy={cy} r={artworkInfo.controlRadius * .42}
                          fill="none" stroke={`url(#demo-switch-nut-${artworkInfo.id})`}
                          strokeWidth={artworkInfo.controlRadius * .055} />
                        <circle cx={cx} cy={cy} r={artworkInfo.controlRadius * .345}
                          fill={`url(#demo-switch-nut-${artworkInfo.id})`}
                          stroke="#f5f7f8" strokeWidth={artworkInfo.controlRadius * .018} />
                        <circle cx={cx} cy={cy} r={artworkInfo.controlRadius * .292}
                          fill={`url(#demo-switch-cap-${artworkInfo.id})`}
                          className="bf-demo-switch-dark-cap"
                          strokeWidth={artworkInfo.controlRadius * .018} />
                        <path d={ringSegmentPath(cx, cy, 225, artworkInfo.controlRadius * .31, 58)}
                          className="bf-demo-switch-cap-highlight"
                          strokeWidth={artworkInfo.controlRadius * .018} />
                      </g>
                    </g>
                  );
                })}
              </svg>
            </div>
          ) : (<>
          <div className="bf-demo-brandline">
            <span className="bf-demo-brand">BF<span>MIDI</span></span>
            <span>{modelInfo?.tag || 'BFMIDI'} · DEMO</span>
          </div>

          {virtualDisplay}

          <div className="bf-demo-foots" style={{ '--switch-count': switchCount }}>
            {Array.from({ length: switchCount }, (_, index) => index + 1).map((sw) => {
              const disabled = sw <= 6 && sw > presetCount;
              const isActive = sw === 7 ? globalLedPixels.some(Boolean)
                : sw === 8 ? (livePinGlobal2 ? global2LedPixels.some(Boolean) : switchMode === 'live')
                : switchMode === 'preset' && !isHybridLiveSwitch(sw)
                ? sw === visualPresetNumber
                : activeSwitches.has(sw);
              const specialLabel = sw === 7 ? 'GLOBAL'
                : sw === 8 ? (livePinGlobal2 ? 'GLOBAL 2'
                  : switchMode === 'live' && layer2Enabled ? `LAYER ${editorLayer}` : 'LIVE') : '';
              return (
                <button key={sw} type="button"
                  className={'bf-demo-foot' + (isActive ? ' is-active' : '') +
                    (pressedSwitch === sw ? ' is-pressed' : '') + (disabled ? ' is-disabled' : '')}
                  style={{ '--led-color': ledFor(sw) }}
                  onPointerDown={() => handleSwitchPointerDown(sw)}
                  onPointerUp={handleSwitchPointerUp}
                  onPointerCancel={handleSwitchPointerUp}
                  onClick={() => !disabled && handleSwitchClick(sw)}
                  disabled={disabled}
                  aria-label={specialLabel || `${switchMode === 'preset' ? 'Selecionar preset' : 'Acionar'} ${sw}`}>
                  <span className="bf-demo-foot-led" />
                  <span className="bf-demo-foot-metal"><span /></span>
                  <span className="bf-demo-foot-label">
                    {specialLabel || (switchMode === 'preset' ? `${letter}${sw}` : liveModeName(sw))}
                  </span>
                </button>
              );
            })}
          </div>
          </>)}
        </div>

        <DemoMidiMonitorCard
          events={midiMonitorEvents}
          mode={midiMonitorMode}
          onSetMode={setMidiMonitorMode}
          onClear={() => setMidiMonitorEvents([])}
        />

        <div className="bf-demo-modal-foot">
          <p>Toque no preset ativo para avançar o banco. Segure para LONG PRESS e toque duas vezes para RECLICK. Em LIVE, os modos e os 3 pixels seguem a configuração salva.</p>
          <button type="button" className="bf-demo-reset" onClick={() => {
            if (window.confirm('Restaurar todos os dados da demonstração?')) {
              resetDemoMemory();
              window.location.reload();
            }
          }}>RESTAURAR DEMONSTRAÇÃO</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Editor visual do layout CUSTOM. X/Y representam o percurso livre depois de
// descontar o tamanho do tile; size e percentual da altura do display. Mesma
// geometria usada pelo firmware, com suporte a mouse e touch.
function CustomLayoutEditor({ t, items, setItems, boardName, iconShape }) {
  const res = displayResolutionFor(boardName);
  const modelInfo = MODELS.find((m) => m.id === boardName);
  const count = modelInfo && modelInfo.switches === 4 ? 4 : 6;
  const visibleIndexes = [...Array(count).keys(), 6, 7];
  const safeItems = Array.isArray(items) && items.length >= 8
    ? items : makeDefaultCustomLayout();
  const [selected, setSelected] = useState(0);
  const stageRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    if (!visibleIndexes.includes(selected)) setSelected(0);
  }, [selected, count]);

  const itemLabel = (idx) => idx === 6 ? 'GLOBAL 1'
                              : idx === 7 ? 'GLOBAL 2' : `SW${idx + 1}`;
  const itemTileLabel = (idx) => idx === 6 ? 'G1'
                                  : idx === 7 ? 'G2' : `SW${idx + 1}`;

  const updateOne = (idx, patch) => {
    setItems((prev) => {
      const next = (Array.isArray(prev) ? prev : makeDefaultCustomLayout())
        .map((it) => ({ ...it }));
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const tileStyle = (it) => {
    const size = clamp(it.size, CUSTOM_LAYOUT_MIN_SIZE, CUSTOM_LAYOUT_MAX_SIZE);
    const widthPct = (res.h * size / 100) / res.w * 100;
    return {
      left: String((100 - widthPct) * clamp(it.x, 0, 100) / 100) + '%',
      top: String((100 - size) * clamp(it.y, 0, 100) / 100) + '%',
      width: String(widthPct) + '%',
      height: String(size) + '%',
    };
  };

  const onTileDown = (idx) => (e) => {
    const stage = stageRef.current;
    const it = safeItems[idx];
    if (!stage || !it || !it.enabled) return;
    setSelected(idx);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const br = stage.getBoundingClientRect();
    const tilePx = br.height * clamp(it.size, CUSTOM_LAYOUT_MIN_SIZE,
                                     CUSTOM_LAYOUT_MAX_SIZE) / 100;
    const travelX = Math.max(0, br.width - tilePx);
    const travelY = Math.max(0, br.height - tilePx);
    dragRef.current = {
      id: e.pointerId, idx, sx: e.clientX, sy: e.clientY, travelX, travelY,
      startLeft: travelX * clamp(it.x, 0, 100) / 100,
      startTop: travelY * clamp(it.y, 0, 100) / 100,
    };
  };

  const onTileMove = (e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const left = clamp(d.startLeft + e.clientX - d.sx, 0, d.travelX);
    const top = clamp(d.startTop + e.clientY - d.sy, 0, d.travelY);
    updateOne(d.idx, {
      x: d.travelX ? Math.round(left / d.travelX * 100) : 50,
      y: d.travelY ? Math.round(top / d.travelY * 100) : 50,
    });
  };

  const onTileUp = (e) => {
    const d = dragRef.current;
    if (d && d.id === e.pointerId) {
      dragRef.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    }
  };

  const active = safeItems[selected] || safeItems[0];
  return (
    <div className="bfg-custom-editor">
      <p className="bfg-custom-hint">{t('glob.disp.customHint')}</p>
      <div ref={stageRef} className="bfg-custom-stage"
           style={{ aspectRatio: String(res.w) + ' / ' + String(res.h) }}>
        <div className="bfg-custom-safe" />
        {visibleIndexes.map((i) => {
          const it = safeItems[i];
          if (!it.enabled) return null;
          return (
            <button key={i} type="button"
              className={'bfg-custom-tile is-' + iconShape +
                         (selected === i ? ' is-selected' : '')}
              style={tileStyle(it)}
              onPointerDown={onTileDown(i)} onPointerMove={onTileMove}
              onPointerUp={onTileUp} onPointerCancel={onTileUp}
              aria-label={itemLabel(i) + ' · X ' + Math.round(it.x) +
                          ' · Y ' + Math.round(it.y) + ' · ' +
                          Math.round(it.size) + '%'}>
              {itemTileLabel(i)}
            </button>
          );
        })}
      </div>
      <div className="bfg-custom-readout">
        <span>{itemLabel(selected)} · X {Math.round(active.x)}% · Y {Math.round(active.y)}%</span>
        <span>{t('glob.disp.customSize')} · {Math.round(active.size)}%</span>
      </div>
      <input className="bfg-custom-range" type="range"
        min={CUSTOM_LAYOUT_MIN_SIZE} max={CUSTOM_LAYOUT_MAX_SIZE} step="1"
        value={active.size}
        onChange={(e) => updateOne(selected, { size: Number(e.target.value) })}
        aria-label={t('glob.disp.customSize') + ' ' + itemLabel(selected)} />
      <div className="bfg-eyebrow-row bfg-custom-visible">
        {t('glob.disp.customVisible')}
      </div>
      <div className="bfg-custom-switches">
        {visibleIndexes.map((i) => {
          const it = safeItems[i];
          return (
          <button key={i} type="button" aria-pressed={!!it.enabled}
            className={(it.enabled ? ' is-on' : '') +
                       (selected === i ? ' is-selected' : '')}
            onClick={() => {
              setSelected(i);
              updateOne(i, { enabled: !it.enabled });
            }}>
            {itemLabel(i)}
          </button>
          );
        })}
      </div>
      <button type="button" className="bfg-custom-reset"
              onClick={() => setItems(makeDefaultCustomLayout())}>
        {t('glob.disp.customReset')}
      </button>
    </div>
  );
}

// Segmented com os 4 formatos de ícone (quadrado/círculo/pílula/octágono).
// Reusado nos cards LIVE e PRESET (valores independentes).
function IconShapeSegmented({ t, value, onChange }) {
  const opts = [
    ['default', t('common.default'),         t('glob.disp.shapeDefaultTitle')],
    ['circle',  t('glob.disp.shapeCircle'),  t('glob.disp.shapeCircleTitle')],
    ['octagon', t('glob.disp.shapeOctagon'), t('glob.disp.shapeOctagonTitle')],
  ];
  return (
    <>
      <div className="bfg-eyebrow-row" style={{ marginTop: 16 }}>{t('glob.disp.iconShapeEyebrow')}</div>
      <div className="bf-seg">
        {opts.map(([id, label, title]) => (
          <button key={id} className={value === id ? 'is-active' : ''}
            onClick={() => onChange(id)} title={title}>{label}</button>
        ))}
      </div>
    </>
  );
}

function DisplaySection({
  t,
  gigView, setGigView,
  namePresetLive, setNamePresetLive,
  namePresetBank, setNamePresetBank,
  iconShape, setIconShape,
  presetIconShape, setPresetIconShape,
  liveLayout, setLiveLayout,
  presetLayout, setPresetLayout,
  liveCustomLayout, setLiveCustomLayout,
  presetCustomLayout, setPresetCustomLayout,
  bpmCardSecs, setBpmCardSecs,
  bpmCardAvg, setBpmCardAvg,
  presetCount,
  boardName,
}) {
  const imageStore = useImageStore();
  const iconStore = useIconStore();
  const imgUsed = imageStore.slots.filter((s) => s && s.exists).length;
  const iconUsed = iconStore.slots ? Object.values(iconStore.slots).filter((s) => s && s.exists).length : 0;
  const [openImg, setOpenImg] = useState(false);
  const [openIcons, setOpenIcons] = useState(false);
  const metaGig = gigView === 'preset' ? t('glob.gig.onlyPreset')
                : gigView === 'live'   ? t('glob.gig.onlyLive')
                : t('glob.gig.default');
  return (
    <>
      {/* GIG VIEW — card único: segmented + 2 toggles + eyebrow + segmented */}
      <div className="bf-card">
        <div className="bf-card-head">
          <h3>Gig View</h3>
          <span className="meta">{metaGig.toUpperCase()}</span>
        </div>
        <div className="bf-seg">
          <button className={gigView === 'padrao' ? 'is-active' : ''}
            onClick={() => setGigView('padrao')}
            title={t('glob.disp.gigDefaultTitle')}
          >{t('glob.gig.default')}</button>
          <button className={gigView === 'preset' ? 'is-active' : ''}
            onClick={() => setGigView('preset')}
            title={t('glob.disp.gigOnlyPresetTitle')}
          >{t('glob.gig.onlyPreset')}</button>
          <button className={gigView === 'live' ? 'is-active' : ''}
            onClick={() => setGigView('live')}
            title={t('glob.disp.gigOnlyLiveTitle')}
          >{t('glob.gig.onlyLive')}</button>
        </div>

        <div style={{ height: 14 }} />
        <div className="bf-auto-row">
          <div className="bfg-toggle-text">
            <span className="label">{t('glob.disp.showNameLive')}</span>
            <span className="bfg-toggle-sub">NAME PRESET · LIVE</span>
          </div>
          <button
            className={'bf-switch is-accent' + (namePresetLive ? ' is-on' : '')}
            onClick={() => setNamePresetLive(!namePresetLive)}
            aria-label="Name Preset Live Mode"
            aria-pressed={namePresetLive}
          />
        </div>
        <div style={{ height: 10 }} />
        <div className="bf-auto-row">
          <div className="bfg-toggle-text">
            <span className="label">{t('glob.disp.showNameBank')}</span>
            <span className="bfg-toggle-sub">NAME PRESET · BANK</span>
          </div>
          <button
            className={'bf-switch is-accent' + (namePresetBank ? ' is-on' : '')}
            onClick={() => setNamePresetBank(!namePresetBank)}
            aria-label="Name Preset Preset Mode"
            aria-pressed={namePresetBank}
          />
        </div>
      </div>

      {/* LAYOUT do modo LIVE — 4 layouts fixos + CUSTOM */}
      <div className="bf-card">
        <div className="bf-card-head">
          <h3>{t('glob.disp.liveLayout')}</h3>
          <span className="meta">{liveLayout === 5
            ? t('glob.disp.layoutCustom').toUpperCase() : `LAYOUT ${liveLayout}`}</span>
        </div>
        <div className="bfg-layout-grid">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={'bfg-layout-btn' + (n === liveLayout ? ' is-on' : '')}
              onClick={() => setLiveLayout(n)}
              title={n === 5 ? t('glob.disp.layoutCustom') : `Layout ${n}`}
            >
              <GLayoutMiniSketch layout={n} selected={n === liveLayout}
                iconShape={iconShape} custom={n === 5}
                customLayout={liveCustomLayout} />
              <span className="bfg-layout-lbl">
                {n === 5 ? t('glob.disp.layoutCustom') : `L${n}`}
              </span>
            </button>
          ))}
        </div>
        <IconShapeSegmented t={t} value={iconShape} onChange={setIconShape} />
        {liveLayout === 5 && (
          <CustomLayoutEditor t={t} items={liveCustomLayout}
            setItems={setLiveCustomLayout} boardName={boardName}
            iconShape={iconShape} />
        )}
      </div>

      {/* LAYOUT do modo PRESET — "nenhum" (tela classica) + os mesmos 4 layouts */}
      <div className="bf-card">
        <div className="bf-card-head">
          <h3>{t('glob.disp.presetLayout')}</h3>
          <span className="meta">{presetLayout === 0 ? t('glob.disp.presetLayoutNone').toUpperCase()
            : presetLayout === 5 ? t('glob.disp.presetLayoutList').toUpperCase()
            : presetLayout === 6 ? t('glob.disp.layoutCustom').toUpperCase()
            : `LAYOUT ${presetLayout}`}</span>
        </div>
        <div className="bfg-layout-grid">
          {[0, 1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              type="button"
              className={'bfg-layout-btn' + (n === presetLayout ? ' is-on' : '')}
              onClick={() => setPresetLayout(n)}
              title={n === 0 ? t('glob.disp.presetLayoutNone')
                   : n === 5 ? t('glob.disp.presetLayoutList')
                   : n === 6 ? t('glob.disp.layoutCustom') : `Layout ${n}`}
            >
              <GLayoutMiniSketch layout={n} selected={n === presetLayout}
                iconShape={presetIconShape} custom={n === 6}
                customLayout={presetCustomLayout} />
              <span className="bfg-layout-lbl">{n === 0 ? t('glob.disp.presetLayoutNone')
                : n === 5 ? t('glob.disp.presetLayoutList')
                : n === 6 ? t('glob.disp.layoutCustom') : `L${n}`}</span>
            </button>
          ))}
        </div>
        <div className="bfg-eyebrow-row" style={{ marginTop: 14 }}>{t('glob.disp.presetLayoutHint')}</div>
        <IconShapeSegmented t={t} value={presetIconShape} onChange={setPresetIconShape} />
        {presetLayout === 6 && (
          <CustomLayoutEditor t={t} items={presetCustomLayout}
            setItems={setPresetCustomLayout} boardName={boardName}
            iconShape={presetIconShape} />
        )}
      </div>

      {/* BPM NO DISPLAY (TAP TEMPO) — duração do card de BPM na tela (0 = OFF,
          não mostra) + valor mostrado (absoluto = 2 últimos toques / médio =
          média da sequência). Persiste via /config/global (bpm_card_secs /
          bpm_card_avg); firmware em BPM_OVERLAY.h. */}
      <div className="bf-card">
        <div className="bf-card-head">
          <h3>{t('glob.disp.bpmTitle')}</h3>
          <span className="meta">TAP TEMPO · {bpmCardSecs === 0 ? 'OFF'
            : `${bpmCardSecs}S · ${(bpmCardAvg ? t('glob.disp.bpmAvg') : t('glob.disp.bpmAbs')).toUpperCase()}`}</span>
        </div>
        <div className="bfg-eyebrow-row">{t('glob.disp.bpmTime')}</div>
        <div className="bf-seg">
          {[0, 2, 5, 10].map((s) => (
            <button
              key={s}
              className={bpmCardSecs === s ? 'is-active' : ''}
              onClick={() => setBpmCardSecs(s)}
              title={s === 0 ? t('glob.disp.bpmOffHint') : undefined}
            >{s === 0 ? 'OFF' : `${s}s`}</button>
          ))}
        </div>
        {bpmCardSecs !== 0 && (
          <>
            <div className="bfg-eyebrow-row" style={{ marginTop: 14 }}>{t('glob.disp.bpmValue')}</div>
            <div className="bf-seg">
              <button
                className={!bpmCardAvg ? 'is-active' : ''}
                onClick={() => setBpmCardAvg(false)}
                title={t('glob.disp.bpmAbsHint')}
              >{t('glob.disp.bpmAbs')}</button>
              <button
                className={bpmCardAvg ? 'is-active' : ''}
                onClick={() => setBpmCardAvg(true)}
                title={t('glob.disp.bpmAvgHint')}
              >{t('glob.disp.bpmAvg')}</button>
            </div>
          </>
        )}
        <div className="bfg-eyebrow-row" style={{ marginTop: 14 }}>
          {bpmCardSecs === 0 ? t('glob.disp.bpmOffHint')
            : bpmCardAvg ? t('glob.disp.bpmAvgHint') : t('glob.disp.bpmAbsHint')}
        </div>
      </div>

      {/* IMAGENS & ÍCONES — 2 tiles compactos + upload colapsavel */}
      <div className="bf-card">
        <div className="bf-card-head">
          <h3>{t('glob.disp.mediaTitle')}</h3>
          <span className="meta">{t('glob.disp.mediaMeta')}</span>
        </div>
        <div className="bfg-media-grid">
          <button
            type="button"
            className={'bfg-media-tile' + (openImg ? ' is-open' : '')}
            onClick={() => setOpenImg((v) => !v)}
            aria-expanded={openImg}
          >
            <span className="bfg-media-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="1.5"/>
                <circle cx="9" cy="11" r="1.6" fill="currentColor"/>
                <path d="M3 17 L9 12 L14 16 L21 9"/>
              </svg>
            </span>
            <span className="bfg-media-text">
              <span className="bfg-media-lbl">{t('glob.disp.mediaBank')}</span>
              <span className="bfg-media-cnt">{String(imgUsed).padStart(2, '0')} / {String(IMAGE_SLOT_COUNT).padStart(2, '0')}</span>
            </span>
          </button>
          <button
            type="button"
            className={'bfg-media-tile' + (openIcons ? ' is-open' : '')}
            onClick={() => setOpenIcons((v) => !v)}
            aria-expanded={openIcons}
          >
            <span className="bfg-media-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="8"/>
                <circle cx="12" cy="12" r="3" fill="currentColor"/>
              </svg>
            </span>
            <span className="bfg-media-text">
              <span className="bfg-media-lbl">{t('glob.disp.mediaIcons')}</span>
              <span className="bfg-media-cnt">{String(iconUsed).padStart(2, '0')} / {String(ICON_UPLOAD_SLOT_COUNT).padStart(2, '0')}</span>
            </span>
          </button>
        </div>
      </div>

      {/* Cards de upload originais aparecem só quando o tile é clicado. */}
      {openImg && <CardUploadImages boardName={boardName} />}
      {openIcons && <CardUploadIcons />}
    </>
  );
}

// ─── EXTERNAL EXPRESSION (GLOBAL > MIDI) ────────────────────────────
// Card do pedal de expressao externo. So e montado quando a placa tem entrada
// de EXP (hasExp em PageGlobalConfig). Faz polling de /exp/live (~200 ms)
// enquanto montado pra mostrar a leitura do ADC ao vivo; os botoes MIN/MAX
// capturam o valor cru atual nos pontos de calibracao 0/127. Os valores
// persistem junto com o resto da config global (SAVE do rodape).
function ExternalExpressionCard({
  enabled, setEnabled,
  cc, setCc,
  channel, setChannel,
  calMin, setCalMin,
  calMax, setCalMax,
}) {
  const [liveRaw, setLiveRaw] = useState(null);  // ADC cru atual (null = sem leitura)
  const [online, setOnline] = useState(false);       // /exp/live respondeu
  const [liveEnabled, setLiveEnabled] = useState(false); // firmware lendo o pino
  const busyRef = useRef(false);
  const { t } = useBfI18n();

  // Polling da leitura ao vivo — SO quando o pedal esta ativado (toggle local).
  // Desligado => nem pollamos, e o firmware tambem nao le o pino (requisito:
  // o pino EXP so fica ativo quando ligado). Como o firmware so passa a ler
  // depois do SAVE (globalExpEnabled), a resposta traz "enabled" pra distinguir
  // "ligado mas ainda nao salvo" de "lendo de verdade".
  useEffect(() => {
    if (!enabled) {
      setOnline(false);
      setLiveEnabled(false);
      setLiveRaw(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const r = await apiCall('GET', '/exp/live');
        if (cancelled) return;
        const fwOn = Number(r.enabled) === 1;
        setLiveEnabled(fwOn);
        setLiveRaw(fwOn && typeof r.raw === 'number' ? r.raw : null);
        setOnline(true);
      } catch {
        if (!cancelled) setOnline(false);
      } finally {
        busyRef.current = false;
      }
    };
    poll();
    const id = setInterval(poll, 200);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled]);

  const liveMidi = liveRaw == null ? null : expRawToMidiJs(liveRaw, calMin, calMax);
  const midiPct = liveMidi == null ? 0 : Math.round((liveMidi / 127) * 100);
  const canCapture = enabled && online && liveEnabled && liveRaw != null;
  const [open, setOpen] = useState(false);

  return (
    <div className="bf-card">
      <div className="bf-card-head">
        <h3>{t('glob.exp.title')}</h3>
        <span className="meta">{enabled ? `CC${cc} · CH ${String(channel).padStart(2, '0')}` : 'OFF'}</span>
      </div>

      {/* Studio compact head: toggle + LEITURA AO VIVO em fonte grande + bar */}
      <div className="bfg-exp-head">
        <button
          className={'bf-switch is-accent' + (enabled ? ' is-on' : '')}
          onClick={() => setEnabled(!enabled)}
          aria-pressed={enabled}
          aria-label={t('glob.exp.enable')}
        />
        <div className="bfg-exp-live">
          <span className="bfg-exp-live-cap">{t('glob.exp.liveReading')}</span>
          <span className="bfg-exp-live-num">
            {liveMidi == null ? '—' : liveMidi}
            <span className="bfg-exp-live-of"> / 127</span>
          </span>
        </div>
      </div>
      <div className="bfg-exp-bar">
        <div className="bfg-exp-bar-fill" style={{ width: `${enabled ? midiPct : 0}%` }} />
      </div>

      <button
        type="button"
        className={'bfg-sum-pill' + (open ? ' is-open' : '')}
        onClick={() => setOpen((v) => !v)}
        style={{ marginTop: 12 }}
        aria-expanded={open}
      >
        <span className="bfg-sum-text">
          <span className="bfg-sum-cap">{t('glob.exp.ccChanCal')}</span>
          <span className="bfg-sum-title">{enabled ? `CC ${cc} · CH ${String(channel).padStart(2, '0')}` : t('glob.exp.pedalOff')}</span>
        </span>
        <span className="bfg-sum-cta">{open ? t('glob.exp.closeArrow') : t('glob.exp.editArrow')}</span>
      </button>

      {open && (<>
      <div className="bf-extras-section-title" style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <span style={{ flex: 1 }}>CC</span>
        <span style={{ flex: 1 }}>{t('common.channel')}</span>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="bf-select-wrap" style={{ flex: 1 }}>
          <BfSelect
            className="bf-input bf-select"
            value={cc}
            onChange={(e) => setCc(clamp(Number(e.target.value), 0, 127))}
            aria-label={t('glob.exp.ccAria')}
          >
            {/* Modo lista: CCs nomeados conforme o MATCH MODE do canal
                selecionado (pedal unico ou por canal no MULTIPLE MODE). Sem
                comandos especiais — o EXP manda um valor continuo 0..127. */}
            {midiOptionElems(MIDI_VALUES_128, 'cc', cc, channel, false)}
          </BfSelect>
          <span className="bf-select-chev">▾</span>
        </div>
        <div className="bf-select-wrap" style={{ flex: 1 }}>
          <BfSelect
            className="bf-input bf-select"
            value={channel}
            onChange={(e) => setChannel(clamp(Number(e.target.value), 1, 16))}
            aria-label={t('glob.exp.chAria')}
          >
            {/* Cada canal mostra o pedal mapeado no MATCH MODE (por canal). */}
            {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => {
              const ped = pedalNameForChannel(n);
              return <option key={n} value={n}>{ped ? `${n} - ${ped}` : `${n}`}</option>;
            })}
          </BfSelect>
          <span className="bf-select-chev">▾</span>
        </div>
      </div>

      <div style={{ height: 16 }} />
      <div className="bf-extras-section-title">{t('glob.exp.liveReading')}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '6px 2px' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {!enabled ? t('glob.exp.off')
            : liveEnabled ? `ADC: ${liveRaw == null ? '—' : liveRaw} / ${EXP_ADC_MAX}`
            : online ? t('glob.exp.waitingSave') : t('glob.exp.noReading')}
        </span>
        <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>
          {liveMidi == null ? '—' : liveMidi}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--card-2)', overflow: 'hidden' }}>
        <div style={{ width: `${midiPct}%`, height: '100%', background: 'var(--accent)', transition: 'width 80ms linear' }} />
      </div>
      {!enabled && (
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 2px 0', lineHeight: 1.4 }}>
          {t('glob.exp.offHint')}
        </p>
      )}
      {enabled && online && !liveEnabled && (
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 2px 0', lineHeight: 1.4 }}>
          {t('glob.exp.saveHint')}
        </p>
      )}
      {enabled && !online && (
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 2px 0', lineHeight: 1.4 }}>
          {t('glob.exp.adcStuckHint')}
        </p>
      )}

      <div style={{ height: 16 }} />
      <div className="bf-extras-section-title">{t('glob.exp.calibration')}</div>
      <div className="bf-actions" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 6 }}>
        <button className="bf-btn" disabled={!canCapture} onClick={() => setCalMin(liveRaw)}>
          {t('glob.exp.captureMin', { v: calMin })}
        </button>
        <button className="bf-btn" disabled={!canCapture} onClick={() => setCalMax(liveRaw)}>
          {t('glob.exp.captureMax', { v: calMax })}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
        <label className="bf-extras-cell" style={{ flex: 1 }}>
          <span className="bf-field-label">{t('glob.exp.minLabel')}</span>
          <input type="number" className="bf-input bf-input-num" min={0} max={EXP_ADC_MAX}
                 value={calMin}
                 onChange={(e) => setCalMin(clamp(Number(e.target.value) || 0, 0, EXP_ADC_MAX))}
                 aria-label={t('glob.exp.minAria')} />
        </label>
        <label className="bf-extras-cell" style={{ flex: 1 }}>
          <span className="bf-field-label">{t('glob.exp.maxLabel')}</span>
          <input type="number" className="bf-input bf-input-num" min={0} max={EXP_ADC_MAX}
                 value={calMax}
                 onChange={(e) => setCalMax(clamp(Number(e.target.value) || 0, 0, EXP_ADC_MAX))}
                 aria-label={t('glob.exp.maxAria')} />
        </label>
      </div>
      <button
        className="bf-btn"
        style={{ width: '100%', marginTop: 10 }}
        onClick={() => { setCalMin(0); setCalMax(EXP_ADC_MAX); }}
      >
        {t('glob.exp.resetCal')}
      </button>
      </>)}

    </div>
  );
}

// ─── INDICADOR ESW por botão (dentro do card External SW) ────────────
// A "config de tela/ícone" de UM ext switch: escopo (OFF/LIVE/PRESET/AMBAS),
// sigla, cores ON/OFF e posição arrastável — tudo do botão `i`. Espelha, na
// prática, a aba DISPLAY dos SWs internos. Firmware em EXT_INDIC.h.
function ExtIndicConfig({
  i, shows, setShows, onColors, setOnColors, offColors, setOffColors,
  fontSizes, setFontSizes, siglas, setSiglas, xs, setXs, ys, setYs,
  liveLayout, presetLayout, liveCustomLayout, presetCustomLayout,
}) {
  const { t } = useBfI18n();
  const [openPos, setOpenPos] = useState(false);
  // Atualiza o índice `i` de um array via seu setter (imutável).
  const at = (setter, arr, val) => setter(arr.map((v, j) => (j === i ? val : v)));
  const show = shows[i];
  const fontSize = fontSizes[i];
  const tilesLayout = show === 2 ? presetLayout : liveLayout;
  const customLayout = show === 2
    ? (presetLayout === 6 ? presetCustomLayout : null)
    : (liveLayout === 5 ? liveCustomLayout : null);
  return (
    <div className="bf-esw-indic">
      <div className="bfg-eyebrow-row" style={{ marginTop: 6 }}>{t('glob.esw.indicTitle')}</div>
      <div className="bf-seg bf-esw-scope">
        {[[0, 'OFF'], [1, 'LIVE'], [2, 'PRESET'], [3, t('glob.esw.both')]].map(([v, lbl]) => (
          <button key={v} className={show === v ? 'is-active' : ''}
                  onClick={() => at(setShows, shows, v)}>{lbl}</button>
        ))}
      </div>
      {show !== 0 && (
        <>
          <div className="bfg-eyebrow-row" style={{ marginTop: 12 }}>{t('glob.esw.siglaColors')}</div>
          <div className="bf-esw-indic-fields">
            <label className="bf-field">
              <span className="bf-field-label">{t('glob.esw.sigla')}</span>
              <input type="text" maxLength={5} className="bf-input bf-esw-sigla"
                     value={siglas[i]} placeholder={`ESW${i + 1}`}
                     onChange={(e) => at(setSiglas, siglas, e.target.value.slice(0, 5))} />
            </label>
            <div className="bf-esw-color">
              <ColorBar label={t('glob.esw.onColor')} colorId={onColors[i]}
                        onChange={(id) => at(setOnColors, onColors, id)}
                        restrictTypes={[DISP_TYPE.SOLID]} excludeImages />
            </div>
            <div className="bf-esw-color">
              <ColorBar label={t('glob.esw.offColor')} colorId={offColors[i]}
                        onChange={(id) => at(setOffColors, offColors, id)}
                        restrictTypes={[DISP_TYPE.SOLID]} excludeImages />
            </div>
            <label className="bf-field bf-esw-font-field">
              <span className="bf-field-label">TAMANHO</span>
              <button
                type="button"
                className="bf-input bf-input-num bf-esw-font-size"
                style={{ fontSize: `${Math.min(fontSize, 18)}px` }}
                onClick={() => at(setFontSizes, fontSizes, nextFontSize(fontSize, true))}
                aria-label={`Tamanho da fonte ESW ${i + 1}: ${fontSize} pontos`}
                title="Alternar tamanho da fonte"
              >{fontSize}pt</button>
            </label>
          </div>
          <div className="bfg-eyebrow-row" style={{ marginTop: 12 }}>{t('glob.esw.position')}</div>
          <button type="button" className="bf-namepos-btn" onClick={() => setOpenPos(true)}
                  title={t('glob.esw.editPos')}>
            <ExtIndicMiniPreview onColors={onColors} siglas={siglas} x={xs} y={ys}
                                 tilesLayout={tilesLayout} customLayout={customLayout}
                                 activeIndex={i} />
            <span className="bf-namepos-btn-cta">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
              </svg>
              {t('glob.esw.editPos')}
            </span>
          </button>
          {openPos && (
            <ExtIndicPositionEditor
              onColors={onColors} offColors={offColors} siglas={siglas} x={xs} y={ys}
              tilesLayout={tilesLayout} customLayout={customLayout} activeIndex={i}
              onClose={() => setOpenPos(false)}
              onApply={(nx, ny) => { setXs(nx); setYs(ny); setOpenPos(false); }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── EXTERNAL DUAL SWITCH (GLOBAL > MIDI) ───────────────────────────
// 2 footswitches externos (entrada nas placas BFMIDI-3 +). So aparece quando
// a placa tem a entrada (hasExtDual). Cada card = 1 ext switch: o SwGlobalEditor
// com TODOS os modos (STOMP/MACROS/MOMENTARY/TAP/SPIN/RAMP/SINGLE, igual aos SWs
// comuns; `noLed` esconde a cor de LED, sem icones) + o ExtIndicConfig daquele
// botao (escopo/sigla/cores/posicao do indicador na tela — o "icone" de cada um).
// Persiste no SAVE do rodape.
function ExternalDualSwitchCard({
  mode1, setMode1, params1, setParams1,
  mode2, setMode2, params2, setParams2,
  resetOnPreset1, setResetOnPreset1,
  resetOnPreset2, setResetOnPreset2,
  presetCount, liveLayout, presetLayout, liveCustomLayout, presetCustomLayout,
  extIndicShows, setExtIndicShows,
  extIndicOnColors, setExtIndicOnColors,
  extIndicOffColors, setExtIndicOffColors,
  extIndicFontSizes, setExtIndicFontSizes,
  extIndicSiglas, setExtIndicSiglas,
  extIndicX, setExtIndicX, extIndicY, setExtIndicY,
}) {
  const { t } = useBfI18n();
  const indicProps = {
    shows: extIndicShows, setShows: setExtIndicShows,
    onColors: extIndicOnColors, setOnColors: setExtIndicOnColors,
    offColors: extIndicOffColors, setOffColors: setExtIndicOffColors,
    fontSizes: extIndicFontSizes, setFontSizes: setExtIndicFontSizes,
    siglas: extIndicSiglas, setSiglas: setExtIndicSiglas,
    xs: extIndicX, setXs: setExtIndicX, ys: extIndicY, setYs: setExtIndicY,
    liveLayout, presetLayout, liveCustomLayout, presetCustomLayout,
  };
  return (
    <>
      <div className="bf-card">
        <div className="bf-card-head">
          <h3>External SW1</h3>
          <span className="meta">{t('glob.extsw.noLed')}</span>
        </div>
        <SwGlobalEditor
          mode={mode1} setMode={setMode1}
          paramsByMode={params1} setParamsByMode={setParams1}
          presetCount={presetCount} noLed externalDual
        />
        <div className="bf-sw-opt-row" style={{ marginTop: 12 }}>
          <div className="bf-sw-opt-text">
            <span className="bf-sw-opt-name">RESET AO CHAMAR PRESET</span>
            <span className="bf-sw-opt-sub">Volta o indicador para OFF sem enviar MIDI.</span>
          </div>
          <BfToggle
            on={resetOnPreset1}
            onClick={() => setResetOnPreset1((v) => !v)}
            ariaLabel="Resetar External SW1 ao chamar preset"
            title="Reseta o estado visual do External SW1 ao chamar preset"
          />
        </div>
        <ExtIndicConfig i={0} {...indicProps} />
      </div>

      <div className="bf-card">
        <div className="bf-card-head">
          <h3>External SW2</h3>
          <span className="meta">{t('glob.extsw.noLed')}</span>
        </div>
        <SwGlobalEditor
          mode={mode2} setMode={setMode2}
          paramsByMode={params2} setParamsByMode={setParams2}
          presetCount={presetCount} noLed externalDual
        />
        <div className="bf-sw-opt-row" style={{ marginTop: 12 }}>
          <div className="bf-sw-opt-text">
            <span className="bf-sw-opt-name">RESET AO CHAMAR PRESET</span>
            <span className="bf-sw-opt-sub">Volta o indicador para OFF sem enviar MIDI.</span>
          </div>
          <BfToggle
            on={resetOnPreset2}
            onClick={() => setResetOnPreset2((v) => !v)}
            ariaLabel="Resetar External SW2 ao chamar preset"
            title="Reseta o estado visual do External SW2 ao chamar preset"
          />
        </div>
        <ExtIndicConfig i={1} {...indicProps} />
      </div>
    </>
  );
}

// ─── GLOBAL ─────────────────────────────────────────────────────────
function PageGlobalConfig({
  onOpenWifi,
  boardName,
  brightness, setBrightness,
  autoStartEnabled, setAutoStartEnabled,
  autoStartMode, setAutoStartMode,
  autoStartBank, setAutoStartBank,
  autoStartPreset, setAutoStartPreset,
  bankLetterEnabled, setBankLetterEnabled,
  bankChangeMode, setBankChangeMode,
  ledColorMode, setLedColorMode,
  letterLedColors, setLetterLedColors,
  switchLedColors, setSwitchLedColors,
  ledPreviewLive, setLedPreviewLive,
  ledPreviewLiveLevel, setLedPreviewLiveLevel,
  liveLedColor, setLiveLedColor,
  layer2LedColor, setLayer2LedColor,
  gigView, setGigView,
  namePresetLive, setNamePresetLive,
  namePresetBank, setNamePresetBank,
  iconShape, setIconShape,
  presetIconShape, setPresetIconShape,
  liveLayout, setLiveLayout,
  presetLayout, setPresetLayout,
  liveCustomLayout, setLiveCustomLayout,
  presetCustomLayout, setPresetCustomLayout,
  bpmCardSecs, setBpmCardSecs,
  bpmCardAvg, setBpmCardAvg,
  extIndicShows, setExtIndicShows,
  extIndicOnColors, setExtIndicOnColors,
  extIndicOffColors, setExtIndicOffColors,
  extIndicFontSizes, setExtIndicFontSizes,
  extIndicSiglas, setExtIndicSiglas,
  extIndicX, setExtIndicX,
  extIndicY, setExtIndicY,
  matchMode, setMatchMode,
  matchOmitUnnamed, setMatchOmitUnnamed,
  matchChannels, setMatchChannels,
  matchLiveCc, setMatchLiveCc,
  kemperGetNames, setKemperGetNames,
  kemperTunerStyle, setKemperTunerStyle,
  kemperTunerSpeed, setKemperTunerSpeed,
  kemperFollowPc, setKemperFollowPc,
  nanoSw6Global,
  globalSwMode, setGlobalSwMode,
  globalSwParams, setGlobalSwParams,
  globalSwDisplay, setGlobalSwDisplay,
  livePinGlobal2,
  global2SwMode, setGlobal2SwMode,
  global2SwParams, setGlobal2SwParams,
  global2SwDisplay, setGlobal2SwDisplay,
  hasExp,
  expEnabled, setExpEnabled,
  expCc, setExpCc,
  expChannel, setExpChannel,
  expCalMin, setExpCalMin,
  expCalMax, setExpCalMax,
  hasExtDual,
  ext1Mode, setExt1Mode, ext1Params, setExt1Params,
  ext2Mode, setExt2Mode, ext2Params, setExt2Params,
  ext1ResetOnPreset, setExt1ResetOnPreset,
  ext2ResetOnPreset, setExt2ResetOnPreset,
  presetCount,
  deviceState, usbState, onToggleUsb,
  connectionMode, onToggleConnectionMode,
  systemTheme, onToggleTheme,
}) {
  const [section, setSection] = useState('midi');
  const hasLivePin = ((MODELS.find((m) => m.id === boardName) || {}).switches || 0) >= 8;
  // MULTIPLE MODE: 16 canais paginados em 3 páginas de 6 (página 3 só tem 4).
  const [matchPage, setMatchPage] = useState(0);
  const letters = BANK_LETTERS;
  const { t } = useBfI18n();

  // GET NAMES so faz sentido em KEMPER PLAYER: pedal unico (matchMode==9) ou
  // MULTIPLE MODE (matchMode==0) com algum canal mapeado pro Kemper. Espelha
  // kemperIsPlayerMode() do firmware.
  const kemperActive =
    matchMode === KEMPER_PLAYER_MATCH_IDX ||
    (matchMode === 0 && matchChannels.some((c) => c === KEMPER_PLAYER_MATCH_IDX));

  return (
    <div className="bf-content bf-content-global" key="global">
      <PageHeader
        title="GLOBAL"
        onOpenWifi={onOpenWifi}
        deviceState={deviceState}
        usbState={usbState}
        onToggleUsb={onToggleUsb}
        connectionMode={connectionMode}
        onToggleConnectionMode={onToggleConnectionMode}
        systemTheme={systemTheme}
        onToggleTheme={onToggleTheme}
      />
      <div className="bf-icon-tabs">
          <button className={'bf-icon-tab' + (section === 'midi' ? ' is-on' : '')} onClick={() => setSection('midi')}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {/* Conector 5-pin DIN MIDI: circulo + 5 pinos + keyway */}
              <circle className="bf-tab-shape" cx="12" cy="12" r="8.5"/>
              <path className="bf-tab-shape" d="M10.4 3.8 L13.6 3.8" strokeWidth="1.8"/>
              <circle className="bf-tab-fill" cx="5.8"  cy="11.3" r="1.15"/>
              <circle className="bf-tab-fill" cx="6.5"  cy="15.4" r="1.15"/>
              <circle className="bf-tab-fill" cx="12"   cy="17"   r="1.15"/>
              <circle className="bf-tab-fill" cx="17.5" cy="15.4" r="1.15"/>
              <circle className="bf-tab-fill" cx="18.2" cy="11.3" r="1.15"/>
            </svg>
            <span>MIDI</span>
          </button>
          <button className={'bf-icon-tab' + (section === 'display' ? ' is-on' : '')} onClick={() => setSection('display')}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {/* Display do pedal: tela + faixa do preset + 3 tiles + base */}
              <rect className="bf-tab-shape" x="2.5" y="4" width="19" height="13" rx="1.8"/>
              <rect className="bf-tab-fill" x="5"    y="6.6"  width="14"  height="2.1" rx="0.6" opacity="0.85"/>
              <rect className="bf-tab-fill" x="5"    y="10.2" width="3.8" height="3.8" rx="0.7"/>
              <rect className="bf-tab-fill" x="10.1" y="10.2" width="3.8" height="3.8" rx="0.7"/>
              <rect className="bf-tab-fill" x="15.2" y="10.2" width="3.8" height="3.8" rx="0.7"/>
              <path className="bf-tab-shape" d="M9 20.5h6 M12 17v3.5"/>
            </svg>
            <span>{t('glob.tab.display')}</span>
          </button>
          <button className={'bf-icon-tab' + (section === 'leds' ? ' is-on' : '')} onClick={() => setSection('leds')}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" aria-hidden="true">
              {/* Footswitch arc: 3 arcos (90/210/330) + cap central */}
              <path className="bf-tab-shape" d="M 16.7 18.47 A 8 8 0 0 1 7.3 18.47"  strokeWidth="2"/>
              <path className="bf-tab-shape" d="M 4.04 12.84 A 8 8 0 0 1 8.75 4.69"  strokeWidth="2"/>
              <path className="bf-tab-shape" d="M 15.25 4.69 A 8 8 0 0 1 19.96 12.84" strokeWidth="2"/>
              <circle className="bf-tab-fill" cx="12" cy="12" r="2.3"/>
            </svg>
            <span>LEDS</span>
          </button>
          <button className={'bf-icon-tab' + (section === 'banks' ? ' is-on' : '')} onClick={() => setSection('banks')}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {/* 5 cards de bank em pilha — o do meio (ativo) sobe e fica solido */}
              <rect className="bf-tab-shape" x="2.6"  y="8"   width="3.2" height="11"   rx="0.9" opacity="0.45"/>
              <rect className="bf-tab-shape" x="6.6"  y="7"   width="3.2" height="12"   rx="0.9" opacity="0.70"/>
              <rect className="bf-tab-fill"  x="10.4" y="4.5" width="3.2" height="14.5" rx="0.9"/>
              <rect className="bf-tab-shape" x="14.2" y="7"   width="3.2" height="12"   rx="0.9" opacity="0.70"/>
              <rect className="bf-tab-shape" x="18.2" y="8"   width="3.2" height="11"   rx="0.9" opacity="0.45"/>
            </svg>
            <span>{t('glob.tab.banks')}</span>
          </button>
        </div>

      {section === 'midi' && (
        <>
        <div className="bf-card">
          <div className="bf-card-head">
            <h3>{t('glob.match.friendlyMode')}</h3>
            <span className="meta">{MATCH_MODE_OPTIONS[matchMode] || MATCH_MODE_OPTIONS[0]}</span>
          </div>
          <div className="bfg-select-box">
            <span className="bfg-select-eyebrow">{t('glob.match.targetEyebrow')}</span>
            <BfSelect
              className="bf-input bf-select bfg-select-lg"
              value={matchMode}
              onChange={(e) => setMatchMode(clamp(Number(e.target.value), 0, MATCH_MODE_OPTIONS.length - 1))}
              aria-label={t('glob.match.targetAria')}
            >
              {MATCH_MODE_ORDER.map((i) => (
                <option key={i} value={i}>{i === 0 ? t('glob.match.multiOption') : MATCH_MODE_OPTIONS[i]}</option>
              ))}
            </BfSelect>
            <span className="bf-select-chev bfg-select-chev">▾</span>
          </div>
          {matchMode === 0 && (
            <>
              <div style={{ height: 10 }} />
              {/* 16 canais paginados em 3 páginas de 6 (a última tem só 4). */}
              <div className="bf-seg bfg-ch-pager" role="tablist"
                   aria-label={t('glob.match.pageAria')} style={{ marginBottom: 10 }}>
                {[0, 1, 2].map((p) => {
                  const lo = p * MATCH_CHANNEL_PAGE_SIZE + 1;
                  const hi = Math.min((p + 1) * MATCH_CHANNEL_PAGE_SIZE, MATCH_CHANNEL_SLOTS);
                  return (
                    <button key={p} type="button" role="tab"
                      aria-selected={matchPage === p}
                      className={matchPage === p ? 'is-active' : ''}
                      onClick={() => setMatchPage(p)}>{`CH ${lo}–${hi}`}</button>
                  );
                })}
              </div>
              <div className="bfg-ch-grid">
                {Array.from({ length: MATCH_CHANNEL_PAGE_SIZE }, (_, j) => {
                  const i = matchPage * MATCH_CHANNEL_PAGE_SIZE + j;
                  if (i >= MATCH_CHANNEL_SLOTS) return null;  // página 3 tem só 4
                  const idx = matchChannels[i] || 0;
                  return (
                  <div key={i} style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
                    <label className="bfg-ch-tile" style={{ flex: 1, minWidth: 0 }}>
                      <span className="bfg-ch-cap">CH {i + 1}</span>
                      <span className={'bfg-ch-val' + (idx === 0 ? ' is-empty' : '')}>
                        {idx === 0 ? '—' : MATCH_MODE_OPTIONS[idx]}
                      </span>
                      <BfSelect
                        className="bfg-ch-select"
                        value={idx}
                        onChange={(e) => {
                          const next = matchChannels.slice();
                          next[i] = clamp(Number(e.target.value), 0, MATCH_MODE_OPTIONS.length - 1);
                          setMatchChannels(next);
                        }}
                        aria-label={t('glob.match.chAria', { n: i + 1 })}
                      >
                        {MATCH_MODE_ORDER.map((n) => (
                          <option key={n} value={n}>{n === 0 ? '—' : MATCH_MODE_OPTIONS[n]}</option>
                        ))}
                      </BfSelect>
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center',
                                  alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '.08em',
                                     textTransform: 'uppercase', color: 'var(--bf-text-dim, #8a8a90)',
                                     whiteSpace: 'nowrap' }}>
                        {t('glob.match.liveCc')}
                      </span>
                      <select
                        value={matchLiveCc[i] > 0 ? String(matchLiveCc[i] - 1) : ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const next = matchLiveCc.slice();
                          next[i] = raw === '' ? 0 : clamp(Number(raw), 0, 127) + 1;
                          setMatchLiveCc(next);
                        }}
                        aria-label={t('glob.match.liveCcAria', { n: i + 1 })}
                        style={{ width: 72, padding: '5px 6px', borderRadius: 8,
                                 border: '1px solid var(--bf-border, #2a3343)',
                                 background: 'var(--bf-input-bg, #0d1119)', color: 'var(--bf-text, #ddd)',
                                 fontSize: 13, textAlign: 'center' }}
                      >
                        <option value="">—</option>
                        {Array.from({ length: 128 }, (_, n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  );
                })}
              </div>
              <p className="bf-hint" style={{ marginTop: 6 }}>{t('glob.match.liveCcHint')}</p>
            </>
          )}

          <div style={{ height: 12 }} />
          <div className="bf-auto-row">
            <div className="bfg-toggle-text">
              <span className="label">{t('glob.match.omitUnnamed')}</span>
              <span className="bfg-toggle-sub">{t('glob.match.omitEyebrow')}</span>
            </div>
            <button
              className={'bf-switch is-accent' + (matchOmitUnnamed ? ' is-on' : '')}
              onClick={() => setMatchOmitUnnamed(!matchOmitUnnamed)}
              aria-pressed={matchOmitUnnamed}
              aria-label={t('glob.match.omitAria')}
            />
          </div>
        </div>

        {kemperActive && (
          <div className="bf-card">
            <div className="bf-card-head">
              <h3>Kemper Player</h3>
              <span className="meta">EXCLUSIVO</span>
            </div>
            <>
              <div className="bf-auto-row">
                <div className="bfg-toggle-text">
                  <span className="label">GET NAMES</span>
                  <span className="bfg-toggle-sub">
                    {t('glob.kemper.getNamesSub')}
                  </span>
                </div>
                <button
                  className={'bf-switch is-accent' + (kemperGetNames ? ' is-on' : '')}
                  onClick={() => setKemperGetNames(!kemperGetNames)}
                  aria-pressed={kemperGetNames}
                  aria-label="GET NAMES"
                />
              </div>

              <div style={{ height: 12 }} />
              <div className="bf-auto-row">
                <div className="bfg-toggle-text">
                  <span className="label">{t('glob.kemper.follow')}</span>
                  <span className="bfg-toggle-sub">
                    {t('glob.kemper.followSub')}
                  </span>
                </div>
                <button
                  className={'bf-switch is-accent' + (kemperFollowPc ? ' is-on' : '')}
                  onClick={() => setKemperFollowPc(!kemperFollowPc)}
                  aria-pressed={kemperFollowPc}
                  aria-label={t('glob.kemper.follow')}
                />
              </div>

              <div style={{ height: 12 }} />
              <div className="bfg-toggle-text" style={{ marginBottom: 8 }}>
                <span className="label">{t('glob.kemper.tunerScreen')}</span>
                <span className="bfg-toggle-sub">
                  {t('glob.kemper.tunerScreenSub')}
                </span>
              </div>
              <div className="bf-seg">
                {[
                  { v: 0, label: t('glob.kemper.tunerArc') },
                  { v: 1, label: t('glob.kemper.tunerBar') },
                  { v: 2, label: t('glob.kemper.tunerLeds') },
                ].map((o) => (
                  <button
                    key={o.v}
                    className={kemperTunerStyle === o.v ? 'is-active' : ''}
                    onClick={() => setKemperTunerStyle(o.v)}
                    aria-pressed={kemperTunerStyle === o.v}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              <div style={{ height: 12 }} />
              <div className="bfg-toggle-text" style={{ marginBottom: 8 }}>
                <span className="label">{t('glob.kemper.acq')}</span>
                <span className="bfg-toggle-sub">
                  {t('glob.kemper.acqSub')}
                </span>
              </div>
              <div style={{ padding: '16px 16px 12px', borderRadius: 14,
                            border: '2px solid transparent',
                            background: 'linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.30)) padding-box, var(--bevel-edge) border-box',
                            boxShadow: 'var(--bevel-relief)' }}>
              <div className="bfg-bright">
                <input
                  type="range"
                  min={0} max={4} step={1}
                  value={kemperTunerSpeed}
                  onChange={(e) => setKemperTunerSpeed(clamp(Number(e.target.value), 0, 4))}
                  className="bfg-bright-input"
                  style={{ '--p': (kemperTunerSpeed / 4) * 100 + '%' }}
                  aria-label={t('glob.kemper.acqAria')}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--bf-text-dim, #8a8a90)', marginTop: 10 }}>
                  <span>{t('glob.kemper.acqSmooth')}</span>
                  <span>{t('glob.kemper.acqLevel', { n: kemperTunerSpeed + 1 })}</span>
                  <span>{t('glob.kemper.acqFast')}</span>
                </div>
              </div>
              </div>
            </>
          </div>
        )}

        {/* SW GLOBAL: nas placas NANO o card só aparece quando o SW6 foi
            roteado como SW GLOBAL (SYSTEM > PRINCIPAL). Nas demais placas
            (com pino SW_GLOBAL dedicado) aparece sempre, como antes. */}
        {(!(boardName || '').includes('NANO') || nanoSw6Global) && (
        <div className="bf-card">
          <div className="bf-card-head">
            <h3>SW Global</h3>
            <span className="meta">{(SW_MODES.find((m) => m.id === globalSwMode) || SW_MODES[0]).title}</span>
          </div>
          <SwGlobalEditor
            mode={globalSwMode}
            setMode={setGlobalSwMode}
            paramsByMode={globalSwParams}
            setParamsByMode={setGlobalSwParams}
            display={globalSwDisplay}
            setDisplay={setGlobalSwDisplay}
            presetCount={presetCount}
            picker="modal"
            hideStart={false}
            hideAtPreset={true}
          />
        </div>
        )}

        {/* Nas placas 7S, o botao LIVE pode ser entregue ao segundo contexto
            GLOBAL. O card so aparece quando esse roteamento esta ligado em
            SYSTEM > PRINCIPAL. */}
        {hasLivePin && livePinGlobal2 && (
        <div className="bf-card">
          <div className="bf-card-head">
            <h3>SW Global 2</h3>
            <span className="meta">{(SW_MODES.find((m) => m.id === global2SwMode) || SW_MODES[0]).title}</span>
          </div>
          <SwGlobalEditor
            mode={global2SwMode}
            setMode={setGlobal2SwMode}
            paramsByMode={global2SwParams}
            setParamsByMode={setGlobal2SwParams}
            display={global2SwDisplay}
            setDisplay={setGlobal2SwDisplay}
            presetCount={presetCount}
            picker="modal"
            hideStart={false}
            hideAtPreset={true}
          />
        </div>
        )}

        {hasExp && (
          <ExternalExpressionCard
            enabled={expEnabled} setEnabled={setExpEnabled}
            cc={expCc} setCc={setExpCc}
            channel={expChannel} setChannel={setExpChannel}
            calMin={expCalMin} setCalMin={setExpCalMin}
            calMax={expCalMax} setCalMax={setExpCalMax}
          />
        )}

        {hasExtDual && (
          <ExternalDualSwitchCard
            mode1={ext1Mode} setMode1={setExt1Mode}
            params1={ext1Params} setParams1={setExt1Params}
            mode2={ext2Mode} setMode2={setExt2Mode}
            params2={ext2Params} setParams2={setExt2Params}
            resetOnPreset1={ext1ResetOnPreset} setResetOnPreset1={setExt1ResetOnPreset}
            resetOnPreset2={ext2ResetOnPreset} setResetOnPreset2={setExt2ResetOnPreset}
            presetCount={presetCount}
            liveLayout={liveLayout} presetLayout={presetLayout}
            liveCustomLayout={liveCustomLayout} presetCustomLayout={presetCustomLayout}
            extIndicShows={extIndicShows} setExtIndicShows={setExtIndicShows}
            extIndicOnColors={extIndicOnColors} setExtIndicOnColors={setExtIndicOnColors}
            extIndicOffColors={extIndicOffColors} setExtIndicOffColors={setExtIndicOffColors}
            extIndicFontSizes={extIndicFontSizes} setExtIndicFontSizes={setExtIndicFontSizes}
            extIndicSiglas={extIndicSiglas} setExtIndicSiglas={setExtIndicSiglas}
            extIndicX={extIndicX} setExtIndicX={setExtIndicX}
            extIndicY={extIndicY} setExtIndicY={setExtIndicY}
          />
        )}
        </>
      )}

      {section === 'display' && (
        <DisplaySection
          t={t}
          gigView={gigView} setGigView={setGigView}
          namePresetLive={namePresetLive} setNamePresetLive={setNamePresetLive}
          namePresetBank={namePresetBank} setNamePresetBank={setNamePresetBank}
          iconShape={iconShape} setIconShape={setIconShape}
          presetIconShape={presetIconShape} setPresetIconShape={setPresetIconShape}
          liveLayout={liveLayout} setLiveLayout={setLiveLayout}
          presetLayout={presetLayout} setPresetLayout={setPresetLayout}
          liveCustomLayout={liveCustomLayout} setLiveCustomLayout={setLiveCustomLayout}
          presetCustomLayout={presetCustomLayout} setPresetCustomLayout={setPresetCustomLayout}
          bpmCardSecs={bpmCardSecs} setBpmCardSecs={setBpmCardSecs}
          bpmCardAvg={bpmCardAvg} setBpmCardAvg={setBpmCardAvg}
          presetCount={presetCount}
          boardName={boardName}
        />
      )}

      {section === 'leds' && (
        <>
          <div className="bf-card bfg-led-card bfg-led-card-brightness">
            <div className="bf-card-head">
              <h3>{t('glob.leds.brightness')}</h3>
              <span className="meta">PWM · {brightness}%</span>
            </div>
            <div className="bfg-bright">
              <input
                type="range"
                min={0} max={100}
                value={brightness}
                onChange={(e) => setBrightness(clamp(Number(e.target.value), 0, 100))}
                className="bfg-bright-input"
                style={{ '--p': brightness + '%' }}
                aria-label={t('glob.leds.brightness')}
              />
              <div className="bfg-bright-marks">
                <span>MIN</span>
                <span className="bfg-bright-now">{brightness}%</span>
                <span>MAX</span>
              </div>
            </div>
          </div>

          <div className="bf-card bfg-led-card bfg-led-card-banks">
            <div className="bf-card-head">
              <h3>{t('glob.leds.banksPresets')}</h3>
              <span className="meta">{ledColorMode === 'letras' ? t('glob.leds.byLetterAE') : t('glob.leds.bySwitch16')}</span>
            </div>
            <div className="bf-seg">
              <button className={ledColorMode === 'letras' ? 'is-active' : ''} onClick={() => setLedColorMode('letras')}>{t('glob.leds.byLetter')}</button>
              <button className={ledColorMode === 'numeros' ? 'is-active' : ''} onClick={() => setLedColorMode('numeros')}>{t('glob.leds.bySwitch')}</button>
            </div>

            <div className={'bf-fsw-grid ' + (ledColorMode === 'letras' ? '' : 'bfg-fsw-6cols')}>
              {ledColorMode === 'letras'
                ? letterLedColors.map((c, i) => (
                    <FootswitchArc
                      key={'L' + i}
                      label={t('glob.leds.bankLabel', { l: 'ABCDE'[i] })}
                      colorId={c}
                      onChange={(id) => {
                        const next = letterLedColors.slice();
                        next[i] = id;
                        setLetterLedColors(next);
                      }}
                    />
                  ))
                : switchLedColors.map((c, i) => (
                    <FootswitchArc
                      key={'S' + i}
                      label={'PRESET ' + (i + 1)}
                      colorId={c}
                      onChange={(id) => {
                        const next = switchLedColors.slice();
                        next[i] = id;
                        setSwitchLedColors(next);
                      }}
                    />
                  ))}
            </div>

          </div>

          <div className="bf-card bfg-led-card bfg-led-card-preview">
            <div className="bf-card-head">
              <h3>{t('glob.leds.preview')}</h3>
              <span className="meta">{ledPreviewLive ? 'ON' : 'OFF'}</span>
            </div>
            {/* Studio: FS arc esquerda + toggle direita com sub-label. */}
            <div className="bfg-preview-row">
              <FootswitchArc
                label={t('glob.leds.swOff')}
                colorId={ledPreviewLive ? 2 : 14}
                litArcs={ledPreviewLive ? [0] : []}
                readOnly
              />
              <button
                className={'bfg-toggle-card bfg-preview-toggle' + (ledPreviewLive ? ' is-on' : '')}
                onClick={() => setLedPreviewLive(!ledPreviewLive)}
                aria-label="LED Preview Live Mode"
                aria-pressed={ledPreviewLive}
              >
                <div className="bfg-toggle-text">
                  <span className="label">{t('glob.leds.previewToggle')}</span>
                  <span className="bfg-toggle-sub">LED PREVIEW · LIVE</span>
                </div>
                <span className="bfg-toggle-pill" aria-hidden="true">
                  <span className="bfg-toggle-state">{ledPreviewLive ? 'ON' : 'OFF'}</span>
                  <span className="bfg-toggle-dot" />
                </span>
              </button>
            </div>
            {/* Brilho do pixel central aceso no preview do SW desligado.
                So faz sentido com o preview ligado. */}
            {ledPreviewLive && (
              <div className="bfg-preview-level">
                <div className="bfg-preview-level-head">
                  <span className="label">{t('glob.leds.previewLevel')}</span>
                  <span className="bfg-toggle-sub">{t('glob.leds.previewLevelSub')}</span>
                </div>
                <div className="bfg-bright">
                  <input
                    type="range"
                    min={0} max={100}
                    value={ledPreviewLiveLevel}
                    onChange={(e) => setLedPreviewLiveLevel(clamp(Number(e.target.value), 0, 100))}
                    className="bfg-bright-input"
                    style={{ '--p': ledPreviewLiveLevel + '%' }}
                    aria-label={t('glob.leds.previewLevel')}
                  />
                  <div className="bfg-bright-marks">
                    <span>MIN</span>
                    <span className="bfg-bright-now">{ledPreviewLiveLevel}%</span>
                    <span>MAX</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bf-card bfg-led-card bfg-led-card-dedicated">
            <div className="bf-card-head">
              <h3>{t('glob.leds.dedicated')}</h3>
              <span className="meta">{t('glob.leds.liveLayer2')}</span>
            </div>
            <div className="bf-fsw-grid bfg-fsw-2cols">
              <FootswitchArc
                label={t('glob.leds.liveMode')}
                colorId={liveLedColor}
                onChange={setLiveLedColor}
              />
              <FootswitchArc
                label="LAYER 2"
                colorId={layer2LedColor}
                onChange={setLayer2LedColor}
              />
            </div>
            {/* O toggle "Ativar Layer 2" saiu daqui: a habilitacao virou POR
                PRESET — icone "L2" no header do card PRINCIPAL (PRESET mode).
                Aqui fica so a cor do LED indicador do L2. */}
          </div>
        </>
      )}

      {section === 'banks' && (
        <>
          <div className="bf-card">
            <div className="bf-card-head">
              <h3>{t('glob.banks.autoStart')}</h3>
              <span className="meta">{t('glob.banks.presetOnBoot')}</span>
            </div>
            <div className="bf-auto-row">
              <span className="label">{t('glob.banks.startWith')}</span>
              <button
                className={'bf-switch is-accent' + (autoStartEnabled ? ' is-on' : '')}
                onClick={() => setAutoStartEnabled(!autoStartEnabled)}
              />
            </div>
            <div style={{ height: 12 }} />
            <div className="bf-seg" style={{ opacity: autoStartEnabled ? 1 : 0.4, pointerEvents: autoStartEnabled ? 'auto' : 'none' }}>
              <button className={autoStartMode === 'bank' ? 'is-active' : ''} onClick={() => setAutoStartMode('bank')}>{t('glob.banks.segBank')}</button>
              <button className={autoStartMode === 'live' ? 'is-active' : ''} onClick={() => setAutoStartMode('live')}>LIVE</button>
            </div>
            <div className="bf-cycle" style={{ opacity: autoStartEnabled ? 1 : 0.4 }}>
              <button className="is-on" disabled={!autoStartEnabled} onClick={() => {
                // Pula pra proxima letra HABILITADA (espelha swBankNextEnabledLetter
                // no firmware) pra nao deixar o auto-start apontar pra um banco
                // desabilitado em GLOBAL>BANCOS — senao a controladora bootava nele
                // e so pulava pra letra habilitada no 1o press.
                let next = autoStartBank;
                for (let s = 1; s <= 5; s++) {
                  const c = (autoStartBank + s) % BANK_LETTER_COUNT;
                  if (bankLetterEnabled[c]) { next = c; break; }
                }
                setAutoStartBank(next);
              }}>
                <span className="cap">{t('glob.banks.segBank')}</span>{letters[autoStartBank]}
              </button>
              <button className="is-on" disabled={!autoStartEnabled} onClick={() => setAutoStartPreset((autoStartPreset % presetCount) + 1)}>
                <span className="cap">PRESET</span>{autoStartPreset}
              </button>
            </div>
          </div>

          <div className="bf-card">
            <div className="bf-card-head">
              <h3>{t('glob.banks.changeBanks')}</h3>
              <span className="meta">{t('glob.banks.presetSel')}</span>
            </div>
            <div className="bf-seg">
              <button className={bankChangeMode === 1 ? 'is-active' : ''} onClick={() => setBankChangeMode(1)}>{t('glob.banks.mode1')}</button>
              <button className={bankChangeMode === 2 ? 'is-active' : ''} onClick={() => setBankChangeMode(2)}>{t('glob.banks.mode2')}</button>
              <button className={bankChangeMode === 3 ? 'is-active' : ''} onClick={() => setBankChangeMode(3)}>{t('glob.banks.mode3')}</button>
            </div>
          </div>

          <div className="bf-card">
            <div className="bf-card-head">
              <h3>{t('glob.banks.active')}</h3>
              <span className="meta">{t('glob.banks.skipDisabled')}</span>
            </div>
            <div className="bf-letter-chips">
              {letters.map((L, i) => (
                <button
                  key={L}
                  className={bankLetterEnabled[i] ? 'is-on' : 'is-off'}
                  onClick={() => {
                    const next = bankLetterEnabled.slice();
                    next[i] = !next[i];
                    setBankLetterEnabled(next);
                  }}
                >{L}</button>
              ))}
            </div>
          </div>
        </>
      )}

    </div>
  );
}

// ─── ERASE DATA (destrutivo) ───────────────────────────────────────
// Zera presets ou config global aos defaults. Cada acao tem confirmacao
// porque nao tem undo (a menos que o usuario tenha um backup recente).
function EraseDataCard({ onErased }) {
  const [busy, setBusy] = useState(null);  // 'presets' | 'global' | null
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const { t } = useBfI18n();

  const erase = useCallback(async (target, label) => {
    const confirmMsg = target === 'presets'
      ? t('sys.danger.confirmPresets')
      : t('sys.danger.confirmGlobal');
    if (!window.confirm(confirmMsg)) return;
    setBusy(target);
    setMsg('');
    setMsgErr(false);
    try {
      await apiCall('POST', `/erase/${target}`);
      setMsg(t('sys.danger.erased', { label }));
      // Forca o App a re-fetchar tudo — sem isso, o editor segue
      // mostrando os modos/params/displays antigos em cache local
      // (firmware ja apagou, mas a UI nao sabe).
      if (onErased) onErased(target);
    } catch (e) {
      setMsg(t('common.fail') + e.message);
      setMsgErr(true);
    } finally {
      setBusy(null);
    }
  }, [onErased, t]);

  return (
    <div className="bf-card">
      <div className="bf-card-head">
        <h3>{t('sys.danger.title')}</h3>
        <span className="meta">{t('sys.danger.meta')}</span>
      </div>
      <p className="bfg-danger-desc">{t('sys.danger.desc')}</p>
      <div className="bfg-danger-grid">
        <button
          type="button"
          className="bfg-danger-btn"
          onClick={() => erase('presets', t('sys.danger.labelPresets'))}
          disabled={!!busy}
        >
          <span className="bfg-danger-lbl">{t('sys.danger.erasePresets').toUpperCase()}</span>
          <span className="bfg-danger-sub">bank_memory.txt</span>
        </button>
        <button
          type="button"
          className="bfg-danger-btn"
          onClick={() => erase('global', t('sys.danger.labelGlobal'))}
          disabled={!!busy}
        >
          <span className="bfg-danger-lbl">{t('sys.danger.eraseGlobal').toUpperCase()}</span>
          <span className="bfg-danger-sub">config NVS</span>
        </button>
      </div>
      {msg && (
        <p className={'bfg-danger-msg' + (msgErr ? ' is-err' : ' is-ok')}>{msg}</p>
      )}
    </div>
  );
}

// ─── HARD TEST ─────────────────────────────────────────────────────
// 3 testes nao-bloqueantes (10s cada) + STOP. Botoes disparam POST
// /hardtest?mode=leds|display|midi|stop. Logica do teste vive no
// firmware (HARD_TEST.h) — frontend so dispara e mostra status.
function HardTestCard() {
  const [running, setRunning] = useState(null);  // 'leds'|'display'|'midi'|null
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const { t } = useBfI18n();

  const fire = useCallback(async (mode) => {
    setMsg('');
    setMsgErr(false);
    try {
      // URLSearchParams (nao string crua) pra que o fetch mande
      // Content-Type: application/x-www-form-urlencoded — sem isso o ESP32
      // WebServer guarda o corpo como arg "plain" e arg("mode") fica vazio
      // (400 missing mode). Em USB o String() vira "mode=leds" igual.
      const body = new URLSearchParams();
      body.set('mode', mode);
      await apiCall('POST', '/hardtest', body);
      if (mode === 'stop') {
        setRunning(null);
        setMsg(t('sys.hardtest.stopped'));
      } else {
        setRunning(mode);
        setMsg(t('sys.hardtest.running', { mode: mode.toUpperCase() }));
        // Auto-clear do estado UI apos a duracao do teste (firmware ja
        // restaura sozinho). 10.5s pra cobrir folga do clock.
        setTimeout(() => {
          setRunning((cur) => (cur === mode ? null : cur));
        }, 10500);
      }
    } catch (e) {
      setMsg(t('common.fail') + e.message);
      setMsgErr(true);
    }
  }, [t]);

  const isOn = (m) => running === m;
  const testIcons = {
    leds: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M 16.7 18.5 A 8 8 0 0 1 7.3 18.5"/>
        <path d="M 4 12.8 A 8 8 0 0 1 8.75 4.7"/>
        <path d="M 15.25 4.7 A 8 8 0 0 1 20 12.8"/>
        <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>
      </svg>
    ),
    display: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="4" width="19" height="13" rx="1.8"/>
        <rect x="5" y="6.6" width="14" height="2.1" rx="0.6" fill="currentColor" stroke="none"/>
        <rect x="5"    y="10.2" width="3.8" height="3.8" rx="0.7" fill="currentColor" stroke="none"/>
        <rect x="10.1" y="10.2" width="3.8" height="3.8" rx="0.7" fill="currentColor" stroke="none"/>
        <rect x="15.2" y="10.2" width="3.8" height="3.8" rx="0.7" fill="currentColor" stroke="none"/>
      </svg>
    ),
    midi: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8.5"/>
        <path d="M10.4 3.8 L13.6 3.8" strokeWidth="2"/>
        <circle cx="5.8"  cy="11.3" r="1.15" fill="currentColor" stroke="none"/>
        <circle cx="6.5"  cy="15.4" r="1.15" fill="currentColor" stroke="none"/>
        <circle cx="12"   cy="17"   r="1.15" fill="currentColor" stroke="none"/>
        <circle cx="17.5" cy="15.4" r="1.15" fill="currentColor" stroke="none"/>
        <circle cx="18.2" cy="11.3" r="1.15" fill="currentColor" stroke="none"/>
      </svg>
    ),
  };
  const tests = [
    { id: 'leds', label: 'LEDS' },
    { id: 'display', label: 'DISPLAY' },
    { id: 'midi', label: 'MIDI' },
  ];
  return (
    <>
      <div className="bf-card">
        <div className="bf-card-head">
          <h3>{t('sys.hardtest.title')}</h3>
          <span className="meta">{t('sys.hardtest.meta')}</span>
        </div>
        <p className="bfg-test-desc">{t('sys.hardtest.desc') || 'Cada teste roda no firmware por 10 segundos sem bloquear o resto do pedal. Use STOP pra abortar.'}</p>
        <div className="bfg-test-grid">
          {tests.map((tst) => {
            const on = isOn(tst.id);
            return (
              <button
                key={tst.id}
                type="button"
                className={'bfg-test-btn' + (on ? ' is-on' : '')}
                onClick={() => fire(tst.id)}
                disabled={!!running && !on}
              >
                <div className="bfg-test-ico">{testIcons[tst.id]}</div>
                <span className="bfg-test-lbl">{tst.label}</span>
                {on && (
                  <span className="bfg-test-pill"><span className="bfg-test-pill-dot"/>10s</span>
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="bfg-test-stop"
          onClick={() => fire('stop')}
          disabled={!running}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="6" y="6" width="12" height="12" rx="1"/>
          </svg>
          {t('sys.hardtest.stop').toUpperCase()}
        </button>
      </div>
    </>
  );
}

// ─── BACKUP / RESTORE ──────────────────────────────────────────────
// Backup: GET /backup → JSON com presets MODIFICADOS apenas.
// Restore: POST /restore com mesmo JSON; aplica como MERGE (presets
// ausentes ficam intactos). Sem persistir NVS — apenas LittleFS de
// bank_memory.txt, que é o escopo do backup.
// ─── STORAGE ───────────────────────────────────────────────────────
// Card de uso da particao LittleFS (storage, 1536 KB): 3 barras de espaco —
// Presets (usado + livre, ignorando o app), Imagens e Icones (usado vs cota do
// firmware). Le GET /storage (firmware: web_handle_storage em WEB_API_BANK.h).
// Read-only, com botao de atualizar. No fim do SYSTEM > Backup.
function StorageCard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setErr('');
    try {
      setData(await apiCall('GET', '/storage'));
    } catch (e) {
      setErr('Falha ao ler o armazenamento: ' + e.message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const fmt = (b) => {
    b = Number(b) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(2) + ' MB';
  };

  let bars = [];
  if (data) {
    const total = Number(data.total) || 0;
    const used = Number(data.used) || 0;
    const free = Number(data.free) || Math.max(0, total - used);
    const presets = Number(data.presets) || 0;
    const images = Number(data.images) || 0;
    const icons = Number(data.icons) || 0;
    const imgMax = Number(data.img_max) || 0;
    const iconMax = Number(data.icon_max) || 0;
    const nvsUsed = Number(data.nvs_used) || 0;
    const nvsTotal = Number(data.nvs_total) || 0;
    bars = [
      // Presets: usado + livre IGNORANDO o app (escala = presets + livre real
      // da particao). Presets nao tem cota fixa — crescem ate o espaco livre.
      { key: 'presets', label: 'Presets', used: presets, cap: presets + free,
        color: '#ff7a1a' },
      // Imagens / Icones: usado vs COTA (limite fixo do firmware).
      { key: 'images', label: 'Imagens', used: images, cap: imgMax, color: '#3a6dff' },
      { key: 'icons',  label: 'Ícones',  used: icons,  cap: iconMax, color: '#22cc44' },
    ];
    // NVS (config GLOBAL/sistema) — particao separada da LittleFS (24 KB).
    // So mostra se o firmware reportou (nvs_total>0).
    if (nvsTotal > 0) {
      bars.push({ key: 'nvs', label: 'Globais (NVS)', used: nvsUsed, cap: nvsTotal,
                  color: '#a855f7' });
    }
  }

  return (
    <div className="bf-card">
      <div className="bf-card-head">
        <h3>STORAGE</h3>
        <span className="meta">LittleFS · NVS</span>
      </div>
      {err && <p className="bfg-danger-msg is-err">{err}</p>}
      {!data && !err && <p className="bf-hint">Lendo…</p>}
      {data && (
        <>
          {bars.map((b) => {
            const cap = b.cap > 0 ? b.cap : 1;
            const pct = Math.min(100, Math.round((b.used / cap) * 100));
            const freeB = Math.max(0, b.cap - b.used);
            return (
              <div key={b.key} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                              alignItems: 'baseline', marginBottom: 5 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
                                 fontWeight: 600 }}>
                    <span className="bf-storage-dot" style={{ background: b.color }} />
                    {b.label}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--bf-text-dim, #9a9aa2)' }}>
                    {pct}%
                  </span>
                </div>
                <div className="bf-storage-bar"
                     role="img"
                     aria-label={`${b.label}: ${fmt(b.used)} usado de ${fmt(b.cap)}`}>
                  <span className="bf-storage-seg"
                        style={{ width: pct + '%', background: b.color }} />
                </div>
                <div className="bf-storage-totals">
                  <span><b>{fmt(b.used)}</b> usado</span>
                  <span className="bf-storage-free"><b>{fmt(freeB)}</b> livre</span>
                  <span className="bf-storage-of">de {fmt(b.cap)}</span>
                </div>
              </div>
            );
          })}
          <button type="button" className="bf-btn bf-storage-refresh"
                  onClick={load} disabled={busy}>
            {busy ? 'Atualizando…' : 'Atualizar'}
          </button>
        </>
      )}
    </div>
  );
}

// Envia o corpo JSON do /restore por USB em CHUNKS. A linha de comando do
// USB_CONTROL.h tem teto de ~2 KB, entao o backup inteiro nao cabe numa
// requisicao — o firmware acumula os pedacos via POST /restore?seq=S&fin=F
// e aplica tudo no chunk final (fin=1). Retorna a resposta do ultimo chunk
// ({applied, persisted}). O JSON minificado nao tem espacos nem quebras de
// linha, entao fatiar por caracteres e seguro no protocolo de linha.
const USB_RESTORE_CHUNK = 1700;  // payload por linha; prefixo cabe nos ~2 KB
async function usbRestoreChunked(body, setProgress) {
  const total = body.length;
  let seq = 0;
  let last = {};
  for (let off = 0; off < total; off += USB_RESTORE_CHUNK) {
    const part = body.slice(off, off + USB_RESTORE_CHUNK);
    const fin = (off + USB_RESTORE_CHUNK >= total) ? 1 : 0;
    last = await apiCall('POST', `/restore?seq=${seq}&fin=${fin}`, part);
    seq++;
    setProgress({
      phase: 'uploading',
      pct: Math.round(Math.min(off + USB_RESTORE_CHUNK, total) / total * 100),
      bytes: Math.min(off + USB_RESTORE_CHUNK, total),
      total,
    });
    if (fin) break;
  }
  return last;
}

// Baixa o backup por USB em PAGINAS. A resposta de /backup pode passar de
// 64 KB numa linha — e o reader do USB (usbStartReader) TRUNCA linhas maiores
// que isso (watchdog anti-burst), o que fazia o /backup grande dar timeout.
// Solucao espelha o restore chunked: GET /backup?seq=N devolve {seq,fin,data}
// com `data` = base64 de ~1200 bytes do JSON; concatena (atob) ate fin=1.
// Como o JSON e ASCII, atob() reconstroi o texto direto.
async function usbBackupChunked(setProgress) {
  let out = '';
  // Teto de seguranca: WEB_BACKUP_BUF_SIZE(128KB)/1200 ~= 110 paginas.
  for (let seq = 0; seq < 4000; seq++) {
    const r = await apiCall('GET', `/backup?seq=${seq}`);
    if (r && typeof r.data === 'string' && r.data) out += atob(r.data);
    setProgress({ phase: 'downloading', pct: null, bytes: out.length });
    if (!r || r.fin) break;
  }
  return out;
}

function BackupRestoreCard({ getGlobalConfigForBackup, onRestored }) {
  const [status, setStatus] = useState({ kind: 'idle', msg: '' });
  // progress: { phase, pct, bytes, total } — pct/total opcionais.
  const [progress, setProgress] = useState(null);
  // Incluir midia (imagens /img/* + icones /icon/*) no arquivo. ON por padrao:
  // o backup nasce COMPLETO (presets + midia referenciada). Desmarcavel pra um
  // backup leve "so presets". Funciona em HTTP e USB (USB_CONTROL.h expoe
  // /img/read + /icon/read + uploads chunked).
  const [includeImages, setIncludeImages] = useState(true);
  const { t } = useBfI18n();

  const fmtKB = (b) => {
    if (!b) return '0 KB';
    if (b < 1024) return b + ' B';
    return (b / 1024).toFixed(1) + ' KB';
  };

  const doBackup = useCallback(async () => {
    setStatus({ kind: 'loading', msg: t('sys.backup.ph.connecting') });
    setProgress({ phase: 'requesting', pct: 0 });
    const wantImages = includeImages;  // funciona em HTTP e USB
    // Por USB o export (download paginado + leitura base64 das imagens) ocupa
    // a serial inteira — pausa os polls de fundo (ver doRestore/usbSendChainRef).
    const usbBulk = _transport.usbConnected;
    if (usbBulk) heavyOpEnter();
    try {
      // Pra ter progresso real, usa fetch + stream reader em vez do
      // apiCall (que faria .text()/.json() de uma vez). USB nao suporta
      // streaming via Web Serial: cai pro caminho antigo (apiCall).
      let text;
      if (_transport.usbConnected) {
        // USB: baixa em paginas (a linha unica estoura o watchdog de 64 KB).
        setProgress({ phase: 'downloading', pct: null });
        text = await usbBackupChunked(setProgress);
      } else {
        const base = DEVICE_API || '';
        const resp = await fetch(`${base}/backup`, { method: 'GET' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        // Content-Length pode nao vir em chunked transfer — tratamos null.
        const total = parseInt(resp.headers.get('Content-Length') || '0', 10);
        const reader = resp.body && resp.body.getReader();
        if (!reader) {
          text = await resp.text();
        } else {
          const decoder = new TextDecoder();
          const chunks = [];
          let received = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            setProgress({
              phase: 'downloading',
              pct: total ? Math.round((received / total) * 100) : null,
              bytes: received,
              total,
            });
          }
          text = chunks.map((c) => decoder.decode(c, { stream: true })).join('')
               + decoder.decode();
        }
      }
      // Embute midia (opcional) no JSON: version 3 + images{slot:base64} +
      // icons{slot:base64}. MERGE-friendly — so os slots ocupados entram.
      // HTTP ou USB (ambos expoem /img/read e /icon/read em base64).
      if (wantImages) {
        setStatus({ kind: 'loading', msg: t('sys.backup.ph.images') });
        setProgress({ phase: 'images', pct: 0 });
        const obj = JSON.parse(text);
        // Imagens de fundo (/img/*).
        await imageStoreFetchList(true);
        const occImg = _imageStore.slots.filter((s) => s.exists);
        // Icones de upload (/icon/*) — referenciados pelos presets via icon_id.
        await iconStoreFetchList(true);
        const occIcon = _iconStore.slots.filter((s) => s.exists);
        const totalMedia = occImg.length + occIcon.length;
        let doneMedia = 0;
        const bumpMedia = () => {
          doneMedia++;
          setProgress({
            phase: 'images',
            pct: totalMedia ? Math.round((doneMedia / totalMedia) * 100) : 100,
          });
        };
        const images = {};
        for (let i = 0; i < occImg.length; i++) {
          const s = occImg[i];
          images[s.slot] = await imageStoreFetchBase64(s.slot, s.size);
          bumpMedia();
        }
        const icons = {};
        for (let i = 0; i < occIcon.length; i++) {
          const s = occIcon[i];
          icons[s.slot] = await iconStoreFetchBase64(s.slot, s.size);
          bumpMedia();
        }
        if (Object.keys(images).length || Object.keys(icons).length) {
          obj.version = 3;
          if (Object.keys(images).length) obj.images = images;
          if (Object.keys(icons).length) obj.icons = icons;
          text = JSON.stringify(obj);
        }
      }
      // Embute as CONFIGS GLOBAIS no pacote (sempre): version 3 + global_config.
      // Ficam separadas na NVS no device — aqui só viajam no arquivo. No restore,
      // o restaurador compara e só regrava se diferentes (ver doRestore).
      try {
        const gc = getGlobalConfigForBackup && getGlobalConfigForBackup();
        if (gc && Object.keys(gc).length) {
          const obj = JSON.parse(text);
          obj.version = 3;
          obj.global_config = gc;
          text = JSON.stringify(obj);
        }
      } catch {/* sem configs globais — segue sem elas */}
      // Aborta se o firmware sinalizou truncamento (buffer cheio na montagem):
      // um backup truncado parece OK mas perde presets — pior que nenhum. Nao
      // baixa o arquivo; mostra erro pedindo pra liberar espaco/usar WiFi.
      let truncatedFlag = false;
      try { truncatedFlag = !!JSON.parse(text).truncated; } catch {/* sem flag */}
      if (truncatedFlag) throw new Error(t('sys.backup.err.truncated'));
      setProgress({ phase: 'saving', pct: 100 });
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `bfmidi-backup-${dateStr}.json`;
      // App Android (WebView): nao baixa blob:/<a download> sozinho — grava o
      // arquivo pela ponte nativa (MainActivity.DownloadBridge). No navegador
      // (desktop/PWA) a ponte nao existe, entao segue o download normal.
      const bridge = window.BFMIDIDownloader;
      if (bridge && typeof bridge.saveText === 'function') {
        // Backups grandes (com imagens base64, ~1 MB) nao passam de forma
        // confiavel numa unica chamada da ponte — fatia em pedacos quando o
        // app suporta (begin/append/end). Backups pequenos vao diretos.
        const CHUNK = 256 * 1024;
        let ok;
        if (text.length > CHUNK &&
            typeof bridge.begin === 'function' &&
            typeof bridge.append === 'function' &&
            typeof bridge.end === 'function') {
          bridge.begin(fileName);
          for (let i = 0; i < text.length; i += CHUNK) {
            bridge.append(text.slice(i, i + CHUNK));
          }
          ok = bridge.end();
        } else {
          ok = bridge.saveText(fileName, text);
        }
        if (!ok) {
          throw new Error('Falha ao salvar o backup no dispositivo.');
        }
      } else {
        const blob = new Blob([text], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }
      let count = 0, imgCount = 0, iconCount = 0;
      try {
        const json = JSON.parse(text);
        count = json.presets ? Object.keys(json.presets).length : 0;
        imgCount = json.images ? Object.keys(json.images).length : 0;
        iconCount = json.icons ? Object.keys(json.icons).length : 0;
      } catch {/* ignore parse — file ainda foi baixado */}
      setStatus({
        kind: 'ok',
        msg: t('sys.backup.resBackup', { n: count })
           + (imgCount ? t('sys.backup.resImages', { n: imgCount }) : '')
           + (iconCount ? t('sys.backup.resIcons', { n: iconCount }) : '')
           + ` · ${fmtKB(text.length)}`,
      });
      setProgress(null);
    } catch (e) {
      setStatus({ kind: 'error', msg: t('common.fail') + e.message });
      setProgress(null);
    } finally {
      if (usbBulk) heavyOpLeave();
    }
  }, [includeImages, t, getGlobalConfigForBackup]);

  const doRestore = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      setStatus({ kind: 'loading', msg: t('sys.backup.ph.reading') });
      setProgress({ phase: 'reading', pct: 0 });
      // Por USB todo o restore (uploads de midia + chunks do /restore) viaja
      // na MESMA linha serial. Marca heavy op durante a sequencia inteira pra
      // os polls de fundo (bank/live, EXP, USB host) pausarem — senao eles
      // intercalariam comandos e, mesmo com o mutex de envio (usbSendChainRef),
      // ficariam empilhados atras de ~90 chunks e estourariam o timeout. Por
      // HTTP o branch XHR mais abaixo faz seu proprio enter/leave.
      let usbBulk = false;
      try {
        const text = await file.text();
        setProgress({ phase: 'reading', pct: 100, bytes: text.length });
        // Valida estrutura antes de enviar pro device
        const parsed = JSON.parse(text);
        if (!parsed.presets || typeof parsed.presets !== 'object') {
          throw new Error(t('sys.backup.err.invalidFile'));
        }
        const hasImages = parsed.images && typeof parsed.images === 'object'
                       && Object.keys(parsed.images).length > 0;
        const hasIcons = parsed.icons && typeof parsed.icons === 'object'
                       && Object.keys(parsed.icons).length > 0;
        const hasGlobal = parsed.global_config && typeof parsed.global_config === 'object'
                       && Object.keys(parsed.global_config).length > 0;
        // Corpo do /restore SEM images/icons/global_config: o firmware as ignora
        // (presets só), e a midia + configs globais vao por suas próprias rotas
        // ANTES do restore (que agenda reboot).
        let restoreBody = text;
        if (hasImages || hasIcons || hasGlobal) {
          const clone = { ...parsed };
          delete clone.images;
          delete clone.icons;
          delete clone.global_config;
          restoreBody = JSON.stringify(clone);
        }
        // Pausa os polls de fundo enquanto a sequencia USB ocupa a serial.
        usbBulk = _transport.usbConnected;
        if (usbBulk) heavyOpEnter();
        // Imagens/icones PRIMEIRO (MERGE: so os slots presentes no arquivo). O
        // /restore agenda reboot, entao os uploads tem que vir antes dele.
        // Best-effort: se um slot falhar (quota/rede), registra e segue —
        // nao aborta o restore dos presets (coerente com o merge).
        let imgUp = 0;
        const imgFail = [];
        if (hasImages) {
          setStatus({ kind: 'loading', msg: t('sys.backup.ph.imagesUp') });
          const slotKeys = Object.keys(parsed.images);
          for (let i = 0; i < slotKeys.length; i++) {
            const slot = parseInt(slotKeys[i], 10);
            const b64 = parsed.images[slotKeys[i]];
            if (!(slot >= 0 && slot < IMAGE_SLOT_COUNT) || typeof b64 !== 'string' || !b64) {
              continue;
            }
            setProgress({
              phase: 'images-up',
              pct: Math.round((i / slotKeys.length) * 100),
            });
            try {
              await imageStoreUpload(slot, base64ToJpegBlob(b64));
              imgUp++;
            } catch {
              imgFail.push(slot);
            }
          }
          setProgress({ phase: 'images-up', pct: 100 });
        }
        let iconUp = 0;
        const iconFail = [];
        if (hasIcons) {
          setStatus({ kind: 'loading', msg: t('sys.backup.ph.iconsUp') });
          const slotKeys = Object.keys(parsed.icons);
          for (let i = 0; i < slotKeys.length; i++) {
            const slot = parseInt(slotKeys[i], 10);
            const b64 = parsed.icons[slotKeys[i]];
            if (!(slot >= 0 && slot < ICON_UPLOAD_SLOT_COUNT) || typeof b64 !== 'string' || !b64) {
              continue;
            }
            setProgress({
              phase: 'icons-up',
              pct: Math.round((i / slotKeys.length) * 100),
            });
            try {
              await iconStoreUpload(slot, base64ToPngBlob(b64));
              iconUp++;
            } catch {
              iconFail.push(slot);
            }
          }
          setProgress({ phase: 'icons-up', pct: 100 });
        }
        // CONFIGS GLOBAIS: compara o backup com o estado atual; só regrava
        // (POST /config/global) se forem DIFERENTES. "Já tem os dados globais" =>
        // pula (não desgasta a NVS). Antes do /restore, que agenda reboot.
        let globalApplied = false, globalSkipped = false;
        if (hasGlobal) {
          const stable = (o) => JSON.stringify(
            Object.keys(o).sort().map((k) => k + '=' + String(o[k])));
          const cur = getGlobalConfigForBackup && getGlobalConfigForBackup();
          if (cur && stable(cur) === stable(parsed.global_config)) {
            globalSkipped = true;
          } else {
            setStatus({ kind: 'loading', msg: t('sys.backup.ph.globalUp') });
            const gb = new URLSearchParams();
            Object.entries(parsed.global_config).forEach(([k, v]) => gb.set(k, String(v)));
            try { await apiCall('POST', '/config/global', gb); globalApplied = true; }
            catch {/* best-effort — segue pro restore dos presets */}
          }
        }
        setStatus({ kind: 'loading', msg: t('sys.backup.st.sendingDevice') });
        // Pra ter progresso de UPLOAD usa XMLHttpRequest (fetch nao expoe
        // upload progress). Em USB envia o corpo em CHUNKS (a linha de comando
        // tem teto de ~2 KB), acumulados no firmware via /restore?seq&fin.
        let result;
        if (DEMO_MODE) {
          setProgress({ phase: 'applying', pct: null });
          result = await apiCall('POST', '/restore', restoreBody);
        } else if (_transport.usbConnected) {
          result = await usbRestoreChunked(restoreBody, setProgress);
        } else {
          const base = DEVICE_API || '';
          // XHR cru (fetch nao expoe progresso de upload) NAO passa pelo
          // queuedFetch — marca o heavy op na mao, senao o pingHttp derruba
          // o deviceState pra offline enquanto o firmware aplica o restore.
          heavyOpEnter();
          try {
          result = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${base}/restore`);
            // text/plain e o que o ESP precisa pra popular webServer.arg("plain").
            // Application/x-www-form-urlencoded seria parseado como pares key=val
            // e o body JSON do restore nao tem '=' — daria 400 "missing body".
            xhr.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
            xhr.upload.onprogress = (evt) => {
              setProgress({
                phase: 'uploading',
                pct: evt.lengthComputable
                  ? Math.round((evt.loaded / evt.total) * 100)
                  : null,
                bytes: evt.loaded,
                total: evt.total,
              });
            };
            xhr.upload.onload = () => {
              setProgress({ phase: 'applying', pct: null });
            };
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText || '{}')); }
                catch { resolve({}); }
              } else {
                reject(new Error('HTTP ' + xhr.status));
              }
            };
            xhr.onerror = () => reject(new Error(t('common.networkError')));
            xhr.send(restoreBody);
          });
          } finally {
            heavyOpLeave();
          }
        }
        setStatus({
          kind: 'ok',
          msg: t('sys.backup.resRestore', { n: result.applied || 0 })
             + (imgUp ? t('sys.backup.resImages', { n: imgUp }) : '')
             + (iconUp ? t('sys.backup.resIcons', { n: iconUp }) : '')
             + (imgFail.length ? t('sys.backup.resFail', { slots: imgFail.join(', ') }) : '')
             + (iconFail.length ? t('sys.backup.resFail', { slots: iconFail.join(', ') }) : '')
             + (globalApplied ? t('sys.backup.resGlobalApplied')
                : globalSkipped ? t('sys.backup.resGlobalSkipped') : '')
             + t('sys.backup.resApplied') + ` · ${fmtKB(restoreBody.length)}`,
        });
        setProgress(null);
        if (onRestored) await onRestored();
      } catch (err) {
        setStatus({ kind: 'error', msg: t('common.fail') + err.message });
        setProgress(null);
      } finally {
        if (usbBulk) heavyOpLeave();
      }
    };
    input.click();
  }, [t, getGlobalConfigForBackup, onRestored]);

  const isBusy = status.kind === 'loading';
  return (
    <div className="bf-card">
      <div className="bf-card-head">
        <h3>{t('sys.backup.title')}</h3>
        <span className="meta">PRESETS · LITTLEFS</span>
      </div>
      {/* Toggle Studio "Incluir imagens" com sub-label */}
      <div className="bf-auto-row">
        <div className="bfg-toggle-text">
          <span className="label">{t('sys.backup.includeImages')}</span>
          <span className="bfg-toggle-sub">{t('sys.backup.biggerFileSub')}</span>
        </div>
        <button
          type="button"
          className={'bf-switch is-accent' + (includeImages ? ' is-on' : '')}
          onClick={() => !isBusy && setIncludeImages(!includeImages)}
          disabled={isBusy}
          aria-pressed={includeImages}
          aria-label={t('sys.backup.includeImages')}
        />
      </div>
      <p className="bf-hint">{t('sys.backup.globalNote')}</p>
      <div className="bfg-backup-actions">
        <button
          type="button"
          className="bfg-backup-btn bfg-backup-btn-primary"
          onClick={doBackup}
          disabled={isBusy}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12 M7 10l5 5 5-5"/>
            <path d="M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>
          </svg>
          <span>{t('sys.backup.doBackup').toUpperCase()}</span>
        </button>
        <button
          type="button"
          className="bfg-backup-btn"
          onClick={doRestore}
          disabled={isBusy}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21V9 M7 14l5-5 5 5"/>
            <path d="M4 7V4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3"/>
          </svg>
          <span>{t('sys.backup.doRestore').toUpperCase()}</span>
        </button>
      </div>
      {/* Status pill — Studio (mostra "PRONTO PARA INICIAR" quando idle) */}
      {!progress && (
        <div className={'bfg-backup-pill ' + (status.kind === 'ok' ? 'is-ok' : status.kind === 'error' ? 'is-err' : '')}>
          <span className="bfg-backup-pill-dot"/>
          <span className="bfg-backup-pill-txt">
            {status.kind === 'idle' ? 'PRONTO PARA INICIAR'
              : status.kind === 'ok' ? status.msg
              : status.kind === 'error' ? status.msg
              : '…'}
          </span>
        </div>
      )}
      {progress && (
        <div className="bf-backup-progress">
          <div className="bf-backup-progress-track">
            <div
              className={'bf-backup-progress-fill' +
                         (progress.pct == null ? ' is-indeterminate' : '')}
              style={progress.pct != null
                ? { width: progress.pct + '%' }
                : undefined}
            />
          </div>
          <div className="bf-backup-progress-info">
            <span>{
              progress.phase === 'requesting' ? t('sys.backup.ph.connecting')
              : progress.phase === 'downloading' ? t('sys.backup.ph.downloading')
              : progress.phase === 'images' ? t('sys.backup.ph.images')
              : progress.phase === 'images-up' ? t('sys.backup.ph.imagesUp')
              : progress.phase === 'icons-up' ? t('sys.backup.ph.iconsUp')
              : progress.phase === 'saving' ? t('sys.backup.ph.saving')
              : progress.phase === 'reading' ? t('sys.backup.ph.reading')
              : progress.phase === 'uploading' ? t('sys.backup.ph.uploading')
              : progress.phase === 'applying' ? t('sys.backup.ph.applying')
              : '…'
            }</span>
            <span className="bf-backup-progress-bytes">
              {progress.pct != null && `${progress.pct}%`}
              {typeof progress.bytes === 'number' && (
                <> · {fmtKB(progress.bytes)}
                  {progress.total ? ` / ${fmtKB(progress.total)}` : ''}
                </>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PRESET ÚNICO (export/import de 1 preset) ──────────────────────
// Exporta/importa UM preset (cabecalho + linhas sw*), 100% client-side sobre
// as rotas /backup e /restore ja existentes — sem endpoint novo no firmware.
//   Export: baixa o backup completo (HTTP: 1 GET; USB: paginado via
//           usbBackupChunked) e filtra a tag escolhida (banco+preset).
//   Import: le o arquivo, RE-CHAVEIA o preset pro slot de destino e manda pro
//           /restore (MERGE + reboot). Relocar e seguro: a tag e so a CHAVE do
//           JSON — nem o header nem as linhas sw* embutem o slot.
// Midia (imagens /img + icones /icon) NAO entra: e o caso de relocar preset,
// nao-destrutivo aos slots de midia. Pra levar midia junto, use Backup Completo.
function SinglePresetCard() {
  const { t } = useBfI18n();
  const [srcBank, setSrcBank] = useState(0);     // 0..9  (A..J)
  const [srcPreset, setSrcPreset] = useState(0); // 0..5  (1..6)
  const [dstBank, setDstBank] = useState(0);
  const [dstPreset, setDstPreset] = useState(0);
  const [status, setStatus] = useState({ kind: 'idle', msg: '' });

  const isBusy = status.kind === 'loading';
  const tagOf = (bank, preset) => `${BANK_LETTERS[bank] || 'A'}${preset + 1}`;
  const fmtKB = (b) => (!b ? '0 KB' : b < 1024 ? b + ' B' : (b / 1024).toFixed(1) + ' KB');

  // Baixa o backup completo e devolve o texto JSON. USB pagina (a linha unica
  // estoura o watchdog de 64 KB); HTTP e um GET direto.
  const fetchBackupText = useCallback(async () => {
    if (_transport.usbConnected) return await usbBackupChunked(() => {});
    const base = DEVICE_API || '';
    const resp = await fetch(`${base}/backup`, { method: 'GET' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.text();
  }, []);

  const doExport = useCallback(async () => {
    const tag = tagOf(srcBank, srcPreset);
    setStatus({ kind: 'loading', msg: t('sys.backup.ph.downloading') });
    const usbBulk = _transport.usbConnected;
    if (usbBulk) heavyOpEnter();
    try {
      const full = JSON.parse(await fetchBackupText());
      const presets = full.presets || {};
      const swParams = full.sw_params || {};
      // O /backup so inclui presets MODIFICADOS — ausente = default, nada a levar.
      if (!presets[tag]) {
        setStatus({ kind: 'error', msg: t('sys.preset1.empty', { tag }) });
        return;
      }
      const out = { version: 2, single: true, preset: tag,
                    presets: { [tag]: presets[tag] } };
      if (swParams[tag]) out.sw_params = { [tag]: swParams[tag] };
      const text = JSON.stringify(out);
      const fileName = `bfmidi-preset-${tag}-${new Date().toISOString().slice(0, 10)}.json`;
      // Ponte nativa (WebView Android) ou <a download> (navegador/PWA). Preset
      // unico e pequeno — nao precisa do begin/append/end do backup grande.
      const bridge = window.BFMIDIDownloader;
      if (bridge && typeof bridge.saveText === 'function') {
        if (!bridge.saveText(fileName, text)) throw new Error('Falha ao salvar o arquivo.');
      } else {
        const blob = new Blob([text], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }
      setStatus({ kind: 'ok',
                  msg: t('sys.preset1.resExport', { tag }) + ` · ${fmtKB(text.length)}` });
    } catch (e) {
      setStatus({ kind: 'error', msg: t('common.fail') + e.message });
    } finally {
      if (usbBulk) heavyOpLeave();
    }
  }, [srcBank, srcPreset, t, fetchBackupText]);

  const doImport = useCallback(() => {
    const dstTag = tagOf(dstBank, dstPreset);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      setStatus({ kind: 'loading', msg: t('sys.backup.ph.reading') });
      let usbBulk = false;
      try {
        const parsed = JSON.parse(await file.text());
        const presets = parsed.presets && typeof parsed.presets === 'object'
          ? parsed.presets : null;
        if (!presets) throw new Error(t('sys.preset1.err.invalidFile'));
        // Preset de origem: o campo `preset` (arquivo de preset unico) ou a 1a
        // chave de `presets` (aceita ate um backup completo — usa o 1o preset).
        const srcTag = (parsed.preset && presets[parsed.preset])
          ? parsed.preset : Object.keys(presets)[0];
        if (!srcTag || !presets[srcTag]) throw new Error(t('sys.preset1.err.invalidFile'));
        // Re-chaveia pro slot de destino: MERGE de 1 preset no bankMemory.
        const body = { version: 2, presets: { [dstTag]: presets[srcTag] } };
        const swParams = parsed.sw_params && typeof parsed.sw_params === 'object'
          ? parsed.sw_params : null;
        if (swParams && swParams[srcTag]) body.sw_params = { [dstTag]: swParams[srcTag] };
        const restoreBody = JSON.stringify(body);
        setStatus({ kind: 'loading', msg: t('sys.backup.st.sendingDevice') });
        usbBulk = _transport.usbConnected;
        if (usbBulk) heavyOpEnter();
        if (_transport.usbConnected) {
          await usbRestoreChunked(restoreBody, () => {});
        } else {
          // apiCall POST com string vira Content-Type text/plain -> arg("plain")
          // no ESP32; /restore casa no HEAVY_URL_RE (heavy op auto-marcado).
          await apiCall('POST', '/restore', restoreBody);
        }
        setStatus({ kind: 'ok', msg: t('sys.preset1.resImport', { tag: dstTag }) });
      } catch (err) {
        setStatus({ kind: 'error', msg: t('common.fail') + err.message });
      } finally {
        if (usbBulk) heavyOpLeave();
      }
    };
    input.click();
  }, [dstBank, dstPreset, t]);

  const bankOptions = BANK_LETTERS.map((L, i) => <option key={i} value={i}>{L}</option>);
  const presetOptions = Array.from({ length: 6 }, (_, i) =>
    <option key={i} value={i}>{i + 1}</option>);
  const selectPair = (bankVal, setBank, presetVal, setPreset, aria) => (
    <div className="bf-p1-row">
      <div className="bfg-select-box bf-p1-sel">
        <span className="bfg-select-eyebrow">{t('sys.preset1.bank')}</span>
        <BfSelect
          className="bf-input bf-select bfg-select-lg"
          value={bankVal}
          onChange={(e) => setBank(Number(e.target.value))}
          disabled={isBusy}
          aria-label={`${aria} · ${t('sys.preset1.bank')}`}
        >
          {bankOptions}
        </BfSelect>
        <span className="bf-select-chev bfg-select-chev">▾</span>
      </div>
      <div className="bfg-select-box bf-p1-sel">
        <span className="bfg-select-eyebrow">{t('sys.preset1.preset')}</span>
        <BfSelect
          className="bf-input bf-select bfg-select-lg"
          value={presetVal}
          onChange={(e) => setPreset(Number(e.target.value))}
          disabled={isBusy}
          aria-label={`${aria} · ${t('sys.preset1.preset')}`}
        >
          {presetOptions}
        </BfSelect>
        <span className="bf-select-chev bfg-select-chev">▾</span>
      </div>
    </div>
  );

  return (
    <div className="bf-card">
      <div className="bf-card-head">
        <h3>{t('sys.preset1.title')}</h3>
        <span className="meta">1 PRESET · LITTLEFS</span>
      </div>
      <p className="bf-hint">{t('sys.preset1.hint')}</p>

      {/* EXPORTAR — banco + preset de ORIGEM */}
      <span className="bfg-select-eyebrow bf-p1-eyebrow">{t('sys.preset1.exportEyebrow')}</span>
      {selectPair(srcBank, setSrcBank, srcPreset, setSrcPreset, t('sys.preset1.doExport'))}
      <button
        type="button"
        className="bfg-backup-btn bfg-backup-btn-primary bf-p1-btn"
        onClick={doExport}
        disabled={isBusy}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12 M7 10l5 5 5-5"/>
          <path d="M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>
        </svg>
        <span>{t('sys.preset1.doExport')}</span>
      </button>

      <div className="bf-p1-divider" />

      {/* IMPORTAR — banco + preset de DESTINO */}
      <span className="bfg-select-eyebrow bf-p1-eyebrow">{t('sys.preset1.importEyebrow')}</span>
      {selectPair(dstBank, setDstBank, dstPreset, setDstPreset, t('sys.preset1.doImport'))}
      <button
        type="button"
        className="bfg-backup-btn bf-p1-btn"
        onClick={doImport}
        disabled={isBusy}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21V9 M7 14l5-5 5 5"/>
          <path d="M4 7V4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3"/>
        </svg>
        <span>{t('sys.preset1.doImport')}</span>
      </button>

      <div className={'bfg-backup-pill bf-p1-pill ' + (status.kind === 'ok' ? 'is-ok' : status.kind === 'error' ? 'is-err' : '')}>
        <span className="bfg-backup-pill-dot"/>
        <span className="bfg-backup-pill-txt">
          {status.kind === 'idle' ? 'PRONTO PARA INICIAR'
            : status.kind === 'loading' ? '…'
            : status.msg}
        </span>
      </div>
    </div>
  );
}

// ─── SYSTEM ─────────────────────────────────────────────────────────
function PageSystemConfig({
  onOpenWifi, sysSectionReq, onSysSectionApplied, getGlobalConfigForBackup,
  onBackupRestored,
  model, setModel,
  switchOperationMode, setSwitchOperationMode,
  hybridSwitchLayout, setHybridSwitchLayout,
  nanoSw6Global, setNanoSw6Global,
  livePinGlobal2, setLivePinGlobal2,
  microRemap, setMicroRemap, hasMicro,
  displayInvert, setDisplayInvert,
  hostReverseMidi, setHostReverseMidi,
  hostCtrlEnabled, setHostCtrlEnabled,
  wifiStatus, wifiNetworks, wifiSsid, setWifiSsid,
  wifiPassword, setWifiPassword, wifiState,
  onWifiScan, onWifiConnect,
  deviceState, usbState, onToggleUsb,
  connectionMode, onToggleConnectionMode,
  usbHostStatus, usbHostBusy,
  onUsbHostLoad, onUsbHostRefresh, onUsbHostSetMode,
  onUsbHostToggleBle, onUsbHostSetBleMode, onUsbHostSetFilter, onUsbHostEnterUpdate,
  systemTheme, onSetSystemTheme, onToggleTheme,
  autoSaveEnabled, onSetAutoSaveEnabled,
  monitorEntry, monitorKind, liveEvents,
  onErased,
}) {
  const [section, setSection] = useState('model');
  const hasLivePin = ((MODELS.find((m) => m.id === model) || {}).switches || 0) >= 8;
  // Pedido externo de seção (ex.: clicar no ícone WiFi do header → abre 'wifi').
  useEffect(() => {
    if (sysSectionReq) {
      setSection(sysSectionReq);
      if (onSysSectionApplied) onSysSectionApplied();
    }
  }, [sysSectionReq]);

  // Idioma da interface vem do store global (compartilhado com o toggle do
  // header e com os comentarios de todos os cards). Padrao PORTUGUES ('pt').
  const { language, setLanguage, t } = useBfI18n();

  // Poll do status do USB Host enquanto a aba estiver aberta. Ciclo 2s.
  // fromPoll=true permite ao handler skipar tick se anterior ainda em vôo.
  useEffect(() => {
    if (section !== 'usbhost' || !onUsbHostLoad) return;
    onUsbHostLoad(true);
    const id = setInterval(() => { onUsbHostLoad(true); }, 2000);
    return () => clearInterval(id);
  }, [section, onUsbHostLoad]);
  const [family, variant] = (() => {
    const idx = model.indexOf(' ');
    return idx === -1 ? [model, ''] : [model.slice(0, idx), model.slice(idx + 1)];
  })();
  // So modelos do chip do pedal conectado (modelIsForChip — placa de outro
  // chip e fatal de aplicar; o firmware tambem recusa no POST). Familias sem
  // nenhum modelo compativel somem do grid.
  const list = MODELS.filter((m) => m.tag === family && modelIsForChip(m));
  const familiesVisible = FAMILIES.filter(
    (f) => MODELS.some((m) => m.tag === f && modelIsForChip(m)));
  const wifiConnected = !!(wifiStatus && wifiStatus.sta_connected);
  // SSID manual (redes OCULTAS nao aparecem no scan — o firmware conecta
  // normalmente, so faltava a UI deixar digitar o nome).
  const [wifiManualSsid, setWifiManualSsid] = useState(false);
  // Estado atual da conexão (card educativo dos desenhos):
  //   4 = comunicando via USB (Web Serial conectado — tem prioridade)
  //   3 = controladora no roteador de casa (STA conectado)
  //   2 = você conectado direto no WiFi da controladora (AP, online mas sem STA)
  //   1 = não conectado (offline / precisa entrar no BFMIDI_WIFI)
  const wifiStateNow = usbState === 'connected' ? 4
    : wifiConnected ? 3
    : (deviceState === 'online' ? 2 : 1);
  // SCAN varre canais e derruba a conexao WiFi ativa. Em STA (bfmidi.local)
  // isso mata a propria sessao do editor e a resposta se perde — entao so
  // liberamos o scan em modo AP (192.168.4.1) ou quando o transporte e USB.
  const scanAllowed = usbState === 'connected' || connectionMode === 'AP';

  return (
    <div className="bf-content bf-content-system" key="system">
      <PageHeader
        title={t('sys.title')}
        onOpenWifi={onOpenWifi}
        deviceState={deviceState}
        usbState={usbState}
        onToggleUsb={onToggleUsb}
        connectionMode={connectionMode}
        onToggleConnectionMode={onToggleConnectionMode}
        systemTheme={systemTheme}
        onToggleTheme={onToggleTheme}
      />
      <div className={'bf-icon-tabs ' + (DEMO_MODE ? 'cols-3' : 'cols-4')}>
          <button className={'bf-icon-tab' + (section === 'model' ? ' is-on' : '')} onClick={() => setSection('model')}>
            <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {/* Engrenagem (PRINCIPAL/MAIN): corpo dentado + cubo central */}
              <circle className="bf-tab-shape" cx="12" cy="12" r="3.1" />
              <path className="bf-tab-shape" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V15z" />
            </svg>
            <span>{t('sys.tab.model')}</span>
          </button>
          {!DEMO_MODE && (
          <button className={'bf-icon-tab' + (section === 'wifi' ? ' is-on' : '')} onClick={() => setSection('wifi')}>
            <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {/* WiFi: 3 ondas concentricas + ponto na base, ocupando todo o viewBox */}
              <path className="bf-tab-shape" d="M2 8.5 Q12 0 22 8.5" />
              <path className="bf-tab-shape" d="M5 13 Q12 6 19 13" />
              <path className="bf-tab-shape" d="M8.5 17.5 Q12 14 15.5 17.5" />
              <circle className="bf-tab-dot" cx="12" cy="21" r="1.5" />
            </svg>
            <span>{t('sys.tab.wifi')}</span>
          </button>
          )}
          <button className={'bf-icon-tab' + (section === 'usbhost' ? ' is-on' : '')} onClick={() => setSection('usbhost')}>
            <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {/* USB HOST: simbolo USB classico (tridente) — circulo no
                  ponto inicial + 3 ramos terminando em circulo, quadrado
                  e seta */}
              <circle className="bf-tab-dot" cx="12" cy="20" r="1.6" />
              <path className="bf-tab-shape" d="M12 20V4" />
              <path className="bf-tab-line" d="M12 4l-2.5 3 5 0z" />
              <path className="bf-tab-shape" d="M12 14l-4-3v-2" />
              <rect className="bf-tab-dot" x="6" y="6.5" width="4" height="3" />
              <path className="bf-tab-shape" d="M12 10l4 3v3" />
              <circle className="bf-tab-dot" cx="16" cy="16.5" r="1.6" />
            </svg>
            <span>{t('sys.tab.usbhost')}</span>
          </button>
          <button className={'bf-icon-tab' + (section === 'backup' ? ' is-on' : '')} onClick={() => setSection('backup')}>
            <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {/* Disquete classico (save/backup): corpo + slot superior +
                  janela do slot + label inferior */}
              <rect className="bf-tab-shape" x="3" y="3" width="18" height="18" rx="2" />
              <rect className="bf-tab-dot" x="6" y="3" width="12" height="6.5" />
              <rect className="bf-tab-shape" x="14" y="4.5" width="2" height="3.5" />
              <rect className="bf-tab-shape" x="6.5" y="13" width="11" height="6" />
            </svg>
            <span>{t('sys.tab.backup')}</span>
          </button>
        </div>

      {section === 'model' && (
        <>
          {/* FAMÍLIA + MODELO — unificados num card so. Familia em cima
              (seletor 1/2/3), variante embaixo (radios), separados por
              eyebrows. */}
          <div className="bf-card">
            <div className="bf-card-head">
              <h3>{t('sys.model.title')}</h3>
              <span className="meta">{model || family}</span>
            </div>

            <span className="bfg-select-eyebrow">{t('sys.model.family')}</span>
            <div className="bfg-family-grid">
              {familiesVisible.map((f) => {
                const num = (f.split('-')[1] || f).trim();
                const on = family === f;
                return (
                  <button
                    key={f}
                    type="button"
                    className={'bfg-family-btn' + (on ? ' is-on' : '')}
                    onClick={() => {
                      const first = MODELS.find((m) => m.tag === f && modelIsForChip(m));
                      if (first) setModel(first.id);
                    }}
                  >
                    <span className="bfg-family-num">{num}</span>
                    <span className="bfg-family-lbl">BFMIDI</span>
                  </button>
                );
              })}
            </div>

            <span className="bfg-select-eyebrow bfg-model-eyebrow-2">{t('sys.model.variant')} · {family}</span>
            <div className="bfg-variant-list">
              {list.map((v) => {
                const on = model === v.id;
                const name = v.id.replace(/^BFMIDI-\d+\s*/, '');
                const sub = `${v.switches} SW · ${v.size}`;
                return (
                  <button
                    key={v.id}
                    type="button"
                    className={'bfg-variant-row' + (on ? ' is-on' : '')}
                    onClick={() => setModel(v.id)}
                  >
                    <span className={'bfg-variant-radio' + (on ? ' is-on' : '')}>
                      {on && <span />}
                    </span>
                    <span className="bfg-variant-text">
                      <span className="bfg-variant-name">{name}</span>
                      <span className="bfg-variant-sub">{sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* IDIOMA + SOBRE — movidos da antiga aba IDIOMA pra ca. A aba
              PRINCIPAL/MAIN agrupa a config principal: modelo + idioma +
              sobre. */}
          <div className="bf-card">
            <div className="bf-card-head">
              <h3>{t('sys.opmode.title')}</h3>
              <span className="meta">
                {switchOperationMode === 1
                  ? t('sys.opmode.hybrid')
                  : t('sys.opmode.presetLive')}
              </span>
            </div>
            <div className="bf-seg" role="radiogroup" aria-label={t('sys.opmode.title')}>
              <button
                type="button"
                role="radio"
                aria-checked={switchOperationMode === 0}
                className={switchOperationMode === 0 ? 'is-active' : ''}
                onClick={() => setSwitchOperationMode(0)}
              >
                {t('sys.opmode.presetLive')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={switchOperationMode === 1}
                className={switchOperationMode === 1 ? 'is-active' : ''}
                onClick={() => setSwitchOperationMode(1)}
              >
                {t('sys.opmode.hybrid')}
              </button>
            </div>
            <p className="bfg-lang-desc" style={{ marginTop: 12 }}>
              {switchOperationMode === 1
                ? t('sys.opmode.hybridHintGeneric')
                : t('sys.opmode.presetLiveHint')}
            </p>
            {switchOperationMode === 1 && (
              <div
                className="bf-hybrid-layouts"
                role="radiogroup"
                aria-label={t('sys.opmode.hybridLayoutAria')}
              >
                {[1, 2].map((layout) => {
                  const active = hybridSwitchLayout === layout;
                  const firstPreset = layout === 1;
                  return (
                    <button
                      key={layout}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={'bf-hybrid-layout' + (active ? ' is-active' : '')}
                      onClick={() => setHybridSwitchLayout(layout)}
                    >
                      <span className="bf-hybrid-layout-head">
                        <span>{t(`sys.opmode.layout${layout}`)}</span>
                        <span className="bf-hybrid-layout-radio" aria-hidden="true">
                          {active && <span />}
                        </span>
                      </span>
                      <svg
                        className="bf-hybrid-layout-svg"
                        viewBox="0 0 292 92"
                        aria-hidden="true"
                      >
                        <rect className="bf-hybrid-board" x="2" y="2" width="288" height="88" rx="15" />
                        <rect className={'bf-hybrid-zone ' + (firstPreset ? 'is-preset' : 'is-live')}
                              x="10" y="10" width="133" height="72" rx="11" />
                        <rect className={'bf-hybrid-zone ' + (firstPreset ? 'is-live' : 'is-preset')}
                              x="149" y="10" width="133" height="72" rx="11" />
                        <text className={'bf-hybrid-zone-label ' + (firstPreset ? 'is-preset' : 'is-live')}
                              x="76.5" y="25" textAnchor="middle">
                          {firstPreset ? 'PRESET' : 'LIVE'}
                        </text>
                        <text className={'bf-hybrid-zone-label ' + (firstPreset ? 'is-live' : 'is-preset')}
                              x="215.5" y="25" textAnchor="middle">
                          {firstPreset ? 'LIVE' : 'PRESET'}
                        </text>
                        {Array.from({ length: 6 }, (_, i) => {
                          const isPreset = firstPreset ? i < 3 : i >= 3;
                          const x = i < 3 ? 32 + i * 44 : 171 + (i - 3) * 44;
                          return (
                            <g key={i}>
                              <circle className={'bf-hybrid-switch ' + (isPreset ? 'is-preset' : 'is-live')}
                                      cx={x} cy="52" r="16" />
                              <circle className="bf-hybrid-switch-core" cx={x} cy="52" r="9" />
                              <text className="bf-hybrid-switch-label" x={x} y="56" textAnchor="middle">
                                {`SW${i + 1}`}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                      <span className="bf-hybrid-layout-desc">
                        {t(`sys.opmode.layout${layout}Desc`)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Preferencia local do editor: quando ligada, qualquer conjunto de
              parametros pendente usa o mesmo fluxo do botao SAVE depois de um
              pequeno debounce (evita gravar a flash a cada passo de slider). */}
          <div className="bf-card">
            <div className="bf-card-head">
              <h3>{t('sys.autosave.title')}</h3>
              <span className={'meta ' + (autoSaveEnabled ? 'is-ok' : 'is-off')}>
                {autoSaveEnabled ? t('sys.autosave.on') : t('sys.autosave.off')}
              </span>
            </div>
            <div className="bf-auto-row">
              <div className="bfg-toggle-text">
                <span className="label">{t('sys.autosave.label')}</span>
                <span className="bfg-toggle-sub">{t('sys.autosave.hint')}</span>
              </div>
              <button
                type="button"
                className={'bf-switch is-accent' + (autoSaveEnabled ? ' is-on' : '')}
                onClick={() => onSetAutoSaveEnabled(!autoSaveEnabled)}
                aria-pressed={autoSaveEnabled}
                aria-label={t('sys.autosave.title')}
              />
            </div>
          </div>

          <div className="bf-card">
            <div className="bf-card-head">
              <h3>{t('sys.lang.title')}</h3>
              <span className="meta">{language.toUpperCase()}</span>
            </div>
            <p className="bfg-lang-desc">{t('sys.lang.desc')}</p>
            <div className="bfg-lang-list">
              {[
                // Cada idioma no seu proprio nome (autonimo), pra que o falante
                // nativo o leia corretamente.
                { id: 'pt', name: 'PORTUGUÊS', code: 'BR', sub: 'Brasil · default' },
                { id: 'en', name: 'ENGLISH',   code: 'US', sub: 'English (worldwide)' },
                { id: 'es', name: 'ESPAÑOL',   code: 'ES', sub: 'Castellano' },
              ].map((l) => {
                const on = language === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={'bfg-lang-row' + (on ? ' is-on' : '')}
                    onClick={() => setLanguage(l.id)}
                  >
                    <span className="bfg-lang-code">{l.code}</span>
                    <span className="bfg-lang-text">
                      <span className="bfg-lang-name">{l.name}</span>
                      <span className="bfg-lang-sub">{l.sub}</span>
                    </span>
                    <span className={'bfg-lang-radio' + (on ? ' is-on' : '')}>
                      {on && <span />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* SW6 = SW GLOBAL — só placas NANO (BFMIDI-2/3 NANO/NANO+). Quando
              ligado, o SW6 deixa de chamar o preset 6 e vira o footswitch do
              SW GLOBAL; o card SW GLOBAL passa a aparecer em GLOBAL > MIDI.
              Espelha sw6IsSwGlobal()/boardIsNano no firmware. Trocar reinicia
              o pedal (repinagem do BTSW6 no boot). */}
          {(model || '').includes('NANO') && (
            <div className="bf-card">
              <div className="bf-card-head">
                <h3>{t('sys.sw6global.title')}</h3>
                <span className={'meta ' + (nanoSw6Global ? 'is-ok' : 'is-off')}>
                  {nanoSw6Global ? t('sys.sw6global.on') : t('sys.sw6global.off')}
                </span>
              </div>
              <div className="bf-auto-row">
                <div className="bfg-toggle-text">
                  <span className="label">{t('sys.sw6global.label')}</span>
                  <span className="bfg-toggle-sub">{t('sys.sw6global.hint')}</span>
                </div>
                <button
                  className={'bf-switch is-accent' + (nanoSw6Global ? ' is-on' : '')}
                  onClick={() => setNanoSw6Global(!nanoSw6Global)}
                  aria-pressed={nanoSw6Global}
                  aria-label={t('sys.sw6global.title')}
                />
              </div>
            </div>
          )}

          {/* REMAPPING — só placas MICRO (BFMIDI-2/3 MICRO). Gira a tela em
              0/90/180/270 e remapeia os 4 foots junto (mantém SW1 no mesmo
              canto visual). Persiste via /config/global (micro_remap); mudar
              reinicia o pedal. Ver display_init / swBankBegin no firmware. */}
          {/* LIVE = SW GLOBAL 2 - somente modelos com botao LIVE dedicado.
              Ao salvar, o firmware reinicia e entrega o GPIO exclusivamente
              ao handler escolhido. */}
          {hasLivePin && (
            <div className="bf-card">
              <div className="bf-card-head">
                <h3>{t('sys.liveglobal2.title')}</h3>
                <span className={'meta ' + (livePinGlobal2 ? 'is-ok' : 'is-off')}>
                  {livePinGlobal2 ? t('sys.liveglobal2.global') : t('sys.liveglobal2.live')}
                </span>
              </div>
              <div className="bf-auto-row">
                <div className="bfg-toggle-text">
                  <span className="label">{t('sys.liveglobal2.label')}</span>
                  <span className="bfg-toggle-sub">{t('sys.liveglobal2.hint')}</span>
                </div>
                <button
                  className={'bf-switch is-accent' + (livePinGlobal2 ? ' is-on' : '')}
                  onClick={() => setLivePinGlobal2(!livePinGlobal2)}
                  aria-pressed={livePinGlobal2}
                  aria-label={t('sys.liveglobal2.title')}
                />
              </div>
            </div>
          )}

          {hasMicro && (
            <div className="bf-card">
              <div className="bf-card-head">
                <h3>{t('sys.remap.title')}</h3>
                <span className="meta">{[0, 90, 180, 270][microRemap]}°</span>
              </div>
              <div className="bf-remap-grid">
                {[0, 1, 2, 3].map((idx) => (
                  <button
                    key={idx}
                    className={'bf-remap-opt' + (microRemap === idx ? ' is-active' : '')}
                    onClick={() => setMicroRemap(idx)}
                    title={`${[0, 90, 180, 270][idx]}°`}
                  >
                    <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
                      <g transform={`rotate(${idx * 90} 24 24)`} stroke="currentColor" fill="none">
                        <rect x="10" y="15" width="28" height="18" rx="3" strokeWidth="2" />
                        <line x1="19" y1="15" x2="29" y2="15" strokeWidth="3" strokeLinecap="round" />
                        <circle cx="14" cy="39" r="3.4" fill="#ff6a1f" stroke="none" />
                        <circle cx="34" cy="39" r="2.4" fill="currentColor" stroke="none" opacity="0.35" />
                        <circle cx="14" cy="9" r="2.4" fill="currentColor" stroke="none" opacity="0.35" />
                        <circle cx="34" cy="9" r="2.4" fill="currentColor" stroke="none" opacity="0.35" />
                      </g>
                    </svg>
                    <span>{[0, 90, 180, 270][idx]}°</span>
                  </button>
                ))}
              </div>
              <p className="bf-hint">{t('sys.remap.hint')}</p>
            </div>
          )}

          {/* INVERTER TELA — placas BFMIDI-1 7S (A1/B1/C1). Gira a tela 180°
              pra quando o display foi soldado de cabeça pra baixo. Persiste via
              /config/global (display_invert); mudar reinicia o pedal (rotação
              aplicada no boot por display_init). Espelha globalDisplayInvert no
              firmware. */}
          {(model || '').startsWith('BFMIDI-1 7S') && (
            <div className="bf-card">
              <div className="bf-card-head">
                <h3>{t('sys.invert.title')}</h3>
                <span className={'meta ' + (displayInvert ? 'is-ok' : 'is-off')}>
                  {displayInvert ? t('sys.invert.on') : t('sys.invert.off')}
                </span>
              </div>
              <div className="bf-auto-row">
                <div className="bfg-toggle-text">
                  <span className="label">{t('sys.invert.label')}</span>
                  <span className="bfg-toggle-sub">{t('sys.invert.hint')}</span>
                </div>
                <button
                  className={'bf-switch is-accent' + (displayInvert ? ' is-on' : '')}
                  onClick={() => setDisplayInvert(!displayInvert)}
                  aria-pressed={displayInvert}
                  aria-label={t('sys.invert.title')}
                />
              </div>
            </div>
          )}

          {/* TESTE DE HARDWARE — movido da antiga aba TESTE pra ca. Fica no
              fim da pagina PRINCIPAL/MAIN (modelo + idioma + teste). */}
          <HardTestCard />

          {/* MONITOR MIDI — movido do botao do topo do app pra um card aqui no
              fim da PRINCIPAL. Mostra o ultimo snapshot: chamada de preset
              (monitorKind 'preset') ou disparo de SW ao vivo ('live'). */}
          <div className="bf-card">
            <div className="bf-card-head">
              <h3>MONITOR MIDI</h3>
              <span className={'meta' + (monitorKind === 'live' ? ' is-ok' : '')}>
                {monitorKind === 'live' ? t('mon.subLive') : t('mon.subPreset')}
              </span>
            </div>
            <MonitorView monitorKind={monitorKind} monitorEntry={monitorEntry}
              liveEvents={liveEvents} />
          </div>
        </>
      )}

      {section === 'wifi' && (
        <>
          {/* Card educativo — 3 estados de conexão, com o atual destacado. */}
          <div className="bf-card">
            <div className="bf-card-head">
              <h3>{t('sys.wifi.stateTitle')}</h3>
            </div>
            <div className="bf-wifi-states">
              <div className={'bf-wifi-state' + (wifiStateNow === 1 ? ' is-active' : '')}>
                <div className="bf-wifi-state-ico">
                  <svg viewBox="0 0 48 48" width="46" height="46" fill="none"
                       stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 19 Q24 6 39 19" />
                    <path d="M14 25 Q24 16 34 25" opacity="0.85" />
                    <path d="M19 31 Q24 26 29 31" />
                    <circle cx="24" cy="37" r="1.7" fill="currentColor" stroke="none" />
                    <line x1="9" y1="9" x2="39" y2="39" />
                  </svg>
                </div>
                <p className="bf-wifi-state-txt">{t('sys.wifi.state1')}</p>
              </div>

              <div className={'bf-wifi-state' + (wifiStateNow === 2 ? ' is-active' : '')}>
                <div className="bf-wifi-state-ico">
                  <svg viewBox="0 0 48 48" width="46" height="46" fill="none"
                       stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="16" width="15" height="17" rx="2.5" />
                    <line x1="8" y1="20.5" x2="15" y2="20.5" />
                    <rect x="31" y="13" width="13" height="22" rx="2.5" />
                    <line x1="34.5" y1="31.5" x2="40.5" y2="31.5" />
                    <path d="M22 25 Q24 22 26 25" />
                    <path d="M20.5 27 Q24 21 27.5 27" opacity="0.55" />
                  </svg>
                </div>
                <p className="bf-wifi-state-txt">{t('sys.wifi.state2')}</p>
              </div>

              <div className={'bf-wifi-state' + (wifiStateNow === 3 ? ' is-active' : '')}>
                <div className="bf-wifi-state-ico">
                  <svg viewBox="0 0 48 48" width="46" height="46" fill="none"
                       stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="16" y="5" width="16" height="9" rx="1.5" />
                    <line x1="20" y1="5" x2="20" y2="1.5" />
                    <line x1="28" y1="5" x2="28" y2="1.5" />
                    <circle cx="24" cy="9.5" r="1.1" fill="currentColor" stroke="none" />
                    <rect x="4" y="31" width="15" height="12" rx="2.5" />
                    <line x1="8" y1="35" x2="15" y2="35" />
                    <rect x="32" y="29" width="12" height="15" rx="2.5" />
                    <path d="M18 14 L12 31" opacity="0.6" />
                    <path d="M30 14 L37 29" opacity="0.6" />
                  </svg>
                </div>
                <p className="bf-wifi-state-txt">{t('sys.wifi.state3')}</p>
              </div>

              <div className={'bf-wifi-state' + (wifiStateNow === 4 ? ' is-active' : '')}>
                <div className="bf-wifi-state-ico">
                  <svg viewBox="0 0 48 48" width="46" height="46" fill="none"
                       stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    {/* Símbolo USB (tridente) */}
                    <line x1="24" y1="40" x2="24" y2="9" />
                    <path d="M20 13 L24 7 L28 13" />
                    <circle cx="24" cy="41" r="2.1" fill="currentColor" stroke="none" />
                    <path d="M24 23 L31.5 18.5" />
                    <circle cx="33" cy="17.5" r="2.4" />
                    <path d="M24 29 L16.5 24.5" />
                    <rect x="12.5" y="21.5" width="5.2" height="5.2" rx="0.6" fill="currentColor" stroke="none" />
                  </svg>
                </div>
                <p className="bf-wifi-state-txt">{t('sys.wifi.state4')}</p>
              </div>
            </div>
          </div>

          {/* Conexão card — Studio */}
          <div className="bf-card">
            <div className="bf-card-head">
              <h3>{t('sys.wifi.title')}</h3>
              <span className="meta">{wifiConnected ? 'STA · ONLINE' : 'AP · OFFLINE'}</span>
            </div>
            <div className={'bfg-wifi-status' + (wifiConnected ? ' is-on' : '')}>
              <div className="bfg-wifi-status-ico">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 8.5 Q12 0 22 8.5"/>
                  <path d="M5 13 Q12 6 19 13"/>
                  <path d="M8.5 17.5 Q12 14 15.5 17.5"/>
                  <circle cx="12" cy="21" r="1.2" fill="currentColor"/>
                </svg>
              </div>
              <div className="bfg-wifi-status-text">
                <span className="bfg-wifi-status-ssid">
                  {wifiConnected ? (wifiStatus.sta_ssid || wifiSsid) : t('sys.wifi.onlyAp')}
                </span>
                <span className="bfg-wifi-status-sub">
                  {wifiConnected
                    ? `STA · ${wifiStatus.sta_ip || '—'}`
                    : ((wifiStatus && wifiStatus.ap_ip) || '192.168.4.1')}
                </span>
              </div>
            </div>

            <div className="bfg-select-box" style={{ marginTop: 12 }}>
              <span className="bfg-select-eyebrow">SSID</span>
              {wifiManualSsid ? (
                <input
                  className="bf-input bfg-select-lg"
                  type="text"
                  value={wifiSsid}
                  maxLength={32}
                  onChange={(e) => setWifiSsid(e.target.value)}
                  placeholder={t('sys.wifi.manualSsidPlaceholder')}
                  aria-label="SSID"
                />
              ) : (
                <>
                  <BfSelect
                    className="bf-input bf-select bfg-select-lg"
                    value={wifiSsid}
                    onChange={(e) => {
                      if (e.target.value === '__manual__') {
                        setWifiManualSsid(true);
                        setWifiSsid('');
                        return;
                      }
                      setWifiSsid(e.target.value);
                    }}
                    aria-label={t('sys.wifi.selectSsidAria')}
                  >
                    {wifiSsid && !wifiNetworks.some((n) => n.ssid === wifiSsid) && (
                      <option value={wifiSsid}>{wifiSsid}</option>
                    )}
                    <option value="">{t('sys.wifi.selectNetwork')}</option>
                    {wifiNetworks.map((n) => (
                      <option key={`${n.ssid}-${n.rssi}`} value={n.ssid}>
                        {n.ssid} · {n.rssi} dBm {n.secure ? t('sys.wifi.lock') : t('sys.wifi.open')}
                      </option>
                    ))}
                    <option value="__manual__">{t('sys.wifi.manualSsidOption')}</option>
                  </BfSelect>
                  <span className="bf-select-chev bfg-select-chev">▾</span>
                </>
              )}
              {wifiManualSsid && (
                <button
                  type="button"
                  className="bfg-btn-outline"
                  style={{ marginTop: 6 }}
                  onClick={() => { setWifiManualSsid(false); setWifiSsid(''); }}
                >{t('sys.wifi.manualSsidBack')}</button>
              )}
            </div>

            <div className="bfg-select-box" style={{ marginTop: 8 }}>
              <span className="bfg-select-eyebrow">{t('sys.wifi.password').toUpperCase()}</span>
              <input
                className="bf-input bfg-select-lg"
                type="password"
                value={wifiPassword}
                onChange={(e) => setWifiPassword(e.target.value)}
                placeholder={wifiConnected ? t('sys.wifi.saved') : t('sys.wifi.pwPlaceholder')}
              />
            </div>

            <div className="bfg-wifi-actions">
              <button
                type="button"
                className="bfg-btn"
                onClick={onWifiScan}
                disabled={wifiState === 'scanning' || !scanAllowed}
                title={scanAllowed ? undefined : t('sys.wifi.scanWarn')}
              >
                {wifiState === 'scanning' ? '…' : t('sys.wifi.scan')}
              </button>
              <button
                type="button"
                className="bfg-btn bfg-btn-primary"
                onClick={onWifiConnect}
                disabled={!wifiSsid || wifiState === 'connecting' || wifiState === 'scanning'}
              >
                {wifiState === 'connecting' ? '…' : wifiState === 'connected' ? 'OK' : t('sys.wifi.connect')}
              </button>
            </div>
            {!scanAllowed && (
              <div className="bfg-wifi-warn">{t('sys.wifi.scanWarn')}</div>
            )}
            <p className="bf-hint">{t('sys.wifi.hint24ghz')}</p>
          </div>

          {/* Redes próximas card — Studio */}
          <div className="bf-card">
            <div className="bf-card-head">
              <h3>{t('sys.wifi.nearby')}</h3>
              <span className="meta">{wifiNetworks.length} {wifiNetworks.length === 1 ? 'ENCONTRADA' : 'ENCONTRADAS'}</span>
            </div>
            <div className="bfg-wifi-list">
              {wifiNetworks.length === 0 && (
                <div className="bfg-wifi-empty">{t('sys.wifi.noNetworks')}</div>
              )}
              {wifiNetworks.map((n, i) => {
                const current = n.ssid === (wifiStatus && wifiStatus.sta_ssid) && wifiConnected;
                const bars = n.rssi > -55 ? 4 : n.rssi > -65 ? 3 : n.rssi > -75 ? 2 : 1;
                return (
                  <button
                    key={`${n.ssid}-${i}`}
                    type="button"
                    className={'bfg-wifi-row' + (current ? ' is-current' : '')}
                    onClick={() => setWifiSsid(n.ssid)}
                  >
                    <span className={'bfg-wifi-bars bars-' + bars + (current ? ' is-current' : '')}>
                      {[1, 2, 3, 4].map((idx) => (
                        <span key={idx} className={'bfg-wifi-bar' + (idx <= bars ? ' is-on' : '')} />
                      ))}
                    </span>
                    <span className="bfg-wifi-ssid">
                      {n.ssid}
                      {current && <span className="bfg-wifi-current">· {t('sys.wifi.current')}</span>}
                    </span>
                    <span className="bfg-wifi-rssi">{n.rssi}<span className="bfg-wifi-rssi-u">dBm</span></span>
                    {n.secure && (
                      <svg className="bfg-wifi-lock" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5" y="11" width="14" height="10" rx="1.5"/>
                        <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {section === 'usbhost' && (() => {
        const s = usbHostStatus || {};
        // O MCU USB-host (e portanto Modo/Filtro/Keyboard BLE/MIDI BFMiDi) só
        // existe nos boards BFMIDI-3; nos BFMIDI-1/2 esses cards somem.
        const isBfmidi3 = (model || '').includes('BFMIDI-3');
        const online = !!s.online;
        const protocolOk = !!s.protocol_ok;
        // Mode: 0=TONEX ONE, 1=USB HOST (default). (BLE eh toggle independente.)
        const mode = Number(s.mode ?? 1);
        const pendingMode = Number(s.pending_mode ?? -1);
        const bleEnabled = !!s.ble_enabled;
        const bleConnected = !!s.ble_connected;
        const pendingBle = Number(s.pending_ble ?? -1);
        // Perfil do BLE: 0 = teclado HID (histórico), 1 = BLE-MIDI padrão
        // (apps/DAWs conectam no host), 2 = PEDAL (central: o host escaneia
        // e conecta num pedal Bluetooth MIDI que esteja anunciando).
        const bleMode = Number(s.ble_mode ?? 0);
        const pendingBleMode = Number(s.pending_ble_mode ?? -1);
        const bleModeLabels = [t('sys.usb.bleModeKeyboard'), t('sys.usb.bleModeMidi'), t('sys.usb.bleModePedal')];
        const bleModeHints = [t('sys.usb.bleModeKeyboardHint'), t('sys.usb.bleModeMidiHint'), t('sys.usb.bleModePedalHint')];
        const bleWaitingLabel = bleMode === 2 ? t('sys.usb.bleScanning') : t('sys.usb.keyboardAdvertising');
        const filterCh = Number(s.midi_filter_channel ?? 0);
        const pendingFilter = Number(s.pending_filter ?? -1);
        const ageS = s.last_seen_ms ? Math.round(s.last_seen_ms / 1000) : null;
        const rows = [
          { l: t('sys.usb.manufacturer'), v: s.manufacturer || '—' },
          { l: t('sys.usb.product'),      v: s.product || '—' },
          // wrap: o status carrega o diagnóstico do BT pedal — não pode
          // morrer num "…" (única janela de debug do host).
          { l: t('sys.usb.status'),       v: s.status_text || '—', wrap: true },
        ];
        if (ageS !== null) rows.push({ l: t('sys.usb.lastFrame'), v: t('sys.usb.ago', { age: ageS }) });
        return (
          <>
            <div className="bf-card">
              <div className="bf-card-head">
                <h3>USB Host</h3>
                <span className={'meta ' + (online ? 'is-ok' : 'is-off')}>
                  {online ? 'ONLINE' : protocolOk ? 'OFFLINE' : t('sys.usb.waiting').toUpperCase()}
                </span>
              </div>
              <div className="bfg-usbh-rows">
                {rows.map((r) => (
                  <div key={r.l} className="bfg-usbh-row">
                    <span className="bfg-usbh-l">{r.l}</span>
                    <span className={'bfg-usbh-v' + (r.wrap ? ' is-wrap' : '')}>{r.v}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="bfg-btn"
                style={{ width: '100%', marginTop: 12 }}
                onClick={onUsbHostRefresh}
                disabled={usbHostBusy}
              >{t('sys.usb.refresh')}</button>
            </div>

            {isBfmidi3 && (<>
            <div className="bf-card">
              <div className="bf-card-head">
                <h3>{t('sys.usb.modeTitle')}</h3>
                <span className="meta">{(s.mode_label || (mode === 0 ? 'TONEX ONE' : 'USB HOST')).toUpperCase()}</span>
              </div>
              <div className="bf-seg">
                <button
                  className={mode === 0 ? 'is-active' : ''}
                  disabled={usbHostBusy || pendingMode !== -1}
                  onClick={() => onUsbHostSetMode && onUsbHostSetMode(0)}
                  title={t('sys.usb.tonexTitle')}
                >TONEX ONE</button>
                <button
                  className={mode === 1 ? 'is-active' : ''}
                  disabled={usbHostBusy || pendingMode !== -1}
                  onClick={() => onUsbHostSetMode && onUsbHostSetMode(1)}
                  title={t('sys.usb.hostGenericTitle')}
                >USB HOST</button>
              </div>
              {pendingMode !== -1 && (
                <p className="bf-hint">{t('sys.usb.switching')}
                  {' '}<b>{pendingMode === 0 ? 'TONEX ONE' : 'USB HOST'}</b>…
                </p>
              )}
              <button
                type="button"
                className="bfg-btn-outline bfg-btn-host-update"
                style={{ width: '100%', marginTop: 10 }}
                onClick={onUsbHostEnterUpdate}
                disabled={usbHostBusy || !online}
                title={t('sys.usb.updateModeTitle')}
              >
                {/* Chip MCU recebendo firmware (seta entrando) = modo de atualização */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2v5.5 M9.4 5.1 12 7.7l2.6-2.6"/>
                  <rect x="7" y="10.5" width="10" height="10" rx="2"/>
                  <rect x="10.4" y="13.9" width="3.2" height="3.2" rx="0.6"/>
                  <path d="M4.2 13.5H7 M4.2 17.5H7 M17 13.5h2.8 M17 17.5h2.8"/>
                </svg>
                <span>{t('sys.usb.updateMode')}</span>
              </button>
            </div>

            <div className="bf-card">
              <div className="bf-card-head">
                <h3>{t('sys.usb.filterTitle')}</h3>
                <span className="meta">{filterCh === 0 ? 'OMNI' : `CH ${filterCh}`}</span>
              </div>
              <div className="bfg-select-box">
                <span className="bfg-select-eyebrow">{t('sys.usb.filterLabel').toUpperCase()}</span>
                <BfSelect
                  className="bf-input bf-select bfg-select-lg"
                  value={filterCh}
                  disabled={usbHostBusy || pendingFilter !== -1}
                  onChange={(e) => onUsbHostSetFilter && onUsbHostSetFilter(Number(e.target.value))}
                  aria-label={t('sys.usb.filterLabel')}
                >
                  <option value={0}>{t('sys.usb.omniAll')}</option>
                  {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{t('sys.usb.channel', { n })}</option>
                  ))}
                </BfSelect>
                <span className="bf-select-chev bfg-select-chev">▾</span>
              </div>
              {pendingFilter !== -1 && (
                <p className="bf-hint">{t('sys.usb.applyingFilter')}
                  {' '}<b>{pendingFilter === 0 ? 'OMNI' : `CH ${pendingFilter}`}</b>…
                </p>
              )}
              <p className="bf-hint">{t('sys.usb.filterHint')}</p>
            </div>

            <div className="bf-card">
              <div className="bf-card-head">
                <h3>{t('sys.usb.bleTitle')}</h3>
                <span className={'meta ' + (bleConnected ? 'is-ok' : bleEnabled ? '' : 'is-off')}>
                  {bleConnected ? t('sys.usb.keyboardConnected') : bleEnabled ? bleWaitingLabel : t('sys.usb.keyboardOff')}
                </span>
              </div>
              <div className="bf-seg">
                <button
                  className={!bleEnabled ? 'is-active' : ''}
                  disabled={usbHostBusy || pendingBle !== -1 || !online}
                  onClick={() => onUsbHostToggleBle && onUsbHostToggleBle(false)}
                >{t('sys.usb.keyboardDisable')}</button>
                <button
                  className={bleEnabled ? 'is-active' : ''}
                  disabled={usbHostBusy || pendingBle !== -1 || !online}
                  onClick={() => onUsbHostToggleBle && onUsbHostToggleBle(true)}
                >{t('sys.usb.keyboardEnable')}</button>
              </div>
              {pendingBle !== -1 && (
                <p className="bf-hint">{t('sys.usb.keyboardApplying')}
                  {' '}<b>{pendingBle === 1 ? t('sys.usb.keyboardEnable') : t('sys.usb.keyboardDisable')}</b>…
                </p>
              )}
              {/* Perfil do BLE: TECLADO (HID, CC → tecla), MIDI (periférico —
                  apps/DAWs conectam no host "BFMiDi") ou PEDAL (central — o
                  host escaneia e conecta num pedal BLE-MIDI anunciando). */}
              <p className="bf-hint" style={{ marginTop: 10, marginBottom: 4 }}>
                {t('sys.usb.bleModeLabel')}
              </p>
              <div className="bf-seg">
                {[0, 1, 2].map((m) => (
                  <button
                    key={m}
                    className={bleMode === m ? 'is-active' : ''}
                    disabled={usbHostBusy || pendingBleMode !== -1 || !online}
                    onClick={() => onUsbHostSetBleMode && onUsbHostSetBleMode(m)}
                    title={bleModeHints[m]}
                  >{bleModeLabels[m]}</button>
                ))}
              </div>
              {pendingBleMode !== -1 && (
                <p className="bf-hint">{t('sys.usb.keyboardApplying')}
                  {' '}<b>{bleModeLabels[pendingBleMode] || '?'}</b>…
                </p>
              )}
              <p className="bf-hint">{bleModeHints[bleMode] || bleModeHints[0]}</p>
            </div>

            {/* MIDI BFMiDi (host -> controladora). Config GLOBAL (salva no botão
                global, não nos endpoints do USB host). reverso = re-emite o MIDI
                do host nas saídas; control = navega a BFMIDI. Ver
                USB_HOST_BRIDGE.h / globalHostReverseMidi/CtrlEnabled/CtrlChannel. */}
            <div className="bf-card">
              <div className="bf-card-head">
                <h3>{t('sys.usb.bfmidiTitle')}</h3>
              </div>
              <div className="bf-auto-row">
                <div className="bfg-toggle-text">
                  <span className="label">{t('sys.usb.reverseLabel')}</span>
                  <span className="bfg-toggle-sub">{t('sys.usb.reverseHint')}</span>
                </div>
                <button
                  className={'bf-switch is-accent' + (hostReverseMidi ? ' is-on' : '')}
                  onClick={() => setHostReverseMidi(!hostReverseMidi)}
                  aria-pressed={hostReverseMidi}
                  aria-label={t('sys.usb.reverseLabel')}
                />
              </div>
              <div className="bf-auto-row">
                <div className="bfg-toggle-text">
                  <span className="label">{t('sys.usb.ctrlLabel')}</span>
                  <span className="bfg-toggle-sub">{t('sys.usb.ctrlHint')}</span>
                </div>
                <button
                  className={'bf-switch is-accent' + (hostCtrlEnabled ? ' is-on' : '')}
                  onClick={() => setHostCtrlEnabled(!hostCtrlEnabled)}
                  aria-pressed={hostCtrlEnabled}
                  aria-label={t('sys.usb.ctrlLabel')}
                />
              </div>
              {/* SEM seletor de canal aqui: o filtro de canal e UM SO — o
                  card "Filtro MIDI" acima (SET_MIDI_FILTER no MCU host),
                  que ja vale pros 2 sentidos. O antigo host_ctrl_channel
                  (filtro de entrada na controladora) foi removido. */}
              {(hostReverseMidi || hostCtrlEnabled) && (
                <p className="bf-hint">{t('sys.usb.bfmidiFilterNote')}</p>
              )}
              {hostCtrlEnabled && (
                <p className="bf-hint">{t('sys.usb.ctrlMap')}</p>
              )}
            </div>
            </>)}
          </>
        );
      })()}

      {section === 'backup' && (
        <div className="bf-stack-centered">
          <BackupRestoreCard
            getGlobalConfigForBackup={getGlobalConfigForBackup}
            onRestored={onBackupRestored}
          />
          <SinglePresetCard />
          <EraseDataCard onErased={onErased} />
          <StorageCard />
        </div>
      )}

    </div>
  );
}

// ─── Tab bar ────────────────────────────────────────────────────────
function TabBar({ page, setPage, saveState, onSave, autoSaveEnabled,
                  onCopyPreset, onPastePreset, presetClipboard,
                  presetClipboardStatus,
                  onCopyBank, onPasteBank, bankClipboard,
                  bankClipboardStatus,
                  onCopyLayer, onPasteLayer, layerClipboard,
                  layerClipboardStatus, editorLayer }) {
  const { t } = useBfI18n();
  const tabs = [
    { id: 'preset_config', label: 'PRESET' },
    { id: 'global_config', label: 'GLOBAL' },
    { id: 'system_config', label: t('sys.title') },
  ];
  const saveLabel =
    saveState === 'saving' ? '…' :
    saveState === 'saved'  ? '✓' :
    saveState === 'error'  ? '!' : autoSaveEnabled ? 'AUTO' : 'SAVE';
  const [menuOpen, setMenuOpen] = React.useState(false);
  React.useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (e.target.closest('.bf-tabbar-plus-wrap')) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);
  return (
    <div className="bf-tabbar">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={'bf-tab ' + t.id + (page === t.id ? ' is-active' : '')}
          onClick={() => setPage(t.id)}
        >{t.label}</button>
      ))}
      {/* Botao "+" abre menu com COPY PRESET / PASTE PRESET. So
          aparece quando esta na pagina PRESET (acoes nao fazem sentido
          em GLOBAL/SYSTEM). */}
      {page === 'preset_config' && (
        <div className="bf-tabbar-plus-wrap">
          <button
            type="button"
            className={'bf-tabbar-plus' +
                       (menuOpen ? ' is-open' : '') +
                       ((presetClipboardStatus === 'copied' || presetClipboardStatus === 'pasted' ||
                         bankClipboardStatus === 'copied' || bankClipboardStatus === 'pasted' ||
                         layerClipboardStatus === 'copied' || layerClipboardStatus === 'pasted')
                         ? ' is-flash-ok' : '') +
                       ((presetClipboardStatus === 'pasting' || bankClipboardStatus === 'pasting' ||
                         bankClipboardStatus === 'copying' || layerClipboardStatus === 'pasting')
                         ? ' is-busy' : '') +
                       ((presetClipboardStatus === 'error' || bankClipboardStatus === 'error' ||
                         layerClipboardStatus === 'error')
                         ? ' is-flash-err' : '')}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t('tabbar.presetActionsAria')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={t('tabbar.presetActionsTitle')}
          >
            <svg viewBox="0 0 24 24" width="18" height="18"
                 fill="none" stroke="currentColor" strokeWidth="2.6"
                 strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14 M5 12h14" />
            </svg>
          </button>
          {menuOpen && (
            <div className="bf-tabbar-plus-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="bf-tabbar-plus-item"
                onClick={() => { setMenuOpen(false); onCopyPreset && onCopyPreset(); }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16"
                     fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="8" y="8" width="11" height="13" rx="2" />
                  <path d="M16 8V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h1" />
                </svg>
                <span>{t('tabbar.copyPreset')}</span>
              </button>
              {presetClipboard && (
                <button
                  type="button"
                  role="menuitem"
                  className="bf-tabbar-plus-item"
                  onClick={() => { setMenuOpen(false); onPastePreset && onPastePreset(); }}
                  title={`Cola o preset copiado (${presetClipboard.srcTag})`}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16"
                       fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" />
                    <path d="M12 11v6 M9 14l3 3 3-3" />
                  </svg>
                  <span>{t('tabbar.pastePreset')} <em>({presetClipboard.srcTag})</em></span>
                </button>
              )}
              <div className="bf-tabbar-plus-sep" />
              {/* COPY/PASTE LAYER — afeta SOMENTE o layer ATIVO no editor
                  (editorLayer). Util pra duplicar funcoes do L1 no L2 ou
                  vice-versa dentro do mesmo preset, ou copiar um layer
                  inteiro pra outro preset. */}
              <button
                type="button"
                role="menuitem"
                className="bf-tabbar-plus-item"
                onClick={() => { setMenuOpen(false); onCopyLayer && onCopyLayer(); }}
                title={`Copia o LAYER ${editorLayer || 1} do preset atual (modos + params + display dos 6 SWs)`}
              >
                <svg viewBox="0 0 24 24" width="16" height="16"
                     fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {/* 2 retangulos sobrepostos = camada/layer */}
                  <rect x="5" y="9" width="11" height="11" rx="2" />
                  <path d="M9 5h9a1 1 0 0 1 1 1v9" />
                </svg>
                <span>{t('tabbar.copyLayer')} <em>(L{editorLayer || 1})</em></span>
              </button>
              {layerClipboard && (
                <button
                  type="button"
                  role="menuitem"
                  className="bf-tabbar-plus-item"
                  onClick={() => { setMenuOpen(false); onPasteLayer && onPasteLayer(); }}
                  title={`Cola o layer copiado (${layerClipboard.srcTag} L${layerClipboard.srcLayer}) no LAYER ${editorLayer || 1} do preset atual`}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16"
                       fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="5" y="9" width="11" height="11" rx="2" />
                    <path d="M9 5h9a1 1 0 0 1 1 1v9" />
                    <path d="M10 14v4 M8 16l2 2 2-2" />
                  </svg>
                  <span>{t('tabbar.pasteLayer')} <em>({layerClipboard.srcTag} L{layerClipboard.srcLayer} → L{editorLayer || 1})</em></span>
                </button>
              )}
              <div className="bf-tabbar-plus-sep" />
              <button
                type="button"
                role="menuitem"
                className="bf-tabbar-plus-item"
                onClick={() => { setMenuOpen(false); onCopyBank && onCopyBank(); }}
                disabled={bankClipboardStatus === 'copying'}
                title={t('tabbar.copyBankTitle')}
              >
                <svg viewBox="0 0 24 24" width="16" height="16"
                     fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {/* Pilha de 3 retangulos = banco com varios presets */}
                  <rect x="3" y="3" width="14" height="14" rx="2" />
                  <path d="M7 7h14v14H7z" />
                </svg>
                <span>{t('tabbar.copyBank')} {bankClipboardStatus === 'copying' ? '…' : ''}</span>
              </button>
              {bankClipboard && (
                <button
                  type="button"
                  role="menuitem"
                  className="bf-tabbar-plus-item"
                  onClick={() => { setMenuOpen(false); onPasteBank && onPasteBank(); }}
                  disabled={bankClipboardStatus === 'pasting'}
                  title={`Cola os 6 presets do banco ${bankClipboard.srcLetter} no banco atual`}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16"
                       fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="3" width="14" height="14" rx="2" />
                    <path d="M7 7h14v14H7z" />
                    <path d="M14 11v6 M11 14l3 3 3-3" />
                  </svg>
                  <span>{t('tabbar.pasteBank')} <em>({bankClipboard.srcLetter}{bankClipboardStatus === 'pasting' ? '…' : ''})</em></span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <button
        className={'bf-save is-' + (saveState || 'idle')}
        onClick={onSave}
        title={
          saveState === 'dirty'  ? 'Mudancas nao salvas — clique pra salvar'
          : saveState === 'saving' ? 'Salvando...'
          : saveState === 'saved'  ? 'Tudo salvo'
          : saveState === 'error'  ? 'Erro ao salvar'
          : autoSaveEnabled ? 'Salvamento automatico ativo' : 'Salvar'
        }
      >{saveLabel}</button>
    </div>
  );
}

// ─── Tela de conexao (gate inicial) ─────────────────────────────────
// Quando o webApp roda hospedado standalone, comeca sem device API
// definido. Esta tela pergunta qual IP usar (AP do pedal, STA via mDNS,
// ou manual) e/ou oferece USB Web Serial. Apos sucesso, esconde e o
// editor segue normal.
function ConnectionScreen({ onWifiConnect, onUsbToggle, usbState, error,
                            attempting }) {
  const { t } = useBfI18n();
  const [ip, setIp] = useState(localStorage.getItem('bfmidi_lastManualIp') || '');
  const usbSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

  const submitManual = (e) => {
    if (e) e.preventDefault();
    if (!ip.trim()) return;
    const clean = ip.trim().replace(/^https?:\/\//, '');
    localStorage.setItem('bfmidi_lastManualIp', clean);
    onWifiConnect('https://' + clean);
  };

  return (
    <div className="phone-frame">
      <div className="bf-screen">
        <div className="bf-conn-shell">
          <div className="bf-conn-logo">
            <img src="icons/app-192.png" alt="BFMIDI" width="80" height="80" />
            <h1>BFMIDI</h1>
            <p>{t('conn.subtitle')}</p>
          </div>

          <div className="bf-conn-section">
            <div className="bf-conn-section-title">{t('conn.viaWifi')}</div>
            <button
              type="button"
              className="bf-conn-option"
              disabled={attempting}
              onClick={() => onWifiConnect('http://192.168.4.1')}
            >
              <span className="bf-conn-option-title">{t('conn.apTitle')}</span>
              <span className="bf-conn-option-sub">BFMIDI_WIFI · 192.168.4.1</span>
            </button>
            <button
              type="button"
              className="bf-conn-option"
              disabled={attempting}
              onClick={() => onWifiConnect('http://bfmidi.local')}
            >
              <span className="bf-conn-option-title">{t('conn.staTitle')}</span>
              <span className="bf-conn-option-sub">{t('conn.staSub')}</span>
            </button>

            <form className="bf-conn-manual" onSubmit={submitManual}>
              <input
                type="text"
                className="bf-input"
                placeholder={t('conn.ipPlaceholder')}
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                disabled={attempting}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <button
                type="submit"
                className="bf-conn-go"
                disabled={attempting || !ip.trim()}
              >
                {attempting ? '…' : t('conn.connect')}
              </button>
            </form>
          </div>

          {usbSupported && (
            <div className="bf-conn-section">
              <div className="bf-conn-section-title">{t('conn.viaUsb')}</div>
              <button
                type="button"
                className="bf-conn-option"
                disabled={attempting || usbState === 'connecting'}
                onClick={onUsbToggle}
              >
                <span className="bf-conn-option-title">
                  {usbState === 'connecting' ? t('conn.usbConnecting')
                    : usbState === 'connected' ? t('conn.usbConnected')
                    : t('conn.usbConnect')}
                </span>
                <span className="bf-conn-option-sub">
                  {t('conn.usbSub')}
                </span>
              </button>
            </div>
          )}

          {error && <div className="bf-conn-error">{error}</div>}

          <div className="bf-conn-foot">
            BFMIDI Project Zero
          </div>
        </div>
      </div>
    </div>
  );
}

// Modal de progresso pra PASTE PRESET / PASTE BANK. Bloqueante (sem
// click-to-close no backdrop) — fecha sozinho quando o paste termina.
// Reusa a barra .bf-backup-progress* (mesmo visual do backup/restore).
function PasteProgressModal({ progress }) {
  const { t } = useBfI18n();
  if (!progress) return null;
  const pct = progress.total > 0
    ? Math.min(100, Math.round((progress.step / progress.total) * 100))
    : null;
  const title = progress.kind === 'bank'
    ? t('paste.bank')
    : progress.kind === 'layer'
      ? t('paste.layer')
      : t('paste.preset');
  return ReactDOM.createPortal(
    <div className="bf-modal-backdrop bf-modal-backdrop-strong">
      <div className="bf-modal" role="dialog" aria-label={title}
           onClick={(e) => e.stopPropagation()}>
        <div className="bf-modal-head">
          <span className="bf-modal-title">{title}</span>
        </div>
        <div style={{ padding: '16px 18px 18px' }}>
          <div className="bf-backup-progress" style={{ marginTop: 0 }}>
            <div className="bf-backup-progress-track">
              <div
                className={'bf-backup-progress-fill' +
                           (pct == null ? ' is-indeterminate' : '')}
                style={pct != null ? { width: pct + '%' } : undefined}
              />
            </div>
            <div className="bf-backup-progress-info">
              <span>{progress.label || '…'}</span>
              <span className="bf-backup-progress-bytes">
                {pct != null
                  ? `${progress.step}/${progress.total}`
                  : '…'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Bail-out pros setters de array do poll: o /bank/current chega como
// Array.from NOVO a cada tick de 1.5s — sem comparar item-a-item, a ref
// nova re-renderizava o App INTEIRO (nenhum memo na arvore) em idle.
// Mesmo guard que o swSpinState ja usava; uso: setX((cur) => sameArr6(cur, novo) ? cur : novo).
const sameArr6 = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  for (let i = 0; i < 6; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

// ─── Root ───────────────────────────────────────────────────────────
function App() {
  // i18n no escopo do App — usado pelo popup de resultado do Wi-Fi (modal
  // renderizado aqui no nível raiz). Os demais textos vêm dos componentes filhos.
  const { t } = useBfI18n();
  const [page, setPage] = useState('preset_config');
  const [demoOpen, setDemoOpen] = useState(false);
  // Pedido de seção do SYSTEM vindo de fora (ex.: clicar no ícone de WiFi do
  // header abre SYSTEM > WIFI). PageSystemConfig aplica via efeito e limpa.
  const [sysSectionReq, setSysSectionReq] = useState(null);
  const openWifiSettings = () => { setPage('system_config'); setSysSectionReq('wifi'); };
  const [saveState, setSaveState] = useState('idle');
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => {
    try { return localStorage.getItem(AUTO_SAVE_STORAGE_KEY) === '1'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(AUTO_SAVE_STORAGE_KEY, autoSaveEnabled ? '1' : '0'); }
    catch {}
  }, [autoSaveEnabled]);
  const [deviceState, setDeviceState] = useState(DEMO_MODE ? 'online' : 'offline');
  // USB transport (Web Serial API). Estados:
  //   'unsupported' (browser nao tem navigator.serial),
  //   'disconnected', 'connecting', 'connected', 'error'.
  const [usbState, setUsbState] = useState(
    typeof navigator !== 'undefined' && 'serial' in navigator
      ? 'disconnected'
      : 'unsupported'
  );
  const usbPortRef = useRef(null);
  const usbReaderRef = useRef(null);
  const usbWriterRef = useRef(null);
  const usbReadBufRef = useRef('');
  // Fila simples de "esperando resposta": resolve a primeira promise quando
  // uma linha '<' chega. Permite request/response request-style sobre stream.
  const usbPendingRef = useRef([]);
  // Mutex de envio: encadeia os comandos USB pra que SO UM esteja em voo por
  // vez na linha serial compartilhada. Sem isso, polls de fundo (bank/live,
  // EXP, USB host) intercalavam comandos durante transferencias grandes
  // (restore/upload por USB) e desalinhavam a fila FIFO de respostas — que
  // casa por ORDEM, sem id de correlacao —, corrompendo imagens e presets.
  // Por WiFi nao acontece (cada request e uma conexao HTTP separada).
  const usbSendChainRef = useRef(Promise.resolve());

  // ── Modo de conexao WiFi (AP vs STA) ─────────────────────────────────
  // Toggle no header alterna entre 2 hosts fixos. Cada modo aponta o
  // DEVICE_API aponta somente para o modo selecionado pelo usuario.
  //   AP  -> http://192.168.4.1   (conectado direto no AP do pedal)
  //   STA -> http://bfmidi.local  (mesmo WiFi de casa via mDNS)
  // Quando o webApp roda hospedado dentro do ESP32 (same-origin), esses
  // hosts ficam ignorados — DEVICE_API fica '' e as chamadas viram relativas.
  const AP_HOST = 'http://192.168.4.1';
  const STA_HOST = 'http://bfmidi.local';
  const [connectionMode, setConnectionMode] = useState(() => {
    const explicitApi = normalizeApiBase(URL_API);
    if (explicitApi) return explicitApi === AP_HOST ? 'AP' : 'STA';
    // Quando o PWA roda no proprio device, a ORIGEM da pagina ja diz o modo:
    //   192.168.4.1 => AP   |   bfmidi.local => STA
    // Sem isso o default 'STA' apontava DEVICE_API pra bfmidi.local mesmo
    // abrindo em 192.168.4.1 (modo AP) — e bfmidi.local NAO resolve no AP
    // (mDNS so sobe com a STA conectada), entao toda request travava ate o
    // timeout (12s) na fila serial ate o pingHttp corrigir o modo. Resultado:
    // ~30s por acao no editor em modo AP. A origem resolve isso na hora.
    if (typeof location !== 'undefined') {
      if (location.hostname === '192.168.4.1') return 'AP';
      if (location.hostname === 'bfmidi.local') return 'STA';
    }
    // Preview local com ?api=http://192.168.4.1 tambem e AP. Sem inferir
    // pelo override explicito, o effect abaixo pode trocar temporariamente
    // o destino para bfmidi.local conforme a ultima escolha persistida.
    // Preview local sem ?api= usa STA por padrao.
    return 'STA';
  });
  const toggleConnectionMode = useCallback(() => {
    setConnectionMode((m) => (m === 'AP' ? 'STA' : 'AP'));
  }, []);
  // Em STA, preserva ?api=<ip> do launcher ou usa same-origin no device.
  const explicitApi = normalizeApiBase(URL_API);
  const staHost = explicitApi && explicitApi !== AP_HOST
    ? explicitApi
    : (typeof location !== 'undefined' &&
       !isLocalPreviewHost(location.hostname) &&
       location.hostname !== '192.168.4.1'
        ? location.origin
        : STA_HOST);
  // O toggle manual troca o host sem executar deteccao cruzada.
  useEffect(() => {
    const host = connectionMode === 'STA' ? staHost : AP_HOST;
    setDeviceApi(host);
    try { localStorage.setItem('bfmidi_connectionMode', connectionMode); } catch {}
  }, [connectionMode, staHost]);

  // true enquanto um disconnect MANUAL esta em andamento — distingue, no
  // encerramento do reader, "usuario togglou" de "cabo caiu".
  const usbClosingRef = useRef(false);
  const usbDisconnect = useCallback(async () => {
    usbClosingRef.current = true;
    try {
      if (usbReaderRef.current) {
        await usbReaderRef.current.cancel().catch(() => {});
        try { usbReaderRef.current.releaseLock(); } catch {}
      }
    } catch {}
    try {
      if (usbWriterRef.current) {
        try { usbWriterRef.current.releaseLock(); } catch {}
      }
    } catch {}
    try {
      if (usbPortRef.current) await usbPortRef.current.close();
    } catch {}
    usbReaderRef.current = null;
    usbWriterRef.current = null;
    usbPortRef.current = null;
    usbReadBufRef.current = '';
    usbPendingRef.current.forEach((p) => p.reject(new Error('disconnected')));
    usbPendingRef.current = [];
    setUsbState('disconnected');
    usbClosingRef.current = false;
  }, []);

  const usbStartReader = useCallback(async () => {
    const port = usbPortRef.current;
    if (!port) return;
    try {
      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable).catch(() => {});
      const reader = decoder.readable.getReader();
      usbReaderRef.current = reader;
      // Watchdog do buffer: se acumulou >USB_RX_MAX sem \n, descarta. Protege
      // contra burst de bytes nao-terminados do firmware (bug futuro / partial
      // send em reset) — sem isso, a string cresceria indefinidamente.
      // 256KB: a leitura de midia (/img/read, /icon/read) vem numa LINHA UNICA
      // e uma imagem de 50KB vira ~67KB em base64 — o teto antigo de 64KB
      // truncava e dava timeout. O /backup grande agora e paginado (chunks
      // ~1.6KB), entao quem precisa da folga aqui e so a midia single-line.
      const USB_RX_MAX = 256 * 1024;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        usbReadBufRef.current += value;
        if (usbReadBufRef.current.length > USB_RX_MAX) {
          // Guarda so a cauda — chance maior de conter a proxima linha valida.
          usbReadBufRef.current = usbReadBufRef.current.slice(-1024);
        }
        // Processa linhas completas
        let nl;
        while ((nl = usbReadBufRef.current.indexOf('\n')) >= 0) {
          const raw = usbReadBufRef.current.slice(0, nl).replace(/\r$/, '');
          usbReadBufRef.current = usbReadBufRef.current.slice(nl + 1);
          // Responses comecam com '<'. Log lines do firmware nao tem prefixo.
          if (raw.startsWith('<')) {
            const body = raw.slice(1).replace(/^\s+/, '');
            const pending = usbPendingRef.current.shift();
            // Zumbi = comando que ja estourou timeout; a resposta atrasada
            // dele e absorvida aqui (descartada) pra fila nao desalinhar.
            if (pending && !pending.zombie) pending.resolve(body);
          }
        }
      }
    } catch (e) {
      // Reader morreu (stream com erro) — tratado abaixo, igual ao done.
    }
    // Reader encerrou. Se NAO foi um disconnect manual (toggle), foi o cabo
    // caindo/device resetando — derruba o transport pra apiCall nao seguir
    // roteando pra uma USB morta (cada chamada penava 15s de timeout).
    if (!usbClosingRef.current) usbDisconnect();
  }, [usbDisconnect]);

  const usbSendCommand = useCallback((line, timeoutMs = 15000) => {
    // Um comando = escrever a linha + esperar a resposta correspondente.
    const run = async () => {
      if (!usbWriterRef.current) throw new Error('no writer');
      const encoder = new TextEncoder();
      await usbWriterRef.current.write(encoder.encode('> ' + line + '\n'));
      return new Promise((resolve, reject) => {
        usbPendingRef.current.push({ resolve, reject });
        // Timeout amplo (15s) cobre operacoes longas (wifi connect ~12s).
        // Comandos rapidos respondem em ms — sem efeito pratico.
        setTimeout(() => {
          const idx = usbPendingRef.current.findIndex((p) => p.resolve === resolve);
          if (idx >= 0) {
            // NAO remove da fila: o protocolo nao tem id de correlacao, as
            // respostas casam por ORDEM. Se a resposta atrasada deste comando
            // ainda chegar, remover a entrada deslocaria a fila (cada comando
            // seguinte receberia a resposta do anterior, pra sempre). Marca
            // como zumbi: o reader absorve e descarta a resposta dele.
            usbPendingRef.current[idx].zombie = true;
            reject(new Error('timeout'));
          }
        }, timeoutMs);
      });
    };
    // Serializa: este comando so escreve depois que o anterior terminou
    // (resolveu OU rejeitou — por isso .then(run, run), pra a cadeia nunca
    // travar numa rejeicao). Garante 1 comando em voo => a fila FIFO de
    // respostas nunca desalinha, mesmo com polls concorrentes. Ver
    // usbSendChainRef.
    const result = usbSendChainRef.current.then(run, run);
    // A cadeia segue viva mesmo se este comando rejeitar.
    usbSendChainRef.current = result.catch(() => {});
    return result;
  }, []);

  const usbConnect = useCallback(async () => {
    if (!('serial' in navigator)) {
      setUsbState('unsupported');
      return;
    }
    setUsbState('connecting');
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      usbPortRef.current = port;
      usbWriterRef.current = port.writable.getWriter();
      // Dispara o reader em background
      usbStartReader();
      // Valida link com PING/PONG
      const pong = await usbSendCommand('PING');
      if (!pong.includes('PONG')) throw new Error('ping failed');
      setUsbState('connected');
    } catch (e) {
      if (e.name === 'NotFoundError') {
        setUsbState('disconnected');
      } else {
        setUsbState('error');
        await usbDisconnect();
      }
    }
  }, [usbStartReader, usbSendCommand, usbDisconnect]);

  const toggleUsb = useCallback(() => {
    if (DEMO_MODE) {
      setDemoOpen(true);
      return;
    }
    if (usbState === 'connected' || usbState === 'connecting') {
      usbDisconnect();
    } else {
      usbConnect();
    }
  }, [usbState, usbConnect, usbDisconnect]);

  // Desplugue fisico: o Chromium dispara 'disconnect' no navigator.serial
  // quando a porta some (cabo fora / device resetou). Sem isso (e sem o
  // fallback no fim do reader), usbState ficava 'connected' pra sempre e
  // todo apiCall morria em timeout de 15s numa USB morta.
  useEffect(() => {
    if (!('serial' in navigator)) return;
    const onSerialDisconnect = (e) => {
      if (usbPortRef.current && e.target === usbPortRef.current) {
        usbDisconnect();
      }
    };
    navigator.serial.addEventListener('disconnect', onSerialDisconnect);
    return () =>
      navigator.serial.removeEventListener('disconnect', onSerialDisconnect);
  }, [usbDisconnect]);

  // Registra/desregistra o transport USB sempre que muda o estado. Quando
  // connected, apiCall() rota chamadas dos endpoints suportados pra USB
  // em vez de HTTP via WiFi.
  useEffect(() => {
    if (usbState === 'connected') {
      _transport.usbSend = usbSendCommand;
      _transport.usbConnected = true;
    } else {
      _transport.usbSend = null;
      _transport.usbConnected = false;
    }
  }, [usbState, usbSendCommand]);
  // Handle registrado pelo PresetEditorCard para o botao SAVE global salvar
  // presets quando estamos na pagina BANK.
  const presetSaveRef = useRef({ save: null, status: 'idle', isDirty: false });
  const [presetSaveStatus, setPresetSaveStatus] = useState('idle');
  const [presetSaveRevision, setPresetSaveRevision] = useState(0);
  const registerPresetSave = useCallback((handle) => {
    presetSaveRef.current = handle || { save: null, status: 'idle', isDirty: false };
    setPresetSaveRevision((revision) => revision + 1);
    // Espelha o flag LAYER 2 da working copy do editor (icone "L2" do card
    // PRINCIPAL edita meta.layer2 antes do SAVE) — assim o switch LAYER 1/2
    // destrava/trava imediato. handle null (unmount/LIVE) NAO reseta: vale o
    // ultimo valor conhecido do preset ativo.
    if (handle && handle.meta) {
      setLayer2Enabled(!!handle.meta.layer2);
    }
    // 'dirty' e um estado *derivado* (idle + mudancas pendentes). O botao
    // SAVE no TabBar usa o estado pra colorir: idle/branco, dirty/vermelho,
    // saving/laranja, saved/verde, error/vermelho.
    if (!handle) {
      setPresetSaveStatus('idle');
    } else if (handle.status === 'idle' && handle.isDirty) {
      setPresetSaveStatus('dirty');
    } else {
      setPresetSaveStatus(handle.status);
    }
  }, []);

  const [model, setModel] = useState('BFMIDI-3 7S');
  // Chip do pedal ('s2'|'s3'), do campo "chip" do /config/global. Vazio ate a
  // primeira carga (ou firmware antigo sem o campo) => seletor mostra tudo.
  const [deviceChip, setDeviceChip] = useState('');
  const [brightness, setBrightness] = useState(72);
  const [bankLedColor, setBankLedColor] = useState(2);
  // liveLedColor = cor dos pixels PIXELSLIVE (LED do switch LIVE_MODE_PIN
  // — placas com foot+LED dedicado para o modo live). Mapeia direto
  // ao globalLiveLedColorIndex / key `live_led_color` no firmware.
  const [liveLedColor, setLiveLedColor] = useState(2);
  // LAYER 2: cor indicadora quando ativo (GLOBAL > LEDS, persiste na NVS).
  const [layer2LedColor, setLayer2LedColor] = useState(4);
  // layer2Enabled agora e POR PRESET (meta.layer2, icone "L2" no card
  // PRINCIPAL) — este estado espelha o flag do preset ATIVO/EDITADO:
  // alimentado pelo /bank/current (meta.layer2), pelos pastes que setam
  // currentSavedMeta e pelo handle do PresetEditorCard (working copy,
  // via registerPresetSave). NAO vem mais do /config/global.
  const [layer2Enabled, setLayer2Enabled] = useState(false);
  const [ledColorMode, setLedColorMode] = useState('letras');
  const [letterLedColors, setLetterLedColors] = useState(
      Array.from({ length: BANK_LETTER_COUNT }, () => 2));
  const [switchLedColors, setSwitchLedColors] = useState([2, 2, 2, 2, 2, 2]);
  // LED PREVIEW LIVE MODE: SW STOMP desligado mantem o pixel central aceso.
  // Padrao ON — sincronizado com /config/global no load.
  const [ledPreviewLive, setLedPreviewLive] = useState(true);
  // LED PREVIEW LIVE LEVEL: intensidade (0..100%) do pixel central aceso no
  // preview do SW desligado. 100% = cor cheia (default). Convertido p/ 0..255
  // do firmware no save/load.
  const [ledPreviewLiveLevel, setLedPreviewLiveLevel] = useState(100);
  // GIG VIEW: 'padrao' | 'preset' | 'live'. Mapeia 0/1/2 do firmware.
  // Padrao 'padrao' = comportamento atual (display segue o modo real).
  const [gigView, setGigView] = useState('padrao');
  // NAME PRESET visibility — sub-toggles do Gig View. Quando OFF, o nome
  // do preset some do display no modo correspondente.
  const [namePresetLive, setNamePresetLive] = useState(true);
  const [namePresetBank, setNamePresetBank] = useState(true);
  // MATCH MODE: index em MATCH_MODE_OPTIONS (0 = MULTIPLE MODE). Persiste
  // na NVS via /config/global (match_mode). Controla os nomes de PC/CC no
  // editor; MULTIPLE MODE mostra os numeros crus (original).
  const [matchMode, setMatchMode] = useState(0);
  // MATCH MODE: omitir PC/CC sem nome no editor. Persiste via /config/global
  // (match_omit_unnamed).
  const [matchOmitUnnamed, setMatchOmitUnnamed] = useState(false);
  // MATCH MODE: em MULTIPLE MODE, pedal por canal 1..16 (índice 0..31; 0=GLOBAL).
  // Persiste via /config/global (match_channel_0..15). 16 canais, paginados 3x6.
  const [matchChannels, setMatchChannels] = useState(() => Array(MATCH_CHANNEL_SLOTS).fill(0));
  // LIVE CC por canal 1..16: CC disparado ao entrar (127) / sair (0) do modo LIVE
  // — pra pedais que acompanham a tela. 0 = off; 1..128 = CC (valor-1, p/ cobrir
  // CC#0). Persiste via /config/global (match_live_cc_0..15). Ver SW_MODE.h.
  const [matchLiveCc, setMatchLiveCc] = useState(() => Array(MATCH_CHANNEL_SLOTS).fill(0));
  // KEMPER GET NAMES: pede o nome do rig ao Kemper Player via SysEx na troca de
  // preset e mostra no display. So tem efeito em KEMPER PLAYER. Persiste via
  // /config/global (kemper_get_names). Ver KEMPER_RIGNAME.h.
  const [kemperGetNames, setKemperGetNames] = useState(false);
  // KEMPER TUNER STYLE: 0=Arc, 1=Bar/Scale. Estilo da tela do afinador no
  // display. Persiste via /config/global (kemper_tuner_style). Ver KEMPER_TUNER.h.
  const [kemperTunerStyle, setKemperTunerStyle] = useState(0);
  // KEMPER TUNER SPEED: nivel 0..4 de aquisicao de dados do afinador (menor =
  // mais espacado/suave). Persiste via /config/global (kemper_tuner_speed).
  const [kemperTunerSpeed, setKemperTunerSpeed] = useState(2);
  // KEMPER FOLLOW PC: quando o Kemper troca de rig e manda PC/Bank Select, a
  // controladora recall o preset salvo que casa. So tem efeito em KEMPER PLAYER.
  // Persiste via /config/global (kemper_follow_pc). Ver KEMPER_PRESET_FOLLOW.h.
  const [kemperFollowPc, setKemperFollowPc] = useState(false);
  // SW GLOBAL: switch fora dos presets (ver SW_GLOBAL.h). modo (id) + params
  // por modo. Persiste via /config/global (sw_global_mode / sw_global_params);
  // so o modo ativo e gravado na NVS.
  const [globalSwMode, setGlobalSwMode] = useState('fx1');  // default STOMP (espelha SW_GLOBAL.h)
  const [globalSwParams, setGlobalSwParams] = useState({});  // { [modeId]: fields }
  const [globalSwDisplay, setGlobalSwDisplay] = useState(() => ({
    ...DEFAULT_SW_DISPLAY(), icon_id: 1, sigla: 'GLOBAL 1',
  }));
  // Botao LIVE dedicado opcionalmente roteado como um segundo SW GLOBAL, com
  // modo/params/runtime independentes do GLOBAL 1. A troca de dono reinicia o
  // pedal ao salvar para evitar dois handlers no mesmo GPIO.
  const [livePinGlobal2, setLivePinGlobal2] = useState(false);
  const [global2SwMode, setGlobal2SwMode] = useState('fx1');
  const [global2SwParams, setGlobal2SwParams] = useState({});
  const [global2SwDisplay, setGlobal2SwDisplay] = useState(() => ({
    ...DEFAULT_SW_DISPLAY(), icon_id: 1, sigla: 'GLOBAL 2',
  }));
  // SW6 = SW GLOBAL (placas NANO): quando ligado, o SW6 deixa de chamar o
  // preset 6 e vira o footswitch do SW GLOBAL. Persiste via /config/global
  // (nano_sw6_global). Card em SYSTEM > PRINCIPAL; libera o card SW GLOBAL em
  // GLOBAL > MIDI. Ver SW_GLOBAL.h / sw6IsSwGlobal() no firmware.
  const [nanoSw6Global, setNanoSw6Global] = useState(false);
  // MIDI reverso + Control Host (SYSTEM > USB HOST). MIDI vindo do USB host
  // (device USB plugado nele) -> controladora. reverso = re-emite nas saidas
  // (USB device + DIN5); ctrl = interpreta como navegacao da BFMIDI (PC 0..29
  // -> preset; CC81-85 -> bank/preset/LIVE). O filtro de canal e UM SO: o
  // FILTRO MIDI do MCU host (card acima na mesma pagina), valido pros 2
  // sentidos — o antigo hostCtrlChannel foi removido (jun/2026).
  // Persiste via /config/global. Ver USB_HOST_BRIDGE.h no firmware.
  const [hostReverseMidi, setHostReverseMidi] = useState(false);
  const [hostCtrlEnabled, setHostCtrlEnabled] = useState(false);
  // REMAPPING (SYSTEM > PRINCIPAL, só placas MICRO): rotação de tela + remap dos
  // 4 foots (0..3 = 0/90/180/270). hasMicro vem da placa (config.has_micro).
  // Persiste via /config/global (micro_remap); mudar reinicia (repinagem+rotação
  // no boot). Ver display_init / swBankBegin / DISPLAY_PRESENT.h no firmware.
  const [microRemap, setMicroRemap] = useState(0);
  const [hasMicro, setHasMicro] = useState(false);
  // INVERTER TELA (SYSTEM > PRINCIPAL, só placas BFMIDI-1 7S A1/B1/C1): gira a
  // tela 180° quando o display foi soldado de cabeça pra baixo. Persiste via
  // /config/global (display_invert); mudar reinicia (rotação aplicada no boot
  // por display_init). Ver GLOBAL_CONFIG.h / display_init no firmware.
  const [displayInvert, setDisplayInvert] = useState(false);
  // CARD BPM do TAP TEMPO (GLOBAL > TELA): duração do card de BPM na tela
  // (segundos) e valor mostrado — false = ABSOLUTO (2 últimos toques), true =
  // MÉDIO (média da sequência). Persiste via /config/global (bpm_card_secs /
  // bpm_card_avg). Ver BPM_OVERLAY.h no firmware.
  const [bpmCardSecs, setBpmCardSecs] = useState(5);
  const [bpmCardAvg, setBpmCardAvg] = useState(false);
  // INDICADORES ESW1/ESW2 (GLOBAL > TELA, só placas BFMIDI-3(+) com dual switch
  // externo — hasExtDual). Retângulos na tela com o estado on/off de cada ext
  // switch. Persiste via /config/global (ext_indic_*). Firmware em EXT_INDIC.h.
  //   show: 0=off, 1=live, 2=preset, 3=both.  onColor/offColor: id DISPLAY_PALETTE.
  //   siglas: texto de cada caixa.  x/y: posição 0..100 por caixa (arrastável).
  // Escopo POR BOTÃO: [ESW1, ESW2]. 0=off, 1=live, 2=preset, 3=both.
  const [extIndicShows, setExtIndicShows] = useState([0, 0]);
  // Cores ON/OFF POR BOTÃO: [ESW1, ESW2]. Default Verde (31) / Cinza Escuro (2).
  const [extIndicOnColors, setExtIndicOnColors] = useState([31, 31]);
  const [extIndicOffColors, setExtIndicOffColors] = useState([2, 2]);
  const [extIndicFontSizes, setExtIndicFontSizes] = useState([9, 9]);
  const [extIndicSiglas, setExtIndicSiglas] = useState(['ESW1', 'ESW2']);
  const [extIndicX, setExtIndicX] = useState([6, 6]);
  const [extIndicY, setExtIndicY] = useState([6, 22]);
  // Aplica os campos ext_indic_* do /config/global (usado nos 2 caminhos de load).
  const applyExtIndicConfig = (config) => {
    if (typeof config.ext_indic_show1 !== 'undefined' || typeof config.ext_indic_show2 !== 'undefined') {
      setExtIndicShows([
        clamp(Number(config.ext_indic_show1) || 0, 0, 3),
        clamp(Number(config.ext_indic_show2) || 0, 0, 3),
      ]);
    }
    const palMax = DISPLAY_PALETTE.length - 1;
    if (typeof config.ext_indic_on_color1 !== 'undefined' || typeof config.ext_indic_on_color2 !== 'undefined') {
      setExtIndicOnColors([
        clamp(Number(config.ext_indic_on_color1) || 0, 0, palMax),
        clamp(Number(config.ext_indic_on_color2) || 0, 0, palMax),
      ]);
    }
    if (typeof config.ext_indic_off_color1 !== 'undefined' || typeof config.ext_indic_off_color2 !== 'undefined') {
      setExtIndicOffColors([
        clamp(Number(config.ext_indic_off_color1) || 0, 0, palMax),
        clamp(Number(config.ext_indic_off_color2) || 0, 0, palMax),
      ]);
    }
    if (typeof config.ext_indic_font_size1 !== 'undefined' || typeof config.ext_indic_font_size2 !== 'undefined') {
      setExtIndicFontSizes([
        clampFontSize(Number(config.ext_indic_font_size1) || 9, true),
        clampFontSize(Number(config.ext_indic_font_size2) || 9, true),
      ]);
    }
    if (typeof config.ext_indic_sigla1 !== 'undefined' || typeof config.ext_indic_sigla2 !== 'undefined') {
      setExtIndicSiglas([
        String(config.ext_indic_sigla1 ?? 'ESW1').slice(0, 5),
        String(config.ext_indic_sigla2 ?? 'ESW2').slice(0, 5),
      ]);
    }
    if (typeof config.ext_indic_x1 !== 'undefined' || typeof config.ext_indic_x2 !== 'undefined') {
      setExtIndicX([clamp(Number(config.ext_indic_x1) || 0, 0, 100), clamp(Number(config.ext_indic_x2) || 0, 0, 100)]);
    }
    if (typeof config.ext_indic_y1 !== 'undefined' || typeof config.ext_indic_y2 !== 'undefined') {
      setExtIndicY([clamp(Number(config.ext_indic_y1) || 0, 0, 100), clamp(Number(config.ext_indic_y2) || 0, 0, 100)]);
    }
  };
  // EXTERNAL EXPRESSION (GLOBAL > MIDI): pedal de expressao analogico. O card
  // so aparece quando a placa tem entrada de EXP (config.has_exp). Persiste via
  // /config/global (exp_enabled / exp_cc / exp_channel / exp_cal_min/max).
  const [hasExp, setHasExp] = useState(false);
  const [expEnabled, setExpEnabled] = useState(false);
  const [expCc, setExpCc] = useState(11);
  const [expChannel, setExpChannel] = useState(1);
  const [expCalMin, setExpCalMin] = useState(0);
  const [expCalMax, setExpCalMax] = useState(EXP_ADC_MAX);
  // EXTERNAL DUAL SWITCH (GLOBAL > MIDI): 2 botoes externos, so nas placas
  // BFMIDI-3 (+) com a entrada (config.has_ext_dual). So modos STOMP/SINGLE,
  // sem LED. Persiste via /config/global (ext1_mode/ext1_params/ext2_*).
  const [hasExtDual, setHasExtDual] = useState(false);
  const [ext1Mode, setExt1Mode] = useState('mute');
  const [ext1Params, setExt1Params] = useState({});  // { [modeId]: fields }
  const [ext2Mode, setExt2Mode] = useState('mute');
  const [ext2Params, setExt2Params] = useState({});
  const [ext1ResetOnPreset, setExt1ResetOnPreset] = useState(false);
  const [ext2ResetOnPreset, setExt2ResetOnPreset] = useState(false);
  // Espelha o estado nos globals lidos pelos helpers de rotulo (midiOptionElems
  // / channelOptionElems) sem prop-drilling. Roda no corpo do App, antes dos filhos.
  __matchMode = matchMode;
  __matchOmit = matchOmitUnnamed ? 1 : 0;
  __matchChannels = matchChannels;
  __deviceChip = deviceChip;
  __displayRes = displayResolutionFor(model);
  __is4sw = ((MODELS.find((m) => m.id === model) || {}).switches || 6) === 4;
  // __presetLayout e atribuido mais abaixo (apos o useState de presetLayout) —
  // referencia-lo aqui seria TDZ (declarado depois neste corpo de funcao).
  // ICON SHAPE: formato dos tiles de SW — 'default'/'circle'/'octagon'
  // (ver ICON_SHAPES). Independente por modo: iconShape = LIVE (icon_shape),
  // presetIconShape = PRESET (preset_icon_shape). Persistido na NVS.
  const [iconShape, setIconShape] = useState('default');
  const [presetIconShape, setPresetIconShape] = useState('default');
  const [systemTheme, setSystemTheme] = useState(() => {
    try { return getSystemTheme(localStorage.getItem(SYSTEM_THEME_STORAGE_KEY)).id; }
    catch { return SYSTEM_THEMES[0].id; }
  });
  useEffect(() => {
    try { localStorage.setItem(SYSTEM_THEME_STORAGE_KEY, getSystemTheme(systemTheme).id); } catch {}
  }, [systemTheme]);
  // Alterna claro <-> escuro (toggle no header, ao lado do MONITOR MIDI).
  // Escolhe o primeiro tema com o `light` oposto ao atual.
  const toggleSystemTheme = useCallback(() => {
    setSystemTheme((id) => {
      const cur = getSystemTheme(id);
      const next = SYSTEM_THEMES.find((th) => !!th.light !== !!cur.light);
      return next ? next.id : id;
    });
  }, []);
  // Espelha o tema no <body>: modais e popovers sao renderizados via portal
  // em document.body (FORA do .bf-screen), entao nao herdam a classe nem as
  // vars do tema. Aqui replicamos a classe is-theme-light + as vars de cor no
  // body pra que .bf-modal/.bf-color-pop (e seu conteudo via var(...)) sigam
  // o tema claro. So as cores — bevel/relief claros vem das regras CSS.
  useEffect(() => {
    const th = getSystemTheme(systemTheme);
    const body = document.body;
    const vars = {
      '--accent': th.accent, '--accent-2': th.accent2,
      '--accent-hi': th.hi, '--accent-lo': th.lo,
      '--card': th.card, '--card-2': th.card2, '--card-3': th.card3,
      '--text': th.text, '--muted': th.muted, '--faint': th.faint,
      '--ghost': th.ghost, '--hair': th.hair, '--hair-strong': th.hairStrong,
    };
    body.classList.toggle('is-theme-light', !!th.light);
    for (const k in vars) {
      if (th.light && vars[k]) body.style.setProperty(k, vars[k]);
      else body.style.removeProperty(k);
    }
    return () => {
      body.classList.remove('is-theme-light');
      for (const k in vars) body.style.removeProperty(k);
    };
  }, [systemTheme]);
  // LIVE MODE LAYOUT: 1 ou 2. Por enquanto so persiste o valor — a
  // renderizacao real dos dois layouts fica pra fase futura.
  const [liveLayout, setLiveLayout] = useState(1);
  // PRESET MODE LAYOUT: 0 = nenhum (tela classica nome/fundo, default), 1..4 =
  // os mesmos 4 layouts de tiles do LIVE. Permite icones diferentes PRESET x LIVE.
  const [presetLayout, setPresetLayout] = useState(0);
  const [liveCustomLayout, setLiveCustomLayout] = useState(makeDefaultCustomLayout);
  const [presetCustomLayout, setPresetCustomLayout] = useState(makeDefaultCustomLayout);
  // Espelha no global lido pelo preview de posicao do nome (area dos icones).
  __presetLayout = (typeof presetLayout === 'number') ? presetLayout : 0;
  __presetCustomLayout = presetCustomLayout;

  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [autoStartMode, setAutoStartMode] = useState('bank');
  const [autoStartBank, setAutoStartBank] = useState(0);
  const [autoStartPreset, setAutoStartPreset] = useState(1);
  const [bankLetterEnabled, setBankLetterEnabled] = useState(
      Array.from({ length: BANK_LETTER_COUNT }, () => true));
  const [bankChangeMode, setBankChangeMode] = useState(2); // 1 = HIBRIDO, 2 = SINGLE (default, casa DEFAULT_BANK_CHANGE_MODE do firmware)
  // Modo principal dos footswitches: 0 = PRESET-LIVE (padrao), 1 = HIBRIDO
  // (um trio seleciona presets e o outro opera funcoes LIVE ainda no BANK).
  const [switchOperationMode, setSwitchOperationMode] = useState(0);
  // Layout do HIBRIDO: 1 = SW1..3 PRESET / SW4..6 LIVE;
  // 2 = SW1..3 LIVE / SW4..6 PRESET.
  const [hybridSwitchLayout, setHybridSwitchLayout] = useState(1);

  // ── Dirty tracking da config GLOBAL/SYSTEM ──
  // Assinatura de TUDO que saveGlobalConfig envia. Quando difere do baseline
  // (ultimo load/save), o botao SAVE do rodape mostra 'dirty' (igual o
  // preset). String recalculada a cada render — barato; usada como dep dos
  // effects abaixo (comparacao por valor).
  const globalConfigSignature = JSON.stringify([
    model, brightness, bankLedColor, liveLedColor, ledColorMode,
    letterLedColors, switchLedColors, autoStartEnabled, autoStartBank,
    autoStartPreset, autoStartMode, bankLetterEnabled, bankChangeMode, switchOperationMode,
    hybridSwitchLayout,
    ledPreviewLive, ledPreviewLiveLevel, layer2LedColor, gigView,
    namePresetLive, namePresetBank, liveLayout, presetLayout,
    liveCustomLayout, presetCustomLayout, iconShape, presetIconShape, matchMode,
    matchOmitUnnamed, matchChannels, matchLiveCc, kemperGetNames, kemperTunerStyle, kemperTunerSpeed,
    kemperFollowPc, nanoSw6Global, globalSwMode, globalSwParams, globalSwDisplay,
    livePinGlobal2, global2SwMode, global2SwParams, global2SwDisplay,
    hostReverseMidi, hostCtrlEnabled, microRemap, displayInvert,
    bpmCardSecs, bpmCardAvg,
    extIndicShows, extIndicOnColors, extIndicOffColors, extIndicFontSizes, extIndicSiglas, extIndicX, extIndicY,
    expEnabled, expCc, expChannel, expCalMin, expCalMax,
    ext1Mode, ext1Params, ext2Mode, ext2Params, ext1ResetOnPreset, ext2ResetOnPreset,
    LED_COLORS.map((c) => c.rgb),
  ]);
  const globalConfigSignatureRef = useRef(globalConfigSignature);
  globalConfigSignatureRef.current = globalConfigSignature;
  const globalBaselineRef = useRef(null);
  const [globalDirty, setGlobalDirty] = useState(false);
  // Incrementado no fim de cada load (tryLoad/reload) — fixa o baseline = o
  // estado JA aplicado. Depende so do tick: roda depois do render onde os
  // campos carregados entraram, lendo a assinatura atualizada.
  const [globalLoadTick, setGlobalLoadTick] = useState(0);
  useEffect(() => {
    globalBaselineRef.current = globalConfigSignature;
    setGlobalDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalLoadTick]);
  // Recalcula dirty a cada mudanca de assinatura (apos baseline existir).
  useEffect(() => {
    if (globalBaselineRef.current === null) return;
    setGlobalDirty(globalConfigSignature !== globalBaselineRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalConfigSignature]);

  const [bankLetterIndex, setBankLetterIndex] = useState(0);
  const [presetNumber, setPresetNumber] = useState(1);
  const [bankData, setBankData] = useState('');
  const [bankDisplayName, setBankDisplayName] = useState('');
  const [bankState, setBankState] = useState('idle');
  // Modo de operacao do hardware: 'preset' (BANK no firmware) ou 'live'.
  // Sincronizado via /bank/current (poll) e alterado via POST /mode.
  const [switchMode, setSwitchMode] = useState('preset');
  // Sync do toggle PRESET MODE / LIVE MODE com a controladora. Quando ON
  // (padrao), clicks no webApp postam /mode e o poll de /bank/current
  // reflete o modo do hardware. Quando OFF, o toggle e puramente local —
  // nenhuma das duas direcoes propaga. Botaozinho redondo no meio dos
  // dois botoes alterna o estado.
  const [modeSync, setModeSync] = useState(true);
  const modeSyncRef = useRef(true);
  useEffect(() => { modeSyncRef.current = modeSync; }, [modeSync]);
  // Mostra ou oculta o painel MONITOR no fim da pagina de preset.
  // Dois botaozinhos flanqueando o toggle PRESET/LIVE alternam isso.
  // Padrao OFF — usuario liga pelo toggle MONITOR no header quando precisar.
  // Modo de operacao escolhido por SW em LIVE MODE (1..6 -> id do modo).
  // Vive aqui (nao no LiveModePanel) pra sobreviver ao toggle PRESET<->LIVE.
  // Persistido no PRESET atual (campo sw_modes): editar marca pendente,
  // o botao SAVE do rodape grava — igual ao card de preset.
  const [swModes, setSwModes] = useState({});
  const [savedSwModes, setSavedSwModes] = useState({});
  const [swModesStatus, setSwModesStatus] = useState('idle'); // idle|saving|saved|error
  const swModesDirty = swModesToStr(swModes) !== swModesToStr(savedSwModes);
  // ── LAYER 2 — stash do layer INATIVO ─────────────────────────────────
  // editorLayer (1|2) define qual layer esta sendo editado. swModes/
  // swParams/swDisplay sempre refletem o layer ATIVO; *L2 versoes guardam
  // os dados do outro layer enquanto ele nao esta visivel. toggleEditorLayer
  // faz swap atomico ativo<->stash. Save grava ambos os layers; load
  // recebe ambos do /bank/current e bucketa por sufixo da chave.
  const [editorLayer, setEditorLayer] = useState(1);
  const [swModesL2, setSwModesL2] = useState({});
  const [savedSwModesL2, setSavedSwModesL2] = useState({});
  // Display config (icone + cores + sigla) por SW. Vive no header do
  // preset (campos swdisp1..swdisp6). Mesmo padrao do swModes: dirty
  // tracking, salvo via saveLive junto com sw_modes.
  const [swDisplay, setSwDisplay] = useState(defaultSwDisplayMap);
  const [savedSwDisplay, setSavedSwDisplay] = useState(defaultSwDisplayMap);
  const swDisplayDirty = !swDisplayEqual(swDisplay, savedSwDisplay);
  const [swDisplayL2, setSwDisplayL2] = useState(defaultSwDisplayMap);
  const [savedSwDisplayL2, setSavedSwDisplayL2] = useState(defaultSwDisplayMap);
  const setSwDisplayOne = useCallback((sw, next) => {
    setSwDisplay((prev) => ({ ...prev, [sw]: { ...DEFAULT_SW_DISPLAY(), ...next } }));
  }, []);
  const [swLiveOn, setSwLiveOn] = useState([false, false, false, false, false, false]);
  // Estado da secao B (click longo do STOMP 2) — espelha swActive.liveOn2
  // do firmware. Separado pra o poll detectar press do click longo.
  const [swLiveOn2, setSwLiveOn2] = useState([false, false, false, false, false, false]);
  // Estado da secao C (reclick / duplo-click do STOMP 3) — espelha
  // swActive.liveOn3 do firmware.
  const [swLiveOn3, setSwLiveOn3] = useState([false, false, false, false, false, false]);
  // Log de presses de SW em LIVE MODE — cada flip em swLiveOn / swLiveOn2
  // entre polls vira uma entrada. Mostrado no MONITOR (visivel em PRESET
  // e LIVE). Limpa na troca de preset. Cap em 50 entradas.
  const [liveEvents, setLiveEvents] = useState([]);
  // Meta salva do preset ativo (fonte do snapshot do MONITOR no nivel da
  // pagina — sobrevive ao toggle PRESET/LIVE, diferente do savedMetaByTag
  // do PresetEditorCard que desmonta com o card).
  const [currentSavedMeta, setCurrentSavedMeta] = useState(null);
  // Bump a cada paste pra forcar o PresetEditorCard (que tem cache interno
  // de meta por tag) a re-buscar /bank/preset. Sem isso o SAVE do rodape
  // reescreve com o meta velho por cima do que o paste acabou de gravar.
  const [presetReloadToken, setPresetReloadToken] = useState(0);
  // Clipboard de preset INTEIRO — { srcTag, meta, swModes, swParams }.
  // COPY: snapshot do preset atual; PASTE: aplica em outro preset.
  // Vive enquanto o webApp roda (perdido no refresh da pagina).
  const [presetClipboard, setPresetClipboard] = useState(null);
  const [presetClipboardStatus, setPresetClipboardStatus] = useState('idle');
  // Clipboard de BANK INTEIRO — { srcLetter, presets: [{ tag, meta,
  // swModes, swParams }, ...] }. COPY BANK varre os 6 presets do banco
  // atual; PASTE BANK aplica todos no banco corrente. Mais pesado que
  // o clipboard de preset — pode demorar varios segundos pra colar.
  const [bankClipboard, setBankClipboard] = useState(null);
  const [bankClipboardStatus, setBankClipboardStatus] = useState('idle');
  // Clipboard de UM LAYER — { srcTag, srcLayer, swModes, swParams, swDisplay }.
  // COPY LAYER: snapshot apenas do layer EDITADO; PASTE LAYER: aplica no
  // layer EDITADO do preset atual (pode ser layer diferente — cross-layer
  // copy de L1 → L2 ou vice-versa). Util pra duplicar funcoes entre layers.
  const [layerClipboard, setLayerClipboard] = useState(null);
  const [layerClipboardStatus, setLayerClipboardStatus] = useState('idle');
  // Progresso visual do PASTE PRESET / PASTE BANK. null = sem operacao.
  // { kind: 'preset'|'bank', step, total, label } — exibido em modal
  // bloqueante via <PasteProgressModal>. Cada API call avanca o step.
  const [pasteProgress, setPasteProgress] = useState(null);
  // Snapshot do preset atual exibido no MONITOR. Reconstruido pelo
  // useEffect abaixo a partir do savedMeta + savedSwModes + savedSwParams.
  const [monitorEntry, setMonitorEntry] = useState(null);
  const monitorLastSnapshotRef = useRef(null);
  // Tipo do evento MAIS RECENTE exibido no MONITOR (independente do modo do
  // app): 'preset' = ultima chamada de preset (snapshot) | 'live' = ultimo
  // disparo de SW ao vivo. O popup do monitor renderiza por monitorKind, nao
  // por switchMode — assim ele "imprime o que aconteceu por ultimo", seja
  // troca de preset ou press de SW, sem historico acumulado.
  const [monitorKind, setMonitorKind] = useState('preset');
  // Refs pra detectar press dentro do setInterval (closure velha).
  const swLiveOnRef = useRef([false, false, false, false, false, false]);
  const swLiveOn2Ref = useRef([false, false, false, false, false, false]);
  const swLiveOn3Ref = useRef([false, false, false, false, false, false]);
  // Contador de pulses do modo MOMENTARY (do firmware) — usado pra
  // detectar quantos pulses ocorreram entre polls e logar no MONITOR.
  const swMomentaryCountRef = useRef([0, 0, 0, 0, 0, 0]);
  // Contador de disparos do modo SINGLE (mesma mecanica).
  const swSingleCountRef = useRef([0, 0, 0, 0, 0, 0]);
  // Contador de taps do modo TAP TEMPO.
  const swTapCountRef = useRef([0, 0, 0, 0, 0, 0]);
  const swSpinStateRef = useRef([-1, -1, -1, -1, -1, -1]);
  // Estado SPIN espelhado em React state pra o tile do LiveModePanel
  // re-renderizar quando o firmware reporta novo state (1/2/3) — assim
  // o icone troca de cor no preview ao receber o press fisico.
  const [swSpinState, setSwSpinState] = useState([-1, -1, -1, -1, -1, -1]);
  // Qual SW em SINGLE foi o ultimo a disparar (vindo do firmware).
  // -1 = nenhum. Usado pelo SwSingleEditor pra mostrar o LED aceso.
  const [lastSingleSw, setLastSingleSw] = useState(-1);
  const switchModeRef = useRef('preset');
  const savedSwModesRef = useRef({});
  const savedSwParamsRef = useRef({});
  const liveEventsTagRef = useRef('');
  useEffect(() => { swLiveOnRef.current = swLiveOn; }, [swLiveOn]);
  useEffect(() => { swLiveOn2Ref.current = swLiveOn2; }, [swLiveOn2]);
  useEffect(() => { swLiveOn3Ref.current = swLiveOn3; }, [swLiveOn3]);
  useEffect(() => { switchModeRef.current = switchMode; }, [switchMode]);
  // Parametros por SW/modo do preset atual (ver parseSwParamsObj). Mesma
  // mecanica do swModes: editar marca pendente, o SAVE do rodape grava.
  const [swParams, setSwParams] = useState({});
  const [savedSwParams, setSavedSwParams] = useState({});
  // Dirty do swParams: serializa cada lado SO quando seu proprio objeto muda
  // (useMemo), em vez de 2x JSON.stringify a CADA render do App raiz — que
  // re-renderiza em qualquer setState/tecla. swParams tem 6 SWs x params de
  // modo (alguns KB); serializar os dois a cada keystroke do editor pesava em
  // celular. Mesma semantica: compara as duas strings memoizadas.
  const swParamsStr = useMemo(() => JSON.stringify(swParams), [swParams]);
  const savedSwParamsStr =
    useMemo(() => JSON.stringify(savedSwParams), [savedSwParams]);
  const swParamsDirty = swParamsStr !== savedSwParamsStr;
  const [swParamsL2, setSwParamsL2] = useState({});
  const [savedSwParamsL2, setSavedSwParamsL2] = useState({});
  // Swap atomico ativo<->stash + POST /live/layer pra device espelhar.
  // React batcha as 8 chamadas de setState num so re-render dentro do
  // handler, entao cada uma le o valor ANTERIOR — swap em 1 passo.
  const toggleEditorLayer = useCallback((target) => {
    const t = Number(target) === 2 ? 2 : 1;
    setEditorLayer((prev) => {
      if (prev === t) return prev;
      // Promove stash a ativo e ativo a stash.
      setSwModes((cur) => { setSwModesL2(cur); return swModesL2; });
      setSavedSwModes((cur) => { setSavedSwModesL2(cur); return savedSwModesL2; });
      setSwParams((cur) => { setSwParamsL2(cur); return swParamsL2; });
      setSavedSwParams((cur) => { setSavedSwParamsL2(cur); return savedSwParamsL2; });
      setSwDisplay((cur) => { setSwDisplayL2(cur); return swDisplayL2; });
      setSavedSwDisplay((cur) => { setSavedSwDisplayL2(cur); return savedSwDisplayL2; });
      // Mirror no device — best-effort, NAO bloqueia o swap visual.
      // Fire-and-forget; em USB/offline o catch silencia o erro.
      try {
        apiCall('POST', `/live/layer?value=${t}`).catch(() => {});
      } catch {}
      return t;
    });
  }, [swModesL2, savedSwModesL2, swParamsL2, savedSwParamsL2,
      swDisplayL2, savedSwDisplayL2]);
  // dirty combinado do LIVE MODE (sw_modes do header + params dos SWs +
  // display config dos SWs).
  const swModesL2Dirty = swModesToStr(swModesL2) !== swModesToStr(savedSwModesL2);
  const swParamsL2Str = useMemo(() => JSON.stringify(swParamsL2), [swParamsL2]);
  const savedSwParamsL2Str = useMemo(
    () => JSON.stringify(savedSwParamsL2), [savedSwParamsL2]);
  const swParamsL2Dirty = swParamsL2Str !== savedSwParamsL2Str;
  const swDisplayL2Dirty = !swDisplayEqual(swDisplayL2, savedSwDisplayL2);
  const liveDirty = swModesDirty || swParamsDirty || swDisplayDirty ||
                    swModesL2Dirty || swParamsL2Dirty || swDisplayL2Dirty;
  const liveConfigSignature = JSON.stringify([
    swModes, swModesL2, swParams, swParamsL2, swDisplay, swDisplayL2,
  ]);
  const liveConfigSignatureRef = useRef(liveConfigSignature);
  liveConfigSignatureRef.current = liveConfigSignature;
  // Espelha o dirty COMBINADO pro poll de loadBankCurrent (setInterval com
  // closure velha) decidir se pode sobrescrever o estado ou se respeita a
  // edicao. ATOMICO de proposito: com guards por categoria (modes/display/
  // params separados), uma edicao so de display deixava o poll recarregar
  // modes+params do preset NOVO quando o pedal trocava por baixo — e o
  // SAVE gravava a mistura no preset errado.
  const liveDirtyRef = useRef(false);
  useEffect(() => { liveDirtyRef.current = liveDirty; }, [liveDirty]);
  // Tag onde a edicao do LIVE comecou — saveLive grava NELA, nao no tag
  // atual (o poll move currentTagRef quando o pedal troca de preset por
  // baixo do editor). Limpa sozinho quando o dirty zera (save/reload).
  const liveDirtyTagRef = useRef(null);
  useEffect(() => {
    if (liveDirty) {
      if (!liveDirtyTagRef.current) {
        liveDirtyTagRef.current = currentTagRef.current;
      }
    } else {
      liveDirtyTagRef.current = null;
    }
  }, [liveDirty]);
  // Espelha o saved* pra o poll snapshotar config no momento do press
  // (eventos do MONITOR ficam congelados se o usuario editar depois).
  useEffect(() => { savedSwModesRef.current = savedSwModes; }, [savedSwModes]);
  useEffect(() => { savedSwParamsRef.current = savedSwParams; }, [savedSwParams]);
  // editorLayerRef — usado por closures em loadSwParams/loadBankCurrent
  // (que rodam em setInterval e podem ter stale value do useState).
  const editorLayerRef = useRef(1);
  useEffect(() => { editorLayerRef.current = editorLayer; }, [editorLayer]);
  // LAYER 2 desligado (por preset) com o editor parado no L2 -> volta pro
  // L1. Cobre: toggle OFF no icone L2, troca pra um preset sem dual layer,
  // paste de um preset single-layer por cima do atual.
  useEffect(() => {
    if (!layer2Enabled && editorLayer === 2) {
      toggleEditorLayer(1);
    }
  }, [layer2Enabled, editorLayer, toggleEditorLayer]);

  // Constroi o snapshot do MONITOR a partir do meta salvo + modos/params
  // dos SWs. Dedup por JSON pra so atualizar quando algo realmente muda
  // (evita recriar o entry e bagunçar o `time` mostrado).
  useEffect(() => {
    if (!currentSavedMeta) return;
    const letters = BANK_LETTERS;
    const tag = `${letters[bankLetterIndex] || 'A'}${presetNumber}`;
    // Estrutura por SW: { sw, modeLabel, sections: [{label, flags, messages}] }
    const swEntries = Array.from({ length: 6 }, (_, i) => {
      const sw = i + 1;
      const id = (savedSwModes && savedSwModes[sw]) || 'mute';
      const params = savedSwParams && savedSwParams[sw] && savedSwParams[sw][id];
      return buildSnapshotSwEntry(sw, id, params);
    }).filter((e) => e.sections && e.sections.length > 0);
    const snapshot = JSON.stringify({
      tag, name: currentSavedMeta.name || tag,
      pc: currentSavedMeta.bank, ch: currentSavedMeta.channel,
      extraPcs: currentSavedMeta.extraPcs,
      extraCcs: currentSavedMeta.extraCcs,
      swEntries,
    });
    if (monitorLastSnapshotRef.current === snapshot) return;
    monitorLastSnapshotRef.current = snapshot;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${
        String(now.getMinutes()).padStart(2, '0')}:${
        String(now.getSeconds()).padStart(2, '0')}`;
    setMonitorEntry({
      tag, name: currentSavedMeta.name || tag,
      pc: currentSavedMeta.bank, ch: currentSavedMeta.channel,
      time,
      extraPcs: (currentSavedMeta.extraPcs || [])
        .map((pc, i) => ({ slot: i + 1, ch: Number(pc.ch),
                           program: Number(pc.program) }))
        .filter((pc) => pc.ch >= 1 && pc.ch <= 16),
      extraCcs: (currentSavedMeta.extraCcs || [])
        .map((cc, i) => ({ slot: i + 1, ch: Number(cc.ch),
                           ctrl: Number(cc.ctrl), value: Number(cc.value) }))
        .filter((cc) => cc.ch >= 1 && cc.ch <= 16),
      swEntries,
    });
    // Ultimo evento = chamada de preset (substitui o que estava no monitor).
    setMonitorKind('preset');
  }, [currentSavedMeta, savedSwModes, savedSwParams, bankLetterIndex, presetNumber]);
  // Tag do preset atual ("A1"...) sempre fresca — saveLive grava nela.
  const currentTagRef = useRef('A1');
  // Tag pra qual swParams foi carregado — o poll re-busca quando muda.
  const swParamsTagRef = useRef(null);

  // Apenas estado local — a persistencia acontece no SAVE (saveLive).
  const setSwMode = (sw, modeId) =>
    setSwModes((prev) => ({ ...prev, [sw]: modeId }));

  // COPY PRESET — snapshot completo do preset atual (meta + sw_modes +
  // sw_params) pro clipboard interno. Usa SAVED state (nao edits ainda
  // pendentes) pra evitar copiar lixo nao confirmado.
  const copyCurrentPreset = useCallback(() => {
    const tag = currentTagRef.current;
    if (!currentSavedMeta) return;
    const clone = (o) => JSON.parse(JSON.stringify(o));
    // Sempre captura L1 + L2 — independente de qual layer o editor esta
    // mostrando agora, swModes/* eh o ATIVO e *L2 eh o stash; normaliza
    // pra L1=ativo quando editorLayer===1, senao ativo eh L2.
    const isEditingL2 = editorLayer === 2;
    const modesL1 = clone((isEditingL2 ? savedSwModesL2 : savedSwModes) || {});
    const modesL2 = clone((isEditingL2 ? savedSwModes : savedSwModesL2) || {});
    const paramsL1 = clone((isEditingL2 ? savedSwParamsL2 : savedSwParams) || {});
    const paramsL2 = clone((isEditingL2 ? savedSwParams : savedSwParamsL2) || {});
    const dispL1 = clone((isEditingL2 ? savedSwDisplayL2 : savedSwDisplay) || {});
    const dispL2 = clone((isEditingL2 ? savedSwDisplay : savedSwDisplayL2) || {});
    setPresetClipboard({
      srcTag: tag,
      meta: clone(currentSavedMeta),
      swModes: modesL1,
      swParams: paramsL1,
      swDisplay: dispL1,
      swModesL2: modesL2,
      swParamsL2: paramsL2,
      swDisplayL2: dispL2,
    });
    setPresetClipboardStatus('copied');
    setTimeout(() => setPresetClipboardStatus('idle'), 1500);
  }, [currentSavedMeta, savedSwModes, savedSwParams, savedSwDisplay,
      savedSwModesL2, savedSwParamsL2, savedSwDisplayL2, editorLayer]);

  // COPY LAYER — snapshot do layer EDITADO (editorLayer) do preset atual.
  // Pega apenas modos + params + display dos 6 SWs daquele layer; ignora
  // meta do preset (name/PC/extras) — esse copia via COPY PRESET.
  const copyCurrentLayer = useCallback(() => {
    const tag = currentTagRef.current;
    if (!tag) return;
    const clone = (o) => JSON.parse(JSON.stringify(o));
    // O layer EDITADO esta sempre em swModes/swParams/swDisplay (ativo);
    // o outro fica em *L2 (stash).
    setLayerClipboard({
      srcTag: tag,
      srcLayer: editorLayer,
      swModes:   clone(savedSwModes   || {}),
      swParams:  clone(savedSwParams  || {}),
      swDisplay: clone(savedSwDisplay || {}),
    });
    setLayerClipboardStatus('copied');
    setTimeout(() => setLayerClipboardStatus('idle'), 1500);
  }, [editorLayer, savedSwModes, savedSwParams, savedSwDisplay]);

  // PASTE LAYER — escreve o layer copiado no LAYER EDITADO do preset atual
  // (pode ser cross-layer: ex.: copiou L1 do A1, cola em L2 do B3). Atualiza
  // estado local imediatamente e posta no firmware:
  //   1) Header (sw_modes ou sw_modes_l2 + swdispN[L2]) — um POST /bank/preset
  //   2) Params — N POSTs /sw/params?layer=editorLayer
  const pasteIntoCurrentLayer = useCallback(async () => {
    if (!layerClipboard) return;
    const tag = currentTagRef.current;
    if (!tag) return;
    setLayerClipboardStatus('pasting');

    // Pre-conta steps: 1 header + 1 por sw/mode escrito (mesma logica
    // de countPasteSteps, mas so de 1 layer).
    const srcModes = layerClipboard.swModes || {};
    const srcParams = layerClipboard.swParams || {};
    let total = 1;
    for (let sw = 1; sw <= 6; sw++) {
      const modes = { ...(srcParams[sw] || {}) };
      const activeMode = srcModes[sw] || 'mute';
      if (activeMode !== 'mute' && !modes[activeMode]) modes[activeMode] = {};
      total += Object.keys(modes).length;
    }
    let step = 0;
    setPasteProgress({
      kind: 'layer', step: 0, total,
      label: `Colando LAYER ${editorLayer} em ${tag}…`,
    });

    try {
      // 1) Header — escreve s o sw_modes (ou _l2) + swdispN[L2] do
      // layer EDITADO. NAO usa metaToApiBody (esse e do preset todo).
      const layerSuffix = editorLayer === 2 ? 'L2' : '';
      const headerBody = new URLSearchParams();
      headerBody.set('sw_modes' + (editorLayer === 2 ? '_l2' : ''),
                     swModesToStr(layerClipboard.swModes || {}));
      swDisplayToApiBody(layerClipboard.swDisplay || {}, headerBody, layerSuffix);
      await apiCall('POST',
        `/bank/preset?bank=${encodeURIComponent(tag)}`, headerBody);
      step += 1;
      setPasteProgress({
        kind: 'layer', step, total,
        label: `Colando em ${tag} · Header`,
      });

      // 2) Params do layer — POST /sw/params?layer=N&sw=K&mode=...
      for (let sw = 1; sw <= 6; sw++) {
        const modes = { ...(srcParams[sw] || {}) };
        const activeMode = srcModes[sw] || 'mute';
        if (activeMode !== 'mute' && !modes[activeMode]) {
          modes[activeMode] = DEFAULT_SW_PARAMS(activeMode);
        }
        for (const modeId of Object.keys(modes)) {
          await apiCall('POST',
            `/sw/params?bank=${encodeURIComponent(tag)}&sw=${sw}` +
            `&layer=${editorLayer}&mode=${encodeURIComponent(modeId)}`,
            swParamsToApiBody(modes[modeId]));
          step += 1;
          setPasteProgress({
            kind: 'layer', step, total,
            label: `Colando em ${tag} · L${editorLayer} SW${sw} · ${modeId}`,
          });
        }
      }

      // Atualiza estado local IMEDIATAMENTE (ativo = layer editado).
      const cloneModes   = JSON.parse(JSON.stringify(srcModes));
      const cloneParams  = JSON.parse(JSON.stringify(srcParams));
      const cloneDisplay = JSON.parse(JSON.stringify(layerClipboard.swDisplay || {}));
      setSwModes(cloneModes);     setSavedSwModes(cloneModes);
      setSwParams(cloneParams);   setSavedSwParams(cloneParams);
      setSwDisplay(cloneDisplay); setSavedSwDisplay(cloneDisplay);

      setPasteProgress(null);
      setLayerClipboardStatus('pasted');
      setTimeout(() => setLayerClipboardStatus('idle'), 1500);
    } catch {
      setPasteProgress(null);
      setLayerClipboardStatus('error');
      setTimeout(() => setLayerClipboardStatus('idle'), 1800);
      loadSwParams(tag);
    }
  }, [layerClipboard, editorLayer]);

  // Helper compartilhado entre PASTE PRESET e PASTE BANK. Aplica um
  // snapshot (meta + swModes + swParams) em um preset destino.
  //
  // Cuidado importante: o destino pode ter dados antigos em sw<N>.<modo>
  // de um uso anterior. Se o snapshot fonte nao tem entrada pra um modo
  // que VAI ficar ATIVO no destino (porque o usuario nunca abriu o
  // editor desse modo na origem), o POST de params nao acontece e o
  // destino continua usando a config antiga daquele modo — gerando o
  // bug "SWs com opcoes um pouco diferentes" depois do paste. Pra
  // corrigir, materializamos DEFAULT_SW_PARAMS(activeMode) quando o
  // snapshot nao tem entrada — assim o destino sempre fica com o
  // mesmo comportamento que a origem tinha.
  //
  // onStep(label) e chamado a cada API call (header + cada sw/mode),
  // pra o modal de progresso avancar. countPasteSteps abaixo pre-calcula
  // o total de calls pro componente conseguir desenhar a barra.
  const pastePresetToDest = useCallback(async (destTag, src, onStep) => {
    // Header em 2 POSTs (L1 + L2): mantem cada body pequeno (~700B em vez
    // de ~1.5KB) e da intervalo entre commits do LittleFS no firmware.
    // Body grande + rajada de POSTs subsequentes em /sw/params satura o
    // WebServer e POSTs comecam a ser dropados silenciosamente.
    onStep && onStep('Header L1');
    const headerL1 = metaToApiBody(src.meta);
    headerL1.set('sw_modes', swModesToStr(src.swModes || {}));
    if (src.swDisplay) swDisplayToApiBody(src.swDisplay, headerL1, '');
    await apiCall('POST',
      `/bank/preset?bank=${encodeURIComponent(destTag)}`, headerL1);

    onStep && onStep('Header L2');
    const headerL2 = new URLSearchParams();
    headerL2.set('sw_modes_l2', swModesToStr(src.swModesL2 || {}));
    if (src.swDisplayL2) swDisplayToApiBody(src.swDisplayL2, headerL2, 'L2');
    await apiCall('POST',
      `/bank/preset?bank=${encodeURIComponent(destTag)}`, headerL2);

    // Escreve params dos 2 layers (clipboard antigo sem *L2 = L2 vazio,
    // efetivamente reseta pra MUTE — consistente com o sw_modes_l2=0,0...).
    const layers = [
      { N: 1, modes: src.swModes   || {}, params: src.swParams   || {} },
      { N: 2, modes: src.swModesL2 || {}, params: src.swParamsL2 || {} },
    ];
    for (const L of layers) {
      for (let sw = 1; sw <= 6; sw++) {
        const modes = { ...(L.params[sw] || {}) };
        const activeMode = L.modes[sw] || 'mute';
        if (activeMode !== 'mute' && !modes[activeMode]) {
          modes[activeMode] = DEFAULT_SW_PARAMS(activeMode);
        }
        const modeIds = Object.keys(modes);
        for (const modeId of modeIds) {
          onStep && onStep(`L${L.N} SW${sw} · ${modeId}`);
          await apiCall('POST',
            `/sw/params?bank=${encodeURIComponent(destTag)}&sw=${sw}` +
            `&layer=${L.N}&mode=${encodeURIComponent(modeId)}`,
            swParamsToApiBody(modes[modeId]));
        }
      }
    }
  }, []);

  // Conta quantas chamadas o paste vai fazer (1 header + 1 por sw/mode
  // que sera escrito). Usado pra montar a barra de progresso ANTES do
  // primeiro request, pra o usuario ja ver o "X de Y" desde o inicio.
  const countPasteSteps = useCallback((src) => {
    let n = 2; // header L1 + header L2
    const layers = [
      { modes: src.swModes   || {}, params: src.swParams   || {} },
      { modes: src.swModesL2 || {}, params: src.swParamsL2 || {} },
    ];
    for (const L of layers) {
      for (let sw = 1; sw <= 6; sw++) {
        const modes = { ...(L.params[sw] || {}) };
        const activeMode = L.modes[sw] || 'mute';
        if (activeMode !== 'mute' && !modes[activeMode]) modes[activeMode] = {};
        n += Object.keys(modes).length;
      }
    }
    return n;
  }, []);

  // PASTE PRESET — aplica o clipboard no preset ATUAL (currentTag).
  // Sobrescreve meta (header), sw_modes e sw_params no firmware via API
  // e atualiza o state local. Nao copia o tag (preset identity fica).
  const pasteIntoCurrentPreset = useCallback(async () => {
    if (!presetClipboard) return;
    const tag = currentTagRef.current;
    if (!tag || tag === presetClipboard.srcTag) {
      // Colar no mesmo preset que foi copiado nao faz sentido.
      setPresetClipboardStatus('error');
      setTimeout(() => setPresetClipboardStatus('idle'), 1500);
      return;
    }
    setPresetClipboardStatus('pasting');
    const total = countPasteSteps(presetClipboard);
    let step = 0;
    setPasteProgress({
      kind: 'preset', step: 0, total,
      label: `Colando preset em ${tag}…`,
    });
    try {
      await pastePresetToDest(tag, presetClipboard, (sublabel) => {
        step += 1;
        setPasteProgress({
          kind: 'preset', step, total,
          label: `Colando em ${tag} · ${sublabel}`,
        });
      });
      // Sincroniza state local DO APP a partir do clipboard — sem isso, o
      // SAVE do rodape reescreve por cima do que o paste gravou no device.
      // Respeita o editorLayer: ativo (swModes/swParams/swDisplay) carrega
      // o layer EDITADO; stash (*L2) carrega o outro.
      const clone = (o) => JSON.parse(JSON.stringify(o));
      const isEditingL2 = editorLayer === 2;
      const activeModes   = clone(isEditingL2 ? presetClipboard.swModesL2   : presetClipboard.swModes);
      const stashModes    = clone(isEditingL2 ? presetClipboard.swModes     : presetClipboard.swModesL2);
      const activeParams  = clone(isEditingL2 ? presetClipboard.swParamsL2  : presetClipboard.swParams);
      const stashParams   = clone(isEditingL2 ? presetClipboard.swParams    : presetClipboard.swParamsL2);
      const activeDisplay = clone(isEditingL2 ? presetClipboard.swDisplayL2 : presetClipboard.swDisplay);
      const stashDisplay  = clone(isEditingL2 ? presetClipboard.swDisplay   : presetClipboard.swDisplayL2);
      setSwModes(activeModes);     setSavedSwModes(activeModes);
      setSwModesL2(stashModes);    setSavedSwModesL2(stashModes);
      setSwParams(activeParams);   setSavedSwParams(activeParams);
      setSwParamsL2(stashParams);  setSavedSwParamsL2(stashParams);
      setSwDisplay(activeDisplay); setSavedSwDisplay(activeDisplay);
      setSwDisplayL2(stashDisplay);setSavedSwDisplayL2(stashDisplay);
      // currentSavedMeta vive no App, mas o PresetEditorCard tem cache
      // proprio de meta por tag (metaByTag/savedMetaByTag interno). Atualiza
      // os dois: o do App direto, e o do card via bump do presetReloadToken.
      setCurrentSavedMeta(clone(presetClipboard.meta));
      setLayer2Enabled(!!presetClipboard.meta.layer2);
      setPresetReloadToken((v) => v + 1);
      setPasteProgress(null);
      setPresetClipboardStatus('pasted');
      setTimeout(() => setPresetClipboardStatus('idle'), 1500);
    } catch (e) {
      setPasteProgress(null);
      setPresetClipboardStatus('error');
      setTimeout(() => setPresetClipboardStatus('idle'), 1800);
    }
  }, [presetClipboard, pastePresetToDest, countPasteSteps, editorLayer]);

  // COPY BANK — varre todos os 6 presets do banco atual (A..E) e
  // armazena um snapshot completo. Faz 12 GETs (6 metas + 6 sw_params).
  // Pode demorar 2-5s dependendo do transport (USB/WiFi).
  const copyCurrentBank = useCallback(async () => {
    const letterIdx = bankLetterIndex;
    const letter = String.fromCharCode(65 + (letterIdx % BANK_LETTER_COUNT));
    setBankClipboardStatus('copying');
    try {
      const presets = [];
      for (let p = 1; p <= 6; p++) {
        const tag = `${letter}${p}`;
        const presetResp = await apiCall('GET',
          `/bank/preset?bank=${encodeURIComponent(tag)}`);
        const rawMeta = (presetResp && presetResp.meta) || presetResp || {};
        const meta = metaFromApi(rawMeta);
        const swModes   = parseSwModesStr(rawMeta.sw_modes   || '0,0,0,0,0,0');
        const swModesL2 = parseSwModesStr(rawMeta.sw_modes_l2 || '0,0,0,0,0,0');
        const swDisplay   = parseSwDisplayFromMeta(rawMeta, '');
        const swDisplayL2 = parseSwDisplayFromMeta(rawMeta, 'L2');
        const paramsResp = await apiCall('GET',
          `/sw/params?bank=${encodeURIComponent(tag)}`);
        const { l1: swParams, l2: swParamsL2 } =
            parseSwParamsObjByLayer(paramsResp && paramsResp.sw_params);
        presets.push({ tag, meta,
          swModes, swParams, swDisplay,
          swModesL2, swParamsL2, swDisplayL2 });
      }
      setBankClipboard({ srcLetter: letter, presets });
      setBankClipboardStatus('copied');
      setTimeout(() => setBankClipboardStatus('idle'), 1500);
    } catch (e) {
      setBankClipboardStatus('error');
      setTimeout(() => setBankClipboardStatus('idle'), 1800);
    }
  }, [bankLetterIndex]);

  // PASTE BANK — aplica os 6 presets do clipboard no banco corrente.
  // Sobrescreve TUDO (meta + sw_modes + sw_params) de cada preset.
  // Pula se for o mesmo banco origem.
  const pasteIntoCurrentBank = useCallback(async () => {
    if (!bankClipboard || !Array.isArray(bankClipboard.presets)) return;
    const letterIdx = bankLetterIndex;
    const letter = String.fromCharCode(65 + (letterIdx % BANK_LETTER_COUNT));
    if (letter === bankClipboard.srcLetter) {
      setBankClipboardStatus('error');
      setTimeout(() => setBankClipboardStatus('idle'), 1500);
      return;
    }
    setBankClipboardStatus('pasting');
    // Soma os steps de todos os 6 presets pra a barra cobrir o bank todo.
    const total = bankClipboard.presets.reduce(
      (acc, src) => acc + countPasteSteps(src), 0);
    let step = 0;
    setPasteProgress({
      kind: 'bank', step: 0, total,
      label: `Colando banco em ${letter}…`,
    });
    try {
      for (let i = 0; i < bankClipboard.presets.length; i++) {
        const src = bankClipboard.presets[i];
        // src.tag e o tag de origem (ex: A1, A2...). Reescreve no destino
        // mantendo o numero do preset (1..6), so trocando a letra.
        const presetNum = parseInt(src.tag.slice(1), 10) || 1;
        const destTag = `${letter}${presetNum}`;
        await pastePresetToDest(destTag, src, (sublabel) => {
          step += 1;
          setPasteProgress({
            kind: 'bank', step, total,
            label: `Preset ${i + 1}/6 · ${destTag} · ${sublabel}`,
          });
        });
      }
      // Re-carrega o preset corrente do clipboard (mesmo numero, letra do
      // destino). Sincroniza state local + bump do reload token pro
      // PresetEditorCard re-buscar o meta. Sem isso, o SAVE do rodape
      // sobrescreve o paste.
      const curTag = currentTagRef.current;
      if (curTag) {
        const curNum = parseInt(curTag.slice(1), 10) || 1;
        const src = bankClipboard.presets.find(
          (p) => (parseInt(p.tag.slice(1), 10) || 1) === curNum);
        if (src) {
          const clone = (o) => JSON.parse(JSON.stringify(o));
          const isEditingL2 = editorLayer === 2;
          const activeModes   = clone(isEditingL2 ? src.swModesL2   : src.swModes);
          const stashModes    = clone(isEditingL2 ? src.swModes     : src.swModesL2);
          const activeParams  = clone(isEditingL2 ? src.swParamsL2  : src.swParams);
          const stashParams   = clone(isEditingL2 ? src.swParams    : src.swParamsL2);
          const activeDisplay = clone(isEditingL2 ? src.swDisplayL2 : src.swDisplay);
          const stashDisplay  = clone(isEditingL2 ? src.swDisplay   : src.swDisplayL2);
          setSwModes(activeModes);     setSavedSwModes(activeModes);
          setSwModesL2(stashModes);    setSavedSwModesL2(stashModes);
          setSwParams(activeParams);   setSavedSwParams(activeParams);
          setSwParamsL2(stashParams);  setSavedSwParamsL2(stashParams);
          setSwDisplay(activeDisplay); setSavedSwDisplay(activeDisplay);
          setSwDisplayL2(stashDisplay);setSavedSwDisplayL2(stashDisplay);
          setCurrentSavedMeta(clone(src.meta));
          setLayer2Enabled(!!src.meta.layer2);
          setPresetReloadToken((v) => v + 1);
        }
      }
      setPasteProgress(null);
      setBankClipboardStatus('pasted');
      setTimeout(() => setBankClipboardStatus('idle'), 1500);
    } catch (e) {
      setPasteProgress(null);
      setBankClipboardStatus('error');
      setTimeout(() => setBankClipboardStatus('idle'), 1800);
    }
  }, [bankClipboard, bankLetterIndex, pastePresetToDest, countPasteSteps, editorLayer]);

  // Edita um campo de um SW/modo. Cria a entrada com os defaults do modo
  // se ainda nao existir. Local — persistido pelo SAVE do rodape.
  const setSwParam = (sw, modeId, patch) =>
    setSwParams((prev) => {
      const prevSw = prev[sw] || {};
      const prevMode = prevSw[modeId] || DEFAULT_SW_PARAMS(modeId);
      return {
        ...prev,
        [sw]: { ...prevSw, [modeId]: { ...prevMode, ...patch } },
      };
    });

  // Carrega os params de SW de um preset (GET /sw/params). Seta swParams e
  // savedSwParams (baseline) — descarta edicao pendente. Otimista no
  // swParamsTagRef pra o poll nao re-buscar antes da resposta chegar.
  const loadSwParams = async (tag) => {
    swParamsTagRef.current = tag;
    try {
      const resp = await apiCall(
        'GET', `/sw/params?bank=${encodeURIComponent(tag)}`);
      // DIAGNOSTICO (temporario): mostra o que o device devolveu pra este
      // preset. Se a chave do SW (ex.: "sw1.single") vier com os valores,
      // o dado chegou na webApp (bug seria de exibicao); se vier vazia, e
      // leitura/persistencia. Remover apos diagnosticar.
      console.log('[BFMIDI] loadSwParams', tag, '→', resp && resp.sw_params);
      const { l1, l2 } = parseSwParamsObjByLayer(resp && resp.sw_params);
      // Bucketa por editorLayer atual: o layer EDITADO vai pra
      // swParams (ativo), o outro vai pro stash swParamsL2.
      const active = editorLayerRef.current === 2 ? l2 : l1;
      const stash  = editorLayerRef.current === 2 ? l1 : l2;
      setSwParams(active);
      setSavedSwParams(active);
      setSwParamsL2(stash);
      setSavedSwParamsL2(stash);
    } catch {
      swParamsTagRef.current = null;  // permite retry no proximo poll
    }
  };

  // Grava o estado do LIVE MODE do preset atual.
  //   Por WiFi (HTTP): 1 POST /bank/preset/batch — single RMW no firmware.
  //     Antes era N+1 POSTs (header + 1 por sw/layer/mode dirty), cada um
  //     1 RMW completo. Agora 1 RMW so. ~300ms -> ~50ms.
  //   Por USB: ainda multi-POST. O body batch tipico passa de 2 KB e nao
  //     cabe na linha de USB_CONTROL.h. webApp ramifica em _transport.
  const saveLive = async () => {
    const signatureAtSave = liveConfigSignature;
    setSwModesStatus('saving');
    // Grava no tag onde a edicao COMECOU — se o pedal trocou de preset por
    // baixo do editor, currentTagRef ja aponta pro preset novo e o save
    // pararia no lugar errado.
    const tag = liveDirtyTagRef.current || currentTagRef.current;
    const isEditingL2 = editorLayer === 2;
    const modesL1   = isEditingL2 ? swModesL2   : swModes;
    const modesL2   = isEditingL2 ? swModes     : swModesL2;
    const paramsL1  = isEditingL2 ? swParamsL2  : swParams;
    const paramsL2  = isEditingL2 ? swParams    : swParamsL2;
    const dispL1    = isEditingL2 ? swDisplayL2 : swDisplay;
    const dispL2    = isEditingL2 ? swDisplay   : swDisplayL2;
    const savedParamsL1 = isEditingL2 ? savedSwParamsL2 : savedSwParams;
    const savedParamsL2 = isEditingL2 ? savedSwParams   : savedSwParamsL2;
    try {
      const updatedL1 = { ...paramsL1 };
      const updatedL2 = { ...paramsL2 };
      const layers = [
        { N: 1, suffix: '',   modes: modesL1, params: paramsL1, saved: savedParamsL1, out: updatedL1 },
        { N: 2, suffix: 'L2', modes: modesL2, params: paramsL2, saved: savedParamsL2, out: updatedL2 },
      ];
      // Materializa defaults pro modo ativo de cada SW (mesma logica do save antigo).
      for (const L of layers) {
        for (let sw = 1; sw <= 6; sw++) {
          const activeMode = L.modes[sw] || 'mute';
          if (activeMode !== 'mute') {
            const cur = L.params[sw] && L.params[sw][activeMode];
            if (!cur) {
              const defaults = DEFAULT_SW_PARAMS(activeMode);
              L.out[sw] = { ...(L.out[sw] || {}), [activeMode]: defaults };
            }
          }
        }
      }

      if (_transport.usbConnected) {
        // ── USB: caminho multi-POST (body batch nao cabe em 2 KB) ──
        const headerBody = new URLSearchParams();
        headerBody.set('sw_modes',    swModesToStr(modesL1));
        headerBody.set('sw_modes_l2', swModesToStr(modesL2));
        swDisplayToApiBody(dispL1, headerBody, '');
        swDisplayToApiBody(dispL2, headerBody, 'L2');
        await apiCall('POST',
          `/bank/preset?bank=${encodeURIComponent(tag)}`, headerBody);
        for (const L of layers) {
          for (let sw = 1; sw <= 6; sw++) {
            const modes = L.out[sw] || {};
            for (const modeId of Object.keys(modes)) {
              const cur = JSON.stringify(modes[modeId]);
              const prev = JSON.stringify((L.saved[sw] || {})[modeId]);
              if (cur === prev) continue;
              await apiCall('POST',
                `/sw/params?bank=${encodeURIComponent(tag)}&sw=${sw}` +
                `&layer=${L.N}&mode=${encodeURIComponent(modeId)}`,
                swParamsToApiBody(modes[modeId]));
            }
          }
        }
      } else {
        // ── HTTP: caminho batch (1 RMW so) ──
        const body = new URLSearchParams();
        body.set('sw_modes',    swModesToStr(modesL1));
        body.set('sw_modes_l2', swModesToStr(modesL2));
        swDisplayToApiBody(dispL1, body, '');
        swDisplayToApiBody(dispL2, body, 'L2');
        for (const L of layers) {
          for (let sw = 1; sw <= 6; sw++) {
            const modes = L.out[sw] || {};
            for (const modeId of Object.keys(modes)) {
              const cur = JSON.stringify(modes[modeId]);
              const prev = JSON.stringify((L.saved[sw] || {})[modeId]);
              if (cur === prev) continue;
              const key = `sw${sw}${L.suffix}.${modeId}`;
              body.set(key, swParamsToGlobalBlob(modes[modeId]));
            }
          }
        }
        await apiCall('POST',
          `/bank/preset/batch?bank=${encodeURIComponent(tag)}`, body);
      }

      // Se houve nova edicao enquanto a requisicao estava em voo, preserva a
      // working copy e deixa dirty para o auto-save seguinte. Sem isso, uma
      // resposta lenta (principalmente via USB) podia apagar o ultimo ajuste.
      if (liveConfigSignatureRef.current === signatureAtSave) {
        // Atualiza baselines salvos (ativo + stash) preservando lado.
        if (isEditingL2) {
          setSavedSwModes(modesL2);
          setSavedSwDisplay(dispL2);
          setSavedSwModesL2(modesL1);
          setSavedSwDisplayL2(dispL1);
          setSwParams(updatedL2); setSavedSwParams(updatedL2);
          setSwParamsL2(updatedL1); setSavedSwParamsL2(updatedL1);
        } else {
          setSavedSwModes(modesL1);
          setSavedSwDisplay(dispL1);
          setSavedSwModesL2(modesL2);
          setSavedSwDisplayL2(dispL2);
          setSwParams(updatedL1); setSavedSwParams(updatedL1);
          setSwParamsL2(updatedL2); setSavedSwParamsL2(updatedL2);
        }
      }

      setSwModesStatus('saved');
      setTimeout(() => setSwModesStatus((s) => (s === 'saved' ? 'idle' : s)), 1200);
    } catch {
      setSwModesStatus('error');
      setTimeout(() => setSwModesStatus((s) => (s === 'error' ? 'idle' : s)), 1400);
      // Re-sincroniza pra refletir o que realmente gravou no dispositivo.
      loadSwParams(tag);
    }
  };

  const [wifiStatus, setWifiStatus] = useState(null);
  const [wifiNetworks, setWifiNetworks] = useState([]);
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiState, setWifiState] = useState('idle');
  // Resultado da última tentativa de conexão STA (popup). null = sem popup.
  // { ok, ip, ssid, code } — ok=true mostra instruções; false mostra o erro.
  const [wifiResult, setWifiResult] = useState(null);

  // USB Host bridge — GET /usb_host/status retorna online/mode/filter/ble/
  // manufacturer/product. Poll a cada 2s enquanto a aba USB HOST estiver
  // aberta. Acoes (mode/filter/ble/update) fazem POST e re-fetch.
  const [usbHostStatus, setUsbHostStatus] = useState(null);
  const [usbHostBusy, setUsbHostBusy] = useState(false);
  // Guard de in-flight pro POLL (setInterval 2s). User actions (setMode/etc)
  // passam fromPoll=false e ignoram o guard — refresh imediato e prioritario.
  const usbHostLoadBusyRef = useRef(false);
  const loadUsbHostStatus = useCallback(async (fromPoll = false) => {
    if (fromPoll && usbHostLoadBusyRef.current) return;
    usbHostLoadBusyRef.current = true;
    try {
      const s = await apiCall('GET', '/usb_host/status');
      setUsbHostStatus(s);
    } catch { /* offline / preview */ }
    finally { usbHostLoadBusyRef.current = false; }
  }, []);
  const setUsbHostMode = useCallback(async (mode) => {
    setUsbHostBusy(true);
    try {
      const b = new URLSearchParams(); b.set('mode', String(mode));
      await apiCall('POST', '/usb_host/mode', b);
      await loadUsbHostStatus();
    } catch {}
    setUsbHostBusy(false);
  }, [loadUsbHostStatus]);
  const toggleUsbHostBle = useCallback(async (enabled) => {
    setUsbHostBusy(true);
    try {
      const b = new URLSearchParams(); b.set('enabled', enabled ? '1' : '0');
      await apiCall('POST', '/usb_host/ble', b);
      await loadUsbHostStatus();
    } catch {}
    setUsbHostBusy(false);
  }, [loadUsbHostStatus]);
  // Perfil do BLE do host: 0 = teclado HID, 1 = BLE-MIDI padrão.
  const setUsbHostBleMode = useCallback(async (mode) => {
    setUsbHostBusy(true);
    try {
      const b = new URLSearchParams(); b.set('mode', String(mode));
      await apiCall('POST', '/usb_host/ble_mode', b);
      await loadUsbHostStatus();
    } catch {}
    setUsbHostBusy(false);
  }, [loadUsbHostStatus]);
  const setUsbHostFilter = useCallback(async (ch) => {
    setUsbHostBusy(true);
    try {
      const b = new URLSearchParams(); b.set('channel', String(ch));
      await apiCall('POST', '/usb_host/filter', b);
      await loadUsbHostStatus();
    } catch {}
    setUsbHostBusy(false);
  }, [loadUsbHostStatus]);
  const usbHostEnterUpdateMode = useCallback(async () => {
    if (!window.confirm('Colocar o MCU USB Host em modo update (OTA)?\n\n' +
      'Ele vai reiniciar e ficar aguardando firmware novo. Use so se for ' +
      'flashar o host.')) return;
    setUsbHostBusy(true);
    try {
      await apiCall('POST', '/usb_host/update_mode');
      await loadUsbHostStatus();
    } catch {}
    setUsbHostBusy(false);
  }, [loadUsbHostStatus]);
  const refreshUsbHostStatus = useCallback(async () => {
    setUsbHostBusy(true);
    try {
      await apiCall('POST', '/usb_host/refresh');
      // Pequeno delay pra resposta do host chegar via SysEx (Serial1 31250).
      await new Promise((r) => setTimeout(r, 200));
      await loadUsbHostStatus();
    } catch {}
    setUsbHostBusy(false);
  }, [loadUsbHostStatus]);

  const activeModel = MODELS.find((m) => m.id === model);
  const presetCount = Math.min((activeModel && activeModel.switches) || 6, 6);
  // SW6 = SW GLOBAL (placas NANO): no editor de PRESET o SW6 deixa de ser
  // preset/live switch — esconde o preset 6 e o tile do SW6 reduzindo a
  // contagem efetiva pra 5. Espelha bankButtons[5] desligado no firmware.
  // Vale SÓ no editor de preset; o catálogo/placa continua 6 SW.
  const sw6IsGlobalActive = nanoSw6Global && (model || '').includes('NANO');
  const presetCountEdit = sw6IsGlobalActive ? Math.min(presetCount, 5) : presetCount;

  useEffect(() => {
    if (autoStartPreset > presetCount) setAutoStartPreset(presetCount);
  }, [presetCount, autoStartPreset]);

  // ── Health check do WiFi (HTTP) — independente do transport de edicao ──
  // O icone WiFi do header so fica verde se o HTTP responder. USB pode estar
  // ativo simultaneamente; usamos apiCall (que pode rotear por USB) so para
  // dados, e fetch HTTP puro aqui exclusivamente para o status de WiFi.
  //
  // Estrategia robusta contra flicker:
  //   - Endpoint /ping (resposta de 16 bytes em ~10ms, evita timeout em STA lenta)
  //   - Timeout 5s (em vez de 3s) — STA via roteador pode demorar
  //   - Polling 10s (em vez de 30s) — recupera mais rapido apos online
  //   - 2 falhas seguidas antes de marcar offline (suaviza flicker de 1 ping perdido)
  //   - Mostra 'loading' (amarelo) enquanto ainda esta no limbo (1 falha so)
  const pingFailCountRef = useRef(0);
  // Guard contra ping sobreposto. Quando offline o probe gasta ate ~6-8s
  // (2 hosts × 3s timeout cada) e o interval pode ser 2s — sem este flag
  // os pings empilhariam no queuedFetch.
  const pingInFlightRef = useRef(false);
  // Backoff exponencial enquanto offline. Step 0 = 2s, 1 = 4s, 2 = 8s,
  // 3 = 16s, 4+ = 30s (cap). Reseta em sucesso do ping ou em mudanca de
  // usbState. Sem isso, WiFi caido por horas gerava ping a cada 2s indefinido.
  const offlineBackoffStepsRef = useRef(0);
  // Espelho de deviceState lido pelo scheduler do ping sem por deviceState
  // nas deps — senao o effect remontaria a cada flicker offline<->loading
  // (failCount 1=loading, 2=offline) e resetaria o step do backoff, deixando
  // ele preso em 0/1 pra sempre.
  const deviceStateRef = useRef('offline');
  // Auto-detecta o modo de WiFi a cada ping: probe STA primeiro (preferido),
  // depois AP como fallback. Atualiza connectionMode + deviceState pela
  // resposta. Sem probe disponivel (same-origin), so reporta offline.
  const pingHttp = useCallback(async () => {
    if (pingInFlightRef.current) return false;
    // Heavy op (scan/upload/restore/backup/connect) bloqueia a fila single-lane
    // do queuedFetch — o probe ia estourar timeout sem nem chegar no device e
    // marcar "offline" falsamente. Enquanto o usuario tem op pesada em vôo,
    // assume online (a propria op revela queda se acontecer).
    if (getHeavyOpsInFlight() > 0) {
      pingFailCountRef.current = 0;
      setDeviceState('online');
      return true;
    }
    pingInFlightRef.current = true;
    // Health-check nao entra na fila HTTP de edicoes. DNS lento ou host
    // indisponivel pode consumir todo o timeout, mas nunca deve segurar um
    // POST disparado pelo usuario atras do probe.
    const probeFetch = async (url, timeoutMs) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetch(url, { method: 'GET', signal: ctrl.signal });
      } finally {
        clearTimeout(t);
      }
    };
    const probeHost = async (host) => {
      // /ping (firmware novo, 16 bytes, ~10ms). Se 404, tenta /config/global
      // pra cobrir firmware antigo.
      try {
        const r = await probeFetch(`${host}/ping`, 3000);
        if (r.ok) return true;
      } catch {}
      try {
        const r = await probeFetch(`${host}/config/global`, 4000);
        return r.ok;
      } catch { return false; }
    };
    // Testa exclusivamente o host escolhido pelo usuario.
    try {
      const host = connectionMode === 'AP' ? AP_HOST : staHost;
      if (await probeHost(host)) {
        pingFailCountRef.current = 0;
        offlineBackoffStepsRef.current = 0;
        setDeviceState('online');
        return true;
      }
      pingFailCountRef.current += 1;
      if (pingFailCountRef.current >= 2) {
        setDeviceState('offline');
      } else {
        // 1a falha: ainda nao desce pra offline; mostra "loading" pra
        // sinalizar instabilidade sem alarmar com vermelho.
        setDeviceState('loading');
      }
      return false;
    } finally {
      pingInFlightRef.current = false;
    }
  }, [connectionMode, staHost]);

  // Sincroniza ref pro scheduler — sem isso, schedule() leria deviceState
  // estale do closure do useEffect.
  useEffect(() => { deviceStateRef.current = deviceState; }, [deviceState]);

  // Re-ping ao trocar estado de USB ou host selecionado.
  // Periodicidade ADAPTATIVA:
  //   - USB conectado: PARA O PING TOTALMENTE — toda comunicacao com o
  //     device vai por USB; bater bfmidi.local sem WiFi so gera spam de
  //     ERR_NAME_NOT_RESOLVED no console.
  //   - Conectado por HTTP (STA/AP OK): 10s — health check leve.
  //   - Offline: backoff exponencial 2s -> 4s -> 8s -> 16s -> 30s (cap).
  //     Reseta em sucesso (pingHttp zera offlineBackoffStepsRef) ou em
  //     mudanca de usbState (effect re-mount). Antes era 2s fixo — gerava
  //     ~30 requests/min spamando o console em WiFi caido por horas.
  // Self-rescheduling setTimeout (em vez de setInterval) pra interval mudar
  // entre ticks. deviceState lido via ref pra effect nao remontar a cada
  // flicker offline<->loading (so re-monta em pingHttp/usbState).
  useEffect(() => {
    pingFailCountRef.current = 0;
    offlineBackoffStepsRef.current = 0;
    if (DEMO_MODE) {
      setDeviceState('online');
      return;
    }
    if (usbState === 'connected') {
      // USB cobre tudo — nao precisa probar HTTP. Marca deviceState como
      // offline (sem perder o estado anterior se ja era offline) pra o
      // icone WiFi ficar consistente: USB ligado, WiFi nao usado.
      setDeviceState((cur) => (cur === 'online' ? 'offline' : cur));
      return;
    }
    let cancelled = false;
    let timerId = null;
    const schedule = () => {
      if (cancelled) return;
      const isOnline = deviceStateRef.current === 'online';
      let intervalMs;
      if (isOnline) {
        intervalMs = 10000;
      } else {
        const step = offlineBackoffStepsRef.current;
        intervalMs = Math.min(2000 * Math.pow(2, step), 30000);
        offlineBackoffStepsRef.current = Math.min(step + 1, 4);
      }
      timerId = setTimeout(async () => {
        if (cancelled) return;
        await pingHttp();
        if (!cancelled) schedule();
      }, intervalMs);
    };
    pingHttp().then(() => { if (!cancelled) schedule(); });
    return () => { cancelled = true; if (timerId) clearTimeout(timerId); };
  }, [pingHttp, usbState]);

  // ── Carregar config global ──
  const loadGlobalConfig = useCallback(async (timeoutMs = 4000) => {
    try {
      const config = await apiCall('GET', '/config/global');
      return config;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function tryLoad() {
      // Tenta com timeout curto; se falhar (típico no primeiro hit ao
      // bfmidi.local que ainda precisa resolver mDNS), tenta de novo
      // com timeout maior.
      let config = await loadGlobalConfig(2500);
      if (cancelled) return;
      if (!config) {
        await new Promise((r) => setTimeout(r, 600));
        if (cancelled) return;
        config = await loadGlobalConfig(6000);
      }
      if (cancelled || !config) return;

      applyDevicePalette(config.colors);
      if (config.chip) setDeviceChip(config.chip);
      if (config.board) setModel(config.board);
      if (typeof config.led_brightness !== 'undefined') setBrightness(brightnessByteToPercent(config.led_brightness));
      if (typeof config.bank_led_color !== 'undefined') setBankLedColor(clamp(config.bank_led_color, 0, 14));
      if (typeof config.live_led_color !== 'undefined') setLiveLedColor(clamp(config.live_led_color, 0, 14));
      if (typeof config.led_color_mode !== 'undefined') setLedColorMode(Number(config.led_color_mode) === 1 ? 'numeros' : 'letras');
      if (Array.isArray(config.letter_led_colors)) setLetterLedColors(Array.from({ length: BANK_LETTER_COUNT }, (_, i) => clamp(config.letter_led_colors[i], 0, 14)));
      if (Array.isArray(config.switch_led_colors)) setSwitchLedColors([0, 1, 2, 3, 4, 5].map((i) => clamp(config.switch_led_colors[i], 0, 14)));
      if (typeof config.auto_start_enabled !== 'undefined') setAutoStartEnabled(Number(config.auto_start_enabled) === 1);
      if (typeof config.auto_start_bank !== 'undefined') setAutoStartBank(clamp(config.auto_start_bank, 0, BANK_LETTER_COUNT - 1));
      if (typeof config.auto_start_preset !== 'undefined') setAutoStartPreset(clamp(config.auto_start_preset, 1, 8));
      if (typeof config.auto_start_mode !== 'undefined') setAutoStartMode(Number(config.auto_start_mode) === 1 ? 'live' : 'bank');
      if (Array.isArray(config.bank_letter_enabled)) setBankLetterEnabled(Array.from({ length: BANK_LETTER_COUNT }, (_, i) => Number(config.bank_letter_enabled[i]) === 1));
      if (typeof config.bank_change_mode !== 'undefined') setBankChangeMode(clamp(config.bank_change_mode, 1, 3) || 2);
      if (typeof config.switch_operation_mode !== 'undefined') {
        setSwitchOperationMode(Number(config.switch_operation_mode) === 1 ? 1 : 0);
      }
      if (typeof config.hybrid_switch_layout !== 'undefined') {
        setHybridSwitchLayout(Number(config.hybrid_switch_layout) === 2 ? 2 : 1);
      }
      if (typeof config.led_preview_live_mode !== 'undefined') setLedPreviewLive(Number(config.led_preview_live_mode) === 1);
      if (typeof config.led_preview_live_level !== 'undefined') setLedPreviewLiveLevel(Math.round(clamp(config.led_preview_live_level, 0, 255) / 255 * 100));
      if (typeof config.layer2_led_color !== 'undefined') setLayer2LedColor(clamp(config.layer2_led_color, 0, 14));
      // layer2_enabled do /config/global e LEGADO — o flag virou por preset
      // (meta.layer2); ignorado aqui de proposito.
      if (typeof config.gig_view !== 'undefined') {
        const g = Number(config.gig_view);
        setGigView(g === 1 ? 'preset' : g === 2 ? 'live' : 'padrao');
      }
      if (typeof config.name_preset_live !== 'undefined') setNamePresetLive(Number(config.name_preset_live) === 1);
      if (typeof config.name_preset_bank !== 'undefined') setNamePresetBank(Number(config.name_preset_bank) === 1);
      if (typeof config.live_layout !== 'undefined') {
        const v = Number(config.live_layout);
        setLiveLayout((v >= 1 && v <= 5) ? v : 1);
      }
      if (typeof config.preset_layout !== 'undefined') {
        const v = Number(config.preset_layout);
        setPresetLayout((v >= 0 && v <= 6) ? v : 0);
      }
      if (typeof config.custom_live !== 'undefined') {
        setLiveCustomLayout(parseCustomLayout(config.custom_live));
      }
      if (typeof config.custom_preset !== 'undefined') {
        setPresetCustomLayout(parseCustomLayout(config.custom_preset));
      }
      if (typeof config.icon_shape !== 'undefined') {
        setIconShape(numToIconShape(config.icon_shape));
      }
      if (typeof config.preset_icon_shape !== 'undefined') {
        setPresetIconShape(numToIconShape(config.preset_icon_shape));
      }
      if (typeof config.match_mode !== 'undefined') setMatchMode(clamp(config.match_mode, 0, MATCH_MODE_OPTIONS.length - 1));
      if (typeof config.match_omit_unnamed !== 'undefined') setMatchOmitUnnamed(Number(config.match_omit_unnamed) === 1);
      if (typeof config.kemper_get_names !== 'undefined') setKemperGetNames(Number(config.kemper_get_names) === 1);
      if (typeof config.kemper_tuner_style !== 'undefined') setKemperTunerStyle(clamp(Number(config.kemper_tuner_style), 0, 2));
      if (typeof config.kemper_tuner_speed !== 'undefined') setKemperTunerSpeed(clamp(Number(config.kemper_tuner_speed), 0, 4));
      if (typeof config.kemper_follow_pc !== 'undefined') setKemperFollowPc(Number(config.kemper_follow_pc) === 1);
      if (typeof config.nano_sw6_global !== 'undefined') setNanoSw6Global(Number(config.nano_sw6_global) === 1);
      if (typeof config.host_reverse_midi !== 'undefined') setHostReverseMidi(Number(config.host_reverse_midi) === 1);
      if (typeof config.host_ctrl_enabled !== 'undefined') setHostCtrlEnabled(Number(config.host_ctrl_enabled) === 1);
        if (typeof config.micro_remap !== 'undefined') setMicroRemap(clamp(Number(config.micro_remap), 0, 3));
      if (typeof config.has_micro !== 'undefined') setHasMicro(Number(config.has_micro) === 1);
      if (typeof config.display_invert !== 'undefined') setDisplayInvert(Number(config.display_invert) === 1);
      if (typeof config.bpm_card_secs !== 'undefined') setBpmCardSecs(clamp(Number.isFinite(Number(config.bpm_card_secs)) ? Number(config.bpm_card_secs) : 5, 0, 30));
      if (typeof config.bpm_card_avg !== 'undefined') setBpmCardAvg(Number(config.bpm_card_avg) === 1);
      applyExtIndicConfig(config);
      if (Array.isArray(config.match_channels)) setMatchChannels(Array.from({ length: MATCH_CHANNEL_SLOTS }, (_, i) => clamp(config.match_channels[i] || 0, 0, MATCH_MODE_OPTIONS.length - 1)));
      if (Array.isArray(config.match_live_cc)) setMatchLiveCc(Array.from({ length: MATCH_CHANNEL_SLOTS }, (_, i) => clamp(Number(config.match_live_cc[i]) || 0, 0, 128)));
      if (typeof config.sw_global_mode !== 'undefined') {
        const gm = config.sw_global_mode || 'fx1';  // default STOMP se vazio (espelha SW_GLOBAL.h)
        setGlobalSwMode(gm);
        setGlobalSwParams({ [gm]: globalBlobToSwParams(config.sw_global_params || '', gm) });
      }
      if (typeof config.sw_global_display !== 'undefined') {
        setGlobalSwDisplay(parseSwDisplayOne(config.sw_global_display || ''));
      }
      if (typeof config.live_pin_global2 !== 'undefined') setLivePinGlobal2(Number(config.live_pin_global2) === 1);
      if (typeof config.sw_global2_mode !== 'undefined') {
        const gm2 = config.sw_global2_mode || 'fx1';
        setGlobal2SwMode(gm2);
        setGlobal2SwParams({ [gm2]: globalBlobToSwParams(config.sw_global2_params || '', gm2) });
      }
      if (typeof config.sw_global2_display !== 'undefined') {
        setGlobal2SwDisplay(parseSwDisplayOne(config.sw_global2_display || ''));
      }
      if (typeof config.has_exp !== 'undefined') setHasExp(Number(config.has_exp) === 1);
      if (typeof config.exp_enabled !== 'undefined') setExpEnabled(Number(config.exp_enabled) === 1);
      if (typeof config.exp_cc !== 'undefined') setExpCc(clamp(config.exp_cc, 0, 127));
      if (typeof config.exp_channel !== 'undefined') setExpChannel(clamp(config.exp_channel, 1, 16));
      if (typeof config.exp_cal_min !== 'undefined') setExpCalMin(clamp(config.exp_cal_min, 0, EXP_ADC_MAX));
      if (typeof config.exp_cal_max !== 'undefined') setExpCalMax(clamp(config.exp_cal_max, 0, EXP_ADC_MAX));
      if (typeof config.has_ext_dual !== 'undefined') setHasExtDual(Number(config.has_ext_dual) === 1);
      if (typeof config.ext1_mode !== 'undefined') {
        const m = config.ext1_mode || 'mute';
        setExt1Mode(m);
        setExt1Params({ [m]: globalBlobToSwParams(config.ext1_params || '', m) });
      }
      if (typeof config.ext2_mode !== 'undefined') {
        const m = config.ext2_mode || 'mute';
        setExt2Mode(m);
        setExt2Params({ [m]: globalBlobToSwParams(config.ext2_params || '', m) });
      }
      if (typeof config.ext1_reset_on_preset !== 'undefined') setExt1ResetOnPreset(Number(config.ext1_reset_on_preset) === 1);
      if (typeof config.ext2_reset_on_preset !== 'undefined') setExt2ResetOnPreset(Number(config.ext2_reset_on_preset) === 1);
      // Fixa o baseline do dirty tracking = config recem-carregada.
      setGlobalLoadTick((t) => t + 1);
      // deviceState e atualizado por pingHttp, nao aqui (load pode ter vindo via USB).
    }
    tryLoad();
    return () => { cancelled = true; };
  }, [loadGlobalConfig, usbState, connectionMode]);

  // Recarregar config manualmente (clicando no status do header).
  const reloadGlobalConfig = useCallback(async () => {
    const config = await loadGlobalConfig(6000);
    if (!config) return;
    applyDevicePalette(config.colors);
    if (config.chip) setDeviceChip(config.chip);
    if (config.board) setModel(config.board);
    if (typeof config.led_brightness !== 'undefined') setBrightness(brightnessByteToPercent(config.led_brightness));
    if (typeof config.bank_led_color !== 'undefined') setBankLedColor(clamp(config.bank_led_color, 0, 14));
    if (typeof config.live_led_color !== 'undefined') setLiveLedColor(clamp(config.live_led_color, 0, 14));
    if (typeof config.led_color_mode !== 'undefined') setLedColorMode(Number(config.led_color_mode) === 1 ? 'numeros' : 'letras');
    if (Array.isArray(config.letter_led_colors)) setLetterLedColors(Array.from({ length: BANK_LETTER_COUNT }, (_, i) => clamp(config.letter_led_colors[i], 0, 14)));
    if (Array.isArray(config.switch_led_colors)) setSwitchLedColors([0, 1, 2, 3, 4, 5].map((i) => clamp(config.switch_led_colors[i], 0, 14)));
    if (typeof config.auto_start_enabled !== 'undefined') setAutoStartEnabled(Number(config.auto_start_enabled) === 1);
    if (typeof config.auto_start_bank !== 'undefined') setAutoStartBank(clamp(config.auto_start_bank, 0, BANK_LETTER_COUNT - 1));
    if (typeof config.auto_start_preset !== 'undefined') setAutoStartPreset(clamp(config.auto_start_preset, 1, 8));
    if (typeof config.auto_start_mode !== 'undefined') setAutoStartMode(Number(config.auto_start_mode) === 1 ? 'live' : 'bank');
    if (Array.isArray(config.bank_letter_enabled)) setBankLetterEnabled(Array.from({ length: BANK_LETTER_COUNT }, (_, i) => Number(config.bank_letter_enabled[i]) === 1));
    if (typeof config.bank_change_mode !== 'undefined') setBankChangeMode(clamp(config.bank_change_mode, 1, 3) || 1);
    if (typeof config.switch_operation_mode !== 'undefined') {
      setSwitchOperationMode(Number(config.switch_operation_mode) === 1 ? 1 : 0);
    }
    if (typeof config.hybrid_switch_layout !== 'undefined') {
      setHybridSwitchLayout(Number(config.hybrid_switch_layout) === 2 ? 2 : 1);
    }
    if (typeof config.led_preview_live_mode !== 'undefined') setLedPreviewLive(Number(config.led_preview_live_mode) === 1);
    if (typeof config.led_preview_live_level !== 'undefined') setLedPreviewLiveLevel(Math.round(clamp(config.led_preview_live_level, 0, 255) / 255 * 100));
    if (typeof config.layer2_led_color !== 'undefined') setLayer2LedColor(clamp(config.layer2_led_color, 0, 14));
    // layer2_enabled legado ignorado (flag por preset — ver meta.layer2).
    if (typeof config.gig_view !== 'undefined') {
      const g = Number(config.gig_view);
      setGigView(g === 1 ? 'preset' : g === 2 ? 'live' : 'padrao');
    }
    if (typeof config.name_preset_live !== 'undefined') setNamePresetLive(Number(config.name_preset_live) === 1);
    if (typeof config.name_preset_bank !== 'undefined') setNamePresetBank(Number(config.name_preset_bank) === 1);
    if (typeof config.live_layout !== 'undefined') {
      const v = Number(config.live_layout);
      setLiveLayout((v >= 1 && v <= 5) ? v : 1);
    }
    if (typeof config.preset_layout !== 'undefined') {
      const v = Number(config.preset_layout);
      setPresetLayout((v >= 0 && v <= 6) ? v : 0);
    }
    if (typeof config.custom_live !== 'undefined') {
      setLiveCustomLayout(parseCustomLayout(config.custom_live));
    }
    if (typeof config.custom_preset !== 'undefined') {
      setPresetCustomLayout(parseCustomLayout(config.custom_preset));
    }
    if (typeof config.icon_shape !== 'undefined') {
      setIconShape(numToIconShape(config.icon_shape));
    }
    if (typeof config.preset_icon_shape !== 'undefined') {
      setPresetIconShape(numToIconShape(config.preset_icon_shape));
    }
    if (typeof config.match_mode !== 'undefined') setMatchMode(clamp(config.match_mode, 0, MATCH_MODE_OPTIONS.length - 1));
    if (typeof config.match_omit_unnamed !== 'undefined') setMatchOmitUnnamed(Number(config.match_omit_unnamed) === 1);
    if (typeof config.kemper_get_names !== 'undefined') setKemperGetNames(Number(config.kemper_get_names) === 1);
    if (typeof config.kemper_tuner_style !== 'undefined') setKemperTunerStyle(clamp(Number(config.kemper_tuner_style), 0, 2));
      if (typeof config.kemper_tuner_speed !== 'undefined') setKemperTunerSpeed(clamp(Number(config.kemper_tuner_speed), 0, 4));
    if (typeof config.kemper_follow_pc !== 'undefined') setKemperFollowPc(Number(config.kemper_follow_pc) === 1);
    if (typeof config.nano_sw6_global !== 'undefined') setNanoSw6Global(Number(config.nano_sw6_global) === 1);
    if (typeof config.host_reverse_midi !== 'undefined') setHostReverseMidi(Number(config.host_reverse_midi) === 1);
    if (typeof config.host_ctrl_enabled !== 'undefined') setHostCtrlEnabled(Number(config.host_ctrl_enabled) === 1);
    if (typeof config.micro_remap !== 'undefined') setMicroRemap(clamp(Number(config.micro_remap), 0, 3));
    if (typeof config.has_micro !== 'undefined') setHasMicro(Number(config.has_micro) === 1);
    if (typeof config.display_invert !== 'undefined') setDisplayInvert(Number(config.display_invert) === 1);
    if (typeof config.bpm_card_secs !== 'undefined') setBpmCardSecs(clamp(Number.isFinite(Number(config.bpm_card_secs)) ? Number(config.bpm_card_secs) : 5, 0, 30));
    if (typeof config.bpm_card_avg !== 'undefined') setBpmCardAvg(Number(config.bpm_card_avg) === 1);
    applyExtIndicConfig(config);
    if (Array.isArray(config.match_channels)) setMatchChannels(Array.from({ length: MATCH_CHANNEL_SLOTS }, (_, i) => clamp(config.match_channels[i] || 0, 0, MATCH_MODE_OPTIONS.length - 1)));
    if (Array.isArray(config.match_live_cc)) setMatchLiveCc(Array.from({ length: MATCH_CHANNEL_SLOTS }, (_, i) => clamp(Number(config.match_live_cc[i]) || 0, 0, 128)));
    if (typeof config.sw_global_mode !== 'undefined') {
      const gm = config.sw_global_mode || 'fx1';  // default STOMP se vazio (espelha SW_GLOBAL.h)
      setGlobalSwMode(gm);
      setGlobalSwParams({ [gm]: globalBlobToSwParams(config.sw_global_params || '', gm) });
    }
    if (typeof config.sw_global_display !== 'undefined') {
      setGlobalSwDisplay(parseSwDisplayOne(config.sw_global_display || ''));
    }
    if (typeof config.live_pin_global2 !== 'undefined') setLivePinGlobal2(Number(config.live_pin_global2) === 1);
    if (typeof config.sw_global2_mode !== 'undefined') {
      const gm2 = config.sw_global2_mode || 'fx1';
      setGlobal2SwMode(gm2);
      setGlobal2SwParams({ [gm2]: globalBlobToSwParams(config.sw_global2_params || '', gm2) });
    }
    if (typeof config.sw_global2_display !== 'undefined') {
      setGlobal2SwDisplay(parseSwDisplayOne(config.sw_global2_display || ''));
    }
    if (typeof config.has_exp !== 'undefined') setHasExp(Number(config.has_exp) === 1);
    if (typeof config.exp_enabled !== 'undefined') setExpEnabled(Number(config.exp_enabled) === 1);
    if (typeof config.exp_cc !== 'undefined') setExpCc(clamp(config.exp_cc, 0, 127));
    if (typeof config.exp_channel !== 'undefined') setExpChannel(clamp(config.exp_channel, 1, 16));
    if (typeof config.exp_cal_min !== 'undefined') setExpCalMin(clamp(config.exp_cal_min, 0, EXP_ADC_MAX));
    if (typeof config.exp_cal_max !== 'undefined') setExpCalMax(clamp(config.exp_cal_max, 0, EXP_ADC_MAX));
    if (typeof config.has_ext_dual !== 'undefined') setHasExtDual(Number(config.has_ext_dual) === 1);
    if (typeof config.ext1_mode !== 'undefined') {
      const m = config.ext1_mode || 'mute';
      setExt1Mode(m);
      setExt1Params({ [m]: globalBlobToSwParams(config.ext1_params || '', m) });
    }
    if (typeof config.ext2_mode !== 'undefined') {
      const m = config.ext2_mode || 'mute';
      setExt2Mode(m);
      setExt2Params({ [m]: globalBlobToSwParams(config.ext2_params || '', m) });
    }
    if (typeof config.ext1_reset_on_preset !== 'undefined') setExt1ResetOnPreset(Number(config.ext1_reset_on_preset) === 1);
    if (typeof config.ext2_reset_on_preset !== 'undefined') setExt2ResetOnPreset(Number(config.ext2_reset_on_preset) === 1);
    // Fixa o baseline do dirty tracking = config recem-recarregada.
    setGlobalLoadTick((t) => t + 1);
    // deviceState (WiFi) e atualizado por pingHttp, independente do transport
    // de edicao.
  }, [loadGlobalConfig]);

  // ── ERASE callback (chamado por EraseDataCard apos POST /erase/<x>) ──
  // Sem isso, o firmware apaga mas a UI segue mostrando estado em cache.
  // Para 'presets': re-fetch da meta + sw_params do preset ativo (limpa
  // tambem clipboards stale e qualquer estado de edicao pendente). Para
  // 'global': reloadGlobalConfig pega a paleta/brilho/etc resetados.
  const handleErased = useCallback(async (target) => {
    if (target === 'presets') {
      // Limpa estado local imediato — defaults sao todos vazios/mute.
      const empty = {};
      setSwModes(empty);     setSavedSwModes(empty);
      setSwParams(empty);    setSavedSwParams(empty);
      setSwModesL2(empty);   setSavedSwModesL2(empty);
      setSwParamsL2(empty);  setSavedSwParamsL2(empty);
      setSwDisplay(defaultSwDisplayMap);  setSavedSwDisplay(defaultSwDisplayMap);
      setSwDisplayL2(defaultSwDisplayMap); setSavedSwDisplayL2(defaultSwDisplayMap);
      setEditorLayer(1);
      // Clipboards podem referir a presets que nao existem mais.
      setPresetClipboard(null);
      setBankClipboard(null);
      setLayerClipboard(null);
      // Forca o tag-ref a recarregar /sw/params na proxima passada do poll.
      swParamsTagRef.current = null;
      // Re-fetch full state (meta + sw_params) do preset ATIVO.
      try { await loadBankCurrent(); } catch {}
      try { await loadSwParams(currentTagRef.current); } catch {}
    } else if (target === 'global') {
      try { await reloadGlobalConfig(); } catch {}
    }
  }, [reloadGlobalConfig]);

  // ── BANK ── (usa apiCall — roteia HTTP ou USB automaticamente)
  const loadBankCurrent = async () => {
    try {
      const bank = await apiCall('GET', '/bank/current');
      const li = Number(bank.bank_letter_index) || 0;
      const pn = Number(bank.preset_number) || 1;
      setBankLetterIndex(li);
      setPresetNumber(pn);
      currentTagRef.current = `${String.fromCharCode(65 + li)}${pn}`;
      setBankData(bank.data || '');
      setBankDisplayName(bank.meta?.name || '');
      if (bank.meta) {
        const m = metaFromApi(bank.meta);
        setCurrentSavedMeta(m);
        setLayer2Enabled(!!m.layer2);
      }
      // Sincroniza o modo com o hardware — cobre o botao fisico LIVE.
      // Com sync OFF, ignora — o toggle do webApp fica desacoplado.
      if (typeof bank.switch_mode !== 'undefined' && modeSyncRef.current) {
        setSwitchMode(Number(bank.switch_mode) === 1 ? 'live' : 'preset');
      }
      const newTag = `${String.fromCharCode(65 + li)}${pn}`;
      const newLiveOn = Array.isArray(bank.sw_live_on)
        ? Array.from({ length: 6 }, (_, i) => Number(bank.sw_live_on[i]) === 1)
        : null;
      const newLiveOn2 = Array.isArray(bank.sw_live_on2)
        ? Array.from({ length: 6 }, (_, i) => Number(bank.sw_live_on2[i]) === 1)
        : null;
      const newLiveOn3 = Array.isArray(bank.sw_live_on3)
        ? Array.from({ length: 6 }, (_, i) => Number(bank.sw_live_on3[i]) === 1)
        : null;
      const newMomentaryCount = Array.isArray(bank.sw_momentary_count)
        ? Array.from({ length: 6 }, (_, i) => Number(bank.sw_momentary_count[i]) || 0)
        : null;
      const newSingleCount = Array.isArray(bank.sw_single_count)
        ? Array.from({ length: 6 }, (_, i) => Number(bank.sw_single_count[i]) || 0)
        : null;
      const newLastSingle = (typeof bank.last_single_sw !== 'undefined')
        ? Number(bank.last_single_sw)
        : null;
      const newTapCount = Array.isArray(bank.sw_tap_count)
        ? Array.from({ length: 6 }, (_, i) => Number(bank.sw_tap_count[i]) || 0)
        : null;
      const newSpinState = Array.isArray(bank.sw_spin_state)
        ? Array.from({ length: 6 }, (_, i) => Number(bank.sw_spin_state[i]))
        : null;
      // Detecta presses em LIVE MODE: flip em swLiveOn / swLiveOn2 /
      // swLiveOn3 entre polls vira um evento pro MONITOR. Delta no
      // sw_momentary_count loga um evento por pulse do modo MOMENTARY
      // (que nao mexe em liveOn, entao precisa do contador). So conta
      // dentro do mesmo preset (troca de preset reseta o log e nao gera
      // evento por initial-MIDI).
      if (switchModeRef.current === 'live' &&
          liveEventsTagRef.current === newTag) {
        const prevA = swLiveOnRef.current;
        const prevB = swLiveOn2Ref.current;
        const prevC = swLiveOn3Ref.current;
        const prevM = swMomentaryCountRef.current;
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${
            String(now.getMinutes()).padStart(2, '0')}:${
            String(now.getSeconds()).padStart(2, '0')}`;
        const newEvents = [];
        for (let i = 0; i < 6; i++) {
          if (newLiveOn && newLiveOn[i] !== prevA[i]) {
            const ev = buildLivePressEvent(i + 1, 0, newLiveOn[i],
              savedSwModesRef.current, savedSwParamsRef.current);
            if (ev) newEvents.push({ ...ev, time });
          }
          if (newLiveOn2 && newLiveOn2[i] !== prevB[i]) {
            const ev = buildLivePressEvent(i + 1, 1, newLiveOn2[i],
              savedSwModesRef.current, savedSwParamsRef.current);
            if (ev) newEvents.push({ ...ev, time });
          }
          if (newLiveOn3 && newLiveOn3[i] !== prevC[i]) {
            const ev = buildLivePressEvent(i + 1, 2, newLiveOn3[i],
              savedSwModesRef.current, savedSwParamsRef.current);
            if (ev) newEvents.push({ ...ev, time });
          }
          if (newMomentaryCount && newMomentaryCount[i] !== prevM[i]) {
            // Delta com wrap (uint16 no firmware). Cap em 5 pra evitar
            // spam caso o user aperte muito entre dois polls.
            const delta = (newMomentaryCount[i] - prevM[i] + 65536) % 65536;
            const n = Math.min(delta, 5);
            for (let k = 0; k < n; k++) {
              const ev = buildLivePressEvent(i + 1, 0, true,
                savedSwModesRef.current, savedSwParamsRef.current);
              if (ev) newEvents.push({ ...ev, time });
            }
          }
          if (newSingleCount && newSingleCount[i] !== swSingleCountRef.current[i]) {
            const prevS = swSingleCountRef.current[i];
            const delta = (newSingleCount[i] - prevS + 65536) % 65536;
            const n = Math.min(delta, 5);
            for (let k = 0; k < n; k++) {
              const ev = buildLivePressEvent(i + 1, 0, true,
                savedSwModesRef.current, savedSwParamsRef.current);
              if (ev) newEvents.push({ ...ev, time });
            }
          }
          if (newTapCount && newTapCount[i] !== swTapCountRef.current[i]) {
            const prevT = swTapCountRef.current[i];
            const delta = (newTapCount[i] - prevT + 65536) % 65536;
            const n = Math.min(delta, 8);  // taps podem ser frequentes
            for (let k = 0; k < n; k++) {
              const ev = buildLivePressEvent(i + 1, 0, true,
                savedSwModesRef.current, savedSwParamsRef.current);
              if (ev) newEvents.push({ ...ev, time });
            }
          }
          if (newSpinState && newSpinState[i] !== swSpinStateRef.current[i] &&
              newSpinState[i] >= 0) {
            // SPIN — passa o stateIndex como nowOn (hack pra reaproveitar
            // a assinatura do builder).
            const ev = buildLivePressEvent(i + 1, 0, newSpinState[i],
              savedSwModesRef.current, savedSwParamsRef.current);
            if (ev) newEvents.push({ ...ev, time });
          }
        }
        if (newEvents.length) {
          // Substitui — o monitor mostra so o disparo MAIS RECENTE.
          // (Mantemos `newEvents` como array porque um press pode
          // disparar simultaneamente em mais de uma secao.)
          setLiveEvents(newEvents);
          // Ultimo evento = disparo de SW ao vivo.
          setMonitorKind('live');
        }
      }
      // Reset do log na troca de preset (e captura do primeiro tag visto).
      if (liveEventsTagRef.current !== newTag) {
        if (liveEventsTagRef.current) setLiveEvents([]);
        liveEventsTagRef.current = newTag;
      }
      if (newLiveOn) {
        swLiveOnRef.current = newLiveOn;  // sincronia imediata pra o proximo poll
        setSwLiveOn((cur) => (sameArr6(cur, newLiveOn) ? cur : newLiveOn));
      }
      if (newLiveOn2) {
        swLiveOn2Ref.current = newLiveOn2;
        setSwLiveOn2((cur) => (sameArr6(cur, newLiveOn2) ? cur : newLiveOn2));
      }
      if (newLiveOn3) {
        swLiveOn3Ref.current = newLiveOn3;
        setSwLiveOn3((cur) => (sameArr6(cur, newLiveOn3) ? cur : newLiveOn3));
      }
      if (newMomentaryCount) {
        swMomentaryCountRef.current = newMomentaryCount;
      }
      if (newSingleCount) {
        swSingleCountRef.current = newSingleCount;
      }
      if (newTapCount) {
        swTapCountRef.current = newTapCount;
      }
      if (newSpinState) {
        swSpinStateRef.current = newSpinState;
        // So dispara re-render se mudou — Array.from chega como nova ref
        // todo poll, comparar item-a-item evita renders inuteis.
        setSwSpinState((cur) => {
          for (let i = 0; i < 6; i++) {
            if (cur[i] !== newSpinState[i]) return newSpinState;
          }
          return cur;
        });
      }
      if (newLastSingle !== null) {
        setLastSingleSw((cur) => (cur === newLastSingle ? cur : newLastSingle));
      }
      // sw_modes / sw_modes_l2 do preset atual. Pulado se ha edicao
      // pendente (dirty) — senao o poll sobrescreveria edicao nao salva.
      // Bucketa por editorLayer atual: o EDITADO vira ativo, o outro
      // stash. /bank/current GET retorna ambos os layers.
      if (typeof bank.meta?.sw_modes !== 'undefined' &&
          !liveDirtyRef.current) {
        const l1 = parseSwModesStr(bank.meta.sw_modes);
        const l2 = parseSwModesStr(bank.meta.sw_modes_l2 || '0,0,0,0,0,0');
        const active = editorLayerRef.current === 2 ? l2 : l1;
        const stash  = editorLayerRef.current === 2 ? l1 : l2;
        setSwModes(active); setSavedSwModes(active);
        setSwModesL2(stash); setSavedSwModesL2(stash);
      }
      // sw_display L1/L2 — mesmo padrao. Respeita edicao pendente.
      if (bank.meta && !liveDirtyRef.current) {
        const dispL1 = parseSwDisplayFromMeta(bank.meta, '');
        const dispL2 = parseSwDisplayFromMeta(bank.meta, 'L2');
        const active = editorLayerRef.current === 2 ? dispL2 : dispL1;
        const stash  = editorLayerRef.current === 2 ? dispL1 : dispL2;
        setSwDisplay(active); setSavedSwDisplay(active);
        setSwDisplayL2(stash); setSavedSwDisplayL2(stash);
      }
      // Params de SW: re-busca quando o preset muda (cobre troca pelo
      // hardware), respeitando edicao pendente. /sw/params e um GET
      // separado — so chamado na troca de preset, nao a cada poll.
      if (swParamsTagRef.current !== currentTagRef.current &&
          !liveDirtyRef.current) {
        loadSwParams(currentTagRef.current);
      }
    } catch {/* preview */}
  };

  // Na controladora real o restore reinicia o firmware e os polls recarregam
  // tudo. Na DEMO não há reboot: invalida os caches e refaz as leituras assim
  // que o JSON termina de ser aplicado, para a importação aparecer na tela.
  const handleBackupRestored = async () => {
    swParamsTagRef.current = null;
    setPresetReloadToken((value) => value + 1);
    await reloadGlobalConfig();
    await loadBankCurrent();
  };

  // So tenta loadBankCurrent quando ha transport disponivel — evita HTTP
  // spam pra bfmidi.local antes do USB ser conectado em modo USB-only.
  useEffect(() => {
    // Roda no PRESET (editor) e tambem no SYSTEM (card MONITOR MIDI em
    // PRINCIPAL precisa do poll pra atualizar ao vivo ao pisar no pedal).
    if (page !== 'preset_config' && page !== 'system_config') return;
    const hasTransport = (usbState === 'connected') || (deviceState === 'online');
    if (!hasTransport) return;
    loadBankCurrent();
  }, [page, usbState, deviceState]);

  // Detecta transicao "sem transport -> com transport" e bumpa o
  // presetReloadToken pra invalidar o cache do PresetEditorCard (e
  // disparar refetch da meta do tag atual). Sem isso, o usuario teria
  // que trocar de preset e voltar pra ver os dados aparecerem depois
  // do USB/WiFi conectar.
  const prevHasTransportRef = useRef(false);
  useEffect(() => {
    const hasTransport = (usbState === 'connected') || (deviceState === 'online');
    const prev = prevHasTransportRef.current;
    prevHasTransportRef.current = hasTransport;
    if (!prev && hasTransport) {
      // Transitou pra ONLINE: re-puxa tudo do device.
      setPresetReloadToken((v) => v + 1);
    }
  }, [usbState, deviceState]);

  // Poll leve: GET /bank/live (payload ~280B vs 3-6KB de /bank/current).
  // Atualiza so campos volateis (estado de SW, contadores, spin_state) +
  // detecta troca de preset feita no hardware. Se o tag mudou, dispara
  // 1 fetch de /bank/current pra refrescar meta+data+sw_params. Reduz a
  // banda do poll em ~95% e o tempo de snprintf no firmware.
  const loadBankLiveBusyRef = useRef(false);
  const loadBankLive = async () => {
    // Guard de in-flight: setInterval(1500ms) sem isso empilhava chamadas no
    // _httpQueue quando o tick era mais rapido que a resposta (rede ruim ou
    // op pesada na fila), gerando backlog e UI reagindo a leituras antigas.
    if (loadBankLiveBusyRef.current) return;
    loadBankLiveBusyRef.current = true;
    try {
      const bank = await apiCall('GET', '/bank/live');
      const li = Number(bank.bank_letter_index) || 0;
      const pn = Number(bank.preset_number) || 1;
      const newTag = `${String.fromCharCode(65 + li)}${pn}`;
      setBankLetterIndex(li);
      setPresetNumber(pn);
      if (typeof bank.switch_mode !== 'undefined' && modeSyncRef.current) {
        setSwitchMode(Number(bank.switch_mode) === 1 ? 'live' : 'preset');
      }

      const newLiveOn = Array.isArray(bank.sw_live_on)
        ? Array.from({ length: 6 }, (_, i) => Number(bank.sw_live_on[i]) === 1)
        : null;
      const newLiveOn2 = Array.isArray(bank.sw_live_on2)
        ? Array.from({ length: 6 }, (_, i) => Number(bank.sw_live_on2[i]) === 1)
        : null;
      const newLiveOn3 = Array.isArray(bank.sw_live_on3)
        ? Array.from({ length: 6 }, (_, i) => Number(bank.sw_live_on3[i]) === 1)
        : null;
      const newMomentaryCount = Array.isArray(bank.sw_momentary_count)
        ? Array.from({ length: 6 }, (_, i) => Number(bank.sw_momentary_count[i]) || 0)
        : null;
      const newSingleCount = Array.isArray(bank.sw_single_count)
        ? Array.from({ length: 6 }, (_, i) => Number(bank.sw_single_count[i]) || 0)
        : null;
      const newLastSingle = (typeof bank.last_single_sw !== 'undefined')
        ? Number(bank.last_single_sw)
        : null;
      const newTapCount = Array.isArray(bank.sw_tap_count)
        ? Array.from({ length: 6 }, (_, i) => Number(bank.sw_tap_count[i]) || 0)
        : null;
      const newSpinState = Array.isArray(bank.sw_spin_state)
        ? Array.from({ length: 6 }, (_, i) => Number(bank.sw_spin_state[i]))
        : null;

      // Detecta presses em LIVE MODE igual loadBankCurrent. Mesma lógica
      // de eventos — duplicada aqui em vez de extraída pra manter
      // loadBankCurrent intocado (refactor incremental).
      if (switchModeRef.current === 'live' &&
          liveEventsTagRef.current === newTag) {
        const prevA = swLiveOnRef.current;
        const prevB = swLiveOn2Ref.current;
        const prevC = swLiveOn3Ref.current;
        const prevM = swMomentaryCountRef.current;
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${
            String(now.getMinutes()).padStart(2, '0')}:${
            String(now.getSeconds()).padStart(2, '0')}`;
        const newEvents = [];
        for (let i = 0; i < 6; i++) {
          if (newLiveOn && newLiveOn[i] !== prevA[i]) {
            const ev = buildLivePressEvent(i + 1, 0, newLiveOn[i],
              savedSwModesRef.current, savedSwParamsRef.current);
            if (ev) newEvents.push({ ...ev, time });
          }
          if (newLiveOn2 && newLiveOn2[i] !== prevB[i]) {
            const ev = buildLivePressEvent(i + 1, 1, newLiveOn2[i],
              savedSwModesRef.current, savedSwParamsRef.current);
            if (ev) newEvents.push({ ...ev, time });
          }
          if (newLiveOn3 && newLiveOn3[i] !== prevC[i]) {
            const ev = buildLivePressEvent(i + 1, 2, newLiveOn3[i],
              savedSwModesRef.current, savedSwParamsRef.current);
            if (ev) newEvents.push({ ...ev, time });
          }
          if (newMomentaryCount && newMomentaryCount[i] !== prevM[i]) {
            const delta = (newMomentaryCount[i] - prevM[i] + 65536) % 65536;
            const n = Math.min(delta, 5);
            for (let k = 0; k < n; k++) {
              const ev = buildLivePressEvent(i + 1, 0, true,
                savedSwModesRef.current, savedSwParamsRef.current);
              if (ev) newEvents.push({ ...ev, time });
            }
          }
          if (newSingleCount && newSingleCount[i] !== swSingleCountRef.current[i]) {
            const prevS = swSingleCountRef.current[i];
            const delta = (newSingleCount[i] - prevS + 65536) % 65536;
            const n = Math.min(delta, 5);
            for (let k = 0; k < n; k++) {
              const ev = buildLivePressEvent(i + 1, 0, true,
                savedSwModesRef.current, savedSwParamsRef.current);
              if (ev) newEvents.push({ ...ev, time });
            }
          }
          if (newTapCount && newTapCount[i] !== swTapCountRef.current[i]) {
            const prevT = swTapCountRef.current[i];
            const delta = (newTapCount[i] - prevT + 65536) % 65536;
            const n = Math.min(delta, 8);
            for (let k = 0; k < n; k++) {
              const ev = buildLivePressEvent(i + 1, 0, true,
                savedSwModesRef.current, savedSwParamsRef.current);
              if (ev) newEvents.push({ ...ev, time });
            }
          }
          if (newSpinState && newSpinState[i] !== swSpinStateRef.current[i] &&
              newSpinState[i] >= 0) {
            const ev = buildLivePressEvent(i + 1, 0, newSpinState[i],
              savedSwModesRef.current, savedSwParamsRef.current);
            if (ev) newEvents.push({ ...ev, time });
          }
        }
        if (newEvents.length) { setLiveEvents(newEvents); setMonitorKind('live'); }
      }
      if (liveEventsTagRef.current !== newTag) {
        if (liveEventsTagRef.current) setLiveEvents([]);
        liveEventsTagRef.current = newTag;
      }
      if (newLiveOn) {
        swLiveOnRef.current = newLiveOn;
        setSwLiveOn((cur) => (sameArr6(cur, newLiveOn) ? cur : newLiveOn));
      }
      if (newLiveOn2) {
        swLiveOn2Ref.current = newLiveOn2;
        setSwLiveOn2((cur) => (sameArr6(cur, newLiveOn2) ? cur : newLiveOn2));
      }
      if (newLiveOn3) {
        swLiveOn3Ref.current = newLiveOn3;
        setSwLiveOn3((cur) => (sameArr6(cur, newLiveOn3) ? cur : newLiveOn3));
      }
      if (newMomentaryCount) swMomentaryCountRef.current = newMomentaryCount;
      if (newSingleCount) swSingleCountRef.current = newSingleCount;
      if (newTapCount) swTapCountRef.current = newTapCount;
      if (newSpinState) {
        swSpinStateRef.current = newSpinState;
        setSwSpinState((cur) => {
          for (let i = 0; i < 6; i++) {
            if (cur[i] !== newSpinState[i]) return newSpinState;
          }
          return cur;
        });
      }
      if (newLastSingle !== null) {
        setLastSingleSw((cur) => (cur === newLastSingle ? cur : newLastSingle));
      }

      // Troca de preset detectada pelo poll (footswitch fisico) — recarrega
      // meta/data/sw_modes/sw_display/sw_params via /bank/current.
      if (currentTagRef.current !== newTag) {
        currentTagRef.current = newTag;
        loadBankCurrent();
      }
    } catch {/* preview */}
    finally { loadBankLiveBusyRef.current = false; }
  };

  // Polling enquanto a page de preset esta ativa. Usa /bank/live (leve);
  // o /bank/current so eh chamado em troca de preset detectada. Pausa
  // quando a aba esta em background (document.hidden) — economiza
  // bateria do device e banda do WiFi.
  //
  // GATE: so faz polling se ha transport ativo (USB conectado OU HTTP
  // online). Sem isso, em modo "USB only" antes do usuario clicar pra
  // conectar, o polling tentava bfmidi.local via HTTP e spamava o
  // console com ERR_NAME_NOT_RESOLVED.
  useEffect(() => {
    // Roda no PRESET (editor) e tambem no SYSTEM (card MONITOR MIDI em
    // PRINCIPAL precisa do poll pra atualizar ao vivo ao pisar no pedal).
    if (page !== 'preset_config' && page !== 'system_config') return;
    const hasTransport = (usbState === 'connected') || (deviceState === 'online');
    if (!hasTransport) return;
    let id = null;
    const start = () => {
      if (id) return;
      loadBankLive();
      id = setInterval(() => { loadBankLive(); }, 1500);
    };
    const stop = () => {
      if (id) { clearInterval(id); id = null; }
    };
    const onVis = () => {
      if (document.hidden) stop();
      else start();
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [page, usbState, deviceState]);

  const selectBank = async (li, pn) => {
    setBankState('loading');
    try {
      const tag = `${String.fromCharCode(65 + li)}${pn}`;
      const bank = await apiCall('POST', `/bank/current?bank=${encodeURIComponent(tag)}`);
      const eli = Number(bank.bank_letter_index) || li;
      const epn = Number(bank.preset_number) || pn;
      setBankLetterIndex(eli);
      setPresetNumber(epn);
      currentTagRef.current = `${String.fromCharCode(65 + eli)}${epn}`;
      setBankData(bank.data || '');
      setBankDisplayName(bank.meta?.name || '');
      if (bank.meta) {
        const m = metaFromApi(bank.meta);
        setCurrentSavedMeta(m);
        setLayer2Enabled(!!m.layer2);
      }
      // Invalida o cache metaByTag do PresetEditorCard pra forcar re-fetch
      // do tag atual — sem isso, revisitar um preset ja visitado mostra
      // dados stale no NowPlayingCard (presetMeta vem do handle, que vem
      // do cache, que nao re-busca enquanto o tag nao mudar).
      setPresetReloadToken((v) => v + 1);
      if (Array.isArray(bank.sw_live_on)) {
        setSwLiveOn(Array.from({ length: 6 }, (_, i) => Number(bank.sw_live_on[i]) === 1));
      }
      if (Array.isArray(bank.sw_live_on2)) {
        setSwLiveOn2(Array.from({ length: 6 }, (_, i) => Number(bank.sw_live_on2[i]) === 1));
      }
      if (Array.isArray(bank.sw_live_on3)) {
        setSwLiveOn3(Array.from({ length: 6 }, (_, i) => Number(bank.sw_live_on3[i]) === 1));
      }
      // Reset dos contadores de momentary / single apos troca de preset
      // (firmware tambem zera em swActiveSendInitialMidi).
      if (Array.isArray(bank.sw_momentary_count)) {
        swMomentaryCountRef.current = Array.from({ length: 6 },
          (_, i) => Number(bank.sw_momentary_count[i]) || 0);
      } else {
        swMomentaryCountRef.current = [0, 0, 0, 0, 0, 0];
      }
      if (Array.isArray(bank.sw_single_count)) {
        swSingleCountRef.current = Array.from({ length: 6 },
          (_, i) => Number(bank.sw_single_count[i]) || 0);
      } else {
        swSingleCountRef.current = [0, 0, 0, 0, 0, 0];
      }
      if (Array.isArray(bank.sw_tap_count)) {
        swTapCountRef.current = Array.from({ length: 6 },
          (_, i) => Number(bank.sw_tap_count[i]) || 0);
      } else {
        swTapCountRef.current = [0, 0, 0, 0, 0, 0];
      }
      if (Array.isArray(bank.sw_spin_state)) {
        swSpinStateRef.current = Array.from({ length: 6 },
          (_, i) => Number(bank.sw_spin_state[i]));
      } else {
        swSpinStateRef.current = [-1, -1, -1, -1, -1, -1];
      }
      setSwSpinState(swSpinStateRef.current);
      if (typeof bank.last_single_sw !== 'undefined') {
        setLastSingleSw(Number(bank.last_single_sw));
      } else {
        setLastSingleSw(-1);
      }
      // Troca explicita de preset: limpa o log de presses em LIVE MODE
      // (era do preset anterior) e fixa o novo tag pro detector.
      setLiveEvents([]);
      liveEventsTagRef.current = currentTagRef.current;
      // Troca de banco eh acao explicita do usuario: descarta edicao nao
      // salva do preset anterior e reseta o editor pro Layer 1 (mesmo
      // que o device tambem faz em swBankApplyPreset). Bucketa L1/L2.
      setEditorLayer(1);
      editorLayerRef.current = 1;
      const l1Modes = parseSwModesStr(bank.meta?.sw_modes);
      const l2Modes = parseSwModesStr(bank.meta?.sw_modes_l2 || '0,0,0,0,0,0');
      setSwModes(l1Modes); setSavedSwModes(l1Modes);
      setSwModesL2(l2Modes); setSavedSwModesL2(l2Modes);
      const dispL1 = parseSwDisplayFromMeta(bank.meta || {}, '');
      const dispL2 = parseSwDisplayFromMeta(bank.meta || {}, 'L2');
      setSwDisplay(dispL1); setSavedSwDisplay(dispL1);
      setSwDisplayL2(dispL2); setSavedSwDisplayL2(dispL2);
      // Troca explicita de preset: recarrega tambem os params de SW
      // (descarta edicao nao salva do preset anterior). loadSwParams
      // bucketa por editorLayerRef = 1 (acabamos de setar).
      loadSwParams(currentTagRef.current);
      setBankState('idle');
    } catch {
      // Update local state in preview mode
      setBankLetterIndex(li);
      setPresetNumber(pn);
      setBankState('error');
      setTimeout(() => setBankState('idle'), 1200);
    }
  };
  // Igual ao hardware (swBankNextEnabledLetter em SW_BANK.h): a partir de
  // current+1, dando a volta, vai pro primeiro banco HABILITADO (bankLetterEnabled);
  // se nenhum outro estiver habilitado, fica no atual (sem ciclar).
  const nextBankLetter = () => {
    let next = bankLetterIndex;
    for (let step = 1; step <= BANK_LETTER_COUNT; step++) {
      const cand = (bankLetterIndex + step) % BANK_LETTER_COUNT;
      if (bankLetterEnabled[cand]) { next = cand; break; }
    }
    selectBank(next, presetNumber);
  };
  // Espelho do nextBankLetter no sentido CONTRÁRIO (sub-botão ◀◀ do bank
  // tile): a partir de current-1, dando a volta, vai pro primeiro banco
  // habilitado; se nenhum outro estiver habilitado, fica no atual.
  const prevBankLetter = () => {
    let next = bankLetterIndex;
    for (let step = 1; step <= BANK_LETTER_COUNT; step++) {
      const cand = (bankLetterIndex - step + BANK_LETTER_COUNT) % BANK_LETTER_COUNT;
      if (bankLetterEnabled[cand]) { next = cand; break; }
    }
    selectBank(next, presetNumber);
  };

  // Alterna o modo PRESET/LIVE no hardware. Atualiza local na hora
  // (feedback instantaneo) e reconcilia com a resposta do firmware —
  // assim o poll de /bank/current nao reverte o estado por uma janela.
  // Com sync OFF, alterna so o estado local — nao posta /mode.
  const setDeviceSwitchMode = async (mode) => {
    setSwitchMode(mode);
    if (!modeSync) return;
    try {
      const resp = await apiCall('POST', `/mode?value=${mode === 'live' ? 1 : 0}`);
      if (resp && typeof resp.switch_mode !== 'undefined') {
        setSwitchMode(Number(resp.switch_mode) === 1 ? 'live' : 'preset');
      }
    } catch {/* preview/offline — mantem o estado local */}
  };

  // ── WIFI ──
  const loadWifiStatus = async () => {
    try {
      const s = await apiCall('GET', '/wifi/status');
      setWifiStatus(s);
      if (s.sta_ssid) setWifiSsid(s.sta_ssid);
    } catch { setWifiStatus(null); }
  };
  useEffect(() => { if (page === 'system_config') loadWifiStatus(); }, [page, usbState]);

  const scanWifiNetworks = async () => {
    setWifiState('scanning');
    // O firmware faz scan ASSINCRONO: a 1a chamada dispara, as seguintes
    // respondem {scanning:true} ate ficar pronto. Faz polling resiliente
    // (ignora falhas transitorias — o radio pode piscar o AP durante o
    // scan). Compat: firmware antigo (bloqueante) ja devolve networks sem
    // o campo 'scanning' -> o loop quebra na 1a iteracao.
    const deadline = Date.now() + 16000;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let networks = null;
    try {
      let data = await apiCall('GET', '/wifi/scan');  // inicia o scan
      while (Date.now() < deadline) {
        if (data && !data.scanning) {
          networks = Array.isArray(data.networks) ? data.networks : [];
          break;
        }
        await sleep(1200);
        try {
          data = await apiCall('GET', '/wifi/scan');
        } catch {
          data = null;  // hiccup do AP durante o scan — tenta de novo
        }
      }
    } catch {/* falha na chamada inicial -> cai pro error abaixo */}

    if (networks) {
      setWifiNetworks(networks);
      if (!wifiSsid && networks[0]) setWifiSsid(networks[0].ssid);
      setWifiState('idle');
    } else {
      setWifiState('error');
      setTimeout(() => setWifiState('idle'), 1400);
    }
  };

  const connectWifiSta = async () => {
    setWifiState('connecting');
    try {
      const body = new URLSearchParams();
      body.set('ssid', wifiSsid);
      body.set('password', wifiPassword);
      const s = await apiCall('POST', '/wifi/connect', body);
      setWifiStatus(s);
      const ok = !!s.sta_connected;
      setWifiState(ok ? 'connected' : 'error');
      // Popup com o resultado (sucesso -> instruções + IP; falha -> motivo).
      setWifiResult({ ok, ip: s.sta_ip || '', ssid: wifiSsid,
                      code: Number(s.status_code),
                      reason: Number(s.reason) || 0 });
      setTimeout(() => setWifiState('idle'), 1600);
    } catch {
      // Sem resposta — pode ser FALSO negativo: quando a STA associa, o
      // softAP migra pro canal do roteador e o HTTP via AP cai no meio da
      // resposta (o pedal CONECTOU mas o popup dizia falha). E em SUCESSO o
      // pedal ainda REINICIA sozinho ~1,2s após responder — então re-consulta
      // o status VÁRIAS vezes (cobre o reboot + reconexão do AP) antes de
      // declarar derrota. 2 respostas explícitas "não conectado" = falha real
      // (o pedal está no ar e respondendo).
      let s = null;
      let explicitFalses = 0;
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        let cur = null;
        try {
          cur = await apiCall('GET', '/wifi/status');
        } catch {/* pedal reiniciando / AP voltando — tenta de novo */}
        if (cur && cur.sta_connected) { s = cur; break; }
        if (cur) { explicitFalses++; if (explicitFalses >= 2) break; }
      }
      if (s && s.sta_connected) {
        setWifiStatus(s);
        setWifiState('connected');
        setWifiResult({ ok: true, ip: s.sta_ip || '', ssid: wifiSsid,
                        code: Number(s.status_code), reason: 0 });
      } else {
        setWifiState('error');
        setWifiResult({ ok: false, ip: '', ssid: wifiSsid, code: -1,
                        reason: s ? (Number(s.reason) || 0) : 0 });
      }
      setTimeout(() => setWifiState('idle'), 1600);
    }
  };

  // ── SAVE ──
  // Monta o corpo (URLSearchParams) do POST /config/global a partir do estado
  // atual. Extraído pra ser reusado pelo save E pelo backup/restore das configs
  // globais (export = este corpo como JSON; import = POST do JSON de volta).
  const buildGlobalConfigBody = () => {
      const body = new URLSearchParams();
      body.set('board', model);
      body.set('led_brightness', String(brightnessPercentToByte(brightness)));
      body.set('bank_led_color', String(bankLedColor));
      body.set('live_led_color', String(liveLedColor));
      body.set('led_color_mode', ledColorMode === 'numeros' ? '1' : '0');
      letterLedColors.forEach((id, i) => body.set(`letter_led_${i}`, String(id)));
      switchLedColors.forEach((id, i) => body.set(`switch_led_${i}`, String(id)));
      body.set('auto_start_enabled', autoStartEnabled ? '1' : '0');
      body.set('auto_start_bank', String(autoStartBank));
      body.set('auto_start_preset', String(autoStartPreset));
      body.set('auto_start_mode', autoStartMode === 'live' ? '1' : '0');
      bankLetterEnabled.forEach((on, i) => body.set(`bank_letter_enabled_${i}`, on ? '1' : '0'));
      body.set('bank_change_mode', String(bankChangeMode));
      body.set('switch_operation_mode', String(switchOperationMode));
      body.set('hybrid_switch_layout', String(hybridSwitchLayout));
      body.set('led_preview_live_mode', ledPreviewLive ? '1' : '0');
      body.set('led_preview_live_level', String(Math.round(clamp(ledPreviewLiveLevel, 0, 100) / 100 * 255)));
      body.set('layer2_led_color', String(layer2LedColor));
      body.set('gig_view', gigView === 'preset' ? '1' : gigView === 'live' ? '2' : '0');
      body.set('name_preset_live', namePresetLive ? '1' : '0');
      body.set('name_preset_bank', namePresetBank ? '1' : '0');
      body.set('live_layout',
               liveLayout === 2 ? '2' : liveLayout === 3 ? '3' :
               liveLayout === 4 ? '4' : liveLayout === 5 ? '5' : '1');
      body.set('preset_layout',
               String(presetLayout >= 0 && presetLayout <= 6 ? presetLayout : 0));
      body.set('custom_live', serializeCustomLayout(liveCustomLayout));
      body.set('custom_preset', serializeCustomLayout(presetCustomLayout));
      body.set('icon_shape', String(iconShapeToNum(iconShape)));
      body.set('preset_icon_shape', String(iconShapeToNum(presetIconShape)));
      body.set('match_mode', String(matchMode));
      body.set('match_omit_unnamed', matchOmitUnnamed ? '1' : '0');
      body.set('kemper_get_names', kemperGetNames ? '1' : '0');
      body.set('kemper_tuner_style', String(kemperTunerStyle));
      body.set('kemper_tuner_speed', String(kemperTunerSpeed));
      body.set('kemper_follow_pc', kemperFollowPc ? '1' : '0');
      body.set('nano_sw6_global', nanoSw6Global ? '1' : '0');
      body.set('host_reverse_midi', hostReverseMidi ? '1' : '0');
      body.set('host_ctrl_enabled', hostCtrlEnabled ? '1' : '0');
      body.set('micro_remap', String(microRemap));
      body.set('display_invert', displayInvert ? '1' : '0');
      body.set('bpm_card_secs', String(bpmCardSecs));
      body.set('bpm_card_avg', bpmCardAvg ? '1' : '0');
      body.set('ext_indic_show1', String(extIndicShows[0]));
      body.set('ext_indic_show2', String(extIndicShows[1]));
      body.set('ext_indic_on_color1', String(extIndicOnColors[0]));
      body.set('ext_indic_on_color2', String(extIndicOnColors[1]));
      body.set('ext_indic_off_color1', String(extIndicOffColors[0]));
      body.set('ext_indic_off_color2', String(extIndicOffColors[1]));
      body.set('ext_indic_font_size1', String(extIndicFontSizes[0]));
      body.set('ext_indic_font_size2', String(extIndicFontSizes[1]));
      body.set('ext_indic_sigla1', extIndicSiglas[0] || '');
      body.set('ext_indic_sigla2', extIndicSiglas[1] || '');
      body.set('ext_indic_x1', String(extIndicX[0]));
      body.set('ext_indic_y1', String(extIndicY[0]));
      body.set('ext_indic_x2', String(extIndicX[1]));
      body.set('ext_indic_y2', String(extIndicY[1]));
      matchChannels.forEach((idx, i) => body.set(`match_channel_${i}`, String(idx)));
      matchLiveCc.forEach((v, i) => body.set(`match_live_cc_${i}`, String(v)));
      body.set('sw_global_mode', globalSwMode);
      body.set('sw_global_params',
               swParamsToGlobalBlob(globalSwParams[globalSwMode] || DEFAULT_SW_PARAMS(globalSwMode)));
      body.set('sw_global_display', serializeSwDisplayOne(globalSwDisplay));
      body.set('live_pin_global2', livePinGlobal2 ? '1' : '0');
      body.set('sw_global2_mode', global2SwMode);
      body.set('sw_global2_params',
               swParamsToGlobalBlob(global2SwParams[global2SwMode] || DEFAULT_SW_PARAMS(global2SwMode)));
      body.set('sw_global2_display', serializeSwDisplayOne(global2SwDisplay));
      body.set('exp_enabled', expEnabled ? '1' : '0');
      body.set('exp_cc', String(expCc));
      body.set('exp_channel', String(expChannel));
      body.set('exp_cal_min', String(expCalMin));
      body.set('exp_cal_max', String(expCalMax));
      body.set('ext1_mode', ext1Mode);
      body.set('ext1_params', swParamsToGlobalBlob(ext1Params[ext1Mode] || DEFAULT_SW_PARAMS(ext1Mode)));
      body.set('ext1_reset_on_preset', ext1ResetOnPreset ? '1' : '0');
      body.set('ext2_mode', ext2Mode);
      body.set('ext2_params', swParamsToGlobalBlob(ext2Params[ext2Mode] || DEFAULT_SW_PARAMS(ext2Mode)));
      body.set('ext2_reset_on_preset', ext2ResetOnPreset ? '1' : '0');
      LED_COLORS.forEach((c) => body.set(`color_${c.id}`, c.rgb.join(',')));
      return body;
  };

  // Configs globais como objeto {chave: valor} (formato do POST /config/global),
  // pra entrar no pacote de backup. No restore, o restaurador compara este mesmo
  // formato (atual vs backup) e só regrava se diferente. Ver BackupRestoreCard.
  const getGlobalConfigForBackup = () => Object.fromEntries(buildGlobalConfigBody());

  const saveGlobalConfig = async () => {
    const signatureAtSave = globalConfigSignature;
    setSaveState('saving');
    try {
      const body = buildGlobalConfigBody();

      await apiCall('POST', '/config/global', body);

      // Salva também trigger /save (persistência em flash). Opcional.
      try { await apiCall('POST', '/save'); } catch {/* opcional */}

      // Se o usuário preencheu nova senha WiFi, conecta também
      if (page === 'system_config' && wifiSsid && wifiPassword) {
        const wb = new URLSearchParams();
        wb.set('ssid', wifiSsid);
        wb.set('password', wifiPassword);
        try {
          const s = await apiCall('POST', '/wifi/connect', wb);
          setWifiStatus(s);
          setWifiState(s.sta_connected ? 'connected' : 'error');
        } catch {/* opcional */}
      }

      // deviceState (WiFi) e atualizado pelo pingHttp; saveState reflete o
      // resultado da operacao em si.
      // Salvou: o estado atual vira o novo baseline (limpa o 'dirty').
      globalBaselineRef.current = signatureAtSave;
      setGlobalDirty(globalConfigSignatureRef.current !== signatureAtSave);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1100);
    } catch {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 1400);
    }
  };

  // ── SALVAMENTO AUTOMATICO ─────────────────────────────────────────
  // Cada editor conserva seu fluxo de persistencia e seu indicador visual.
  // O debounce agrupa digitacao/sliders; a assinatura por editor impede
  // retry infinito depois de erro e agenda outro save se houve nova edicao.
  const autoSaveGlobalAttemptRef = useRef('');
  const autoSaveLiveAttemptRef = useRef('');
  const autoSavePresetAttemptRef = useRef('');

  useEffect(() => {
    if (!autoSaveEnabled || !globalDirty || saveState === 'saving') return;
    if (autoSaveGlobalAttemptRef.current === globalConfigSignature) return;
    const timer = setTimeout(() => {
      autoSaveGlobalAttemptRef.current = globalConfigSignature;
      saveGlobalConfig();
    }, AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // saveGlobalConfig e recriada a cada render; a assinatura contem todos os
    // valores usados por ela e e a dependencia intencional do debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSaveEnabled, globalDirty, globalConfigSignature, saveState]);

  useEffect(() => {
    if (!autoSaveEnabled || !liveDirty || swModesStatus === 'saving') return;
    if (autoSaveLiveAttemptRef.current === liveConfigSignature) return;
    const timer = setTimeout(() => {
      autoSaveLiveAttemptRef.current = liveConfigSignature;
      saveLive();
    }, AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSaveEnabled, liveDirty, liveConfigSignature, swModesStatus]);

  useEffect(() => {
    const handle = presetSaveRef.current;
    const signature = handle && handle.meta ? JSON.stringify(handle.meta) : '';
    if (!autoSaveEnabled || !handle || !handle.save || !handle.isDirty ||
        handle.status === 'saving' || !signature) return;
    if (autoSavePresetAttemptRef.current === signature) return;
    const timer = setTimeout(() => {
      const current = presetSaveRef.current;
      if (!current || !current.save || !current.isDirty || current.status === 'saving') return;
      autoSavePresetAttemptRef.current = signature;
      current.save();
    }, AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoSaveEnabled, presetSaveRevision, presetSaveStatus]);

  // Cor do LED do banco/preset selecionado. NAO pinta mais o estado ativo
  // (que fica sempre laranja, o --accent default) — entra so na "bolinha" do
  // canto sup. direito das molduras de banco/preset, via CSS var --bank-led.
  // Modo POR LETRA → cor da letra ativa.
  // Modo POR SWITCH → cor do switch correspondente ao preset ativo.
  const currentTileColor = (() => {
    const safeColor = (idx, fallback = '#ff7a1a') =>
      (LED_COLORS[idx] && LED_COLORS[idx].hex) || fallback;
    const letterIdx = (letterLedColors && letterLedColors[bankLetterIndex]) ?? 7;
    if (ledColorMode === 'numeros' && switchLedColors) {
      const swIdx = switchLedColors[presetNumber - 1];
      return safeColor(swIdx, safeColor(letterIdx));
    }
    return safeColor(letterIdx);
  })();
  const currentSystemTheme = getSystemTheme(systemTheme);

  return (
    <div className="phone-frame">
      <div className={
        'bf-screen'
        + (iconShape === 'circle' ? ' is-icon-circle' : '')
        + (currentSystemTheme.light ? ' is-theme-light' : '')
      } style={{
        // So a "bolinha" de LED (canto sup. dir. das molduras de banco/preset)
        // usa essa cor. O resto da UI (estados ativos, --tile-color, --accent)
        // fica sempre laranja — nao acompanha mais a cor do LED escolhida.
        '--bank-led': currentTileColor,
        '--accent': currentSystemTheme.accent,
        '--accent-2': currentSystemTheme.accent2,
        '--accent-hi': currentSystemTheme.hi,
        '--accent-lo': currentSystemTheme.lo,
        '--bg': currentSystemTheme.bg,
        '--screen': currentSystemTheme.screen,
        '--card': currentSystemTheme.card,
        '--card-2': currentSystemTheme.card2,
        '--card-3': currentSystemTheme.card3,
        '--text': currentSystemTheme.text || '#f6f6f8',
        '--muted': currentSystemTheme.muted || 'rgba(235,235,245,0.6)',
        '--faint': currentSystemTheme.faint || 'rgba(235,235,245,0.32)',
        '--ghost': currentSystemTheme.ghost || 'rgba(235,235,245,0.18)',
        '--hair': currentSystemTheme.hair || 'rgba(255,255,255,0.07)',
        '--hair-strong': currentSystemTheme.hairStrong || 'rgba(255,255,255,0.12)',
        '--screen-glow-a': currentSystemTheme.glowA,
        '--screen-glow-b': currentSystemTheme.glowB,
      }}>
        {page === 'preset_config' && (
          <PagePresetConfig
            onOpenWifi={openWifiSettings}
            bankLetterIndex={bankLetterIndex}
            presetNumber={presetNumber}
            bankData={bankData}
            bankDisplayName={bankDisplayName}
            bankState={bankState}
            deviceState={deviceState}
            usbState={usbState}
            onToggleUsb={toggleUsb}
            presetCount={presetCountEdit}
            onNextLetter={nextBankLetter}
            onPrevLetter={prevBankLetter}
            onSelectPreset={(n) => selectBank(bankLetterIndex, n)}
            connectionMode={connectionMode}
            onToggleConnectionMode={toggleConnectionMode}
            onDisplayNameChange={setBankDisplayName}
            onRegisterPresetSave={registerPresetSave}
            presetReloadToken={presetReloadToken}
            switchMode={switchMode}
            onSetSwitchMode={setDeviceSwitchMode}
            modeSync={modeSync}
            onToggleModeSync={() => setModeSync((v) => !v)}
            systemTheme={systemTheme}
            onToggleTheme={toggleSystemTheme}
            swModes={swModes}
            savedSwModes={savedSwModes}
            onSetSwMode={setSwMode}
            swParams={swParams}
            savedSwParams={savedSwParams}
            onSetSwParam={setSwParam}
            swLiveOn={swLiveOn}
            lastSingleSw={lastSingleSw}
            swSpinState={swSpinState}
            swDisplay={swDisplay}
            onSetSwDisplay={setSwDisplayOne}
            ledPreviewLive={ledPreviewLive}
            editorLayer={editorLayer}
            onSetEditorLayer={toggleEditorLayer}
            layer2Enabled={layer2Enabled}
            hasExtIndicators={hasExtDual}
          />
        )}
        {page === 'global_config' && (
          <PageGlobalConfig
            onOpenWifi={openWifiSettings}
            boardName={model}
            brightness={brightness} setBrightness={setBrightness}
            autoStartEnabled={autoStartEnabled} setAutoStartEnabled={setAutoStartEnabled}
            autoStartMode={autoStartMode} setAutoStartMode={setAutoStartMode}
            autoStartBank={autoStartBank} setAutoStartBank={setAutoStartBank}
            autoStartPreset={autoStartPreset} setAutoStartPreset={setAutoStartPreset}
            bankLetterEnabled={bankLetterEnabled} setBankLetterEnabled={setBankLetterEnabled}
            bankChangeMode={bankChangeMode} setBankChangeMode={setBankChangeMode}
            ledColorMode={ledColorMode} setLedColorMode={setLedColorMode}
            letterLedColors={letterLedColors} setLetterLedColors={setLetterLedColors}
            switchLedColors={switchLedColors} setSwitchLedColors={setSwitchLedColors}
            ledPreviewLive={ledPreviewLive} setLedPreviewLive={setLedPreviewLive}
            ledPreviewLiveLevel={ledPreviewLiveLevel} setLedPreviewLiveLevel={setLedPreviewLiveLevel}
            liveLedColor={liveLedColor} setLiveLedColor={setLiveLedColor}
            layer2LedColor={layer2LedColor} setLayer2LedColor={setLayer2LedColor}
            gigView={gigView} setGigView={setGigView}
            namePresetLive={namePresetLive} setNamePresetLive={setNamePresetLive}
            namePresetBank={namePresetBank} setNamePresetBank={setNamePresetBank}
            iconShape={iconShape} setIconShape={setIconShape}
            presetIconShape={presetIconShape} setPresetIconShape={setPresetIconShape}
            liveLayout={liveLayout} setLiveLayout={setLiveLayout}
            presetLayout={presetLayout} setPresetLayout={setPresetLayout}
            liveCustomLayout={liveCustomLayout} setLiveCustomLayout={setLiveCustomLayout}
            presetCustomLayout={presetCustomLayout} setPresetCustomLayout={setPresetCustomLayout}
            bpmCardSecs={bpmCardSecs} setBpmCardSecs={setBpmCardSecs}
            bpmCardAvg={bpmCardAvg} setBpmCardAvg={setBpmCardAvg}
            extIndicShows={extIndicShows} setExtIndicShows={setExtIndicShows}
            extIndicOnColors={extIndicOnColors} setExtIndicOnColors={setExtIndicOnColors}
            extIndicOffColors={extIndicOffColors} setExtIndicOffColors={setExtIndicOffColors}
            extIndicFontSizes={extIndicFontSizes} setExtIndicFontSizes={setExtIndicFontSizes}
            extIndicSiglas={extIndicSiglas} setExtIndicSiglas={setExtIndicSiglas}
            extIndicX={extIndicX} setExtIndicX={setExtIndicX}
            extIndicY={extIndicY} setExtIndicY={setExtIndicY}
            matchMode={matchMode} setMatchMode={setMatchMode}
            matchOmitUnnamed={matchOmitUnnamed} setMatchOmitUnnamed={setMatchOmitUnnamed}
            matchChannels={matchChannels} setMatchChannels={setMatchChannels}
            matchLiveCc={matchLiveCc} setMatchLiveCc={setMatchLiveCc}
            kemperGetNames={kemperGetNames} setKemperGetNames={setKemperGetNames}
            kemperTunerStyle={kemperTunerStyle} setKemperTunerStyle={setKemperTunerStyle}
            kemperTunerSpeed={kemperTunerSpeed} setKemperTunerSpeed={setKemperTunerSpeed}
            kemperFollowPc={kemperFollowPc} setKemperFollowPc={setKemperFollowPc}
            nanoSw6Global={nanoSw6Global}
            globalSwMode={globalSwMode} setGlobalSwMode={setGlobalSwMode}
            globalSwParams={globalSwParams} setGlobalSwParams={setGlobalSwParams}
            globalSwDisplay={globalSwDisplay} setGlobalSwDisplay={setGlobalSwDisplay}
            livePinGlobal2={livePinGlobal2}
            global2SwMode={global2SwMode} setGlobal2SwMode={setGlobal2SwMode}
            global2SwParams={global2SwParams} setGlobal2SwParams={setGlobal2SwParams}
            global2SwDisplay={global2SwDisplay} setGlobal2SwDisplay={setGlobal2SwDisplay}
            hasExp={hasExp}
            expEnabled={expEnabled} setExpEnabled={setExpEnabled}
            expCc={expCc} setExpCc={setExpCc}
            expChannel={expChannel} setExpChannel={setExpChannel}
            expCalMin={expCalMin} setExpCalMin={setExpCalMin}
            expCalMax={expCalMax} setExpCalMax={setExpCalMax}
            hasExtDual={hasExtDual}
            ext1Mode={ext1Mode} setExt1Mode={setExt1Mode}
            ext1Params={ext1Params} setExt1Params={setExt1Params}
            ext2Mode={ext2Mode} setExt2Mode={setExt2Mode}
            ext2Params={ext2Params} setExt2Params={setExt2Params}
            ext1ResetOnPreset={ext1ResetOnPreset} setExt1ResetOnPreset={setExt1ResetOnPreset}
            ext2ResetOnPreset={ext2ResetOnPreset} setExt2ResetOnPreset={setExt2ResetOnPreset}
            presetCount={presetCount}
            deviceState={deviceState}
            usbState={usbState}
            onToggleUsb={toggleUsb}
            connectionMode={connectionMode}
            onToggleConnectionMode={toggleConnectionMode}
            systemTheme={systemTheme}
            onToggleTheme={toggleSystemTheme}
          />
        )}
        {page === 'system_config' && (
          <PageSystemConfig
            onOpenWifi={openWifiSettings}
            sysSectionReq={sysSectionReq}
            onSysSectionApplied={() => setSysSectionReq(null)}
            getGlobalConfigForBackup={getGlobalConfigForBackup}
            onBackupRestored={handleBackupRestored}
            model={model} setModel={setModel}
            switchOperationMode={switchOperationMode} setSwitchOperationMode={setSwitchOperationMode}
            hybridSwitchLayout={hybridSwitchLayout} setHybridSwitchLayout={setHybridSwitchLayout}
            nanoSw6Global={nanoSw6Global} setNanoSw6Global={setNanoSw6Global}
            livePinGlobal2={livePinGlobal2} setLivePinGlobal2={setLivePinGlobal2}
            microRemap={microRemap} setMicroRemap={setMicroRemap} hasMicro={hasMicro}
            displayInvert={displayInvert} setDisplayInvert={setDisplayInvert}
            hostReverseMidi={hostReverseMidi} setHostReverseMidi={setHostReverseMidi}
            hostCtrlEnabled={hostCtrlEnabled} setHostCtrlEnabled={setHostCtrlEnabled}
            wifiStatus={wifiStatus} wifiNetworks={wifiNetworks}
            wifiSsid={wifiSsid} setWifiSsid={setWifiSsid}
            wifiPassword={wifiPassword} setWifiPassword={setWifiPassword}
            wifiState={wifiState}
            onWifiScan={scanWifiNetworks}
            onWifiConnect={connectWifiSta}
            deviceState={deviceState}
            usbState={usbState}
            onToggleUsb={toggleUsb}
            connectionMode={connectionMode}
            onToggleConnectionMode={toggleConnectionMode}
            usbHostStatus={usbHostStatus}
            usbHostBusy={usbHostBusy}
            onUsbHostLoad={loadUsbHostStatus}
            onUsbHostRefresh={refreshUsbHostStatus}
            onUsbHostSetMode={setUsbHostMode}
            onUsbHostToggleBle={toggleUsbHostBle}
            onUsbHostSetBleMode={setUsbHostBleMode}
            onUsbHostSetFilter={setUsbHostFilter}
            onUsbHostEnterUpdate={usbHostEnterUpdateMode}
            systemTheme={systemTheme}
            onSetSystemTheme={setSystemTheme}
            onToggleTheme={toggleSystemTheme}
            autoSaveEnabled={autoSaveEnabled}
            onSetAutoSaveEnabled={setAutoSaveEnabled}
            monitorEntry={monitorEntry}
            monitorKind={monitorKind}
            liveEvents={liveEvents}
            onErased={handleErased}
          />
        )}
        <TabBar
          page={page}
          setPage={setPage}
          autoSaveEnabled={autoSaveEnabled}
          saveState={
            page !== 'preset_config'
              ? (saveState === 'idle' && globalDirty ? 'dirty' : saveState)
              : switchMode === 'live'
                ? (swModesStatus === 'idle' && liveDirty ? 'dirty' : swModesStatus)
                : presetSaveStatus}
          onSave={
            page !== 'preset_config' ? saveGlobalConfig
              : switchMode === 'live'
                ? saveLive
                : () => { const h = presetSaveRef.current; if (h && h.save) h.save(); }}
          onCopyPreset={copyCurrentPreset}
          onPastePreset={pasteIntoCurrentPreset}
          presetClipboard={presetClipboard}
          presetClipboardStatus={presetClipboardStatus}
          onCopyBank={copyCurrentBank}
          onPasteBank={pasteIntoCurrentBank}
          bankClipboard={bankClipboard}
          bankClipboardStatus={bankClipboardStatus}
          onCopyLayer={copyCurrentLayer}
          onPasteLayer={pasteIntoCurrentLayer}
          layerClipboard={layerClipboard}
          layerClipboardStatus={layerClipboardStatus}
          editorLayer={editorLayer}
        />
      </div>
      <PasteProgressModal progress={pasteProgress} />
      <DemoControllerModal
        open={demoOpen}
        onClose={() => setDemoOpen(false)}
        model={model}
        switchMode={switchMode}
        onSetSwitchMode={setDeviceSwitchMode}
        bankLetterIndex={bankLetterIndex}
        presetNumber={presetNumber}
        bankDisplayName={bankDisplayName}
        presetCount={presetCountEdit}
        onSelectPreset={(number, targetLetterIndex = bankLetterIndex) =>
          selectBank(targetLetterIndex, number)}
        onPreviousBank={prevBankLetter}
        onNextBank={nextBankLetter}
        swModes={swModes}
        swParams={swParams}
        swDisplay={swDisplay}
        ledColorMode={ledColorMode}
        letterLedColors={letterLedColors}
        switchLedColors={switchLedColors}
        liveLedColor={liveLedColor}
        brightness={brightness}
        displayMeta={presetSaveRef.current?.meta || currentSavedMeta || DEFAULT_PRESET_META()}
        liveLayout={liveLayout}
        presetLayout={presetLayout}
        liveCustomLayout={liveCustomLayout}
        presetCustomLayout={presetCustomLayout}
        namePresetLive={namePresetLive}
        namePresetBank={namePresetBank}
        iconShape={iconShape}
        presetIconShape={presetIconShape}
        gigView={gigView}
        editorLayer={editorLayer}
        swModesL2={swModesL2}
        swParamsL2={swParamsL2}
        swDisplayL2={swDisplayL2}
        bankLetterEnabled={bankLetterEnabled}
        layer2Enabled={layer2Enabled}
        onSetEditorLayer={toggleEditorLayer}
        bankChangeMode={bankChangeMode}
        switchOperationMode={switchOperationMode}
        hybridSwitchLayout={hybridSwitchLayout}
        globalSwMode={globalSwMode}
        globalSwParams={globalSwParams}
        globalSwDisplay={globalSwDisplay}
        layer2LedColor={layer2LedColor}
        livePinGlobal2={livePinGlobal2}
        global2SwMode={global2SwMode}
        global2SwParams={global2SwParams}
        global2SwDisplay={global2SwDisplay}
        bpmCardSecs={bpmCardSecs}
        bpmCardAvg={bpmCardAvg}
        nanoSw6Global={nanoSw6Global}
      />
      {wifiResult && (
        <div className="bf-modal-backdrop" onClick={() => setWifiResult(null)}>
          <div className="bf-modal bf-wifi-result" role="dialog"
               aria-label={t('sys.wifi.title')}
               onClick={(e) => e.stopPropagation()}>
            <div className="bf-modal-head">
              <span className="bf-modal-title">
                {wifiResult.ok ? t('sys.wifi.okTitle') : t('sys.wifi.failTitle')}
              </span>
              <button type="button" className="bf-modal-close"
                      onClick={() => setWifiResult(null)} aria-label={t('common.close')}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                     stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M5 5 L19 19 M19 5 L5 19" />
                </svg>
              </button>
            </div>
            <div className="bf-wifi-result-body">
              <div className={'bf-wifi-result-badge ' + (wifiResult.ok ? 'is-ok' : 'is-fail')}>
                {wifiResult.ok ? (
                  <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
                       stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12.5 L9.5 18 L20 6" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
                       stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M12 6 L12 14 M12 18 L12 18.5" />
                  </svg>
                )}
              </div>
              {wifiResult.ok ? (
                <>
                  <p className="bf-wifi-result-msg">{t('sys.wifi.okMsg')}</p>
                  <div className="bf-wifi-result-addr">
                    <code>bfmidi.local</code>
                    {wifiResult.ip ? <code>{wifiResult.ip}</code> : null}
                  </div>
                </>
              ) : (
                <p className="bf-wifi-result-msg">
                  {(() => {
                    // reason (wifi_err_reason_t do firmware) e mais preciso
                    // que o status_code: 201 = AP nao encontrado/alcance;
                    // 2/15/202/204/205 = autenticacao/handshake (senha).
                    const r = Number(wifiResult.reason) || 0;
                    if (r === 201) return t('sys.wifi.failNoSsid');
                    if (r === 2 || r === 15 || r === 202 || r === 204 ||
                        r === 205) return t('sys.wifi.failAuth');
                    if (wifiResult.code === 1) return t('sys.wifi.failNoSsid');
                    if (wifiResult.code === 4) return t('sys.wifi.failAuth');
                    return t('sys.wifi.failGeneric');
                  })()}
                </p>
              )}
            </div>
            <div className="bf-wifi-result-foot">
              <button type="button" className="bf-btn primary"
                      onClick={() => setWifiResult(null)}>
                {t('common.ok')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
