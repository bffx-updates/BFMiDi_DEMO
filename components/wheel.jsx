// ─── Wheel picker (drum/roda estilo iOS) ──────────────────────────────
// Modulo FOLHA compartilhado: so depende do React/Preact ja injetado
// globalmente; nao importa nada do app.jsx nem do bank.jsx.
//
// Exporta:
//   - WHEEL_ITEM_H  : altura (px) de cada item da roda. Sincronizada com o
//                     `height` de .bf-studio-picker-item no app.css.
//   - WheelPopup    : o popup centralizado (backdrop + modal + roda rolavel
//                     com scroll-snap). Quem usa passa as <option> e recebe
//                     o valor escolhido. Renderiza num portal (document.body).
//   - BfSelect      : substituto drop-in do <select> nativo. Mantem a MESMA
//                     interface (className, value, onChange recebendo um
//                     evento-like {target:{value}}, disabled, children
//                     <option>, aria-label/title) e, ao abrir, mostra a roda.
//
// O CSS de tudo isso (.bf-studio-picker-*, .bf-studio-wheel*) vive em app.css.

const { useMemo, useState, useRef, useEffect } = React;
const { createPortal, Fragment } = React;

// Altura de cada item na roda. Sincronizada com o `height` de
// .bf-studio-picker-item no app.css — o JS usa esse valor pra dimensionar o
// padding da roda e descobrir qual item caiu no centro (scrollTop / H). Se
// mudar aqui, mude tambem no CSS.
export const WHEEL_ITEM_H = 48;

// ─── Escala de fonte da roda (persistida) ──────────────────────────────
// Em alguns dispositivos a fonte fixa dos itens fica grande demais. Os botoes
// A-/A+ no cabecalho do popup ajustam um multiplicador (--bf-wheel-fscale) que
// o CSS aplica via calc() nos font-size dos itens. A preferencia e GLOBAL
// (vale pra todos os WheelPopup) e fica salva em localStorage. So afeta a
// FONTE — a ALTURA do item (WHEEL_ITEM_H) nao muda, pra preservar o invariante
// centro = scrollTop / WHEEL_ITEM_H.
export const WHEEL_FONT_SCALE_KEY = 'bf_wheel_fscale';
const WHEEL_FONT_SCALE_MIN = 0.5;
const WHEEL_FONT_SCALE_MAX = 1.3;
const WHEEL_FONT_SCALE_STEP = 0.1;

function clampFontScale(v) {
  if (!isFinite(v)) return 1;
  const c = Math.max(WHEEL_FONT_SCALE_MIN, Math.min(WHEEL_FONT_SCALE_MAX, v));
  return Math.round(c * 100) / 100; // evita acumular erro de ponto flutuante
}
function readWheelFontScale() {
  try {
    const raw = localStorage.getItem(WHEEL_FONT_SCALE_KEY);
    if (raw != null) return clampFontScale(parseFloat(raw));
  } catch (e) { /* localStorage indisponivel (modo restrito) */ }
  return 1;
}
function writeWheelFontScale(v) {
  try { localStorage.setItem(WHEEL_FONT_SCALE_KEY, String(v)); } catch (e) { /* idem */ }
}

// Achata children/options (arrays aninhados, falsy, etc.) e extrai de cada
// <option> o { value, label, className, disabled } que a roda consome.
// Aceita tanto o array que midiOptionElems/channelOptionElems retornam quanto
// os children crus de um <select> (que podem misturar elemento unico, arrays
// de map() e expressoes condicionais que viram false/null).
function optionsToItems(options) {
  const flat = [];
  const walk = (node) => {
    if (node == null || typeof node === 'boolean' || typeof node === 'string') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    // Descer em Fragments (<>...</>): os <option> reais ficam nos children.
    // Sem isso, um valueOptionElems do tipo <><option/>...{map}</> seria
    // empurrado como UM vnode sem props.value e descartado (roda vazia).
    if (node.type === Fragment && node.props) { walk(node.props.children); return; }
    flat.push(node);
  };
  walk(options);
  const out = [];
  for (const el of flat) {
    if (!el || !el.props || typeof el.props.value === 'undefined') continue;
    out.push({
      value: el.props.value,
      label: el.props.children,
      className: el.props.className || '',
      disabled: !!el.props.disabled,
    });
  }
  return out;
}

// Converte labels JSX em texto pesquisavel. Na maioria dos selects o label ja
// e string, mas alguns call-sites podem passar spans/fragments.
function optionLabelText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(optionLabelText).join(' ');
  if (node.props) return optionLabelText(node.props.children);
  return '';
}

