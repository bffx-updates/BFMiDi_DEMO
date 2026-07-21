// ─── BANK page · STUDIO redesign ─────────────────────────────────────
// Componentes visuais novos do redesign Studio (refactor2/BFMIDI Redesign.html).
// Modulo FOLHA: so depende do React/Preact ja injetado globalmente; nao
// importa nada do app.jsx. Quem consome (PagePresetConfig) passa props.
//
// Origem do design: refactor2/project/variants/v1-studio.jsx (handoff bundle
// de Claude Design). DNA: iOS dark + laranja BFMIDI (#ff6a1f), Inter Tight
// pro texto, JetBrains Mono nos labels, Antonio nos numerais.
//
// Esse modulo entrega DUAS pecas, ambas opt-in (mobile only):
//   - NowPlayingCard: card "Tocando agora" com nome do preset, mini-meter,
//     toggle PRESET/LIVE e selectors PC + CANAL.
//   - SwPreviewGrid:  grid 3x2 dos 6 SWs do preset ativo em LIVE — visual
//     (preview no-touch), exibe icone do modo + sigla + LED dot + tag stripe.
//
// Comportamento e estilos vivem aqui (inline + classes .bf-studio-*); as
// classes correspondentes ficam em app.css.

import { WheelPopup } from '../components/wheel.jsx';

const { useMemo, useState } = React;

// ─── StudioPicker ─────────────────────────────────────────────────────
// Picker custom com visual Studio. Substitui o <select> nativo (dropdown
// branco feio do SO). Mantem o pill como trigger; ao clicar, abre o
// WheelPopup (roda/drum picker centralizado, em ../components/wheel.jsx).
//
// `options` aceita o mesmo formato que midiOptionElems / channelOptionElems
// retornam (array de <option> JSX elements) — repassado direto ao WheelPopup.
export function StudioPicker({
  value, onChange,
  options,           // array de <option> elements (mesmo que <select> consome)
  ariaLabel, title,
  // Visual: 'pill' (padrao, usado pelo NowPlayingCard) ou 'pill-lg'.
  variant,
  labelText,         // texto pequeno acima do valor (PC / Canal)
  valueText,         // texto do valor visivel (42 / CH 03 / OFF)
  accent,            // forca cor laranja no valor (canal selected)
  mute,              // canal=0 (renderiza "OFF" em accent)
  disabled,
  className,
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={
        'bf-studio-picker' +
        (open ? ' is-open' : '') +
        (disabled ? ' is-disabled' : '') +
        (className ? ' ' + className : '')
      }
    >
      <button
        type="button"
        className={
          'bf-studio-np-pill' +
          (variant === 'pill-lg' ? ' bf-studio-np-pill-lg' : '') +
          (accent ? ' is-accent' : '') +
          (mute ? ' is-mute' : '')
        }
        onClick={() => !disabled && setOpen(true)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
      >
        {labelText && <span className="bf-studio-np-pill-l">{labelText}</span>}
        <span className="bf-studio-np-pill-v">{valueText}</span>
        <span className="bf-studio-np-pill-chev">▾</span>
      </button>

      <WheelPopup
        open={open}
        onClose={() => setOpen(false)}
        value={value}
        onChange={(v) => onChange && onChange(v)}
        options={options}
        title={labelText}
        ariaLabel={ariaLabel || labelText}
      />
    </div>
  );
}


// Cores dos LEDs por modo de SW — espelham a paleta usada no LIVE preview.
// Ids do SW_MODES (app.jsx::SW_MODES) -> cor RGB do LED. Para modos sem
// cor dedicada, cai no laranja accent.
const STUDIO_MODE_LED = {
  fx1:       '#ff6a1f', // STOMP
  fx2:       '#ff6a1f',
  fx3:       '#ff6a1f',
  spin:      '#ff453a',
  ramp:      '#30d158',
  momentary: '#a872ff',
  tap_tempo: '#3a8dff',
  macros:    '#ffb04a',
  single:    '#ffb04a',
  mute:      'rgba(235,235,245,0.30)',
};

// Mapa id-do-modo -> SVG glyph mini pro tile. Renderiza placeholder estilizado
// na ausencia de icone real. Cada SVG aceita { color, lit }.
function StudioSwGlyph({ modeId, color, lit }) {
  const fg = lit ? color : 'rgba(235,235,245,0.7)';
  const glow = lit ? `drop-shadow(0 0 4px ${color}aa)` : 'none';
  const common = {
    width: 26, height: 26, viewBox: '0 0 24 24',
    fill: 'none', stroke: fg, strokeWidth: 1.6,
    strokeLinecap: 'round', strokeLinejoin: 'round',
    style: { filter: glow },
  };
  switch (modeId) {
    case 'fx1': case 'fx2': case 'fx3': // STOMP — pedal-shape
      return (
        <svg {...common}>
          <path d="M5 8 C5 5, 8 4, 12 4 C16 4, 19 5, 19 8 L19 17 C19 19, 17 20, 12 20 C7 20, 5 19, 5 17 Z"/>
          <circle cx="12" cy="9" r="2" fill={fg} stroke="none"/>
        </svg>
      );
    case 'tap_tempo':
      return (
        <svg {...common}>
          <path d="M7 16 L7 9"/>
          <path d="M12 16 L12 5" strokeWidth="2"/>
          <path d="M17 16 L17 11"/>
          <path d="M5 19 L19 19"/>
        </svg>
      );
    case 'ramp':
      return (
        <svg {...common}>
          <path d="M5 18 L19 6"/>
          <circle cx="19" cy="6" r="1.5" fill={fg} stroke="none"/>
        </svg>
      );
    case 'spin':
      return (
        <svg {...common}>
          <circle cx="12" cy="5"  r="2" fill={fg} stroke="none"/>
          <circle cx="5"  cy="17" r="2" fill={fg} stroke="none" opacity="0.5"/>
          <circle cx="19" cy="17" r="2" fill={fg} stroke="none" opacity="0.5"/>
        </svg>
      );
    case 'momentary':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" opacity="0.4"/>
          <circle cx="12" cy="12" r="6" opacity="0.6"/>
          <circle cx="12" cy="12" r="3.5" fill={fg} stroke="none"/>
        </svg>
      );
    case 'macros':
      return (
        <svg {...common}>
          <rect x="5" y="5" width="6" height="6" rx="1"/>
          <rect x="13" y="5" width="6" height="6" rx="1"/>
          <rect x="5" y="13" width="6" height="6" rx="1"/>
          <rect x="13" y="13" width="6" height="6" rx="1"/>
        </svg>
      );
    case 'single':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7"/>
          <circle cx="12" cy="12" r="2" fill={fg} stroke="none"/>
        </svg>
      );
    case 'mute':
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" fill={fg} stroke="none" opacity="0.5"/>
        </svg>
      );
  }
}

