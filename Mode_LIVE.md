# BFMIDI · Modos LIVE

Referência de **como cada modo de SW funciona em LIVE MODE**. Complementa o
[design.md §3.6](design.md) (que cobre a estrutura de UI/armazenamento) — aqui o
foco é o **comportamento**: o que cada modo faz no MIDI, no LED e no toque do
footswitch.

**Implementados:** STOMP (`fx1` unificado, com FAVORITE por seção), SPIN,
RAMPA, MOMENTARY, MACROS, TAP TEMPO, SINGLE.
**Legados:** `fx2` e `fx3` (ocultos no picker, dados antigos ainda carregam).
**Removidos do picker:** FAVORITE como modo separado (virou toggle por seção
do STOMP — ver §3.6).

---

## 1. Visão geral

Em LIVE MODE cada um dos 6 footswitches (SW1–SW6) opera de forma independente,
segundo o **modo** atribuído a ele. O modo de cada SW é escolhido no picker do
card de SW e guardado no campo `sw_modes` do header do preset (6 índices,
`i,i,i,i,i,i`). Os **parâmetros** de cada SW/modo ficam em linhas próprias do
arquivo do preset (`sw<N>.<modo>:<key=value|...>` em `/banks/<tag>.txt`).

Dois tempos distintos:

- **Na chamada do preset** (em QUALQUER modo — BANK ou LIVE): o firmware
  dispara o MIDI inicial de cada SW (quando o modo tem estado de partida),
  junto do header do preset.
- **Em LIVE MODE**: o footswitch fica interativo (toque altera/dispara MIDI) e
  o LED de cada SW reflete o estado. Em BANK MODE o SW não é interativo e não
  há visualização por LED — só o disparo inicial aconteceu.

O estado de runtime de cada SW vive em `swActive`
([BANK_MEMORY.h](../BANK_MEMORY.h)), um cache só do preset ativo, recarregado a
cada troca de preset. Campos compartilhados entre modos (cada SW roda só 1
modo por vez, então é seguro reusar):

- `liveOn[6]` / `liveOn2[6]` / `liveOn3[6]` — on/off persistente das 3 seções
  do STOMP/MACROS. Reaproveitados: TAP TEMPO LP usa `liveOn2[i]`; RAMP usa
  `liveOn[i]` como direção do sweep.
- `ledBlinkNextMs[6]` / `ledBlinkPhase[6]` — timer + fase de animação do LED.
  Reusado por TAP TEMPO (idle cycle 1→2→3, blink no tempo) e SPIN (blink do
  awaiting).
- `momentaryFlashUntilMs[6]` / `momentaryPressCount[6]` — flash de 500 ms e
  contador de pulses do MOMENTARY.
- `singlePressCount[6]` / `lastActiveSingleSw` — contador e ID do último SW
  em SINGLE pressionado (só ele fica com o LED aceso).
- `tapLastTapMs[6]` / `tapIntervalMs[6]` / `tapPressCount[6]` /
  `tapLpFiredFlag[6]` — estado da TAP TEMPO (tempo, contador, flag de LP).
- `spinState[6]` — estado da SPIN (-1 = awaiting, 0/1/2 = pixel ativo).
- `rampValue[6]` / `rampSegStart[6]` / `rampSegStartMs[6]` /
  `rampSegDurMs[6]` / `rampNextSendMs[6]` / `rampMoving[6]` /
  `rampHoldActive[6]` / `rampLoopActive[6]` — máquina de sweep do RAMP.

---

## 2. Modos disponíveis

