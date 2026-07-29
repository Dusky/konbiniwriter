"use strict";
// footnotes.ts — Markdown footnotes, in and out.
//
// The syntax is the ordinary one (`[^1]` in the prose, `[^1]: the note` on its
// own line), which matters because a `.konbini` bundle is plain Markdown a
// writer can open in any editor. A footnote has to survive being read by
// something that has never heard of Konbini.
//
// One parser, four consumers: the Scrivener importer writes this syntax, and
// the DOCX, EPUB and Markdown exports read it. Before this existed the
// importer simply discarded footnotes, which is the worst of the options.
//
// Pure — no DOM, no Node.
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasFootnotes = void 0;
exports.splitFootnotes = splitFootnotes;
exports.segmentLine = segmentLine;
exports.renderFootnotes = renderFootnotes;
/** A reference like `[^1]`, not preceded by a backslash. */
const REF = /\[\^([^\]\s]+)\]/g;
/** A definition line: `[^1]: text`, with optional indented continuation lines. */
const DEF = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
/**
 * Pull the definitions out of a Markdown document.
 *
 * Ordering follows the *references*, not the definitions, because that is the
 * order a reader meets them — a document whose definitions are alphabetised
 * should still number 1, 2, 3 down the page. A definition nothing refers to is
 * kept at the end rather than dropped; it is text the author wrote.
 */
function splitFootnotes(markdown) {
    const defs = new Map();
    const kept = [];
    let current = null;
    for (const raw of markdown.split('\n')) {
        const line = raw.replace(/\r$/, '');
        const m = DEF.exec(line);
        if (m) {
            current = m[1];
            defs.set(current, (m[2] ?? '').trim());
            continue;
        }
        // An indented line directly under a definition continues it.
        if (current && /^[ \t]+\S/.test(line)) {
            defs.set(current, `${defs.get(current) ?? ''} ${line.trim()}`.trim());
            continue;
        }
        current = null;
        kept.push(line);
    }
    const notes = [];
    const seen = new Set();
    const body = kept.join('\n');
    REF.lastIndex = 0;
    let r;
    while ((r = REF.exec(body)) !== null) {
        const label = r[1];
        if (seen.has(label) || !defs.has(label))
            continue;
        seen.add(label);
        notes.push({ label, text: defs.get(label) });
    }
    // Definitions with no reference: keep them, at the end, rather than lose them.
    for (const [label, text] of defs)
        if (!seen.has(label))
            notes.push({ label, text });
    return { body: body.replace(/\n{3,}/g, '\n\n').trim(), notes };
}
/**
 * Split a line into prose and references, numbered by `order`.
 *
 * `order` is the labels in final document order, so a reference renders as the
 * number a reader will see even when the author labelled it `mira-age`.
 */
function segmentLine(line, order) {
    const out = [];
    let last = 0;
    REF.lastIndex = 0;
    let m;
    while ((m = REF.exec(line)) !== null) {
        const idx = order.indexOf(m[1]);
        // A reference with no definition is just text — don't invent a note for it.
        if (idx === -1)
            continue;
        if (m.index > last)
            out.push({ text: line.slice(last, m.index) });
        out.push({ ref: m[1], index: idx + 1 });
        last = m.index + m[0].length;
    }
    if (last < line.length)
        out.push({ text: line.slice(last) });
    return out;
}
/** Render notes back into Markdown definition lines. */
function renderFootnotes(notes) {
    return notes.map((n) => `[^${n.label}]: ${n.text}`).join('\n');
}
/** True when the text carries at least one usable footnote. */
const hasFootnotes = (markdown) => splitFootnotes(markdown).notes.length > 0;
exports.hasFootnotes = hasFootnotes;