function normalizeSearchText(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

// ─── WheelPopup ────────────────────────────────────────────────────────
// Popup centralizado com a roda. Controlado pelo pai via `open`/`onClose`.
// `options` aceita o mesmo formato que <select> consome (array de <option>
// ou children crus). Comparacao do selecionado por igualdade fraca (==),
// porque option.value vem como NUMBER mas o state as vezes chega string.
export function WheelPopup({ open, onClose, value, onChange, options, title, ariaLabel }) {
  // Indice do item que esta no CENTRO da roda (o que sera selecionado).
  const [centerIdx, setCenterIdx] = useState(0);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const rafRef = useRef(0);
  const [searchQuery, setSearchQuery] = useState('');

  // Escala de fonte da roda (botoes A-/A+). Inicia do localStorage e e relida
  // a cada abertura (outro popup pode te-la mudado). Persiste a cada ajuste.
  const [fontScale, setFontScale] = useState(readWheelFontScale);
  const adjustFontScale = (dir) => {
    setFontScale((prev) => {
      const next = clampFontScale(prev + dir * WHEEL_FONT_SCALE_STEP);
      writeWheelFontScale(next);
      return next;
    });
  };

  const allItems = useMemo(() => optionsToItems(options), [options]);
  const normalizedQuery = normalizeSearchText(searchQuery);
  const items = useMemo(() => {
    if (!normalizedQuery) return allItems;
    const matches = allItems.filter((it) => {
      const haystack = normalizeSearchText(`${it.value} ${optionLabelText(it.label)}`);
      return haystack.includes(normalizedQuery);
    });
    // Ao digitar um numero MIDI completo, deixa a correspondencia exata no
    // topo sem esconder outras ocorrencias que tambem contenham o texto.
    if (/^\d+$/.test(normalizedQuery)) {
      return matches.slice().sort((a, b) => {
        const ax = String(a.value) === normalizedQuery ? 0 : 1;
        const bx = String(b.value) === normalizedQuery ? 0 : 1;
        return ax - bx;
      });
    }
    return matches;
  }, [allItems, normalizedQuery]);
  const showSearch = allItems.length > 0;

  // Indice do item cujo value casa com o valor salvo (== fraco).
  const activeIndex = useMemo(() => {
    const i = items.findIndex((it) => it.value == value);
    return i < 0 ? 0 : i;
  }, [items, value]);

  // Fecha no Escape + trava o scroll do body enquanto aberto (igual modal).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Cada abertura comeca com a lista completa, sem reaproveitar a pesquisa do
  // popup anterior. Separado do listener acima porque onClose pode mudar entre
  // renders e nao deve apagar o texto enquanto o usuario digita.
  useEffect(() => {
    if (!open) return;
    setSearchQuery('');
    setFontScale(readWheelFontScale());
  }, [open]);

  // Ao abrir ou pesquisar: dimensiona o padding da roda e posiciona o item
  // salvo (lista completa) ou o primeiro resultado (lista filtrada) no centro.
  useEffect(() => {
    if (!open) return;
    const vp = listRef.current;
    if (!vp) return;
    const pad = Math.max(0, (vp.clientHeight - WHEEL_ITEM_H) / 2);
    vp.style.paddingTop = pad + 'px';
    vp.style.paddingBottom = pad + 'px';
    const target = normalizedQuery ? 0 : activeIndex;
    vp.scrollTop = target * WHEEL_ITEM_H;
    setCenterIdx(target);
  }, [open, normalizedQuery, items.length, activeIndex]);

  // Entrega o foco direto pra caixa ao abrir, pronta pra digitacao.
  useEffect(() => {
    if (!open || !showSearch) return;
    const id = requestAnimationFrame(() => searchRef.current && searchRef.current.focus());
    return () => cancelAnimationFrame(id);
  }, [open, showSearch]);

  // Wheel do mouse: anda 1 item por "notch" (em vez do scroll nativo, que pula
  // ~2 — um notch manda ~100px de deltaY e cada item tem 48px). Listener
  // NAO-passivo pra poder preventDefault. Throttle leve (50ms) coalesce mouses
  // de alta resolucao / trackpad (que mandam varios eventos por notch) sem
  // atrapalhar o notch comum. O onScroll (abaixo) reatualiza o centro.
  useEffect(() => {
    if (!open) return;
    const vp = listRef.current;
    if (!vp) return;
    let lock = 0;
    const onWheel = (e) => {
      e.preventDefault();
      const n = items.length;
      if (n === 0 || !e.deltaY) return;
      if (e.timeStamp - lock < 50) return;
      lock = e.timeStamp;
      const cur = Math.round(vp.scrollTop / WHEEL_ITEM_H);
      const target = Math.max(0, Math.min(n - 1, cur + (e.deltaY > 0 ? 1 : -1)));
      // Instantaneo pra um ponto-snap EXATO: 'smooth' brigaria com o
      // scroll-snap mandatory (a snap reverte a animacao no meio do caminho).
      vp.scrollTop = target * WHEEL_ITEM_H;
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [open, items.length]);

  // Throttle via rAF: a cada scroll recalcula qual item caiu no centro
  // (scrollTop / WHEEL_ITEM_H, ja que o padding centraliza o item i quando
  // scrollTop = i * WHEEL_ITEM_H).
  const onWheelScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const vp = listRef.current;
      if (!vp || items.length === 0) return;
      const idx = Math.max(0, Math.min(items.length - 1,
        Math.round(vp.scrollTop / WHEEL_ITEM_H)));
      setCenterIdx((prev) => (prev === idx ? prev : idx));
    });
  };

  // Salta o scroll para um indice absoluto (clampado) e marca o centro.
  // Instantaneo (igual ao wheel): 'smooth' brigaria com o scroll-snap
  // mandatory. O onScroll reconfirma o centro depois.
  const scrollToIdx = (idx) => {
    const vp = listRef.current;
    const n = items.length;
    if (!vp || n === 0) return;
    const t = Math.max(0, Math.min(n - 1, idx));
    vp.scrollTop = t * WHEEL_ITEM_H;
    setCenterIdx(t);
  };
  // Pula `delta` itens a partir do centro atual (botoes -10 / +10).
  const jump = (delta) => scrollToIdx(centerIdx + delta);

  // Confirma um valor: dispara onChange e fecha.
  const pick = (v) => {
    onChange && onChange(v);
    onClose && onClose();
  };
  // Confirma o item que esta no centro da roda (botao ✓).
  const confirmCenter = () => {
    const it = items[centerIdx];
    if (it && !it.disabled) pick(it.value);
    else onClose && onClose();
  };

  if (!open) return null;

  return createPortal(
    <div
      className="bf-studio-picker-backdrop"
      onClick={() => onClose && onClose()}
      role="presentation"
    >
      <div
        className="bf-studio-picker-modal"
        role="listbox"
        aria-label={ariaLabel || title || ''}
        style={{ '--bf-wheel-fscale': fontScale }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bf-studio-picker-modal-head">
          <span className="bf-studio-picker-modal-title">{title || ''}</span>
          <div className="bf-studio-picker-modal-actions">
            {/* Ajuste do tamanho da fonte da roda (A- / A+) — global, salvo. */}
            <div className="bf-studio-picker-font-ctrl" role="group" aria-label="Tamanho da fonte">
              <button
                type="button"
                className="bf-studio-picker-font-btn"
                onClick={() => adjustFontScale(-1)}
                disabled={fontScale <= WHEEL_FONT_SCALE_MIN + 0.001}
                aria-label="Diminuir fonte"
                title="Diminuir fonte"
              >A<span className="bf-studio-picker-font-sign">−</span></button>
              <button
                type="button"
                className="bf-studio-picker-font-btn"
                onClick={() => adjustFontScale(1)}
                disabled={fontScale >= WHEEL_FONT_SCALE_MAX - 0.001}
                aria-label="Aumentar fonte"
                title="Aumentar fonte"
              >A<span className="bf-studio-picker-font-sign">+</span></button>
            </div>
            <button
              type="button"
              className="bf-studio-picker-modal-ok"
              onClick={confirmCenter}
              aria-label="Confirmar selecao"
              title="Confirmar"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
                   stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 6.5"/>
              </svg>
            </button>
            <button
              type="button"
              className="bf-studio-picker-modal-close"
              onClick={() => onClose && onClose()}
              aria-label="Fechar"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                   stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Roda de selecao (wheel): ticks de regua nas laterais + brilho
            cilindrico (decoracao em .bf-studio-wheel), faixa de selecao fixa
            no centro e a lista rolavel com scroll-snap. O item que para no
            centro (centerIdx) vira o selecionado; confirma clicando nele/em
            qualquer item ou no botao ✓. */}
        <div className="bf-studio-picker-body">
          <div className="bf-studio-picker-main">
            {showSearch && (
              <div className="bf-studio-picker-search">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>
                </svg>
                <input
                  ref={searchRef}
                  type="search"
                  inputMode="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && items.length) {
                      e.preventDefault();
                      confirmCenter();
                    }
                  }}
                  placeholder="Digite o número ou nome do parâmetro"
                  aria-label="Buscar por número ou nome do parâmetro"
                  autoComplete="off"
                  spellCheck="false"
                />
              </div>
            )}
            <div className="bf-studio-wheel">
              <div className="bf-studio-wheel-band" aria-hidden="true" />
              {items.length === 0 && (
                <div className="bf-studio-picker-empty" role="status">Nenhum resultado</div>
              )}
              <div
                className="bf-studio-picker-list"
                ref={listRef}
                onScroll={onWheelScroll}
              >
                {items.map((it, i) => (
                  <button
                    key={`${it.value}-${i}`}
                    type="button"
                    role="option"
                    aria-selected={it.value == value}
                    className={
                      'bf-studio-picker-item' +
                      (i === centerIdx ? ' is-center' : '') +
                      (it.value == value ? ' is-active' : '') +
                      (it.className ? ' ' + it.className : '')
                    }
                    onClick={() => !it.disabled && pick(it.value)}
                    disabled={it.disabled}
                  ><span className="bf-studio-picker-item-label">{it.label}</span></button>
                ))}
              </div>
            </div>
          </div>

          {/* Coluna de atalhos: pula pro inicio/fim ou de 10 em 10 itens —
              navegacao rapida em listas longas (PC/CC 0..127). */}
          <div className="bf-studio-picker-nav" aria-hidden={items.length === 0}>
            <button
              type="button"
              className="bf-studio-picker-nav-btn"
              onClick={() => scrollToIdx(0)}
              aria-label="Ir para o inicio"
              title="Inicio"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                   stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 6h14"/><path d="M12 19V11"/><path d="M8 14l4-4 4 4"/>
              </svg>
              <span className="bf-studio-picker-nav-lbl">INÍCIO</span>
            </button>
            <button
              type="button"
              className="bf-studio-picker-nav-btn"
              onClick={() => jump(-10)}
              aria-label="Subir 10"
              title="-10"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                   stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 13l6-6 6 6M6 18l6-6 6 6"/>
              </svg>
              <span className="bf-studio-picker-nav-lbl">-10</span>
            </button>
            <button
              type="button"
              className="bf-studio-picker-nav-btn"
              onClick={() => jump(10)}
              aria-label="Descer 10"
              title="+10"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                   stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 6l6 6 6-6M6 11l6 6 6-6"/>
              </svg>
              <span className="bf-studio-picker-nav-lbl">+10</span>
            </button>
            <button
              type="button"
              className="bf-studio-picker-nav-btn"
              onClick={() => scrollToIdx(items.length - 1)}
              aria-label="Ir para o final"
              title="Final"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                   stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 18h14"/><path d="M12 5v8"/><path d="M8 10l4 4 4-4"/>
              </svg>
              <span className="bf-studio-picker-nav-lbl">FINAL</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── BfSelect ──────────────────────────────────────────────────────────