| Índice | id | Nome | Status |
|---|---|---|---|
| 0 | `mute` | MUTE | padrão — SW silencioso, não faz nada |
| 1 | `fx1` | STOMP | **implementado** unificado (1/2/3 seções, §3) + FAVORITE por seção |
| 2 | `fx2` | STOMP - 2 | legado, oculto do picker (§7) |
| 3 | `fx3` | STOMP - 3 | legado, oculto do picker (§7) |
| 4 | `spin` | SPIN | **implementado** 3-state cycle + até 3 slots simultâneos (§8) |
| 5 | `ramp` | RAMPA | **implementado** sweep com curva + 3 triggers (§9) |
| 6 | `momentary` | MOMENTARY | **implementado** até 4 slots (§4) |
| 7 | `favorite` | (removido) | virou toggle no STOMP — picker oculto |
| 8 | `macros` | MACROS | **implementado** (§5) |
| 9 | `tap_tempo` | TAP TEMPO | **implementado** 3 tap slots + LP toggle (§10) |
| 10 | `single` | SINGLE | **implementado** até 4 slots (§6) |

---

## 3. STOMP (`fx1`) — unificado, adaptativo

### 3.1 Conceito

Um único modo "STOMP" que **adapta o comportamento** conforme quantas seções
têm atividade (CC configurado **ou** FAVORITE ligado). O usuário configura até
3 seções (A, B, C) no editor; o firmware decide em runtime se opera como STOMP
clássico, dual ou trial.

Tiers (decisão em runtime — seção é "ativa" se `chN ∈ 1..16` OU `favN = 1`):

| Atividade | Tier | Apelido | Gestos / LED |
|---|---|---|---|
| Só A | 1 | STOMP clássico | tap = toggle de A; segurar = momentary em A. **LED**: 3 pixels na cor A. |
| A + B | 2 | DUAL STOMP | tap = toggle A (imediato no release); long-press = toggle B (permanente). **LED**: pixels externos = A, central = B. |
| A + B + C | 3 | TRIAL STOMP | tap = A (após janela do duplo-click); long-press = B; duplo-click = C. **LED**: pixel 1/2/3 = A/B/C. |

> **Trade-off do tier 3**: o tap simples só pode ser confirmado depois que a
> janela do duplo-click expira (~350 ms em `doubleClickMs` de
> [ALL_SWITCHES.h](../ALL_SWITCHES.h)).

### 3.2 Parâmetros

Blob da linha `sw<N>.fx1:` — até 33 chaves, divididas em 3 seções:

| Seção | Sufixo | Gesto | Chaves CC | Chaves FAV |
|---|---|---|---|---|
| A | (vazio) | tap | `num`, `ch`, `custom`, `on`, `off`, `start`, `at_preset`, `color` | `fav`, `fav_bank`, `fav_preset`, `fav_mode` |
| B | `2` | long-press | mesmo + sufixo `2` | mesmo + sufixo `2` |
| C | `3` | duplo-click | mesmo + sufixo `3` | mesmo + sufixo `3` |

Chaves CC (idem que antes):

| Key | Range | Significado |
|---|---|---|
| `num` | 0–127 | número do CC |
| `ch` | `0` = OFF, 1–16 | canal MIDI |
| `custom` | 0/1 | habilita valores ON/OFF próprios |
| `on` | 0–127 | valor do CC no estado ligado |
| `off` | 0–127 | valor do CC no estado desligado |
| `start` | 0/1 | estado inicial na chamada do preset |
| `at_preset` | 0/1 | dispara MIDI na chamada do preset (default 1) |
| `color` | 0–14 | cor do LED da seção |

### 3.3 FAVORITE por seção

Quando `favN = 1`, a seção **não dispara CC** — em vez disso, ao tocar carrega
um banco/preset específico:

| Key | Range | Significado |
|---|---|---|
| `fav` | 0/1 | toggle do modo FAVORITE da seção |
| `fav_bank` | 0–4 | banco alvo (A–E) |
| `fav_preset` | 1–N | preset alvo |
| `fav_mode` | 0/1 | 0 = entrar em PRESET MODE; 1 = entrar em LIVE MODE |

Firmware (`swLiveHandleTapSection`, [SW_LIVE.h](../SW_LIVE.h)) checa `fav<suf>`
primeiro: se ON, chama `swBankSet(bankIdx, presetIdx)` e troca o `currentSwitchMode`
conforme `fav_mode`. Seções FAVORITE **não disparam MIDI no load** do preset
(o initial-fire pula essas seções).

