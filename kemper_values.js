// Rótulos de VALOR fixo dos CCs especiais do Kemper (NRPN). Diferente de
// pedal_labels.js (nomes de PC/nº de CC) e kemper_nrpn.js (nomes dos CCs
// 200..321): AQUI rotulamos o VALOR enviado a certos CCs — figuras musicais
// do Transpose e enums/note-values de delay/reverb.
//
// MANTIDO À MÃO (não é gerado). Portado de BFMIDI_FULL_11/PRESET_CONFIG_JS_CORE.h
// (kemperTransposeLabels + kemperCustomLabels). Cada entrada define o range
// válido [min,max] e os rótulos por valor. Consumido em app.jsx por
// kemperValueOptionElems / kemperSnapValue (só quando o canal é Kemper).

// CC do Pitch Transpose (NRPN). Valor = semitons, range 28..100, centro 64.
export const KEMPER_TRANSPOSE_CC = 208;

// Transpose: figuras musicais (28..100). 64 = ORIGINAL (sem transposição).
export const KEMPER_TRANSPOSE_LABELS = {
  min: 28,
  max: 100,
  labels: {
    28: '-3 Oitavas',
    29: '-2 Oit + 11 Semi', 30: '-2 Oit + 10 Semi', 31: '-2 Oit + 9 Semi',
    32: '-2 Oit + 8 Semi', 33: '-2 Oit + 7 Semi', 34: '-2 Oit + 6 Semi',
    35: '-2 Oit + 5 Semi', 36: '-2 Oit + 4 Semi', 37: '-2 Oit + 3 Semi',
    38: '-2 Oit + 2 Semi', 39: '-2 Oit + 1 Semi', 40: '-2 Oitavas',
    41: '-1 Oit + 11 Semi', 42: '-1 Oit + 10 Semi', 43: '-1 Oit + 9 Semi',
    44: '-1 Oit + 8 Semi', 45: '-1 Oit + 7 Semi', 46: '-1 Oit + 6 Semi',
    47: '-1 Oit + 5 Semi', 48: '-1 Oit + 4 Semi', 49: '-1 Oit + 3 Semi',
    50: '-1 Oit + 2 Semi', 51: '-1 Oit + 1 Semi', 52: '-1 Oitava',
    53: '-5 Tons + 1 Semi', 54: '-5 Tons', 55: '-4 Tons + 1 Semi', 56: '-4 Tons',
    57: '-3 Tons + 1 Semi', 58: '-3 Tons', 59: '-2 Tons + 1 Semi', 60: '-2 Tons',
    61: '-1 Tom + 1 Semi', 62: '-1 Tom', 63: '-1 Semitom',
    64: 'ORIGINAL (ZERO)',
    65: '+1 Semitom', 66: '+1 Tom', 67: '+1 Tom + 1 Semi',
    68: '+2 Tons', 69: '+2 Tons + 1 Semi', 70: '+3 Tons', 71: '+3 Tons + 1 Semi',
    72: '+4 Tons', 73: '+4 Tons + 1 Semi', 74: '+5 Tons', 75: '+5 Tons + 1 Semi',
    76: '+1 Oitava', 77: '+1 Oit + 1 Semi', 78: '+1 Oit + 1 Tom',
    79: '+1 Oit + 1T + 1S', 80: '+1 Oit + 2 Tons', 81: '+1 Oit + 2T + 1S',
    82: '+1 Oit + 3 Tons', 83: '+1 Oit + 3T + 1S', 84: '+1 Oit + 4 Tons',
    85: '+1 Oit + 4T + 1S', 86: '+1 Oit + 5 Tons', 87: '+1 Oit + 5T + 1S',
    88: '+2 Oitavas', 89: '+2 Oit + 1 Semi', 90: '+2 Oit + 1 Tom',
    91: '+2 Oit + 1T + 1S', 92: '+2 Oit + 2 Tons', 93: '+2 Oit + 2T + 1S',
    94: '+2 Oit + 3 Tons', 95: '+2 Oit + 3T + 1S', 96: '+2 Oit + 4 Tons',
    97: '+2 Oit + 4T + 1S', 98: '+2 Oit + 5 Tons', 99: '+2 Oit + 5T + 1S',
    100: '+3 Oitavas',
  },
};

// Note-values do delay/reverb (compartilhado por 294/295). 0..20.
const NOTE_VALUES_16 = {
  0: '1/32', 1: '1/16', 2: '2/16', 3: '3/16', 4: '4/16',
  5: '5/16', 6: '6/16 Dotted', 7: '7/16', 8: '8/16', 9: '9/16',
  10: '10/16', 11: '11/16', 12: '12/16 Dotted', 13: '13/16', 14: '14/16',
  15: '15/16', 16: '16/16 (1 bar)', 17: '1/16 Triplet', 18: '1/8 Triplet',
  19: '1/4 Triplet', 20: '1/2 Triplet',
};

// Demais CCs especiais com valores fixos/enum (delay/reverb). Chave = nº do CC.
export const KEMPER_VALUE_LABELS = {
  // ---- DELAY ----
  289: { min: 0, max: 1, labels: { 0: 'Off', 1: 'On' } },          // Tempo Sync
  291: { min: 0, max: 1, labels: { 0: 'Off', 1: 'On' } },          // Freeze
  292: { min: 0, max: 2, labels: { 0: 'Normal', 1: 'Analog', 2: 'Tape' } }, // Cut Character
  293: { min: 0, max: 1, labels: { 0: 'Pre', 1: 'Post' } },        // Ducking Position
  294: { min: 0, max: 20, labels: NOTE_VALUES_16 },                // Note Value 1
  295: { min: 0, max: 20, labels: NOTE_VALUES_16 },                // Note Value 2
  // ---- REVERB ----
  297: { min: 0, max: 1, labels: { 0: 'Pre', 1: 'Post' } },        // Position
  298: { min: 0, max: 1, labels: { 0: 'Off', 1: 'On' } },          // Tempo Sync
  299: { min: 0, max: 1, labels: { 0: 'Off', 1: 'On' } },          // Freeze
  300: { min: 0, max: 1, labels: { 0: 'Off', 1: 'On' } },          // Infinity
  301: { min: 0, max: 1, labels: { 0: 'Off', 1: 'On' } },          // Reverse
  302: { min: 0, max: 1, labels: { 0: 'Pre', 1: 'Post' } },        // Ducking Position
  303: { min: 0, max: 15, labels: {                                // Predelay Note Value
    0: '1/64', 1: '1/32', 2: '1/16', 3: '1/8', 4: '1/4', 5: '1/2', 6: '1/1',
    7: '1/64 Dotted', 8: '1/32 Dotted', 9: '1/16 Dotted', 10: '1/8 Dotted', 11: '1/4 Dotted',
    12: '1/64 Triplet', 13: '1/32 Triplet', 14: '1/16 Triplet', 15: '1/8 Triplet',
  } },
};

// Retorna a definição de rótulos {min,max,labels} de um CC, ou null. Trata o
// Transpose (208) à parte. NÃO checa canal — quem chama gateia por isKemperChannel.
export function kemperValueLabelsFor(cc) {
  const n = Number(cc);
  if (n === KEMPER_TRANSPOSE_CC) return KEMPER_TRANSPOSE_LABELS;
  return KEMPER_VALUE_LABELS[n] || null;
}
