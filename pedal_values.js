// Rótulos de VALOR enumerado dos pedais do MODO AMIGÁVEL. Diferente de
// pedal_labels.js (nomes do nº de CC): AQUI rotulamos o VALOR enviado a certos
// CCs (Model Select, Cab Select, Channel, Bypass, etc.) com os nomes ORIGINAIS
// em inglês do fabricante. MANTIDO À MÃO (não é gerado — ≠ pedal_labels.js).
//
// Chaveado pela mesma `cc`-key de MATCH_MODE_PEDAL em app.jsx (ex.: 'RUBY63').
// PEDAL_VALUE_LABELS[<ccKey>][<ccNumber>] = { min, max, labels: { <v>: 'Nome' } }
// — mesma forma das defs de kemper_values.js, pra reusar a renderização. Só
// entram CCs com valor ENUMERADO; CCs contínuos (0-127) e toggles on/off
// simples ficam de fora (mostram 0..127 cru). Consumido em app.jsx por
// pedalValueLabelsForKey, dentro de valueLabelsFor → kemperValueOptionElems/
// kemperSnapValue (gateado pelo MODO AMIGÁVEL do canal via pedalEntryForChannel).
//
// `sparse: true` — def por FAIXAS: o CC aceita qualquer valor no [min,max], mas
// só as âncoras rotuladas aparecem no dropdown (ex.: Rhythmic Figure dos VTR:
// 0–31 Quarter · 32–63 Eighth · ...). O renderer pula valores sem rótulo; um
// valor salvo fora das âncoras continua exibido (regra do `current`) e o snap
// não mexe nele (qualquer valor no range é válido).

// Cab Select 0..5 = Cab 1..6, 6 = No Cab (UAFX com 6 cabs: Ruby/Lion/Dream).
const CAB_SELECT_7 = { min: 0, max: 6, labels: {
  0: 'Cab 1', 1: 'Cab 2', 2: 'Cab 3', 3: 'Cab 4', 4: 'Cab 5', 5: 'Cab 6', 6: 'No Cab',
} };
// Cab Select 0..8 = Cab 1..9, 9 = No Cab (UAFX com 9 cabs: Enigmatic '82).
const CAB_SELECT_10 = { min: 0, max: 9, labels: {
  0: 'Cab 1', 1: 'Cab 2', 2: 'Cab 3', 3: 'Cab 4', 4: 'Cab 5',
  5: 'Cab 6', 6: 'Cab 7', 7: 'Cab 8', 8: 'Cab 9', 9: 'No Cab',
} };
// Bypass UAFX: 0 = Bypass, 1 = Unbypass Left FS, 2 = Unbypass Right FS.
const BYPASS_UAFX = { min: 0, max: 2, labels: {
  0: 'Bypass', 1: 'Unbypass Left FS', 2: 'Unbypass Right FS',
} };
// Store UAFX: 0 = Off, 1 = Hold.
const STORE_UAFX = { min: 0, max: 1, labels: { 0: 'Off', 1: 'Hold' } };

// ─── VTR Effects (MIDI Implementation Chart v1.0, jun/2026) ───
// Bypass (CC1): Gold Series usa FAIXAS (0–63 bypass · 64–127 active); Ignis/
// Helios/Venator usam 0/127 exatos. 0 e 127 funcionam em todas as linhas —
// só as duas âncoras entram (sparse).
const BYPASS_VTR = { min: 0, max: 127, sparse: true, labels: {
  0: 'Bypass (OFF)', 127: 'Active (ON)',
} };
// Rhythmic figure / tap subdivision (CC9, só Narciso e Loki — pedais
// time-based; Kailani ignora): faixas de 32 valores.
const RHYTHM_FIGURE_VTR = { min: 0, max: 127, sparse: true, labels: {
  0: 'Quarter (semínima)', 32: 'Eighth (colcheia)',
  64: 'Dotted 8th (pontuada)', 96: 'Triplet (quiáltera)',
} };
// Algorithm select (CC2, Gold Series): zero-indexado, 0..N-1 seleciona e
// >= N satura no último. N = 16 (Kailani) · 12 (Narciso) · 9 (Loki).
const vtrAlgorithms = (n) => ({ min: 0, max: n - 1, labels: Object.fromEntries(
  Array.from({ length: n }, (_, i) => [i, `Algoritmo ${i + 1}`])) });
// Tipo de clipagem (CC2, drives): modos válidos 1..N (1-indexado; 0 não é modo).
const vtrClipping = (n) => ({ min: 1, max: n, labels: Object.fromEntries(
  Array.from({ length: n }, (_, i) => [i + 1, `Clipagem ${i + 1}`])) });