### 3.4 Comportamento

**Na chamada do preset** (`swActiveSendInitialMidi`,
[SW_BANK.h](../SW_BANK.h)): para cada seção com `ch ∈ 1..16` E sem FAVORITE,
envia `CC num` com o valor de `start` (se `at_preset = 1`). Seções FAVORITE
ou com `ch = 0` são puladas.

**No toque do footswitch** (`swLiveUpdateButton` + `swLiveHandleTapSection`,
[SW_LIVE.h](../SW_LIVE.h)) — só em LIVE MODE: conforme o tier ativo, dispara
o gesto correspondente. Se a seção é FAVORITE, troca o preset; senão,
toggle do CC.

**LED**: layout adapta por tier; cada seção acende seu pixel na sua cor
quando ON.

### 3.5 MONITOR

Eventos LIVE: STOMP normal mostra `CC X = val · CH Y`. FAVORITE mostra
chip amarelo `FAV B5 · LIVE` em vez do CC.

---

## 4. MOMENTARY (`momentary`)

### 4.1 Conceito

Disparo em pulse (ON → delay → OFF) sem estado persistente. **Até 4 slots**
disparam todos juntos no press. Só opera em LIVE MODE — não há MIDI inicial.

### 4.2 Parâmetros

| Key | Tipo | Significado |
|---|---|---|
| `mom_slots` | string | até 4 slots: `"ch:num:on:off,ch:num:on:off,ch:num:on:off,ch:num:on:off"` |
| `color` | 0–14 | cor do LED no flash |

Cada slot em `mom_slots` (`ch:num:on:off`):

| Sub-campo | Range | Significado |
|---|---|---|
| `ch` | 0/1–16 | canal MIDI (0 = slot inativo) |
| `num` | 0–127 | CC# |
| `on` | 0–127 | valor do pulse de ida |
| `off` | 0–127 | valor do pulse de volta |

**Compat legado**: campos `ch`/`num`/`custom`/`on`/`off` soltos viram slot 1
até o usuário salvar.

### 4.3 Comportamento

**Press** (`swLiveHandleMomentary` + `swLiveFireMomentarySlots`):
1. Para cada slot com `ch ≥ 1`: envia `CC num = on`, `delay(2)`, `CC num = off`.
2. Incrementa `momentaryPressCount[i]`.
3. Seta `momentaryFlashUntilMs[i] = millis() + 500` (flash 500 ms).

### 4.4 LED

3 pixels acesos na cor `color` durante o flash. `swLiveMomentaryFlashTick`
apaga ao expirar.

---

## 5. MACROS (`macros`)

### 5.1 Conceito

Igual ao STOMP unificado (3 seções adaptativas), mas **cada seção tem até 4
slots** de mensagens MIDI (CC ou PC). Quando a seção alterna, todos os slots
disparam (cada um com sua direção ON/OFF independente).

### 5.2 Parâmetros

Por seção (sufixo '', '2', '3'):

| Key | Tipo | Significado |
|---|---|---|
| `mslots[N]` | string | até 4 slots: `"t:ch:num:on:off,..."` |
| `start[N]` | 0/1 | estado inicial lógico (ON/OFF) |
| `at_preset[N]` | 0/1 | dispara no load do preset (independente de `start`) |
| `color[N]` | 0–14 | cor do LED |

Slot: `t` (0=CC,1=PC), `ch`, `num`, `on`/`off` (-1 = pula direção pra esse slot).

### 5.3 Tabela start + at_preset

| at_preset | start | Na chamada do preset | liveOn final |
|---|---|---|---|
| 0 | 0 | nada | false |
| 0 | 1 | nada | true |
| 1 | 0 | manda valores OFF | false |
| 1 | 1 | manda valores ON | true |

### 5.4 LED

