'use strict';
/**
 * Pull named functions and const declarations OUT of a browser script so a gate can
 * run the REAL renderer logic under node.
 *
 * WHY THIS EXISTS: assets/app.js is a classic browser script. It calls
 * document.addEventListener at top level, so `require()` throws and every attempt to
 * test it ends up reimplementing the regexes in the test — which is worthless, because
 * a reimplementation agrees with itself while the shipped code stays broken. That is
 * exactly how the DFARS PGI shipped with all 427 of its section numbers unparsed and
 * every citation in a part identical: the corpus was valid, and nothing ever asked the
 * renderer whether it could READ the corpus.
 *
 * So: slice the function text verbatim out of the file and eval it in a bare vm
 * context. What the gate exercises is the shipped source, character for character.
 *
 * The brace matcher understands strings, template literals, line/block comments AND
 * regex literals. All four matter in this repo:
 *   - comments carry apostrophes ("the publisher's HTML") -> phantom string
 *   - esc() is `.replace(/"/g,'&quot;')`   -> a quote inside a regex literal
 *   - several functions hold `/[{}]/` style classes -> braces inside a regex literal
 * Get any of those wrong and the matcher runs past the end of the function and drags in
 * top-level DOM code, which fails confusingly at eval time rather than here.
 */

// Tokens after which a '/' starts a REGEX, not a division. (Division only ever follows
// a value: an identifier, a literal, or a closing bracket.)
const REGEX_OK_BEFORE = /[({[,;:!&|?+\-*%~^=<>]$/;

function prevMeaningful(text, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  return j >= 0 ? text.slice(Math.max(0, j - 8), j + 1) : '';
}

function isRegexStart(text, i) {
  const before = prevMeaningful(text, i).trimEnd();
  if (!before) return true;
  if (REGEX_OK_BEFORE.test(before)) return true;
  // `return /re/`, `typeof /re/`, `case /re/` … keyword then slash
  return /\b(return|typeof|case|in|of|new|delete|void|instanceof|do|else)$/.test(before);
}

/**
 * Return the source text from `startIdx` through the balanced `close` that matches the
 * first `open` at or after `startIdx`. Returns null if unbalanced.
 */
function balancedFrom(text, startIdx, open, close) {
  const first = text.indexOf(open, startIdx);
  if (first < 0) return null;
  let depth = 0;
  let str = null;      // quote char of the string we're inside
  let esc = false;     // previous char was a backslash
  let line = false;    // inside //
  let block = false;   // inside /* */
  let regex = false;   // inside /.../
  let cls = false;     // inside a [...] char class within a regex

  for (let i = first; i < text.length; i++) {
    const c = text[i], n = text[i + 1];

    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (regex) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (cls) { if (c === ']') cls = false; continue; }
      if (c === '[') { cls = true; continue; }
      if (c === '/') regex = false;
      continue;
    }
    if (str) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === str) str = null;
      continue;
    }

    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '/' && isRegexStart(text, i)) { regex = true; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }

    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return text.slice(startIdx, i + 1); }
  }
  return null;
}

/** Slice `function NAME(...) { ... }` (or `async function`) verbatim. */
function grabFunction(src, name) {
  const m = new RegExp(`(?:^|\\n)[ \\t]*(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!m) throw new Error(`extract_js_fns: function not found: ${name}`);
  const start = m.index + (src[m.index] === '\n' ? 1 : 0);
  const body = balancedFrom(src, start, '{', '}');
  if (!body) throw new Error(`extract_js_fns: unbalanced braces in function ${name}`);
  return body;
}

/** Slice `const NAME = { ... }` or `const NAME = [ ... ]` verbatim. */
function grabConst(src, name) {
  const m = new RegExp(`(?:^|\\n)[ \\t]*(?:const|let|var)\\s+${name}\\s*=`).exec(src);
  if (!m) throw new Error(`extract_js_fns: const not found: ${name}`);
  const start = m.index + (src[m.index] === '\n' ? 1 : 0);
  const eq = src.indexOf('=', start);
  let open = null;
  for (let i = eq + 1; i < src.length; i++) {
    if (/\s/.test(src[i])) continue;
    open = src[i];
    break;
  }
  const pair = { '{': '}', '[': ']' }[open];
  if (!pair) throw new Error(`extract_js_fns: ${name} is not an object/array literal`);
  const body = balancedFrom(src, start, open, pair);
  if (!body) throw new Error(`extract_js_fns: unbalanced ${open} in const ${name}`);
  return body + ';';
}

/**
 * Slice a single-line declaration verbatim — `const XREF_LEAD = /^(...)/;`
 * grabConst only handles object/array literals; regex and primitive constants are just
 * as much part of the parsing layer a gate needs to drive.
 */
function grabLine(src, name) {
  const m = new RegExp(`(?:^|\\n)[ \\t]*(?:const|let|var)\\s+${name}\\s*=[^\\n]*`).exec(src);
  if (!m) throw new Error(`extract_js_fns: declaration not found: ${name}`);
  return m[0].replace(/^\n/, '');
}

module.exports = { balancedFrom, grabFunction, grabConst, grabLine };
