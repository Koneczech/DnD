// Živý náhled v editoru karty (⚠ bod 150), jako Live Preview v Obsidianu: píše se do markdownu,
// ale formátování je vidět rovnou. Nadpisy jsou velké, tučné tučně, [[odkazy]] jako odkazy,
// %%zná%% jako oko. Značky se ukážou jen na řádku s kurzorem. Text karty se nikdy nepřevádí,
// ukládá se přesně tak, jak je napsaný (Obsidian, odkrývání odstavců podle prvního řádku).
//
// Pole se navenek chová jako <textarea> (value, selectionStart, setRangeText, události input,
// keydown, blur, click), takže editor karty, příkazy „/“ a našeptávání [[ fungují beze změny.
// Když se CodeMirror nenačte, editor použije obyčejné textové pole.

/** Odkaz [[id]], [[id|text]], [[id#oddíl|text]]. */
const ODKAZ = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g;
/** Značka odkryté odrážky nebo odstavce (rozhodnutí 75). */
const ZNA = /[ \t]*%%\s*zn[aá]\s*%%/gi;
/** Komentář Obsidianu na jednom řádku (mimo %%zná%%). */
const KOMENTAR = /%%(?!\s*zn[aá]\s*%%)[^\n%]*?%%/gi;
const JE_DM = (text) => /^DM(\b|\s|—|-|:|$)/.test(String(text ?? '').trim());

let knihovna = null;
/** CodeMirror se načte jen jednou a jen při otevření editoru (309 kB). */
function nacistKnihovnu() {
  knihovna ??= import('/panel/vendor/codemirror.js');
  return knihovna;
}

/**
 * @param {string} text výchozí text karty
 * @param {{popisekOdkazu?: (id: string) => {text: string, existuje: boolean, barva?: string}, aria?: string}} volby
 * @returns {Promise<object>} pole s rozhraním textarea a vlastností element
 */
export async function vytvoritPole(text, volby = {}) {
  let cm;
  try {
    cm = await nacistKnihovnu();
  } catch {
    return obycejnePole(text, volby);
  }
  return zivePole(cm, text, volby);
}

function obycejnePole(text, { aria = 'Text karty (markdown)' } = {}) {
  const t = document.createElement('textarea');
  t.className = 'editor-text';
  t.spellcheck = true;
  t.value = text;
  t.setAttribute('aria-label', aria);
  t.element = t;
  return t;
}