Mesmo layout adaptativo do STOMP por tier. Tier detection: presença de slot
com `ch ≥ 1` em cada seção (`macrosSectionHasAnySlot`).

---

## 6. SINGLE (`single`)

### 6.1 Conceito

Disparo único (sem on/off), até 4 slots em paralelo. Se houver outros SWs em
SINGLE, só o último pressionado fica com o LED aceso (`lastActiveSingleSw`).

### 6.2 Parâmetros

| Key | Tipo | Significado |
|---|---|---|
| `sslots` | string | até 4 slots: `"t:ch:num:val,..."` |
| `at_preset` | 0/1 | dispara na chamada do preset (default 1) |
| `color` | 0–14 | cor do LED |

Slot: `t` (0=CC,1=PC), `ch`, `num`, `val` (0–127 CC ou 0–16383 PC).

**Compat legado**: campos `num`/`ch`/`on`/`pc`/`as_pc`/`start` soltos viram
slot 1.

### 6.3 LED

`i == lastActiveSingleSw` → 3 pixels na cor `color`. Os outros SINGLE
apagados.

---

## 7. Modos legado (fx2, fx3)

`fx2` ("STOMP - 2") e `fx3` ("STOMP - 3") existiram como modos exclusivos antes
da unificação no `fx1`. Hoje:

- **Picker** os esconde (`hidden: true` no `SW_MODES` do webApp).
- **Dados existentes** continuam funcionando — firmware tem paths legados
  (`mode == 2` / `mode == 3` em `swLiveUpdateButton`).
- **Editores legados**: `SwFx2Editor` (2 tabs) ainda monta pra SWs em `fx2`;
  `fx3` usa o `SwStompEditor` unificado.

Ao trocar o modo de um SW pelo picker, salva como `fx1` com os 33 campos.

---

## 8. SPIN (`spin`)

### 8.1 Conceito

Máquina de **3 estados** (pixel 1 / pixel 2 / pixel 3) com **até 3 slots de
CC disparados simultaneamente** por estado. Cada press cicla estado
0 → 1 → 2 → 0; o LED mostra qual estado está ativo. Quando `at_preset = 1`,
o load do preset entra em estado 0 (dispara v1 de todos os slots). Quando
`at_preset = 0`, fica em "awaiting" (pixel 1 piscando) até o primeiro press,
que então firma estado 0.

### 8.2 Parâmetros

| Key | Tipo | Significado |
|---|---|---|
| `spin_slots` | string | até 3 slots: `"ch:num:v1:v2:v3,ch:num:v1:v2:v3,ch:num:v1:v2:v3"` |
| `at_preset` | 0/1 | dispara v1 de cada slot no load do preset |
| `color` | 0–14 | cor do LED |

Cada slot em `spin_slots` (`ch:num:v1:v2:v3`):

| Sub-campo | Range | Significado |
|---|---|---|
| `ch` | 0/1–16 | canal MIDI |
| `num` | 0–127 | CC# |
| `v1` / `v2` / `v3` | 0–127 | valor do CC em cada estado |

**Compat legado**: campos `ch`/`num`/`val1`/`val2`/`val3` soltos viram slot 1.

### 8.3 Comportamento

**Press** (`swLiveHandleSpin` + `swLiveFireSpinSlots`): se estado=-1
(awaiting), firma estado 0; senão `(state+1)%3`. Dispara `CC num = vN` de
todos os slots configurados (simultâneo, `delay(1)` entre).

**Awaiting** (`swLiveSpinTick`): pisca pixel 1 em ciclo 300 ms ON / 300 ms OFF
usando `ledBlinkNextMs` + `ledBlinkPhase`.

### 8.4 LED

- `spinState ∈ {0,1,2}`: pixel correspondente aceso na cor `color`.
- `spinState = -1`: pixel 1 piscando (controlado pelo phase do tick).

Mapeamento: pixel 1 → arc 1 (sup esq), pixel 2 → arc 0 (inferior),
pixel 3 → arc 2 (sup dir).

