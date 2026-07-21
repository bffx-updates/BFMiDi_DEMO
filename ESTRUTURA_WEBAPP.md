# Estrutura do WebApp — BFMIDI Project Zero

Editor PWA (Preact + esbuild) servido pela controladora ou rodado localmente.
Documento mapeia **todas as páginas, seus cards e funções**, com **índice de
localização de código** (`arquivo:linha`) em cada item. Mapeado a partir de
`app.jsx` (~14,6k linhas), `pages/bank.jsx`, `components/wheel.jsx`, `api.js`,
`stores.js`, `i18n.js` e os catálogos de dados (`kemper_*.js`, `pedal_*.js`).

> **Como ler o índice:** a coluna **📍 Código** aponta `arquivo:linha`. Quando o
> componente é definido em um lugar e *usado* em outro, aparece `def L<linha>`
> (definição) e `uso L<linha>` (onde é renderizado na página). As linhas podem
> derivar ao longo de edições — use o **nome da função** como âncora estável.
>
> **Documentos irmãos:** índice do firmware em [`../ESTRUTURA_FIRMWARE.md`](../ESTRUTURA_FIRMWARE.md);
> ambos estão linkados a partir do [`../CLAUDE.md`](../CLAUDE.md) (seção "Mapa de estrutura").
> Para o "porquê" e armadilhas de cada módulo, ver o `CLAUDE.md`.
>
> Cards aparecem/somem conforme o **modelo da placa** (`MODELS`) e flags de
> hardware (`hasExp`, `hasExtDual`, `hasMicro`, NANO, BFMIDI-3, Kemper).

---

## 0. Tela de Conexão (gate inicial) — `ConnectionScreen`

📍 `app.jsx:12240`

Antes de qualquer página, o app exige uma conexão com a controladora. Opções de transporte:

| Opção | Função | 📍 Código |
|---|---|---|
| **Via WiFi → Modo AP** | Conecta em `http://192.168.4.1` (rede `BFMIDI_WIFI`). | `app.jsx:11264` |
| **Via WiFi → mDNS** | Conecta em `http://bfmidi.local` (controladora no roteador / STA). | `app.jsx:11273` |
| **Via WiFi → IP manual** | Campo de IP livre (`?api=`), salvo em `localStorage`. | `app.jsx:11244` |
| **Via USB** | Web Serial API → canal CDC (`USB_CONTROL.h`). Só se `navigator.serial` existir. | `app.jsx:11242` |

Após conectar, entra no app com 3 páginas (`TabBar` `app.jsx:12039`): **PRESET · GLOBAL · SYSTEM**.

---

## 1. Página PRESET — `PagePresetConfig`

📍 `app.jsx:6880`

Dois sub-modos alternados pelo toggle **PRESET / LIVE** (`StudioToggle`) com badge de
**LAYER (1/2)** no centro. Botão **sync** (`modeSync`) espelha o modo p/ a controladora.

### Topo (sempre visível)
| Item | Função | 📍 Código |
|---|---|---|
| **`PageHeader`** | Cabeçalho: WiFi, USB, modo conexão (AP/STA), monitor MIDI, tema. | def `app.jsx:2019` · uso grep `PageHeader` em `PagePresetConfig` |
| **Linha de bancos/presets** | Bank tile (letra A–J; toque no corpo AVANÇA a letra, sub-botão ◀◀ na base VOLTA — `prevBankLetter`; sem preview de nome) + 6 botões de preset. | `app.jsx:6741` |
| **Toggle PRESET/LIVE + LAYER** | `StudioToggle` com badge de layer central. | def `pages/bank.jsx:632` · uso `app.jsx:6696` |