// ─── Now Playing card ─────────────────────────────────────────────────
// Visual do "TOCANDO AGORA". Absorve os campos PC + CANAL + NOME que
// antigamente moravam na aba PRESET do PARAMETROS card — em mobile a
// aba some (PresetEditorCard.hidePresetTab=true) e esta e a unica
// entrada de edicao desses campos.
//
// Quando `onPcChange`/`pcOptions` sao passados, o pill PC vira um
// <select> nativo (mantido visualmente como pill). O mesmo vale pra
// CANAL e pra NOME do preset (clicar no titulo torna o nome editavel).
// Quando ausentes (ex: LIVE mode, PresetEditorCard nao montado), os
// pills caem pra display read-only com "—".
export function NowPlayingCard({
  tag, displayName, presetCount,
  // Eyebrow/titulo do card. Default: "Tocando agora". O pai pode passar
  // texto i18n via `cardTitle` (ex: t('bank.nowplaying')).
  cardTitle,
  switchMode, onSetSwitchMode,
  // Edicao real do preset (vinda do PresetEditorCard via App):
  pcValue, onPcChange, pcOptions,
  channelValue, onChannelChange, channelOptions,
  nameValue, onNameChange,
  // Extras: lista de {idx, ch, program} so dos slots ATIVOS (ch !== 0).
  // canAddExtra: ha algum slot livre. Cada extra tem PC range diferente
  // (MIDI_VALUES_128) do PC principal (PC_VALUES_601) — por isso o pai
  // passa o builder de options por linha.
  extras, canAddExtra,
  onAddExtra, onUpdateExtra, onRemoveExtra,
  // onRemoveMain: clicar no × da linha PRINCIPAL — promove o primeiro
  // extra ativo pra main slot (data shuffle no pai), removendo aquele
  // extra. So renderiza o × quando ha extras PC ativos pra promover.
  onRemoveMain,
  // Tipo do envio extra: cada item de `extras` carrega type 'pc' | 'cc'.
  //   - 'pc' = slot de extra_pcs {idx, ch, program}
  //   - 'cc' = slot de extra_ccs {idx, ch, ctrl, value} — VALOR FIXO
  //     (toggle ON=127 / OFF=0 na linha; sem picker de valor).
  // onToggleExtraType(entry) converte a linha PC<->CC (o pai faz o data
  // shuffle entre os dois arrays); canExtraToCc/canExtraToPc indicam se
  // ha slot livre do tipo destino (sem ele o botao desabilita).
  onToggleExtraType, canExtraToCc, canExtraToPc,
  // buildExtraCcValueOptions(value, ch, cc) -> <option>s do VALOR do CC
  // extra (0..127; com rotulos amigaveis quando o canal resolve pra um
  // pedal com labels de valor — Kemper/UAFX, ver kemperValueOptionElems).
  buildExtraPcOptions, buildExtraCcOptions, buildExtraChannelOptions,
  buildExtraCcValueOptions,
  // Slot pra integrar a aba TELA do PresetEditorCard dentro do mesmo
  // card no mobile — o pai passa <PresetEditorCard noFrame /> como
  // children pra unificar visualmente. (Em LIVE mode nao passa nada e o
  // card fica curto, so com nome+toggle+pills.)
  children,
  // LAYER 1/2 — em LIVE mode aparece um botao texto "LAYER N" no canto
  // sup. direito (substitui o TELA quadrado). Clicar troca pra outro
  // layer. Se layer2Enabled=false, o botao some por completo (so existe
  // 1 layer, nao ha pra onde alternar). layer2Enabled e POR PRESET
  // (meta.layer2 — working copy do editor).
  editorLayer, onSetEditorLayer, layer2Enabled,
  // Toggle do LAYER 2 do PRESET (icone circular "L2" no header, so em
  // PRESET mode). Clicar liga/desliga meta.layer2 na working copy — o
  // SAVE do rodape persiste. Ausente (LIVE/sem editor) => icone some.
  onToggleLayer2,
  // MASTER dos indicadores ESW1/ESW2 por preset. So aparece quando a placa
  // possui entrada de SW externo. Ligado ainda respeita o escopo individual
  // PRESET/LIVE/OFF configurado em GLOBAL; desligado bloqueia todos.
  hasExtIndicators, extIndicEnabled, onToggleExtIndic,
  // Strings de UI traduzidas (i18n). Vem do pai pra evitar bank.jsx
  // importar app.jsx ou i18n.js diretamente. Se ausente, usa fallback PT
  // (mesmo texto que estava hardcoded antes — preserva acessibilidade
  // mesmo em standalone/tests).
  i18n,
}) {
  // Acessor com fallback PT. Aceita funcao (pra interpolar {n}) ou string.
  const I = i18n || {};
  const tx = (k, n, fb) => {
    const v = I[k];
    if (typeof v === 'function') return v(n);
    return v || fb;
  };
  // O titulo mostra o nome editavel (se onNameChange) ou cai pro bankDisplayName
  // / tag pra preservar o "header" mesmo quando nao tem meta carregada.
  const titleName = ((nameValue || '').trim())
    || (displayName && displayName.trim())
    || tag || '';
  const isLive = switchMode === 'live';

  // Procura o label "amigavel" das <option> pra mostrar no pill preview
  // quando ha nome de pedal/PC configurado (igual o dropdown mostra).
  // Retorna a string da label, ou null se nao encontrou / valor bare.
  // Definidos AQUI (antes do primeiro uso) pra evitar TDZ — const nao
  // hoista, entao usar antes da declaracao explode.
  const friendlyLabel = (opts, val) => {
    if (!Array.isArray(opts) || val == null) return null;
    for (const opt of opts) {
      if (!opt || !opt.props) continue;
      if (opt.props.value != val) continue;
      const c = opt.props.children;
      if (typeof c === 'string') return c;
      if (typeof c === 'number') return String(c);
      if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' || typeof x === 'number') ? x : '').join('');
      return null;
    }
    return null;
  };
  // Heuristica "tem nome de verdade": label nao e somente digitos.
  const hasName = (lbl) => typeof lbl === 'string' && /[^\d\s]/.test(lbl);

  // PC preview: usa o nome amigavel se existir (PC_LABELS[pedal][n]). Caso
  // contrario, mostra o numero puro. (midiOptionElems devolve so o nome quando
  // ha label custom, senao o numero.)
  const pcFriendly = friendlyLabel(pcOptions, pcValue);
  const pcLabel = hasName(pcFriendly)
    ? pcFriendly
    : ((pcValue ?? null) !== null ? String(pcValue) : '—');
  // CANAL preview: se a label customizada vier do channelOptionElems
  // (formato "n - PedalName"), usa ela. Senao monta "CH NN" padrao.
  const chFriendly = friendlyLabel(channelOptions, channelValue);
  const chLabel = channelValue === 0
    ? (chFriendly && chFriendly !== '0' ? chFriendly : 'OFF')
    : (hasName(chFriendly)
        ? chFriendly
        : (channelValue ? `CH ${String(channelValue).padStart(2, '0')}` : 'CH —'));

  const pcEditable = !!onPcChange && Array.isArray(pcOptions);
  const chEditable = !!onChannelChange && Array.isArray(channelOptions);
  const nameEditable = !!onNameChange;

  // Painel de TELA (display config) — fechado por default. O botao de
  // toggle vive no canto superior direito do card; abrir mostra o
  // conteudo (children) como dropdown inline abaixo.
  const hasExtras = !!children;
  const [extrasOpen, setExtrasOpen] = useState(false);

  // Extras PC ativos — gate do × da linha PRINCIPAL (promover main so faz
  // sentido com um PC extra; linhas CC nao podem virar o PC principal).
  // Itens legados sem `type` contam como PC.
  const pcExtras = Array.isArray(extras)
    ? extras.filter((x) => x && x.type !== 'cc')
    : [];

  // Subtitulo: "Bank NNNN · N footswitches" — NNNN = PC principal padded 4
  // digitos (combinacao MSB+LSB 0..16383, na pratica 0..600 pelo clamp).
  const bankCode = (pcValue ?? null) !== null
    ? String(pcValue).padStart(4, '0')
    : null;
  const swCount = presetCount || 0;

  return (
    <section className="bf-studio-now-playing">
      {/* Header: eyebrow esquerda + ACOES DA DIREITA. Em LIVE mode + layer2Enabled,
          mostra um botao texto "LAYER N" que troca pra outro layer (substitui o
          TELA quadrado). Em PRESET mode mantem os botoes TELA + SLOT+. */}
      <div className="bf-studio-np-head">
        <span className="bf-studio-np-eyebrow">• {cardTitle || 'Tocando agora'}</span>
        <div className="bf-studio-np-head-right bf-studio-np-head-right-stack">
          {isLive && layer2Enabled && onSetEditorLayer && (
            <button
              type="button"
              className={'bf-studio-np-layer-btn' + (editorLayer === 2 ? ' is-l2' : '')}
              onClick={() => onSetEditorLayer(editorLayer === 2 ? 1 : 2)}
              aria-label={tx('layerSwitch', editorLayer === 2 ? 1 : 2, `Trocar para LAYER ${editorLayer === 2 ? 1 : 2}`)}
              title={tx('layerSwitch', editorLayer === 2 ? 1 : 2, `Trocar para LAYER ${editorLayer === 2 ? 1 : 2}`)}
            >
              LAYER {editorLayer === 2 ? 1 : 2}
            </button>
          )}
          {/* L2 — toggle do LAYER 2 por preset (circulo "L2"). ON =
              destacado; OFF = apagado. So em PRESET mode (a edicao de
              meta nao existe em LIVE). */}
          {!isLive && onToggleLayer2 && (
            <button
              type="button"
              className={'bf-studio-np-l2-sq' + (layer2Enabled ? ' is-on' : '')}
              onClick={onToggleLayer2}
              aria-pressed={!!layer2Enabled}
              aria-label={layer2Enabled
                ? tx('layer2On', null, 'Layer 2 ativado neste preset — clique para desativar')
                : tx('layer2Off', null, 'Layer 2 desativado neste preset — clique para ativar')}
              title={layer2Enabled
                ? tx('layer2On', null, 'Layer 2 ativado neste preset — clique para desativar')
                : tx('layer2Off', null, 'Layer 2 desativado neste preset — clique para ativar')}
            >
              <span aria-hidden="true">L2</span>
            </button>
          )}
          {!isLive && hasExtras && (
            <button
              type="button"
              className={'bf-studio-np-tela-sq' + (extrasOpen ? ' is-open' : '')}
              onClick={() => setExtrasOpen((v) => !v)}
              aria-expanded={extrasOpen}
              aria-label={tx('displayConfigAria', null, 'Configuracao de tela do preset')}
              title={tx('displayConfigTitle', null, 'Configurar display do preset')}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2.5" y="4.5" width="19" height="12" rx="1.6" />
                <rect x="6"  y="11" width="1.6" height="3.5" fill="currentColor" stroke="none"/>
                <rect x="9"  y="9"  width="1.6" height="5.5" fill="currentColor" stroke="none"/>
                <rect x="12" y="7"  width="1.6" height="7.5" fill="currentColor" stroke="none"/>
                <rect x="15" y="10" width="1.6" height="4.5" fill="currentColor" stroke="none"/>
                <rect x="18" y="12" width="1.6" height="2.5" fill="currentColor" stroke="none"/>
                <path d="M9 21h6 M12 16.5v4.5" />
              </svg>
            </button>
          )}
          {/* SLOT+ — inverso de TELA: visivel SO quando o painel TELA esta
              fechado. Mesmo tamanho do TELA (56×56), ao lado dele.
              Em LIVE mode o lugar dos botoes e do "LAYER N", entao oculta. */}
          {!isLive && onAddExtra && !extrasOpen && (
            <button
              type="button"
              className="bf-studio-np-slot-sq"
              onClick={onAddExtra}
              disabled={!canAddExtra}
              aria-label={tx('addExtraPc', null, 'Adicionar PC + Canal extra')}
              title={canAddExtra ? tx('addExtraPc', null, 'Adicionar PC + Canal extra') : tx('addExtraLimit', null, 'Limite de extras atingido')}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
                   stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Titulo + accent stripe laranja vertical na esquerda. Em LIVE
          mode os botoes de acao do header (TELA/SLOT+) nao renderizam,
          entao zeramos o padding-right reservado pra eles. */}
      <div className={
        'bf-studio-np-title-row bf-studio-np-title-row-accent' +
        (isLive ? ' is-live-summary' : '')
      }>
        <span className="bf-studio-np-accent-bar" aria-hidden="true" />
        <div className="bf-studio-np-title-wrap">
          {nameEditable ? (
            <input
              type="text"
              className="bf-studio-np-title bf-studio-np-title-input"
              value={nameValue || ''}
              placeholder={tag}
              maxLength={16}
              spellCheck={false}
              onChange={(e) => onNameChange(e.target.value)}
              aria-label={tx('nameAria', null, 'Nome do preset')}
            />
          ) : (
            <h2 className="bf-studio-np-title" title={titleName}>{titleName || '—'}</h2>
          )}
        </div>
      </div>

      {/* PRESET/LIVE toggle removido daqui — agora vive na linha de toggles
          (StudioToggleRow) abaixo do card, ao lado do LAYER 1/2. */}

      {/* PC + CANAL pickers — visíveis SO em PRESET mode. Em LIVE mode o
          card vira resumo (titulo + subtitulo), sem campos editaveis.
          Botao "×" da linha principal so aparece quando ha extras ativos
          (>=1 slot ativo); clicar promove o primeiro extra pra main. */}
      {!isLive && (
        <div className="bf-studio-np-meta">
          <StudioPicker
            variant="pill-lg"
            labelText="PC"
            valueText={pcLabel}
            value={pcValue}
            options={pcOptions}
            onChange={(v) => pcEditable && onPcChange(v)}
            disabled={!pcEditable}
            ariaLabel={tx('pcAria', null, 'Program Change do preset')}
          />
          <div className={'bf-studio-np-extra-wrap' + (onRemoveMain && pcExtras.length > 0 ? '' : ' is-no-x')}>
            <StudioPicker
              variant="pill-lg"
              labelText={tx('channelLabel', null, 'Canal')}
              valueText={chLabel}
              value={channelValue}
              options={channelOptions}
              onChange={(v) => chEditable && onChannelChange(v)}
              disabled={!chEditable}
              accent
              mute={channelValue === 0}
              ariaLabel={tx('chAria', null, 'Canal MIDI do preset')}
            />
            {onRemoveMain && pcExtras.length > 0 && (
              <button
                type="button"
                className="bf-studio-np-extra-x"
                onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); onRemoveMain(); }}
                aria-label={tx('removeMainAria', null, 'Remover este PC (promove o proximo)')}
                title={tx('removeMainTitle', null, 'Remover este PC (o proximo vira o principal)')}
              >
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none"
                     stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {!isLive && hasExtIndicators && onToggleExtIndic && (
        <div className="bf-studio-np-esw-master">
          <div className="bf-studio-np-esw-copy">
            <span className="bf-studio-np-esw-label">
              {tx('extIndicLabel', null, 'SW EXTERNOS NO DISPLAY')}
            </span>
            <span className="bf-studio-np-esw-hint">
              {tx('extIndicHint', null, 'Master deste preset; PRESET/LIVE seguem as opções globais.')}
            </span>
          </div>
          <button
            type="button"
            className={'bf-switch is-accent' + (extIndicEnabled ? ' is-on' : '')}
            onClick={onToggleExtIndic}
            aria-pressed={!!extIndicEnabled}
            aria-label={extIndicEnabled
              ? tx('extIndicOn', null, 'Indicadores externos ativados neste preset')
              : tx('extIndicOff', null, 'Indicadores externos desativados neste preset')}
            title={extIndicEnabled
              ? tx('extIndicOn', null, 'Indicadores externos ativados neste preset')
              : tx('extIndicOff', null, 'Indicadores externos desativados neste preset')}
          />
        </div>
      )}

      {/* Linhas de envios EXTRAS — PCs (extra_pcs, 4 slots) e CCs
          (extra_ccs, 2 slots) mesclados, PCs primeiro (mesma ordem em que
          o firmware dispara no apply do preset). Cada linha tem um botao
          de TIPO no canto do primeiro pill (converte PC<->CC; desabilita
          sem slot livre do tipo destino). Linhas CC enviam VALOR FIXO —
          toggle ON=127 / OFF=0 na coluna do meio. Botao remove "×" no
          canto do pill do canal (fora do trigger pra nao consumir o
          clique do pill). valueText reusa friendlyLabel pra mostrar nomes
          amigaveis (PC/CC_LABELS do pedal, pedal-name do canal) — espelha
          o dropdown. Visivel SO em PRESET mode (em LIVE o card vira resumo). */}
      {!isLive && Array.isArray(extras) && extras.length > 0 && (
        <div className="bf-studio-np-extras-list">
          {extras.map((e) => {
            const isCc = e.type === 'cc';
            const exNum = isCc ? e.ctrl : e.program;
            const exNumOpts = isCc
              ? (buildExtraCcOptions ? buildExtraCcOptions(e.ctrl, e.ch) : null)
              : (buildExtraPcOptions ? buildExtraPcOptions(e.program, e.ch) : null);
            const exChOpts = buildExtraChannelOptions ? buildExtraChannelOptions() : null;
            const exNumFriendly = friendlyLabel(exNumOpts, exNum);
            const exChFriendly = friendlyLabel(exChOpts, e.ch);
            const exNumText = hasName(exNumFriendly) ? exNumFriendly : String(exNum ?? 0);
            const exChText = e.ch === 0
              ? (exChFriendly && exChFriendly !== '0' ? exChFriendly : 'OFF')
              : (hasName(exChFriendly)
                  ? exChFriendly
                  : `CH ${String(e.ch).padStart(2, '0')}`);
            // Valor do CC (0..127, customizavel). Options do picker vem do
            // pai (labels amigaveis por pedal quando existirem).
            const exVal = isCc ? (Number(e.value) || 0) : 0;
            const exValOpts = isCc
              ? (buildExtraCcValueOptions
                  ? buildExtraCcValueOptions(exVal, e.ch, e.ctrl)
                  : Array.from({ length: 128 }, (_, n) => (
                      <option key={n} value={n}>{n}</option>
                    )))
              : null;
            const exValFriendly = isCc ? friendlyLabel(exValOpts, exVal) : null;
            const canSwitchType = isCc ? canExtraToPc : canExtraToCc;
            const typeTitle = canSwitchType
              ? (isCc
                  ? tx('extraTypeToPc', null, 'Enviar PC em vez de CC')
                  : tx('extraTypeToCc', null, 'Enviar CC em vez de PC (com valor 0-127)'))
              : (isCc
                  ? tx('extraTypeLimitPc', null, 'Sem slot de PC extra livre')
                  : tx('extraTypeLimitCc', null, 'Sem slot de CC extra livre'));
            return (
            <div
              key={(e.type || 'pc') + e.idx}
              className={'bf-studio-np-meta bf-studio-np-meta-extra' + (isCc ? ' bf-studio-np-meta-cc' : '')}
            >
              <div className="bf-studio-np-extra-wrap">
                <StudioPicker
                  variant="pill-lg"
                  labelText={isCc ? 'CC' : 'PC'}
                  valueText={exNumText}
                  value={exNum}
                  options={exNumOpts}
                  onChange={(v) => onUpdateExtra(e, isCc ? { ctrl: Number(v) } : { program: Number(v) })}
                  ariaLabel={isCc
                    ? tx('extraCcAria', e.idx + 1, `CC do envio extra ${e.idx + 1}`)
                    : tx('extraPcAria', e.idx + 1, `Programa do PC extra ${e.idx + 1}`)}
                />
                {onToggleExtraType && (
                  <button
                    type="button"
                    className="bf-studio-np-extra-type"
                    onClick={(ev) => {
                      ev.preventDefault(); ev.stopPropagation();
                      if (canSwitchType) onToggleExtraType(e);
                    }}
                    disabled={!canSwitchType}
                    aria-label={typeTitle}
                    title={typeTitle}
                  >{isCc ? 'PC' : 'CC'}</button>
                )}
              </div>
              {isCc && (
                <StudioPicker
                  className="bf-studio-np-cc-valpick"
                  labelText="VALOR"
                  valueText={String(exVal)}
                  value={exVal}
                  options={exValOpts}
                  onChange={(v) => onUpdateExtra(e, {
                    value: Math.max(0, Math.min(127, Number(v) || 0)),
                  })}
                  ariaLabel={tx('extraCcValAria', e.idx + 1, `Valor do CC extra ${e.idx + 1}`)}
                  title={hasName(exValFriendly)
                    ? exValFriendly
                    : tx('extraCcValTitle', null, 'Valor enviado junto com o CC (0-127)')}
                />
              )}
              <div className="bf-studio-np-extra-wrap">
                <StudioPicker
                  variant="pill-lg"
                  labelText={tx('channelLabel', null, 'Canal')}
                  valueText={exChText}
                  value={e.ch}
                  options={exChOpts}
                  onChange={(v) => onUpdateExtra(e, { ch: Number(v) })}
                  accent
                  mute={e.ch === 0}
                  ariaLabel={isCc
                    ? tx('extraCcChAria', e.idx + 1, `Canal do CC extra ${e.idx + 1}`)
                    : tx('extraChAria', e.idx + 1, `Canal do PC extra ${e.idx + 1}`)}
                />
                <button
                  type="button"
                  className="bf-studio-np-extra-x"
                  onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); onRemoveExtra && onRemoveExtra(e); }}
                  aria-label={tx('removeExtraAria', e.idx + 1, `Remover PC extra ${e.idx + 1}`)}
                  title={tx('removeExtraTitle', null, 'Remover este extra')}
                >
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none"
                       stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18"/>
                  </svg>
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Slot pra aba TELA — children SEMPRE montam pra que o
          PresetEditorCard registre seu handle (meta + update) no pai,
          mesmo com o painel fechado. Sem isso, presetMeta ficava null
          quando TELA estava fechado -> SLOT+ sumia. Visibilidade do
          painel e controlada via classe `is-hidden`. */}
      {hasExtras && (
        <div className={'bf-studio-np-extras' + (extrasOpen ? '' : ' is-hidden')}>
          {children}
        </div>
      )}
    </section>
  );
}

// ─── SW preview grid (3x2) ────────────────────────────────────────────
// Mostra os 6 SWs do preset ativo. Substitui o card antigo
// (.bf-sw-grid-card) no mobile — clicar num tile seleciona o SW e abre
// o editor do LiveModePanel (que continua sendo dono do editor; este
// componente so renderiza a lista visual e dispara o callback).
//
// `tiles` (preferencial): array pronto vindo do pai, cada item:
//    { sw, sigla, modeLabel, color, on, iconNode }
//   onde `iconNode` e um React element renderizado com o SwDisplayTile
//   real (icone do swDisplay, LED state, sigla embutida). Quando o pai
//   passa `iconNode`, ele substitui o conteudo central do tile — assim o
//   icone do PNG real (ICO<id>.png) aparece em vez do placeholder SVG.
// `presetCount`+`swModes`+`swDisplay`+`swLiveOn`+`swLiveColors`:
//   fallback (modo standalone, sem tiles pre-construido) — usa o glyph
//   placeholder StudioSwGlyph. Mantido pra testes isolados do modulo.
export function SwPreviewGrid({
  // controlled mode
  tiles: extTiles,
  // fallback (placeholder glyph)
  presetCount, swModes, swDisplay,
  swLiveOn, swLiveColors,
  // interaction
  onSelectSw,
  selectedSw,
  switchMode,
  // twoRows: layout em 2 linhas de 3 (3 em cima / 3 embaixo) em vez da
  // unica linha compacta de 6. Usado em LIVE mode (mais espaco vertical
  // depois que o card MAIN foi removido).
  twoRows,
}) {
  const tiles = useMemo(() => {
    if (Array.isArray(extTiles) && extTiles.length > 0) return extTiles;
    const count = Math.min(presetCount || 6, 6);
    return Array.from({ length: count }, (_, i) => {
      const mode = (swModes && swModes[i]) || 'fx1';  // default STOMP
      const sigla = (swDisplay && swDisplay[i] && swDisplay[i].sigla) || '';
      const color = (swLiveColors && swLiveColors[i]) || STUDIO_MODE_LED[mode] || '#ff6a1f';
      const on = !!(swLiveOn && swLiveOn[i]);
      return {
        sw: i + 1, sigla, color, on,
        modeLabel: STUDIO_MODE_LABEL[mode] || String(mode).toUpperCase(),
        iconNode: null,
        _mode: mode,
      };
    });
  }, [extTiles, presetCount, swModes, swDisplay, swLiveOn, swLiveColors]);

  const isLive = switchMode === 'live';
  // Layout sempre compacto (6 SWs em 1 linha) em PRESET e LIVE — so o
  // icone, sem labels externas. A sigla ja vem renderizada DENTRO do
  // SwDisplayTile, e a moldura externa com SW idx + modo e redundante.
  const compact = true;

  return (
    <section className="bf-studio-sw-preview">
      <div className="bf-studio-sw-preview-head">
        <span className="bf-studio-sw-preview-eyebrow">
          <span className="bf-studio-sw-preview-eyebrow-dot" />
          Footswitches{isLive ? ' · live' : ''}
        </span>
      </div>
      <div className={
        'bf-studio-sw-preview-grid' +
        (compact ? ' is-compact' : '') +
        (twoRows ? ' is-2rows' : '') +
        (tiles.length <= 4 ? ' is-4sw' : '')
      }>
        {tiles.map((sw) => {
          const lit = !!sw.on;
          const isSel = selectedSw === sw.sw;
          // SW desabilitado (SW5/SW6 em placas 4S/MICRO): miniatura preta, sem
          // clique nem selecao. O iconNode preto ja vem pronto do studioTiles.
          const isDisabled = !!sw.disabled;
          return (
            <button
              key={sw.sw}
              type="button"
              className={
                'bf-studio-sw-tile' +
                (compact ? ' is-compact' : '') +
                (lit ? ' is-lit' : '') +
                (isSel ? ' is-selected' : '') +
                (isDisabled ? ' is-disabled' : '')
              }
              style={{ '--sw-color': sw.color || '#ff6a1f' }}
              onClick={() => { if (!isDisabled && onSelectSw) onSelectSw(sw.sw); }}
              disabled={!onSelectSw || isDisabled}
              aria-disabled={isDisabled}
            >
              {!compact && (
                <span className="bf-studio-sw-tile-top">
                  <span className="bf-studio-sw-tile-idx">SW{sw.sw}</span>
                  <span className="bf-studio-sw-tile-led" />
                </span>
              )}
              <span className="bf-studio-sw-tile-icon">
                {sw.iconNode
                  ? sw.iconNode
                  : <StudioSwGlyph modeId={sw._mode || 'mute'} color={sw.color || '#ff6a1f'} lit={lit} />}
              </span>
              {!compact && (
                <span className="bf-studio-sw-tile-base">
                  <span className="bf-studio-sw-tile-sigla">{sw.sigla || `SW${sw.sw}`}</span>
                  <span className="bf-studio-sw-tile-mode">{sw.modeLabel || ''}</span>
                </span>
              )}
              <span className="bf-studio-sw-tile-stripe" />
              {/* Label "SW1".. abaixo do icone — escondida por padrao
                 (mobile inalterado); revelada so no desktop (.bf-content-bank
                 no @media >=900px). */}
              <span className="bf-studio-sw-tile-label">SW{sw.sw}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ─── StudioToggle ─────────────────────────────────────────────────────
// Pill segmentado de 2 estados — visual unificado do redesign Studio.
// Usado pro PRESET/LIVE e LAYER 1/2, lado-a-lado em StudioToggleRow
// abaixo do NowPlayingCard.
export function StudioToggle({
  value, onChange,
  optionA, optionB,
  ariaLabel,
  disabled,
  disabledOption,  // 'a' | 'b' | null — desabilita uma das opcoes
  // centerNode: elemento opcional sobreposto no CENTRO do pill (na divisa
  // entre as duas opcoes). Usado pelo badge de LAYER no PRESET/LIVE.
  centerNode,
}) {
  const isA = value === optionA.value;
  return (
    <div
      className={'bf-studio-toggle' + (disabled ? ' is-disabled' : '') + (centerNode ? ' has-center' : '')}
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        className={'bf-studio-toggle-btn' + (isA ? ' is-active' : '')}
        onClick={() => !disabled && onChange && onChange(optionA.value)}
        disabled={disabled || disabledOption === 'a'}
      >{optionA.label}</button>
      <button
        type="button"
        className={'bf-studio-toggle-btn' + (!isA ? ' is-active' : '')}
        onClick={() => !disabled && onChange && onChange(optionB.value)}
        disabled={disabled || disabledOption === 'b'}
      >{optionB.label}</button>
      {centerNode && <div className="bf-studio-toggle-center">{centerNode}</div>}
    </div>
  );
}

// ─── StudioToggleRow ──────────────────────────────────────────────────
// Linha de toggles compactos abaixo do NowPlayingCard. Vem populada
// pelo PagePresetConfig com o PRESET/LIVE + LAYER 1/2 lado-a-lado.
export function StudioToggleRow({ children }) {
  return (
    <div className="bf-studio-toggle-row">{children}</div>
  );
}

const STUDIO_MODE_LABEL = {
  mute:      'MUTE',
  fx1:       'STOMP',
  fx2:       'STOMP',
  fx3:       'STOMP',
  spin:      'SPIN',
  ramp:      'RAMP',
  momentary: 'MOMENT.',
  macros:    'MACROS',
  tap_tempo: 'TAP',
  single:    'SINGLE',
  favorite:  'FAV',
};
