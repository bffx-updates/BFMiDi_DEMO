# BFMIDI webApp · Design Reference

Documento de referência do design atual do webApp (React SPA em `webApp/`). Serve para orientar implementações futuras mantendo coerência visual e de comportamento. Foco principal: **página BANK**, com o sistema de design compartilhado (tokens, header, tabbar) documentado para reaproveitamento.

Arquivos vivos:
- [webApp/app.jsx](app.jsx) — componentes React (JSX transpilado no browser via Babel-standalone).
- [webApp/app.css](app.css) — folha única com tokens e todos os componentes.
- [webApp/components.jsx](components.jsx), [webApp/themes.jsx](themes.jsx), [webApp/tweaks-panel.jsx](tweaks-panel.jsx), [webApp/preset-leds.jsx](preset-leds.jsx) — componentes auxiliares.

---

## 1. Linguagem visual

Inspiração: **iOS dark mode** com sotaque laranja da marca BFMIDI. Cantos arredondados generosos, fundos com gradiente radial sutil, glow alaranjado em elementos ativos, tipografia condensada para números/títulos e monospace para metadados.

### 1.1 Tokens (CSS vars em `:root`, [app.css:3-26](app.css:3))

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#0a0a0c` | fundo da janela |
| `--screen` | `#07070a` | fundo do "shell" do iPhone |
| `--card` | `#141418` | cartão padrão |
| `--card-2` | `#1c1c20` | cartão elevado / tab ativa neutra |
| `--card-3` | `#232328` | cartão hover/3º nível |
| `--hair` | `rgba(255,255,255,0.07)` | borda fina |
| `--hair-strong` | `rgba(255,255,255,0.12)` | borda fina mais visível (tabbar) |
| `--text` | `#f6f6f8` | texto principal |
| `--muted` | `rgba(235,235,245,0.6)` | secundário |
| `--faint` | `rgba(235,235,245,0.32)` | terciário (labels pequenos) |
| `--ghost` | `rgba(235,235,245,0.18)` | LED apagado |
| `--accent` | `#ff6a1f` | laranja BFMIDI (CTA, ativo, brand) |
| `--accent-2` | `#ff8a3a` | gradient highlight |
| `--accent-soft` | `rgba(255,106,31,0.16)` | fundo discreto laranja |
| `--accent-glow` | `rgba(255,106,31,0.55)` | sombra/blur laranja |
| `--success` / `--danger` / `--blue` | iOS green/red/blue | status |

Tipografia:
- `--font-sys` — system stack (SF Pro / Inter). Default da UI.
- `--font-mono` — JetBrains Mono / SF Mono. Eyebrows, labels técnicos, valores key=value, tabbar.
- `--font-display` — Antonio condensada. Números grandes dos presets.

### 1.2 Raios, espaçamento e sombras

- Cartões: `border-radius: 22px`, padding `18px`, borda `1px solid var(--hair)`.
- Tile do bank: `18px`. Presets: `14px`. Tabbar: `28px` (pill).
- Glow do ativo: `0 0 0 1px var(--accent-glow), 0 12px 40px -8px var(--accent-glow)`.

### 1.3 Fundo geral

`body` tem dois `radial-gradient` (canto sup-esq + canto inf-dir) sobre `#0c0c10`. O `.bf-screen` adiciona um pseudo-elemento com dois gradientes radiais laranja/azul muito tênues — atmosfera, sem distrair.

---

## 2. Estrutura comum a todas as páginas

Cada página é renderizada dentro de `.bf-screen` (moldura tipo iPhone) e usa o mesmo esqueleto:

```
.bf-screen
  .bf-content                     ← scroll, padding 16/16/110
    .bf-header                    ← eyebrow + título + subtítulo
      .bf-eyebrow                 ← status online/offline + pill "LIVE"
      h1.bf-title                 ← 34px, peso 700
      p.bf-subtitle               ← 14px, muted
    ...conteúdo da página...
  .bf-tabbar (fixo)               ← BANK | GLOBAL | SYSTEM | SAVE
```

### 2.1 Header (`bf-header`, [app.css:74](app.css:74))