### Sub-modo PRESET (`switchMode === 'preset'`)
| Card | Função | 📍 Código |
|---|---|---|
| **`NowPlayingCard`** ("Tocando agora") | Card MAIN: **nome**, **PC** (0–600), **canal**, **envios extras** (add/edit/remove via "+"; 4 slots PC + 2 slots CC mesclados), promover extra PC→main. Cada linha extra tem badge de **tipo PC↔CC** (converte preservando ch/número; precisa de slot livre do destino); linhas CC têm picker de **VALOR** (0–127 customizável via `StudioPicker`; rótulos amigáveis por pedal via `buildExtraCcValueOptions`→`kemperValueOptionElems` e snap ao trocar o CC via `kemperSnapValue`). Nomes amigáveis com Match Mode/Kemper. Header tem o ícone **L2** — toggle do LAYER 2 **por preset** (`meta.layer2`; arg `layer2`/chave `l2` no firmware), que destrava o switch LAYER 1/2 do editor. | def `pages/bank.jsx:192` · uso `app.jsx:6789` |
| **`PresetEditorCard`** (embutido, `noFrame`) | Aba TELA do preset absorvida no NowPlayingCard; registra o handle de save. | def `app.jsx:1560` · uso `app.jsx:6893` |
| **`NamePositionEditor`** + **`NamePosMiniPreview`** | Posição **livre** do nome no display (modal arrastável, pixel exato). Substitui a antiga grade 3×3. Botão na aba TELA mostra mini-preview; modal mostra o display em escala (fundo/cor/imagem reais via `paletteCss`) com o frame do nome arrastável (pointer+touch). Salva `name_x`/`name_y` (0..100). Helpers `npFrameStyle`/`npLabel`/`parseNameXY`; aspect via `__displayRes`. | def `app.jsx:1250` (preview `app.jsx:1231`) |
| **`PresetDashboard`** | Resumo **read-only** por SW (modo + MIDI + accent do LED). Clique abre editor; ícone abre aba DISPLAY. | def `app.jsx:7129` |

### Sub-modo LIVE (`switchMode === 'live'`) — `LiveModePanel`
📍 def `app.jsx:6365`

| Item | Função | 📍 Código |
|---|---|---|
| **Navegação de SW** (`bf-sw-row`) | Botões SW1..N para selecionar qual editar. | `app.jsx:5996` |
| **COPY / PASTE entre SWs** | Clipboard interno (modo + params + display completo). | `app.jsx:5944` |

**Aba CONFIGURAÇÕES (`gear`)** — editor do modo do SW (`SW_MODES` `app.jsx:1996`):

| Modo (id) | Editor | Função | 📍 Código |
|---|---|---|---|
| **STOMP** (`fx1`) | `SwStompEditor` | 3 seções por gesto (CLICK/LONG/RECLICK); CC ou PC por seção. | def `app.jsx:3782` |
| **MACROS** (`macros`) | `SwMacrosEditor` | Sequência de mensagens MIDI (slots), CC/PC por slot. | def `app.jsx:4138` |
| **MOMENTARY** (`momentary`) | `SwMomentaryEditor` | Manda ao pressionar / outro valor ao soltar. | def `app.jsx:4241` |
| **TAP TEMPO** (`tap_tempo`) | `SwTapTempoEditor` | Tap tempo + long-press. | def `app.jsx:4933` |
| **SPIN** (`spin`) | `SwSpinEditor` | Cicla valores a cada press (fader range); slot de Long Press. | def `app.jsx:4411` |
| **RAMP** (`ramp`) | `SwRampEditor` | Sweep contínuo de valor. | def `app.jsx:4729` |
| **SINGLE** (`single`) | `SwSingleEditor` | Disparo único (CC ou PC). | def `app.jsx:5226` |
| **MUTE** (`mute`) | — | SW silencioso (padrão sem modo salvo). | `app.jsx:1996` (`SW_MODES`) |
| *Legados* (`fx2`/`fx3`/`favorite`) | `SwFx2Editor` | Escondidos do picker; só p/ dados antigos. | def `app.jsx:3732` |

> Cada editor tem helpers próprios `Sw*Slot` / `Sw*Section` (linha do slot / seção
> de gesto) definidos logo acima dele — `SwStompSection` `app.jsx:3340`,
> `SwMacrosSlot`/`SwMacrosSection` `:3841`/`:3968`, `SwMomentarySlot` `:4160`,
> `SwTapTempoSlot` `:4349`, `SwSingleSlot` `:5137`. Âncora = nome.

