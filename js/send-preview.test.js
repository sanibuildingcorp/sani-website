/* send-preview.test.js — run: node js/send-preview.test.js */
/* The pre-send preview, executed: the postMessage handshake between
   dashboard.html and quote.html, and — the part that matters — that a preview
   which fails NEVER resolves to "send". */
const fs = require('fs'), vm = require('vm');
const DASH = fs.readFileSync(require('path').join(__dirname,'..','dashboard.html'), 'utf8');
const QUOTE = fs.readFileSync(require('path').join(__dirname,'..','quote.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? pass++ : fail++; console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

function ext(src, name) {
  const s = src.indexOf('function ' + name + '(');
  if (s < 0) throw new Error('missing ' + name);
  let i = src.indexOf('{', s), d = 0;
  for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); } }
}

/* A DOM just real enough for the dialog: elements that record their children,
   attributes and handlers, plus a window with postMessage listeners. */
function mkCtx(opts) {
  opts = opts || {};
  const listeners = [];
  const made = [];
  function el(tag) {
    const e = {
      tag, children: [], style: {}, attrs: {}, _html: '', disabled: false,
      textContent: '', src: '',
      setAttribute(k, v) { this.attrs[k] = v; if (k === 'src') this.src = v; },
      getAttribute(k) { return this.attrs[k]; },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
      insertBefore(c) { this.children.unshift(c); return c; },
      insertAdjacentHTML(_, h) { this._html += h; },
      set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
      querySelectorAll() { return []; },
    };
    made.push(e);
    return e;
  }
  const body = el('body');
  const ctx = {
    console, JSON, Math, String, Number, Boolean, Array, Object, Promise, setTimeout, clearTimeout,
    encodeURIComponent,
    location: { origin: 'https://www.sanibuildingcorp.com' },
    document: { createElement: el, body, getElementById: () => el('div') },
    esc: s => String(s == null ? '' : s),
    fmt: n => '$' + Number(n || 0).toFixed(2),
    currentRecord: {
      ref: 'SBC-260827-XQNQ', status: 'drafted',
      customer: { name: 'Inventive Contracting Inc.', email: 'x@example.com' },
      request: { service: 'Stairs' },
    },
    addEventListener: (t, f) => { if (t === 'message') listeners.push(f); },
    removeEventListener: (t, f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); },
    _listeners: listeners, _made: made, _posted: [],
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(ext(DASH, 'previewBeforeSend'), ctx);
  return ctx;
}

const EST = { projectTitle: 'Stair repair', labor: [{ item: 'x', qty: 1, rate: 100 }], materials: [] };
const CV = { customerTotal: 10000.01 };

function open_(ctx) {
  const p = vm.runInContext('previewBeforeSend', ctx)(EST, CV, 'Total only (no breakdown)');
  const frame = ctx._made.find(e => e.tag === 'iframe');
  const buttons = ctx._made.filter(e => e.tag === 'button');
  frame.contentWindow = { postMessage: (m) => ctx._posted.push(m) };
  return { p, frame, cancel: buttons.find(b => b.textContent === 'Cancel'), send: buttons.find(b => b.textContent === 'Send it') };
}
const fire = (ctx, data) => ctx._listeners.slice().forEach(f => f({ origin: 'https://www.sanibuildingcorp.com', data }));

