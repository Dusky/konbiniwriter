"use strict";
// epubBuilder.ts — pure EPUB 3 builder. Works in both browser and Node.js.
// Imported by all three compile() backends (BrowserProjectService, OPFSProjectService,
// NodeProjectService) so the format lives in one place.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEpub = buildEpub;
const jszip_1 = __importDefault(require("jszip"));
const footnotes_1 = require("./footnotes");
// ── Minimal Markdown → XHTML ──────────────────────────────────────────────────
function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function inlineMarkup(line) {
    return esc(line)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/_([^_]+)_/g, '<em>$1</em>');
}
/**
 * Inline markup, with `[^1]` turned into a linked EPUB 3 note reference.
 *
 * `epub:type="noteref"` is what lets a reader render the note as a popup
 * footnote rather than making the reader jump to the end of the chapter and
 * find their way back. Readers that don't support it fall back to the link,
 * which still works.
 */
function inlineWithNotes(line, order, chId) {
    return (0, footnotes_1.segmentLine)(line, order)
        .map((seg) => 'ref' in seg
        ? `<a epub:type="noteref" href="#${chId}-fn${seg.index}" id="${chId}-ref${seg.index}" class="noteref">${seg.index}</a>`
        : inlineMarkup(seg.text))
        .join('');
}
/** The notes themselves, as an EPUB 3 footnotes section at the chapter's end. */
function notesXhtml(notes, chId) {
    if (notes.length === 0)
        return '';
    const items = notes.map((n, i) => {
        const idx = i + 1;
        return `<aside epub:type="footnote" id="${chId}-fn${idx}" class="footnote">`
            + `<p><a href="#${chId}-ref${idx}" class="fnback">${idx}.</a> ${inlineMarkup(n.text)}</p></aside>`;
    });
    return `<section epub:type="footnotes" class="footnotes"><hr class="fnrule"/>\n${items.join('\n')}\n</section>`;
}
function mdToXhtml(md, order = [], chId = '') {
    const lines = md.split('\n');
    const out = [];
    let para = [];
    const flushPara = () => {
        if (!para.length)
            return;
        const joined = para.join(' ');
        out.push(`<p>${order.length ? inlineWithNotes(joined, order, chId) : inlineMarkup(joined)}</p>`);
        para = [];
    };
    for (const raw of lines) {
        const h1 = raw.match(/^#\s+(.+)$/);
        const h2 = raw.match(/^##\s+(.+)$/);
        const h3 = raw.match(/^###\s+(.+)$/);
        const hr = /^-{3,}$/.test(raw.trim());
        if (h1 || h2 || h3) {
            flushPara();
            const lvl = h1 ? 1 : h2 ? 2 : 3;
            const text = esc((h1 ?? h2 ?? h3)[1]);
            out.push(`<h${lvl}>${text}</h${lvl}>`);
        }
        else if (hr) {
            flushPara();
            out.push('<hr/>');
        }
        else if (raw.trim() === '') {
            flushPara();
        }
        else {
            para.push(raw);
        }
    }
    flushPara();
    return out.join('\n');
}
function chapterXhtml(ch) {
    // Definitions never belong in the flow — they are rendered as the notes
    // section below, and leaving them in would print `[^1]: …` as prose.
    const { body, notes } = (0, footnotes_1.splitFootnotes)(ch.markdown);
    const order = notes.map((n) => n.label);
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${esc(ch.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${mdToXhtml(body, order, ch.id)}
${notesXhtml(notes, ch.id)}
</body>
</html>`;
}
const STYLESHEET = `
body { font-family: Georgia, "Times New Roman", serif; line-height: 1.8; margin: 1em 2em; }
h1, h2, h3 { margin-top: 2em; font-weight: bold; }
p { margin: 0; text-indent: 1.5em; }
p + p { margin-top: 0.2em; }
h1 + p, h2 + p, h3 + p, p:first-of-type { text-indent: 0; }
hr { border: none; text-align: center; margin: 2em 0; }
hr::before { content: "* * *"; }
.noteref { font-size: 0.75em; vertical-align: super; text-decoration: none; }
.footnotes { margin-top: 3em; font-size: 0.9em; }
.footnotes p { text-indent: 0; margin: 0.6em 0; }
.fnrule { border: none; border-top: 1px solid #999; width: 30%; margin: 0 0 1em 0; }
.fnrule::before { content: ""; }
.fnback { text-decoration: none; font-weight: bold; margin-right: 0.4em; }
`.trim();
// ── EPUB assembly ─────────────────────────────────────────────────────────────
async function buildEpub(opts) {
    const { title, author, language = 'en', chapters } = opts;
    const uid = `urn:uuid:epub-${Date.now().toString(36)}`;
    const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const zip = new jszip_1.default();
    // mimetype must be first and stored without compression per the EPUB spec
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);
    zip.file('OEBPS/style.css', STYLESHEET);
    for (const ch of chapters) {
        zip.file(`OEBPS/${ch.id}.xhtml`, chapterXhtml(ch));
    }
    const manifestItems = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="css" href="style.css" media-type="text/css"/>',
        ...chapters.map(ch => `<item id="${ch.id}" href="${ch.id}.xhtml" media-type="application/xhtml+xml"/>`),
    ].join('\n    ');
    const spineItems = chapters
        .map(ch => `<itemref idref="${ch.id}"/>`)
        .join('\n    ');
    zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uid}</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
${author ? `    <dc:creator>${esc(author)}</dc:creator>\n` : ''}    <dc:language>${language}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`);
    const navItems = chapters
        .map((ch, i) => `      <li><a href="${ch.id}.xhtml">${String(i + 1).padStart(2, '0')}. ${esc(ch.title)}</a></li>`)
        .join('\n');
    zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head><meta charset="UTF-8"/><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`);
    return zip.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' });
}