**Aba DISPLAY (`display`)** — `SwDisplayEditor` (`app.jsx:6239`):

| Item | Função | 📍 Código |
|---|---|---|
| **`SwDisplayTile`** | Preview do tile (ícone + sigla + LED). | `app.jsx:5787` |
| **`SwIconPicker`** | Escolhe ícone (tingido/colorido/upload PNG) ou texto. | `app.jsx:5879` |
| **`SwDisplaySpinEditor`** | Cores/sub-estados do modo SPIN. | `app.jsx:5967` |
| **`SwDisplayStompEditor`** | Cores/sub-estados do modo STOMP. | `app.jsx:6140` |
| **`SwDisplayTapEditor`** | Cores/sub-estados do modo TAP. | `app.jsx:6401` |

### Lateral / extras
| Item | Função | 📍 Código |
|---|---|---|
| **`SwPreviewGrid`** (desktop) | Grade 2×3 dos 6 SWs; também seletor de SW. | def `pages/bank.jsx:632` |
| **`MonitorView`** (modal) | Monitor MIDI: snapshot do preset / último disparo de SW + copiar. | def `app.jsx:7954` |

### Ações da TabBar (menu "+", só nesta página) — 📍 `TabBar` `app.jsx:12039`
| Ação | Função | 📍 Código |
|---|---|---|
| **COPY / PASTE PRESET** | Copia o preset inteiro entre slots (handlers `copyCurrentPreset`/`pastePreset*` no `App()`). | menu `app.jsx:12112` |
| **COPY / PASTE LAYER** | Copia só o layer ativo (modos+params+display dos 6 SWs). | menu `app.jsx:12159` |
| **COPY / PASTE BANK** | Copia o banco inteiro. | props do `TabBar` `app.jsx:12040` |
| **SAVE** | Salva o preset/edições (handle registrado por `registerPresetSave`). | `app.jsx:12039` (`TabBar`) |

---

## 2. Página GLOBAL — `PageGlobalConfig`

📍 `app.jsx:9832` — 4 abas (`bf-icon-tabs` `app.jsx:9907`): **MIDI · DISPLAY · LEDS · BANCOS**.

### Aba MIDI (`app.jsx:9956`)
| Card | Função | 📍 Código |
|---|---|---|
| **Modo Amigável / Match Mode** | Mapeia canal a um **pedal conhecido** (nomes PC/CC). Pedal único OU MULTIPLE MODE (pedal por canal 1..5) + **CC no LIVE** + omitir não-nomeados. | `app.jsx:9079` |
| **Kemper Player** *(só Kemper)* | GET NAMES, SEGUIR O KEMPER, estilo do afinador (Arc/Bar/LEDs), velocidade de aquisição. | `app.jsx:9173` |
| **SW Global** *(pino dedicado / NANO c/ SW6)* | `SwGlobalEditor` — footswitch fora dos presets. | def `app.jsx:9178` |
| **External Expression** *(`hasExp`)* | `ExternalExpressionCard` — pedal ADC→0..127: enable/CC/canal/calibração. | def `app.jsx:9589` |
| **External Dual Switch** *(`hasExtDual`)* | `ExternalDualSwitchCard` — 2 cards (1 por ext switch). Cada card = `SwGlobalEditor` com TODOS os modos (`noLed`, sem ícone), toggle **RESET AO CHAMAR PRESET** (`ext1/2_reset_on_preset`: volta estado/indicador para OFF sem MIDI OFF) e, **somente no SINGLE**, **INICIAR ON** (`start`) + **LEMBRAR ESTADO** (`remember_state`: alterna o indicador ON/OFF a cada toque, sem mudar MIDI) + `ExtIndicConfig` (o indicador ESW **daquele botão**: escopo OFF/LIVE/PRESET/AMBAS, sigla, cores ON/OFF compactas `ext_indic_on/off_color1/2`, tamanho de fonte `ext_indic_font_size1/2` e posição arrastável `ext_indic_x/y1/2`). Reusa `ExtIndicMiniPreview`/`ExtIndicPositionEditor` com `activeIndex` (caixa do botão arrastável, a outra como referência esmaecida, sobre o pré-render de ícones). Firmware em `EXT_INDIC.h` (tudo por botão, blob v32). | def `ExternalDualSwitchCard` / `ExtIndicConfig` em `app.jsx` |