---

## 9. RAMPA (`ramp`)

### 9.1 Conceito

Sweep gradual de CC entre min/max, com curva (linear/exp/log/sine), tempo de
subida/descida e modo de gatilho (toggle/hold/loop). **Só opera em LIVE MODE
por design** — não dispara nada no load do preset.

### 9.2 Parâmetros

| Key | Tipo | Significado |
|---|---|---|
| `ch` | 0/1–16 | canal MIDI |
| `num` | 0–127 | CC# do sweep |
| `min_val` / `max_val` | 0–127 | valores extremos do sweep |
| `up_ms` / `down_ms` | 10–60000 | duração de subida / descida (ms) |
| `curve` | 0/1/2/3 | LINEAR / EXP / LOG / SINE |
| `trigger` | 0/1/2 | TOGGLE / HOLD / LOOP |
| `step_ms` | 5–500 | intervalo entre envios MIDI (default 25) |
| `start_on` | 0/1 | direção inicial do sweep |
| `color` | 0–14 | cor do LED |

### 9.3 Triggers

| Trigger | Comportamento |
|---|---|
| TOGGLE | press flipa direção; press mid-flight reverte (tempo proporcional à distância restante) |
| HOLD | wasPressed = sobe; wasReleased = desce |
| LOOP | press inicia ping-pong contínuo; press para |

### 9.4 Comportamento

**Tick** (`swLiveRampTick`, chamado uma vez por iteração do loop LIVE):
- Para cada SW em RAMP com `rampMoving = true`:
  - Calcula `pos = curve(elapsed/segDur)` no intervalo [0,1].
  - Interpola `newVal = segStart + (target - segStart) * pos`.
  - Se `newVal != rampValue`: envia `CC num = newVal`, marca `anyChanged`.
- No fim do tick, se algum mudou: marca `gLiveLedDirty`; o anel é repintado
  **uma vez** no fim do `swLiveUpdate` (repaint coalescido — LED segue).

**LED**: brilho da cor escalado pelo `rampValue` normalizado entre min/max
(floor de 6% no pixel central pra sempre indicar "modo ativo").

---

## 10. TAP TEMPO (`tap_tempo`)

### 10.1 Conceito

Calcula tempo entre 2 últimos taps (clampado 100–3000 ms) e dispara **até 3
slots de CC** por tap. Tem ainda **1 slot fixo de LONG PRESS** com toggle
independente (igual STOMP), que dispara `CC + ON` no long-press e
`CC + OFF` no long-press seguinte.

O tap é contado **no release** (não no press) — assim segurar pra long-press
não dispara um tap parasita.

### 10.2 Parâmetros

| Key | Tipo | Significado |
|---|---|---|
| `tslots` | string | até 3 slots: `"ch:num:mode,ch:num:mode,ch:num:mode"` |
| `lp_ch` | 0/1–16 | canal MIDI do slot de LONG PRESS |
| `lp_num` | 0–127 | CC# do LP |
| `lp_on` / `lp_off` | 0–127 | valores ON / OFF do toggle do LP |
| `lp_start` | 0/1 | estado inicial do LP toggle |
| `lp_at_preset` | 0/1 | dispara LP no load do preset (default 1) |
| `color` | 0–14 | cor do LED |

Cada slot em `tslots` (`ch:num:mode`):

| Sub-campo | Range | Significado |
|---|---|---|
| `ch` | 0/1–16 | canal MIDI |
| `num` | 0–127 | CC# (valor fixo 127 no tap) |
| `mode` | 1/2 | 1 = só CC+127 (clássico); 2 = CC+127 seguido de CC+0 (pulse) |

### 10.3 Comportamento

**Tap** (`swLiveHandleTapTempo`, no release): calcula intervalo entre 2
últimos taps. Dispara `CC num = 127` de cada slot; se `mode=2`, manda
`CC num = 0` em seguida.