- `.bf-eyebrow`: mono 11px, letter-spacing `0.18em`, uppercase, muted. Inclui um dot 6×6 verde (`--success`) com glow quando online, cinza quando offline. Texto: `ONLINE · <host>` ou `OFFLINE · TAP`. Pill "LIVE" com borda laranja alinhado à direita (`margin-left: auto`).
- Em offline/erro, o eyebrow inteiro vira clicável para forçar reload.
- `.bf-title`: 34px, weight 700, letter-spacing `-0.02em`. Pode ter `.accent` em parte do texto.
- `.bf-subtitle`: muted, 14px, instrução curta.

### 2.2 Tabbar (`bf-tabbar`, [app.css:263](app.css:263))

- `position: fixed`, centralizada, largura `calc(100% - 24px)` até `456px`, `bottom: 16px`.
- Fundo `rgba(20,20,24,0.78)` com `backdrop-filter: blur(20px) saturate(140%)`.
- Grid `1fr 1fr 1fr auto`: 3 tabs + botão SAVE.
- `.bf-tab` 48px de altura, raio 20, mono 11px uppercase. Ativa: fundo `--card-2` (default). Quando a tab ativa tem classe extra `bank` / `global` / `system`, ela ganha fundo `--accent`, texto `#1a0e06` e glow.
- `.bf-save`: pílula branca (`background: var(--text)`) com texto escuro.

### 2.3 Cards e seções

- `.bf-card` — caixa base. Cards empilhados ganham `margin-top: 14px` automaticamente.
- `.bf-card-head` — header interno: `h3` 13px uppercase muted + `.meta` mono `--faint` à direita.
- `.bf-section-label` — rótulo de grupo entre cards. 12px uppercase muted, com um dot laranja antes do texto (gera o efeito "• MEMÓRIA" usado em outras páginas). Padding `18px 6px 8px`.

---

## 3. Página SET PRESET

Componente: `PagePresetConfig(...)` em [app.jsx](app.jsx). Primeira aba da tabbar. Abaixo da grade de presets há o seg `PRESET MODE` / `LIVE MODE`, que alterna o conteúdo do card:
- **PRESET MODE** — edição do preset (`PresetEditorCard`, abas MIDI / DISPLAY / EXTRAS / MONITOR).
- **LIVE MODE** — configuração dos 6 SWs do preset ativo (`LiveModePanel`); ver §3.6.

O modo é sincronizado com o hardware (botão físico LIVE / `POST /mode`).

### 3.1 Layout atual

```
bf-content (key="bank")
├── bf-header
│   ├── bf-eyebrow      ← status do device + pill LIVE
│   ├── h1.bf-title     ← "Banks"
│   └── p.bf-subtitle   ← "Toque para selecionar um preset."
└── bf-bank-row         ← grade 2fr 1fr 1fr 1fr, 2 linhas
    ├── bf-bank-tile    ← coluna 1, linhas 1-2 (quadrado grande com a letra)
    └── bf-preset × 6   ← presets 1-6 em 3×2 nas colunas 2-4
```

> Antes existia uma seção **"Memória"** (card abaixo da grade com `Preset data` e `Próximo bank`). Foi removida em 2026-05-10 a pedido do usuário. Não recriar sem solicitação explícita.

Abaixo da `bf-bank-row` há agora o card **Preset editor** (`PresetEditorCard`, [app.jsx](app.jsx)). Recebe `tag` (ex.: `A1`) e mantém um dicionário `metaByTag` em estado local — ao trocar de preset, o card preenche os campos com a meta salva para aquele tag (fallback aos defaults).

**Esquema por preset** (30 entradas, A1–E6):

| Campo | Tipo | Range / paleta | Default |
|---|---|---|---|
| `name` | string ≤ 16 chars | livre; quando vazio, fallback ao `tag` | `''` |
| `bank` | int | 0–16383 (MSB+LSB combinado) | `0` |
| `channel` | int | `0`=MUTE/OFF; `1..16` | `0` |
| `nameColorId` | int | id em `BG_COLORS` (paleta visual, 5 cores) | `1` (BRANCO) |
| `bgColorId` | int | id em `BG_COLORS` | `0` (PRETO) |
| `backLayersColorId` | int | id em `BG_COLORS` | `0` — fundo da tela no modo LIVE |
| `tagColorId` | int | id em `BG_COLORS` | `2` (LARANJA, reservado) |