### Aba DISPLAY — `DisplaySection` (def `app.jsx:9408`; renderizada em `section === 'display'` `app.jsx:10209`)
| Card | Função | 📍 Código |
|---|---|---|
| **Gig View** | Toggle de visão de palco + nomes do preset em LIVE/BANK. | `app.jsx:8577` |
| **Layout LIVE** | `GLayoutMiniSketch` (4 layouts fixos + CUSTOM) + `IconShapeSegmented`. No CUSTOM, `CustomLayoutEditor` controla visibilidade, posição e tamanho dos SW1..SW6. | `app.jsx` |
| **Layout PRESET** | Tela clássica + 4 layouts fixos + LISTA + CUSTOM independente do LIVE (`presetLayout` 0..6). O CUSTOM usa configuração própria de visibilidade, posição e tamanho. | `app.jsx` |
| **`IconShapeSegmented`** | Segmented dos 3 formatos de tile, reusado nos 2 cards (valores independentes). | def `app.jsx:9722` |
| **BPM no display** | Card do TAP TEMPO: duração do card de BPM na tela (OFF/2/5/10s, `bpm_card_secs`; 0 = OFF esconde a seção de valor) + valor mostrado (Absoluto = 2 últimos toques / Médio = média da sequência, `bpm_card_avg`). Firmware em `BPM_OVERLAY.h`. | card `app.jsx:9713` |
| ~~Indicadores ESW~~ | **Movido** pra dentro dos cards External SW (GLOBAL > MIDI) — ver `ExtIndicConfig` abaixo. | — |
| **Imagens & Ícones** | Abre `CardUploadImages` / `CardUploadIcons` (mídia). | card `app.jsx:8659` · img `app.jsx:7866` · icon `app.jsx:8233` |

### Aba LEDS (`section === 'leds'` `app.jsx:10224`)
| Card | Função | 📍 Código |
|---|---|---|
| **Brilho** | Slider PWM 0–100%. | `app.jsx:9326` |
| **Bancos & Presets** | Cor do LED por letra (A–J) ou por switch (1–6) (`FootswitchArc`). | `app.jsx:9349` |
| **Preview** | Toggle "LED preview no LIVE". | `app.jsx:9389` |
| **Dedicados** | Cor do LED de LIVE MODE e LAYER 2 (o toggle "habilitar Layer 2" saiu daqui — virou POR PRESET, ícone L2 no header do NowPlayingCard). | `app.jsx:9420` |

### Aba BANCOS (`section === 'banks'` `app.jsx:10370`)
| Card | Função | 📍 Código |
|---|---|---|
| **Auto-start** | Liga/desliga preset no boot; modo BANK/LIVE; banco + preset inicial. | `app.jsx:9458` |
| **Trocar bancos** | Modo de seleção: HÍBRIDO vs SINGLE (`bankChangeMode` 1/2). | `app.jsx:9496` |
| **Bancos ativos** | Chips A–J para habilitar/desabilitar cada letra. | `app.jsx:9507` |

---

## 3. Página SYSTEM — `PageSystemConfig`

📍 `app.jsx:11261` — 4 abas (`bf-icon-tabs` `app.jsx:11342`): **PRINCIPAL · WIFI · USB HOST · BACKUP**.

### Aba PRINCIPAL (`app.jsx:10457`)
| Card | Função | 📍 Código |
|---|---|---|
| **Modelo** | Família (BFMIDI 1/2/3) + variante (`MODELS`, nº de switches + tamanho). Reinicia. | `app.jsx:10462` |
| **Idioma** | PT / EN / ES (`useBfI18n` `app.jsx:62`). | `app.jsx:10519` |
| **SW6 = SW Global** *(só NANO)* | SW6 vira footswitch do SW GLOBAL. Reinicia. | `app.jsx:10560` |
| **Remapping** *(só MICRO, `hasMicro`)* | Gira a tela 0/90/180/270° + remapeia foots. Reinicia. | `app.jsx:10587` |
| **`HardTestCard`** | Teste de hardware (LEDs/Display/MIDI), 10s + tema do sistema. | def `app.jsx:10998` |