**Long press** (`swLiveHandleTapLongPressToggle`, no wasLongPressed): flipa
`liveOn2[i]` (estado do LP toggle). Dispara `CC = lp_on` ou `CC = lp_off`
conforme o novo estado. Seta `tapLpFiredFlag[i]` pra bloquear o tap
subsequente no release.

**Initial** (`swActiveSendInitialMidi`): se `lp_at_preset = 1`, fixa
`liveOn2[i] = lp_start` e dispara o valor correspondente.

### 10.4 LED

Idle (sem tempo batido): cicla pixel 0 → 1 → 2 a cada 300 ms
(`ledBlinkPhase`).
Tempo batido: pisca os 3 pixels no `tapIntervalMs` (80 ms ON, resto OFF).

---

## 11. Convenções de variáveis

Memória do projeto: **reaproveitar chaves entre modos**. Cada SW roda só 1
modo por vez, então as chaves podem ser compartilhadas e o blob fica enxuto.

### 11.1 Chaves canônicas

| Key | Onde aparece | Semântica |
|---|---|---|
| `num` | STOMP, MOMENTARY (legado), SINGLE (legado), SPIN, RAMP, slot CC | CC# (0–127) |
| `ch` | mesmos modos | canal MIDI (0 = OFF, 1–16) |
| `custom` | STOMP, MOMENTARY (legado) | habilita valores ON/OFF próprios |
| `on` | STOMP, MOMENTARY (legado), slot CC do MACROS | valor de CC no estado ON |
| `off` | STOMP, MOMENTARY (legado), slot CC do MACROS | valor de CC no estado OFF |
| `start` | STOMP, MACROS | **estado inicial** lógico (ON/OFF) |
| `start_on` | RAMP | direção inicial do sweep (semantica idêntica a `start`) |
| `lp_start` | TAP TEMPO LP | estado inicial do toggle de LONG PRESS |
| `color` | todos os modos com LED | cor do LED (índice 0–14) |
| `at_preset` | STOMP, MACROS, SINGLE, SPIN | dispara na chamada do preset |
| `lp_at_preset` | TAP TEMPO LP | dispara o LP no load do preset |
| `t` | slot (MACROS, SINGLE) | tipo do slot: 0 = CC, 1 = PC |
| `val` | slot SINGLE | valor único de disparo (CC value ou PC#) |
| `mslots[N]` | MACROS | slots `t:ch:num:on:off` por seção |
| `sslots` | SINGLE | slots `t:ch:num:val` |
| `tslots` | TAP TEMPO | slots `ch:num:mode` |
| `mom_slots` | MOMENTARY | slots `ch:num:on:off` |
| `spin_slots` | SPIN | slots `ch:num:v1:v2:v3` |
| `fav` / `fav_bank` / `fav_preset` / `fav_mode` | STOMP por seção | FAVORITE (carrega banco/preset) |

Sufixos `2` e `3` indicam seções B/C em STOMP e MACROS.

### 11.2 State runtime compartilhado

- `liveOn[i]` — STOMP seção A, MACROS seção A, RAMP direção
- `liveOn2[i]` — STOMP seção B, MACROS seção B, **TAP TEMPO LP toggle**
- `liveOn3[i]` — STOMP seção C, MACROS seção C
- `ledBlinkNextMs[i]` / `ledBlinkPhase[i]` — TAP TEMPO idle/tempo + SPIN
  awaiting (modos exclusivos por SW → sem conflito)

### 11.3 Quando criar uma chave nova

Antes de inventar, olhe o blob dos modos já feitos. Use o mesmo nome pra
conceitos equivalentes. Só adicione uma chave nova quando:
- O conceito não existe em outro modo (`mom_slots`, `spin_slots`).
- Há prefixo namespace claro (`lp_*` pra TAP TEMPO LP, `fav_*` pra FAVORITE).

Modos com schema de "slot" reusam o formato compacto `campo:campo:..,campo:..`
no composite string pra ficar fácil de parsear no firmware (sscanf).