`BG_COLORS` é uma paleta **separada** da `LED_COLORS` (não misturar — LEDs e cores de display são coisas distintas). Atualmente: 0 PRETO, 1 BRANCO, 2 LARANJA, 3 AZUL, 4 VERDE. Adicionar/remover cores aqui propaga para todos os 4 color bars.

Layout do card:
- Linha 1 (grid `2fr 1fr 1fr`): `Preset name` (input, placeholder = tag, texto em `--accent`) · `Bank` (input numérico 0–16383, sem spinner) · `Channel` (select MUTE + 1..16; estado MUTE pinta o texto em `--danger`).
- Linha 2: `Preset name color` · `Display background` · `Back layers` (3 color bars).
- Linha 3: `Preset tag color` (1 color bar; demais slots viram `bf-field-spacer` invisível).
- Rodapé: `.bf-hint` mono mostrando `Editando A1 · será exibido no display como <displayName>`. `<displayName>` = `meta.name || tag`.

Cada `ColorBar` abre um popover (reaproveita `bf-color-pop` + `bf-modal-backdrop` de `FootswitchArc`) com `bf-bg-grid` 5×1 de `bf-bg-swatch`. O visual da barra: cor pura quando id=0 (PRETO), e `linear-gradient(90deg, #050507, <cor>, #050507)` nas demais — efeito "metálico" do print.

Classes novas em [app.css](app.css): `.bf-preset-editor`, `.bf-form-row(-3)`, `.bf-field`, `.bf-field-label`, `.bf-field-spacer`, `.bf-input-name`, `.bf-input-num`, `.bf-select(.is-mute)`, `.bf-select-wrap`, `.bf-select-chev`, `.bf-color-bar`, `.bf-bg-pop`, `.bf-bg-grid`, `.bf-bg-swatch`, `.bf-hint`. Em telas ≤ 520px a grade vira `1fr 1fr` e os spacers somem.

**Persistência (firmware, schema v3):** [BANK_MEMORY.h](../BANK_MEMORY.h) usa **um arquivo por preset** em `/banks/<tag>.txt` (`BANK_MEMORY_VERSION = 3`). Estrutura do arquivo:

```
v=3
<header: key=value|key=value|...>     ← linha 2, o blob `data` (320 bytes)
sw<N>.<modo>:<key=value|...>          ← linhas 3+, params de SW (esparso, ver §3.6)
```

Campos do header (pares `key=value` dentro de `data`):

| HTTP arg | Key em `data` | Range | Default |
|---|---|---|---|
| `name` / `name_raw` | `name` | string ≤ 16 (sem `\| = :`) | `''` |
| — | `enabled` | 0/1 | 1 |
| `midi_bank` | `bank` | 0–16383 | 0 |
| `channel` | `channel` | 0 (MUTE) ou 1–16 | 0 |
| `name_color` | `name_color` | id em `DISPLAY_PALETTE` | 4 |
| `name_border_color` | `name_border_color` | id em `DISPLAY_PALETTE` | 0 |
| `bg_color` | `bg_color` | id em `DISPLAY_PALETTE` — fundo da tela no modo PRESET/BANK | 0 |
| `back_layers_color` | `back_layers_color` | id em `DISPLAY_PALETTE` — fundo da tela no modo LIVE | 0 |
| `tag_color` | `tag_color` | id em `DISPLAY_PALETTE` | 11 |
| `font_size` | `font_size` | 9/12/18/24 (snap) | 18 |
| `font_bold` | `font_bold` | 0/1 | 0 |
| `name_x` / `name_y` | `name_x` / `name_y` | posição livre do nome 0–100 (% do espaço livre da tela; 50/50 = centro). Substitui o antigo `name_align` 0–8 — presets antigos migram via `bankMemoryNameXY` (col·50/row·50) | 50 / 50 |
| `extra_pcs` | `extra_pcs` | `ch:pg` ×4 (ch 0 = slot off) | `0:0,0:0,0:0,0:0` |
| `extra_ccs` | `extra_ccs` | `ch:ctl:val` ×2 | `0:0:0,0:0:0` |
| `sw_modes` | `sw_modes` | 6 índices de modo `i,i,i,i,i,i` (ver §3.6) | `0,0,0,0,0,0` |