### Aba WIFI (`app.jsx:10625`)
| Card | Função | 📍 Código |
|---|---|---|
| **Estado da conexão** | Card educativo com 4 estados (offline/AP/STA/USB), o atual destacado. | `app.jsx:10628` |
| **Conexão** | Status STA/AP, seletor SSID, senha, SCAN (só AP/USB) + CONECTAR. | `app.jsx:10700` |
| **Redes próximas** | Lista do scan (RSSI/barras/cadeado); clique preenche SSID. | `app.jsx:10783` |

### Aba USB HOST (`app.jsx:10826`) — cards extras só em BFMIDI-3
| Card | Função | 📍 Código |
|---|---|---|
| **USB Host** | Status do MCU sibling (fabricante/produto/status/última frame) + atualizar. | `app.jsx:10850` |
| **Modo** *(BFMIDI-3)* | TONEX ONE vs USB HOST + modo de update do firmware do host. | `app.jsx:10875` |
| **Filtro MIDI** *(BFMIDI-3)* | OMNI ou canal 1–16. | `app.jsx:10909` |
| **Teclado BLE** *(BFMIDI-3)* | Habilita/desabilita BLE keyboard. | `app.jsx:10937` |
| **MIDI BFMiDi** *(BFMIDI-3)* | MIDI reverso + Control Host (navega por PC/CC) + canal. | `app.jsx:10967` |

### Aba BACKUP (`app.jsx:11024`)
| Card | Função | 📍 Código |
|---|---|---|
| **`BackupRestoreCard`** | "Backup Completo": exportar/importar backup de presets (v3, incluir imagens/ícones; chunked em USB). | def `app.jsx:11272` |
| **`SinglePresetCard`** | "Preset Único": export/import de 1 preset (só header+sw*, sem mídia), client-side sobre `/backup`+`/restore`. Seletores banco/preset de ORIGEM (export) e DESTINO (import re-chaveia a tag → reloca o slot). | def `app.jsx` |
| **`EraseDataCard`** | Zera presets ou config global (destrutivo, com confirmação). | def `app.jsx:10931` |
| **`StorageCard`** | Uso LittleFS/NVS: 4 barras (Presets/Imagens/Ícones/NVS) via GET `/storage`. | def `app.jsx:11123` |

---

## Raiz — `App()` (hub de estado)

📍 `app.jsx:12398`. Todo `useState` global vive aqui e desce por props às 3 páginas:

| Responsabilidade | Como | 📍 Código |
|---|---|---|
| **Round-trip da config GLOBAL** | `tryLoad`/`reloadGlobalConfig` (GET `/config/global`) + `saveGlobalConfig` (POST, body com todos os campos) + assinatura de dirty (`globalConfigSignature`). | grep `globalConfigSignature` |
| **Estado do preset ativo** | `loadBankCurrent` (GET `/bank/current`: meta+data+sw_params) + poll leve GET `/bank/live` (~280 B; refetch do `/bank/current` só em troca de preset detectada; pausa quando `liveDirty`). | grep `loadBankCurrent` |
| **LAYER do editor** | `editorLayer` (1/2) + `toggleEditorLayer` (swap atômico ativo↔stash dos 6 estados sw* + espelho POST `/live/layer`); `layer2Enabled` = flag POR PRESET (`meta.layer2`), alimentado por `/bank/current`, pastes e pelo handle do editor (`registerPresetSave`); effect força L1 quando o flag desliga. | grep `toggleEditorLayer` |
| **Save de preset** | `registerPresetSave` guarda o handle `{save,status,isDirty,meta,update}` do `PresetEditorCard`; o SAVE do `TabBar` chama `handle.save()`. | grep `registerPresetSave` |
| **Clipboards** | COPY/PASTE de preset / layer / bank (snapshots de saved* + POSTs batch). | grep `presetClipboard` |
| **Transportes** | `usbState`/Web Serial ↔ `_transport` (`api.js`); modo AP/STA; `ConnectionScreen` até conectar. | grep `usbSendCommand` |