(async () => {
  console.log('\n1. It opens the real customer page, in preview mode');
  {
    const ctx = mkCtx(); const { frame } = open_(ctx);
    ok('the iframe points at quote.html', /^\/quote\.html\?/.test(frame.src), frame.src);
    ok('...with preview=1', /[?&]preview=1/.test(frame.src), frame.src);
    ok('...for this ref', /ref=SBC-260827-XQNQ/.test(frame.src), frame.src);
  }

  console.log('\n2. Send is OFF until the page has actually rendered');
  {
    const ctx = mkCtx(); const { send } = open_(ctx);
    ok('Send starts disabled — he cannot approve a blank box', send.disabled === true);
    fire(ctx, { type: 'sbc-preview-listening' });
    ok('the pending estimate is posted into the frame',
      ctx._posted.length === 1 && ctx._posted[0].type === 'sbc-preview-record', JSON.stringify(ctx._posted));
    ok('...carrying the UNSAVED edits, not stored data',
      ctx._posted[0].record.estimate === EST);
    ok('...and the real customer name', ctx._posted[0].record.customer.name === 'Inventive Contracting Inc.');
    ok('Send is still disabled before the render confirms', send.disabled === true);
    fire(ctx, { type: 'sbc-preview-ready' });
    ok('Send enables only once the page reports it rendered', send.disabled === false);
  }

  console.log('\n3. The answer it gives back');
  {
    const ctx = mkCtx(); const { p, send } = open_(ctx);
    fire(ctx, { type: 'sbc-preview-listening' }); fire(ctx, { type: 'sbc-preview-ready' });
    send.onclick();
    ok('pressing Send resolves TRUE', (await p) === true);
  }
  {
    const ctx = mkCtx(); const { p, cancel } = open_(ctx);
    fire(ctx, { type: 'sbc-preview-listening' }); fire(ctx, { type: 'sbc-preview-ready' });
    cancel.onclick();
    ok('pressing Cancel resolves FALSE', (await p) === false);
  }
  {
    const ctx = mkCtx(); const { p, send } = open_(ctx);
    send.onclick();                       // never rendered
    let done = false; p.then(() => { done = true; });
    await new Promise(r => setTimeout(r, 20));
    ok('clicking Send on an unrendered preview does NOTHING', done === false);
  }

  console.log('\n4. A foreign origin cannot drive the dialog');
  {
    const ctx = mkCtx(); const { send } = open_(ctx);
    ctx._listeners.slice().forEach(f => f({ origin: 'https://evil.example', data: { type: 'sbc-preview-ready' } }));
    ok('a cross-origin "ready" does not enable Send', send.disabled === true);
    ctx._listeners.slice().forEach(f => f({ origin: 'https://evil.example', data: { type: 'sbc-preview-listening' } }));
    ok('...and cannot make the estimate be posted out', ctx._posted.length === 0, JSON.stringify(ctx._posted));
  }

  console.log('\n5. The dialog is removed either way');
  {
    const ctx = mkCtx(); const { p, cancel } = open_(ctx);
    const before = ctx.document.body.children.length;
    cancel.onclick(); await p;
    ok('the overlay is torn down on cancel', ctx.document.body.children.length === before - 1);
    ok('and its message listener is unhooked', ctx._listeners.length === 0);
  }

  console.log('\n6. quote.html preview mode');
  {
    ok('quote.html only renders on a same-origin message',
      /e\.origin!==location\.origin\)return/.test(QUOTE));
    /* Structural, not a fixed-width regex: the preview branch must open before
       the get-estimate call and return out before reaching it. */
    const gate = QUOTE.indexOf("q.get('preview')==='1'");
    const fetchAt = QUOTE.indexOf("get-estimate?ref=");
    const retAt = QUOTE.indexOf('\n return;\n}', gate);
    ok('the preview branch opens before the get-estimate call',
       gate > -1 && fetchAt > gate, 'gate@' + gate + ' fetch@' + fetchAt);
    ok('...and returns out before reaching it — preview never fetches',
       retAt > gate && retAt < fetchAt, 'return@' + retAt + ' fetch@' + fetchAt);
    ok('every control is disabled in the preview',
      /querySelectorAll\('button,input,textarea,select'\)[\s\S]{0,120}disabled=true/.test(QUOTE));
    ok('it tells the viewer it is a preview', /PREVIEW — this is exactly what your customer will see/.test(QUOTE));
  }

  console.log('\n──────────────────────────────');
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  console.log('──────────────────────────────');
})();
