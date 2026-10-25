// Copied from kajetanzaziemski/wyceny (util.js @ e042de5). Grid.js needs colLetters_, rectA1_, parseA1_; the rest is unused for now.
// ---------------------------------------------------------------------------
// Small helpers shared by every range of the project (no spreadsheet access, no project knowledge).
// ---------------------------------------------------------------------------

/** Languages whose number format has a decimal COMMA: the spreadsheet then writes the arguments of a formula separated by ";" (Polish: =AND(A1>1;B1<2)). */
const COMMA_DECIMAL_LANGUAGES_ = ['af', 'az', 'be', 'bg', 'bs', 'ca', 'cs', 'da', 'de', 'el', 'es', 'et', 'eu', 'fi', 'fr', 'gl', 'hr', 'hu', 'hy', 'id', 'is', 'it', 'ka',
  'kk', 'lt', 'lv', 'mk', 'nb', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sq', 'sr', 'sv', 'tr', 'uk', 'vi'];

/**
 * The separator between the arguments of a formula as the spreadsheet of this locale ("pl_PL", "en_US" ...) writes it: ";" where the decimal mark is a comma, else ",".
 * Asks Intl how the locale writes 1.5 when Intl is there (`intl` = null: skip it), else goes by the language.
 */
function formulaArgSeparator_(locale, intl) {
  const tag = String(locale || '').replace('_', '-');
  try {
    const I = intl === undefined ? (typeof Intl !== 'undefined' ? Intl : null) : intl;
    if (I && tag) {
      const shown = new I.NumberFormat(tag).format(1.5);
      if (shown.indexOf(',') >= 0) return ';';
      if (shown.indexOf('.') >= 0) return ',';
    }
  } catch (err) { /* an unknown locale: by language below */ }
  return COMMA_DECIMAL_LANGUAGES_.indexOf(tag.split('-')[0].toLowerCase()) >= 0 ? ';' : ',';
}

/** 1-based column number -> letters (A, B, ..., AA). */
function colLetters_(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

/** { r1, c1, r2, c2 } -> "B3" or "B3:D4". */
function rectA1_(m) {
  const a = colLetters_(m.c1) + m.r1;
  return (m.r2 > m.r1 || m.c2 > m.c1) ? a + ':' + colLetters_(m.c2) + m.r2 : a;
}

/** "B3" / "B3:D4" -> { r1, c1, r2, c2 }. */
function parseA1_(a1) {
  const m = String(a1).match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  const num = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const c1 = num(m[1]), r1 = Number(m[2]);
  return { r1: r1, c1: c1, r2: m[4] ? Number(m[4]) : r1, c2: m[3] ? num(m[3]) : c1 };
}

/**
 * The cells a formula reads on its own sheet: [{ r1, c1, r2, c2 }] (a whole column / row has r2 / c2 = Infinity). References to
 * other sheets ('Sheet'!B5, Sheet!A:A) and text in quotes are skipped; names and INDIRECT cannot be seen.
 */
function formulaRefs_(formula) {
  const s = String(formula).replace(/"(?:[^"]|"")*"/g, '""');
  const col = t => t.replace('$', '').split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const out = [];
  const cells = /(?<![A-Za-z0-9_.!:'])(\$?[A-Z]{1,3})(\$?\d+)(?::(\$?[A-Z]{1,3})(\$?\d+))?(?![A-Za-z0-9_(])/g;
  const cols = /(?<![A-Za-z0-9_.!:'$])(\$?[A-Z]{1,3}):(\$?[A-Z]{1,3})(?![A-Za-z0-9_(])/g;
  const rows = /(?<![A-Za-z0-9_.!:'$])(\$?\d+):(\$?\d+)(?![A-Za-z0-9_(])/g;
  let m;
  while ((m = cells.exec(s))) {
    const r1 = Number(m[2].replace('$', '')), c1 = col(m[1]);
    out.push(m[3] ? { r1: Math.min(r1, Number(m[4].replace('$', ''))), c1: Math.min(c1, col(m[3])), r2: Math.max(r1, Number(m[4].replace('$', ''))), c2: Math.max(c1, col(m[3])) }
                  : { r1: r1, c1: c1, r2: r1, c2: c1 });
  }
  while ((m = cols.exec(s))) out.push({ r1: 1, c1: Math.min(col(m[1]), col(m[2])), r2: Infinity, c2: Math.max(col(m[1]), col(m[2])) });
  while ((m = rows.exec(s))) out.push({ r1: Math.min(+m[1].replace('$', ''), +m[2].replace('$', '')), c1: 1, r2: Math.max(+m[1].replace('$', ''), +m[2].replace('$', '')), c2: Infinity });
  return out;
}

/** Locale-proof number literal for a formula (no decimal separator needed). */
function numberForFormula_(v) {
  const r = Math.round(v * 1e6) / 1e6;
  return Number.isInteger(r) ? String(r) : '(' + Math.round(r * 1e6) + '/1000000)';
}

/** JSON that is safe to drop inside a <script> block. */
function safeJson_(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