Helpers em [BANK_MEMORY.h](../BANK_MEMORY.h): acessores genéricos `bankMemoryGetField(Int)` / `bankMemorySetField(Int)` / `bankMemorySanitizeValue` (operam sobre qualquer blob `key=value|...`); I/O por arquivo `bankMemorySave` (todos os 30, só header — usado pelo erase), `bankMemorySavePresetHeader` (1 arquivo, **preserva** as linhas de SW — usado pelo meta-edit), `bankMemoryWritePresetFull` (restore). As escritas read-modify-write são atômicas (temp + `rename`). Loader tolerante: campos/linhas ausentes caem no default, sem migração explícita.

**API HTTP** ([WEB_API_BANK.h](../WEB_API_BANK.h)) — espelhada no transporte USB Serial ([USB_CONTROL.h](../USB_CONTROL.h)); o webApp roteia via `apiCall`:

- `GET /bank/current` — devolve `data` + `meta` parseado + `switch_mode` (0 = PRESET, 1 = LIVE).
- `GET /bank/preset?bank=A2` — lê o header de qualquer slot sem trocar o preset ativo.
- `POST /bank/preset?bank=A2` — aceita os args do header (todos opcionais; ver tabela). Sanitiza, clampa, persiste com `bankMemorySavePresetHeader` (preserva as linhas de SW). Resposta inclui `changed` e `persisted`.
- `GET /sw/params?bank=A2` — devolve `{"sw_params":{"sw1.fx1":"<blob>",...}}` com as linhas de SW do preset.
- `POST /sw/params?bank=A2&sw=1&mode=fx1` — grava o blob de um SW/modo (params no body); body vazio remove a linha. Ver §3.6.
- `GET /backup` / `POST /restore` — backup **v2**: `presets` (header) + `sw_params` (linhas de SW). Restore aceita v1 e v2, grava o arquivo completo de cada preset e reinicia o ESP32.
- `OPTIONS` em todos os caminhos.

`PresetEditorCard` busca o header por `tag` (cache `metaByTag`); a edição marca *dirty* e o botão SAVE do rodapé persiste — não há autosave/debounce. Status no rodapé do card (`CARREGANDO` / `SALVANDO` / `SALVO` / `ERRO`).

**Display do device:** `draw_bank_screen` e `draw_live_screen` ([DISPLAY_320.h](../DISPLAY_320.h), [DISPLAY_480.h](../DISPLAY_480.h)) recebem agora `(const char *label, uint16_t bg, uint16_t fg)`. Os callers em [SW_BANK.h](../SW_BANK.h) e [SW_LIVE.h](../SW_LIVE.h) compõem o label via `bankMemoryScreenLabel(...)` e convertem os ids de cor (`bg_color`, `name_color`) em RGB565 via `bankMemoryColorRgb565(id)` (em [BANK_MEMORY.h](../BANK_MEMORY.h) — tabela espelha `BG_COLORS` do webApp). Quando o preset tem `name` preenchido, o display mostra **só o nome** (ex.: `MY SOLO`); quando vazio, cai no formato legado `BANK A1` / `LIVE A1`. Cores acompanham o que o usuário configurar no card "Preset editor".

**Tile do bank no webApp:** a `bf-bank-tile` agora exibe o nome do preset ativo logo abaixo da letra grande (classe `.bf-bank-name`, mono uppercase muted, com `text-overflow: ellipsis`). O nome é alimentado pelo estado `bankDisplayName` no topo (vem de `meta.name` em `/bank/current`) e o `PresetEditorCard` propaga mudanças locais via `onDisplayNameChange` em `useEffect`, então a tile reage imediatamente enquanto o usuário digita — antes mesmo do debounce do save. Quando o nome está vazio, exibe o tag (`A1`/`B2`/...).

### 3.2 Bank row (`bf-bank-row`, [app.css:167](app.css:167))

- Grid `grid-template-columns: 2fr 1fr 1fr 1fr` × `grid-auto-rows: 1fr`, gap `10px`, margem vertical `8px 0 18px`.
- A tile do bank ocupa `grid-column: 1 / 2` e `grid-row: 1 / span 2` — fica aproximadamente quadrada (largura 2X, altura ≈ 2X + gap).
- Os 6 presets fluem automaticamente para preencher as 3 colunas restantes em 2 linhas.

### 3.3 Tile do bank (`bf-bank-tile`)