## Componentes transversais (atoms / helpers)

| Componente | Papel | 📍 Código |
|---|---|---|
| **`StatusBar`** | Relógio/status no topo. | `app.jsx:716` |
| **`PageHeader`** | Cabeçalho de página (WiFi/USB/conexão/monitor/tema). | `app.jsx:2019` |
| **`TabBar`** | Navegação PRESET/GLOBAL/SYSTEM + SAVE + menu "+" (copy/paste). | `app.jsx:12552` |
| **`BrightnessSlider`** | Slider de brilho. | `app.jsx:744` |
| **`FootswitchArc`** | Seletor visual de cor de LED (arco do footswitch). | `app.jsx:796` |
| **`ColorBar`** | Seletor de cor (barra). | `app.jsx:1017` |
| **`BfSelect`** | Select estilizado (chevron/wheel). | `components/wheel.jsx:378` |
| **`SwModeIcon`** | Ícone do modo de SW. | `app.jsx:3442` |
| **`SwIconImg`** | `<img>`/render de ícone de SW. | `app.jsx:5716` |
| **`LiveLayoutSketch`** | Preview do layout do display LIVE. | `app.jsx:879` |
| **`GLayoutMiniSketch`** | Mini-sketch dos 4 layouts (aba DISPLAY). | `app.jsx:9636` |
| **`ImageEditor`** | Modal crop/zoom/brilho + texto (até 5 caixas, 8 fontes) → JPEG. | `app.jsx:8172` |
| **`IconEditor`** | Modal de ajuste de ícone PNG 100×100 (drag/wheel). | `app.jsx:9118` |
| **`CardUploadImages`** | Upload de slots de imagem (`/img/*`). | `app.jsx:8932` |
| **`CardUploadIcons`** | Upload de slots de ícone (`/icon/*`). | `app.jsx:9333` |
| **`useMediaManager`** | Hook: seleção múltipla + excluir tudo + upload em lote (auto-ajuste). Compartilhado pelos 2 cards. | `app.jsx:8771` |
| **`MediaManageBar`** | Barra de ações (carregar em lote / selecionar / excluir) dos cards de mídia. | `app.jsx:8882` |
| **`imageFileToJpegBlob` / `iconFileToPngBlob`** | Normalização de arquivo→Blob pro lote (cover JPEG / contain PNG), sem editor. | `app.jsx:8728` / `:8745` |
| **`StudioToggle` / `StudioToggleRow`** | Toggle PRESET/LIVE com badge de layer. | `pages/bank.jsx:740` / `:777` |
| **`StudioSwGlyph`** | Glyph SVG mini por modo de SW (tiles do preview). | `pages/bank.jsx:106` |
| **`BfToggle`** | Toggle simples ON/OFF (atom). | `app.jsx:5078` |
| **`EditorSlider`** | Slider dos modais de mídia (zoom/brilho). | `app.jsx:8630` |
| **`HomeIndicator`** | Barra inferior estilo iOS (safe-area). | `app.jsx:736` |
| **`PasteProgressModal`** | Progresso dos pastes multi-POST (preset/layer/bank). | `app.jsx:12855` |
| **`MonitorView` / `MonitorCopyButton`** | Monitor MIDI (popup) + copiar. | `app.jsx:7954` / `:7916` |

## Camada de dados (módulos extraídos)