function zivePole(cm, text, { popisekOdkazu = (id) => ({ text: id, existuje: true }), aria = 'Text karty (markdown)' }) {
  const {
    EditorState, EditorView, Decoration, ViewPlugin, WidgetType, keymap, drawSelection, syntaxTree, HighlightStyle,
    syntaxHighlighting, Language, LanguageSupport, defineLanguageFacet, parserMarkdownu, GFM, history, historyKeymap,
    defaultKeymap, indentWithTab, tags, Prec, EditorSelection, Transaction,
  } = cm;

  const jazyk = new LanguageSupport(new Language(defineLanguageFacet(), parserMarkdownu.configure([GFM]), [], 'markdown'));

  class Oko extends WidgetType {
    eq() { return true; }
    toDOM() {
      const s = document.createElement('span');
      s.className = 'cm-oko';
      s.textContent = ' 👁';
      s.title = 'Družina to ví (%%zná%%)';
      return s;
    }
  }
  class Odrazka extends WidgetType {
    eq() { return true; }
    toDOM() {
      const s = document.createElement('span');
      s.className = 'cm-odrazka';
      s.textContent = '•';
      return s;
    }
  }
  class Odkaz extends WidgetType {
    constructor(id, alias) {
      super();
      this.id = id;
      this.alias = alias;
    }
    eq(jiny) { return jiny.id === this.id && jiny.alias === this.alias; }
    toDOM() {
      const p = popisekOdkazu(this.id);
      const s = document.createElement('span');
      s.className = p.existuje ? 'cm-odkaz' : 'cm-odkaz cm-odkaz-chybi';
      if (p.barva) s.style.setProperty('--c', p.barva);
      s.textContent = this.alias || p.text || this.id;
      s.title = p.existuje ? `[[${this.id}]]` : `Karta [[${this.id}]] neexistuje`;
      return s;
    }
    ignoreEvent() { return false; }
  }

  const skryt = Decoration.replace({});
  const radkyKurzoru = (state) => {
    const r = new Set();
    for (const v of state.selection.ranges) {
      for (let n = state.doc.lineAt(v.from).number; n <= state.doc.lineAt(v.to).number; n++) r.add(n);
    }
    return r;
  };

  function dekorace(view) {
    const { state } = view;
    const aktivni = view.hasFocus ? radkyKurzoru(state) : new Set();
    const d = [];
    const jeAktivni = (pos) => aktivni.has(state.doc.lineAt(pos).number);
    const vKodu = new Set();
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(state).iterate({
        from, to,
        enter: (uzel) => {
          const n = uzel.name;
          const h = /^ATXHeading(\d)$/.exec(n);
          if (h) {
            const radek = state.doc.lineAt(uzel.from);
            const nadpis = state.doc.sliceString(uzel.from, uzel.to).replace(/^#+\s*/, '');
            d.push(Decoration.line({ class: `cm-nadpis cm-nadpis-${h[1]}${JE_DM(nadpis) ? ' cm-nadpis-dm' : ''}` }).range(radek.from));
            return;
          }
          if (n === 'HeaderMark' && !jeAktivni(uzel.from)) {
            const konec = state.doc.sliceString(uzel.to, uzel.to + 1) === ' ' ? uzel.to + 1 : uzel.to;
            if (uzel.from === state.doc.lineAt(uzel.from).from) d.push(skryt.range(uzel.from, konec));
            return;
          }
          if (n === 'StrongEmphasis') d.push(Decoration.mark({ class: 'cm-tucne' }).range(uzel.from, uzel.to));
          else if (n === 'Emphasis') d.push(Decoration.mark({ class: 'cm-kurziva' }).range(uzel.from, uzel.to));
          else if (n === 'Strikethrough') d.push(Decoration.mark({ class: 'cm-preskrtnute' }).range(uzel.from, uzel.to));
          else if (n === 'InlineCode') d.push(Decoration.mark({ class: 'cm-kod' }).range(uzel.from, uzel.to));
          else if ((n === 'EmphasisMark' || n === 'StrikethroughMark' || (n === 'CodeMark' && uzel.node.parent?.name === 'InlineCode')) && !jeAktivni(uzel.from)) {
            if (uzel.to > uzel.from) d.push(skryt.range(uzel.from, uzel.to));
          } else if (n === 'QuoteMark') {
            d.push(Decoration.line({ class: 'cm-citace' }).range(state.doc.lineAt(uzel.from).from));
            if (!jeAktivni(uzel.from)) {
              const konec = state.doc.sliceString(uzel.to, uzel.to + 1) === ' ' ? uzel.to + 1 : uzel.to;
              d.push(skryt.range(uzel.from, konec));
            }
          } else if (n === 'ListMark') {
            const znak = state.doc.sliceString(uzel.from, uzel.to);
            if (/^[-*+]$/.test(znak) && !jeAktivni(uzel.from)) d.push(Decoration.replace({ widget: new Odrazka() }).range(uzel.from, uzel.to));
            else d.push(Decoration.mark({ class: 'cm-znacka-seznamu' }).range(uzel.from, uzel.to));
          } else if (n === 'Link') {
            d.push(Decoration.mark({ class: 'cm-odkaz-web' }).range(uzel.from, uzel.to));
          } else if ((n === 'LinkMark' || n === 'URL') && uzel.node.parent?.name === 'Link' && !jeAktivni(uzel.from)) {
            if (uzel.to > uzel.from) d.push(skryt.range(uzel.from, uzel.to));
          } else if (n === 'HorizontalRule') {
            d.push(Decoration.line({ class: 'cm-cara' }).range(state.doc.lineAt(uzel.from).from));
            if (!jeAktivni(uzel.from)) d.push(skryt.range(uzel.from, uzel.to));
          } else if (n === 'FencedCode' || n === 'Table') {
            for (let p = uzel.from; p <= uzel.to;) {
              const radek = state.doc.lineAt(p);
              d.push(Decoration.line({ class: n === 'Table' ? 'cm-tabulka' : 'cm-blok-kodu' }).range(radek.from));
              if (n === 'FencedCode') vKodu.add(radek.number);
              p = radek.to + 1;
            }
          }
        },
      });
      // Obsidian: [[odkazy]], %%zná%% a komentáře (mimo bloky kódu).
      for (let p = from; p <= to;) {
        const radek = state.doc.lineAt(p);
        p = radek.to + 1;
        if (vKodu.has(radek.number)) continue;
        const akt = aktivni.has(radek.number);
        for (const m of radek.text.matchAll(ODKAZ)) {
          const a = radek.from + m.index;
          const b = a + m[0].length;
          if (akt) d.push(Decoration.mark({ class: 'cm-odkaz-zdroj' }).range(a, b));
          else d.push(Decoration.replace({ widget: new Odkaz(m[1].trim(), m[2]?.trim() ?? '') }).range(a, b));
        }
        for (const m of radek.text.matchAll(ZNA)) {
          const a = radek.from + m.index;
          const b = a + m[0].length;
          if (akt) d.push(Decoration.mark({ class: 'cm-zna-zdroj' }).range(a, b));
          else d.push(Decoration.replace({ widget: new Oko() }).range(a, b));
        }
        for (const m of radek.text.matchAll(KOMENTAR)) {
          d.push(Decoration.mark({ class: 'cm-komentar' }).range(radek.from + m.index, radek.from + m.index + m[0].length));
        }
      }
    }
    return Decoration.set(d, true);
  }

  const nahled = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = dekorace(view); }
    update(u) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) this.decorations = dekorace(u.view);
    }
  }, { decorations: (p) => p.decorations });

  /** Enter v seznamu pokračuje další odrážkou; prázdná odrážka seznam ukončí (jako Obsidian). */
  function pokracovatSeznam(view) {
    const { state } = view;
    const v = state.selection.main;
    if (!v.empty) return false;
    const radek = state.doc.lineAt(v.head);
    const m = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(radek.text);
    if (!m || v.head < radek.from + m[0].length) return false;
    const zbytek = radek.text.slice(m[0].length);
    if (!zbytek.trim()) {
      // Prázdná odrážka ukončí seznam a nechá prázdný řádek: text pod seznamem by se jinak
      // v markdownu přilepil k poslední odrážce.
      view.dispatch({ changes: { from: radek.from, to: radek.to, insert: '\n' }, selection: { anchor: radek.from + 1 }, userEvent: 'input' });
      return true;
    }
    const znacka = m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2];
    const vlozit = `\n${m[1]}${znacka}${m[5]}${m[6] ? '[ ] ' : ''}`;
    view.dispatch({ changes: { from: v.head, insert: vlozit }, selection: { anchor: v.head + vlozit.length }, userEvent: 'input', scrollIntoView: true });
    return true;
  }

  const posluchaci = { input: [], keydown: [], blur: [], click: [] };
  const element = document.createElement('div');
  element.className = 'editor-text editor-zivy';
  // Klávesy (našeptávání, Ctrl+S) dostane editor karty dřív než CodeMirror.
  element.addEventListener('keydown', (ev) => {
    for (const f of posluchaci.keydown) f(ev);
    if (ev.defaultPrevented) ev.stopPropagation();
  }, true);
  element.addEventListener('focusout', (ev) => {
    if (!element.contains(ev.relatedTarget)) for (const f of posluchaci.blur) f(ev);
  });
  element.addEventListener('click', (ev) => {
    for (const f of posluchaci.click) f(ev);
  });

  const zvyrazneni = HighlightStyle.define([
    { tag: tags.monospace, class: 'cm-kod' },
    { tag: tags.processingInstruction, class: 'cm-znacka' },
  ]);

  const view = new EditorView({
    parent: element,
    state: EditorState.create({
      doc: text,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        jazyk,
        syntaxHighlighting(zvyrazneni),
        nahled,
        Prec.high(keymap.of([{ key: 'Enter', run: pokracovatSeznam }])),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.contentAttributes.of({ spellcheck: 'true', lang: 'cs', 'aria-label': aria, autocapitalize: 'sentences' }),
        EditorView.updateListener.of((u) => {
          // Jen změny od uživatele (psaní, mazání, vložení, zpět), jako událost input u textarea.
          if (u.docChanged && u.transactions.some((t) => t.annotation(Transaction.userEvent) !== undefined)) {
            for (const f of posluchaci.input) f(new Event('input'));
          }
        }),
      ],
    }),
  });

  /** Nahradí jen změněnou část (zpět a pozice kurzoru fungují i po vložení z editoru karty). */
  function nahraditText(novy) {
    const stary = view.state.doc.toString();
    if (stary === novy) return;
    let a = 0;
    while (a < stary.length && a < novy.length && stary[a] === novy[a]) a++;
    let b = 0;
    while (b < stary.length - a && b < novy.length - a && stary[stary.length - 1 - b] === novy[novy.length - 1 - b]) b++;
    view.dispatch({ changes: { from: a, to: stary.length - b, insert: novy.slice(a, novy.length - b) } });
  }
  const vyber = (anchor, head) => {
    const delka = view.state.doc.length;
    view.dispatch({ selection: EditorSelection.single(Math.max(0, Math.min(anchor, delka)), Math.max(0, Math.min(head, delka))), scrollIntoView: true });
  };

  return {
    element,
    view,
    get value() { return view.state.doc.toString(); },
    set value(t) { nahraditText(String(t ?? '')); },
    get selectionStart() { return view.state.selection.main.from; },
    set selectionStart(x) { vyber(x, Math.max(x, view.state.selection.main.to)); },
    get selectionEnd() { return view.state.selection.main.to; },
    set selectionEnd(x) { vyber(Math.min(view.state.selection.main.from, x), x); },
    setSelectionRange(a, b) { vyber(a, b); },
    setRangeText(vlozit, od, do_, rezim = 'preserve') {
      view.dispatch({ changes: { from: od, to: do_, insert: vlozit } });
      if (rezim === 'end') vyber(od + vlozit.length, od + vlozit.length);
      else if (rezim === 'select') vyber(od, od + vlozit.length);
    },
    focus() { view.focus(); },
    get scrollTop() { return view.scrollDOM.scrollTop; },
    set scrollTop(x) { view.scrollDOM.scrollTop = x; },
    addEventListener(typ, f) { posluchaci[typ]?.push(f); },
    dispatchEvent(ev) {
      for (const f of posluchaci[ev.type] ?? []) f(ev);
      return true;
    },
  };
}