- Botão grande com `border-radius: 18px`.
- Fundo: gradiente radial laranja suave sobre gradiente vertical `#1b1b20 → #131318`.
- `.letter` — letra A–E centralizada, `font-weight: 700`, `font-size: clamp(72px, 22vw, 150px)`, cor `--accent`, com `text-shadow` dupla (glow laranja).
- `.led` — bolinha 8×8 no canto superior direito.
  - Default: laranja com glow.
  - `.is-loading`: cor `--ghost`, sem glow.
  - `.is-error`: vermelho `#e54545` com glow vermelho.
- `onClick` → `onNextLetter` (cicla A→B→C→D→E→A).
- `aria-label` inclui letra atual + tag (ex.: `A3`) + dica "toque para alternar".
- `title` reflete estado: `LOADING` / `ERROR` / `LOADED`.

### 3.4 Preset (`bf-preset`, [app.css:219](app.css:219))

- `aspect-ratio: 1` (quadrado), `border-radius: 14px`.
- Fundo gradiente vertical `#1b1b20 → #131318`. Padding `8px 10px`.
- Layout interno em `flex column space-between`:
  - `.num` no topo — `font-family: Antonio` (display condensada), `clamp(28px, 8vw, 48px)`, peso 700.
  - `.label` no pé — mono 9px, uppercase, letter-spacing `0.18em`, cor `--faint`. Texto fixo "PRESET".
  - `.led` 6×6 no canto superior direito, cinza (`--ghost`) por padrão.
- Estado **ativo** (`.is-active`):
  - Borda `--accent`.
  - Fundo combina radial laranja `0.32` + gradient vertical âmbar escuro `#2a1a10 → #18120e`.
  - Box-shadow dupla (linha interna + halo externo `--accent-glow`).
  - `.num` muda para `--accent`; `.led` acende laranja com glow.
- `onClick` → `onSelectPreset(n)`.

### 3.5 Estados e dados

- `bankLetterIndex` (0–4) ↔ `letters[i]` → A, B, C, D, E.
- `presetNumber` (1–N) determina qual `.bf-preset` recebe `.is-active`.
- `tag` = `${letra}${preset}` (ex.: `A3`) — exibido em tooltip da tile.
- `bankState`: `'loaded' | 'loading' | 'error'` controla o LED da tile.
- `deviceState`: `'online' | 'loading' | 'offline'` controla o eyebrow.
- `presetCount` é dinâmico (vem do config); o layout assume 6 (3×2 nas 3 colunas restantes). Se mudar para outro número, revisar a grade.

### 3.6 LIVE MODE — modos e parâmetros de SW

Em LIVE MODE o card vira o `LiveModePanel`: 6 botões SW1–SW6, cada um abre um sub-card com o **modo de operação** do SW (picker) e duas abas (engrenagem = parâmetros, display = em breve).

**Modos** (`SW_MODES` em [app.jsx](app.jsx) / `SW_MODE_IDS` em [BANK_MEMORY.h](../BANK_MEMORY.h) — mesma ordem): índice `0 = mute`, `1 = fx1` (STOMP unificado), `2 = fx2` (legado), `3 = fx3` (legado), `4 = spin`, `5 = ramp`, `6 = momentary`, `7 = favorite` (removido do picker, agora vive como toggle por seção do STOMP), `8 = macros`, `9 = tap_tempo`, `10 = single`. O modo ativo de cada SW vai no campo `sw_modes` do header (`i,i,i,i,i,i`).

Todos os modos estão implementados (exceto `mute`, que é o estado padrão silencioso). Detalhamento completo do **comportamento** de cada modo (parâmetros, gestos, LED, MIDI, MONITOR) está em [Mode_LIVE.md](Mode_LIVE.md). Esta seção foca só no que o **webApp** faz pra render/save.

**Parâmetros por SW** ficam nas linhas 3+ do arquivo do preset, formato `sw<N>.<modo>:<key=value|...>`, esparso — trocar o modo de um SW não apaga os params do modo anterior. O blob mistura campos numéricos simples (`ch`, `num`, `color`, ...) com campos **composite string** que carregam slots (`mslots`, `sslots`, `tslots`, `mom_slots`, `spin_slots`) — esses últimos seguem o padrão `campo:campo:..,campo:campo:..` (separador `:` entre subcampos, `,` entre slots).