// Substituto drop-in do <select> nativo. Renderiza um <button> com as mesmas
// classes do select (className repassado, ex: "bf-input bf-select is-mute")
// mostrando o label da opcao selecionada; ao clicar, abre o WheelPopup. O
// onChange e chamado com um evento-like { target: { value } } pra que os
// call-sites existentes (e) => Number(e.target.value) continuem funcionando
// sem alteracao. O <span class="bf-select-chev"> irmao (quando existe) segue
// posicionado sobre o button, ja que a estrutura DOM no lugar do select e
// preservada (BfSelect renderiza um Fragment: button + portal).
export function BfSelect({
  className, value, onChange, disabled, children, title, 'aria-label': ariaLabel, ...rest
}) {
  const [open, setOpen] = useState(false);

  const items = useMemo(() => optionsToItems(children), [children]);
  const selected = useMemo(() => {
    return items.find((it) => it.value == value) || items[0] || null;
  }, [items, value]);

  const cls = 'bf-input bf-select bf-select-btn' +
    (className ? ' ' + className.replace(/\bbf-input\b/g, '').replace(/\bbf-select\b/g, '').trim() : '');

  return (
    <>
      <button
        type="button"
        className={cls}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        onClick={() => !disabled && setOpen(true)}
        {...rest}
      >
        <span className="bf-select-btn-label">{selected ? selected.label : ''}</span>
      </button>
      <WheelPopup
        open={open}
        onClose={() => setOpen(false)}
        value={value}
        onChange={(v) => onChange && onChange({ target: { value: v } })}
        options={children}
        title={ariaLabel}
        ariaLabel={ariaLabel}
      />
    </>
  );
}
