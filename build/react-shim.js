// Shim React -> Preact. Tem que ser um modulo separado (nao misturado
// com entry.js) porque ES modules evaluam imports antes do corpo do
// modulo importador. Se o setup de globais estiver no entry.js junto
// com 'import ../app.jsx', o app.jsx executa ANTES dos globais serem
// setados.
//
// Como modulo proprio, este arquivo evalua na ordem certa:
//   1. preact/compat + preact/hooks (deps importadas aqui)
//   2. corpo deste arquivo (set dos globais)
//   3. so depois disso o entry.js evalua 'import ../app.jsx'
import * as PreactCompat from 'preact/compat';
import * as PreactHooks from 'preact/hooks';

const ReactGlobal = { ...PreactCompat, ...PreactHooks };

if (typeof globalThis !== 'undefined') {
  globalThis.React = ReactGlobal;
  globalThis.ReactDOM = PreactCompat;
}