Cada modo tem seu **editor próprio** no webApp (`SwStompEditor`, `SwMomentaryEditor`, `SwMacrosEditor`, `SwSingleEditor`, `SwSpinEditor`, `SwRampEditor`, `SwTapTempoEditor` — todos em [app.jsx](app.jsx)), reusando `bf-extras-row` / `bf-extras-cell` / `bf-tap-slot-actions` (ADD/REMOVE SLOT) / `bf-spin-bar` (meter horizontal) etc.

**Runtime no firmware:** `swActive` ([BANK_MEMORY.h](../BANK_MEMORY.h)) é um cache do modo ativo de cada SW, **só do preset ativo**, recarregado a cada troca de preset (`swActiveLoadCurrent`). Na chamada do preset (qualquer modo), `swActiveSendInitialMidi` dispara o MIDI inicial de cada SW junto do header (modos como RAMP, TAP TEMPO tap-slots e MOMENTARY **nunca** disparam no load — só reagem a press). Em LIVE MODE, `swLiveUpdate` despacha cada gesto pro handler do modo correspondente ([SW_LIVE.h](../SW_LIVE.h)); o LED é re-renderizado conforme o modo ([LED_STRIP.h](../LED_STRIP.h)). Estados runtime são **compartilhados entre modos** sempre que possível (`liveOn*`, `ledBlinkNextMs`, `ledBlinkPhase`) — ver [Mode_LIVE.md §11](Mode_LIVE.md#11-convenções-de-variáveis).

**webApp:** `LiveModePanel` recebe `swModes` + `swParams` (estado no `App`). O cliente busca `GET /sw/params` na troca de preset, com guarda contra o poll de 1.5s sobrescrever edição pendente. O SAVE do rodapé em LIVE (`saveLive`) grava o `sw_modes` do header e, em seguida, cada linha de SW alterada via `POST /sw/params`.

---

## 4. Diretrizes para implementações futuras na BANK

1. **Manter a hierarquia de container**: novos blocos vão como filhos de `.bf-content`, abaixo da `bf-bank-row`. Não envolva tudo num novo wrapper.
2. **Use `bf-card` + `bf-section-label`** para qualquer grupo novo (ex.: "• AÇÕES", "• INFO"). O dot laranja antes do label é o selo visual de seção.
3. **Cores reservadas**:
   - Laranja (`--accent`) = brand, ativo, CTA. Evite usar para erro ou só decoração.
   - Verde (`--success`) = online/saudável. Vermelho (`--danger` / `#e54545`) = erro/offline ativo.
4. **Tipografia por papel**:
   - Números de slot / contadores grandes → `--font-display` (Antonio).
   - Labels uppercase técnicos, valores `key=value`, status → `--font-mono`.
   - Texto comum → `--font-sys`.
5. **Botões secundários** devem reaproveitar o estilo dos cards (`--card`, raio 14–18, borda `--hair`). Botões primários: pílula branca como `.bf-save` ou fill laranja seguindo a tab ativa.
6. **Toques (mobile-first)**: alvos ≥ 44px. `cursor: pointer`. Sempre `aria-label` quando o conteúdo é só visual (letras, números, ícones).
7. **Feedback de estado**: prefira indicadores discretos (LED no canto, mudança de borda + glow) ao invés de banners. Padronize com `.led` (8px para tiles grandes, 6px para presets).
8. **Animação**: `transition: transform 0.15s ease, box-shadow 0.2s ease` é o padrão. Não use animações longas (>250ms) em controles de toque.
9. **Acessibilidade**: `aria-label` em botões só com ícone/letra; `title` para tooltip de status; respeitar `cursor: default` quando não há ação (ex.: eyebrow online).
10. **Sem dependências novas**: o webApp é transpilado pelo Babel-standalone no browser. Nada de import de pacotes — use React global e CSS puro em `app.css`.

---

## 5. Pontos abertos / observações

- O `bankData` ainda chega como prop mas não é mais exibido (após remoção da seção Memória). Se permanecer não usado, pode ser limpo da assinatura de `PageBank` e do call site.
- `presetCount` variável: confirmar com o usuário se a UI precisa adaptar a grade quando ≠ 6.
- Edição de preset (PRESET MODE) e configuração de SW (LIVE MODE) já existem como cards abaixo da grade. Novas adições devem seguir o mesmo padrão — card ou modal sobre o shell, nunca substituindo o grid principal.