| Módulo | Conteúdo | 📍 Código |
|---|---|---|
| **`api.js`** | `apiCall` (roteia HTTP/USB), `apiUrl`, `DEVICE_API`, `queuedFetch`, `_transport`, helpers de IP. | `api.js` |
| **`stores.js`** | `ImageStore` (`/img/*`) + `IconStore` (`/icon/*`), `IMAGE_SLOT_COUNT`, `ICON_UPLOAD_*`. | `stores.js` |
| **`i18n.js`** | `BF_I18N` + `useBfI18n` (idioma da UI). *(também há cópia em `app.jsx:52`/`:63`)* | `i18n.js` |
| **`pages/bank.jsx`** | `StudioPicker` (pill+wheel dos selects do card), `NowPlayingCard`, `SwPreviewGrid`, `StudioToggle`, `StudioToggleRow`. | `pages/bank.jsx:30` / `:192` / `:632` / `:740` / `:777` |
| **`components/wheel.jsx`** | `WheelPopup` (roda/drum picker modal — usado por `BfSelect` e `StudioPicker`) + `BfSelect` (select estilizado). | `components/wheel.jsx:90` / `:378` |
| **`kemper_nrpn.js`** (gerado) / **`kemper_values.js`** (manual) / **`pedal_labels.js`** (gerado) / **`pedal_values.js`** (manual) | Nomes de CC/PC e rótulos de VALOR enumerado (Kemper + pedais UAFX/TONEX/**VTR** do Modo Amigável — consumidos por `valueLabelsFor`→`kemperValueOptionElems`/`kemperSnapValue`). Defs VTR (Bypass/Algoritmo/Clipagem/Rhythmic Figure, do MIDI chart v1.0) usam `sparse: true` p/ CCs de FAIXA (só as âncoras rotuladas aparecem no wheel). | raiz `webApp/` |

## Build & PWA

| Item | Papel | 📍 Código |
|---|---|---|
| **`build.mjs`** | Pipeline esbuild: bundle `app.jsx`→`../data/app.js`, aliases React→Preact (`PREACT_ALIASES` + `build/react-inject.js`), defines `__BF_ICON_COUNT__`/`__BF_COLOR_ICON_IDS__` (de `icons/build/ICONS_META.json`), gzip de `app.js`/`app.css` no build de produção (`BF_NO_GZIP=1` desliga p/ servidores estáticos burros), geração do `sw.js` de produção (CACHE_NAME com hash de conteúdo). `npm run dev` = watch sem gzip. | `build.mjs` |
| **`sw.js`** (gerado em `data/`) | Service worker PWA: `APP_SHELL` cacheado no install, invalidação por hash no activate. O `webApp/sw.js` fonte é só do DEV — nunca copiar pra `data/`. | `build.mjs` (função de geração) |
| **`index.html`** / **`manifest.webmanifest`** / **`icons/`** | Template da SPA + manifest/ícones do PWA. | raiz `webApp/` |
| **`serve_webapp.py`** / bats `abrir_*` | Servem `data/` num http.server local com `?api=<ip>` p/ desenvolvimento cross-origin (CORS aberto no device). | `serve_webapp.py` |

## Constantes-chave (topo de `app.jsx`)

| Constante | Papel | 📍 Código |
|---|---|---|
| **`BF_I18N` / `useBfI18n`** | i18n da UI. | `app.jsx:52` / `:63` |
| **`LED_COLORS`** | Paleta de LED (id 0..14, igual ao firmware). | `app.jsx:82` |
| **Paleta de display** | Cores de display (distinta de LED). | `app.jsx:99` |
| **`MODELS`** | Catálogo de placas (sync com `AVAILABLE_BOARDS` em `BOARDS.h`). | `app.jsx:347` |
| **`SW_MODES`** | Lista dos modos de SW. | `app.jsx:2151` |

## Manutenção

Os números de linha rodam a cada edição. Para manter este índice honesto (a partir
da **raiz do repo**, não de `webApp/`):

```
node tools/gen_structure.mjs          # verifica (DRIFT = linha mudou; SUMIDO = renomeado/removido)
node tools/gen_structure.mjs --fix    # corrige os números de linha in-place
```

O verificador re-localiza cada componente por **grep da definição** (`function X` /
`const X =`), preserva as descrições e só toca nos números. As linhas `def` são
verificadas; `uso` (call-site) fica como está. Ids de dado (`fx1`, `mute`…) e props
(`hasExp`…) são ignorados de propósito (não são definições).