export const PEDAL_VALUE_LABELS = {
  // ─── UAFX Ruby '63 ───
  RUBY63: {
    16: STORE_UAFX,                                                  // Store
    17: { min: 0, max: 2, labels: { 0: 'Brilliant', 1: 'Normal', 2: 'Vibrato' } }, // Channel Select
    18: CAB_SELECT_7,                                                // Cab Select
    19: BYPASS_UAFX,                                                 // Bypass
  },
  // ─── UAFX Enigmatic '82 ───
  ENIGMATIC82: {
    16: STORE_UAFX,                                                 // Store
    17: { min: 0, max: 2, labels: { 0: 'Rock', 1: 'Jazz', 2: 'Custom' } }, // Model Select
    18: CAB_SELECT_10,                                              // Cab Select
    19: BYPASS_UAFX,                                                // Bypass
    20: { min: 0, max: 1, labels: { 0: 'Normal', 1: 'FET' } },      // Channel
    21: { min: 0, max: 3, labels: {                                 // Amp (power amp)
      0: '50W, high plate', 1: '100W low plate, squishy PS',
      2: '100W high plate, stiff PS', 3: '100W low plate, very stiff PS',
    } },
    36: { min: 0, max: 3, labels: { 0: 'None', 1: '150 pf', 2: '196 pf', 3: '300 pf' } }, // Bright
    37: { min: 0, max: 1, labels: { 0: 'Classic', 1: 'Horizon' } }, // Tonestack
  },
  // ─── UAFX Lion '68 ───
  LION68: {
    16: STORE_UAFX,                                                 // Store
    17: { min: 0, max: 2, labels: { 0: 'Bass', 1: 'Lead', 2: 'Brown' } }, // Model Select
    18: CAB_SELECT_7,                                               // Cab Select
    19: BYPASS_UAFX,                                                // Bypass
    21: { min: 0, max: 2, labels: { 0: 'Low', 1: 'High', 2: 'Jumped' } }, // Input
    36: { min: 0, max: 1, labels: { 0: 'On', 1: 'Off' } },          // Ghost Notes
  },
  // ─── UAFX Dream '65 ───
  DREAM65: {
    16: STORE_UAFX,                                                 // Store
    17: { min: 0, max: 2, labels: { 0: 'Lead', 1: 'Stock', 2: 'D-Tex' } }, // Mod Select
    18: CAB_SELECT_7,                                               // Cab Select
    19: BYPASS_UAFX,                                                // Bypass
  },
  // ─── VTR Gold Series (Kailani · Narciso · Loki) ───
  KAILANI: {
    1: BYPASS_VTR,
    2: vtrAlgorithms(16),
  },
  VTR_NARCISO: {
    1: BYPASS_VTR,
    2: vtrAlgorithms(12),
    9: RHYTHM_FIGURE_VTR,
  },
  VTR_LOKI: {
    1: BYPASS_VTR,
    2: vtrAlgorithms(9),
    9: RHYTHM_FIGURE_VTR,
  },
  // ─── VTR Ignis / Helios / Venator ───
  VTR_IGNIS: {
    1: BYPASS_VTR,
    102: { min: 0, max: 127, sparse: true, labels: {   // Afinador (tuner)
      0: 'Afinador OFF', 127: 'Afinador ON',
    } },
  },
  VTR_HELIOS: {
    1: BYPASS_VTR,
    2: vtrClipping(7),
  },
  VTR_VENATOR: {
    1: BYPASS_VTR,
    2: vtrClipping(12),
  },
  // ─── TONEX ONE+ ─── (toggles 0/127 ficam crus; só os enums contíguos entram)
  TONEX_ONE_PLUS: {
    3:  { min: 0, max: 1, labels: { 0: 'Digital', 1: 'Tape' } },   // Delay Type
    33: { min: 0, max: 4, labels: {                                 // Modulation Type
      0: 'Chorus', 1: 'Tremolo', 2: 'Phaser', 3: 'Flanger', 4: 'Rotary',
    } },
    85: { min: 0, max: 5, labels: {                                 // Reverb Type
      0: 'Spring 1', 1: 'Spring 2', 2: 'Spring 3', 3: 'Spring 4', 4: 'Room', 5: 'Plate',
    } },
  },
};

// Retorna a def {min,max,labels} de um CC pra um pedal (cc-key), ou null.
// NÃO checa canal — quem chama (valueLabelsFor) resolve o pedal pelo canal.
export function pedalValueLabelsForKey(ccKey, cc) {
  const pedal = ccKey ? PEDAL_VALUE_LABELS[ccKey] : null;
  if (!pedal) return null;
  return pedal[Number(cc)] || null;
}
