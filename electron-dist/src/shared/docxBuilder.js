"use strict";
// docxBuilder.ts — pure DOCX builder. Works in both browser and Node.js.
// Imported by all three compile() backends so the format lives in one place.
//
// Two styles:
//   'manuscript' — a clean, readable book layout (title page, chapter breaks,
//                  first-line indents, centered scene breaks).
//   'shunn'      — standard manuscript format for agent/editor submission
//                  (Courier 12pt, double-spaced, title page with word count,
//                  running "Surname / TITLE / page" header, # scene breaks).
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDocx = buildDocx;
const docx_1 = require("docx");
const TWIP = { halfInch: 720, inch: 1440 };
function inlineRuns(text, base = {}) {
    const runs = [];
    // Tokenise **bold**, *italic*, _italic_ in one pass.
    const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)/g;
    let last = 0;
    let m;
    const push = (t, extra = {}) => {
        if (t)
            runs.push(new docx_1.TextRun({ text: t, font: base.font, size: base.size, ...extra }));
    };
    while ((m = re.exec(text))) {
        if (m.index > last)
            push(text.slice(last, m.index));
        if (m[2] !== undefined)
            push(m[2], { bold: true });
        else if (m[4] !== undefined)
            push(m[4], { italics: true });
        else if (m[6] !== undefined)
            push(m[6], { italics: true });
        last = re.lastIndex;
    }
    if (last < text.length)
        push(text.slice(last));
    if (runs.length === 0)
        push('');
    return runs;
}
const isSceneBreak = (line) => /^(-{3,}|\*{3,}|#)\s*$/.test(line.trim());
// Split a chapter's markdown into body paragraphs, dropping a leading H1 that
// merely repeats the chapter title and normalising scene-break markers.
function bodyLines(markdown, title) {
    const lines = markdown.split('\n');
    const out = [];
    let seenContent = false;
    for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        const trimmed = line.trim();
        // Skip a leading "# Title" that duplicates the chapter heading.
        if (!seenContent && /^#\s+/.test(trimmed) && trimmed.replace(/^#\s+/, '') === title)
            continue;
        if (trimmed === '')
            continue;
        seenContent = true;
        if (isSceneBreak(trimmed)) {
            out.push({ scene: true });
            continue;
        }
        // Strip any remaining markdown heading marker; render as a normal paragraph.
        out.push({ text: trimmed.replace(/^#{1,6}\s+/, '') });
    }
    return out;
}
function wordCount(chapters) {
    const words = chapters.map(c => c.markdown.trim()).join(' ').trim();
    return words ? words.split(/\s+/).length : 0;
}
// ── Build ─────────────────────────────────────────────────────────────────────
async function buildDocx(opts) {
    const { title, author, chapters, style } = opts;
    const shunn = style === 'shunn';
    const font = shunn ? 'Courier New' : 'Georgia';
    const size = 24; // 12pt (half-points)
    const line = shunn ? { line: 480, lineRule: docx_1.LineRuleType.AUTO } : { line: 276, lineRule: docx_1.LineRuleType.AUTO };
    const bodySpacing = shunn ? line : { ...line, after: 0 };
    const para = (children, extra = {}) => new docx_1.Paragraph({ children, spacing: line, ...extra });
    const children = [];
    // ── Title page ──
    if (shunn) {
        const wc = wordCount(chapters);
        const rounded = wc >= 10000 ? Math.round(wc / 1000) * 1000 : Math.round(wc / 100) * 100;
        // Author / contact block, top-left.
        children.push(para([new docx_1.TextRun({ text: author || 'Author Name', font, size })]));
        children.push(para([new docx_1.TextRun({ text: '(contact details)', font, size })]));
        children.push(para([new docx_1.TextRun({ text: `about ${rounded.toLocaleString()} words`, font, size })]));
        // Title, centered, pushed down the page.
        for (let i = 0; i < 8; i++)
            children.push(para([new docx_1.TextRun({ text: '', font, size })]));
        children.push(para([new docx_1.TextRun({ text: title.toUpperCase(), font, size })], { alignment: docx_1.AlignmentType.CENTER }));
        children.push(para([new docx_1.TextRun({ text: `by ${author || 'Author Name'}`, font, size })], { alignment: docx_1.AlignmentType.CENTER }));
    }
    else {
        for (let i = 0; i < 6; i++)
            children.push(para([new docx_1.TextRun({ text: '', font, size })]));
        children.push(para([new docx_1.TextRun({ text: title, font, size: 56, bold: true })], { alignment: docx_1.AlignmentType.CENTER }));
        if (author)
            children.push(para([new docx_1.TextRun({ text: `by ${author}`, font, size: 28 })], { alignment: docx_1.AlignmentType.CENTER, spacing: { ...line, before: 240 } }));
    }
    // ── Chapters ──
    chapters.forEach((ch, ci) => {
        children.push(para([new docx_1.TextRun({ text: shunn ? ch.title.toUpperCase() : ch.title, font, size: shunn ? size : 32, bold: !shunn })], { alignment: docx_1.AlignmentType.CENTER, pageBreakBefore: true, spacing: { ...line, before: shunn ? 2400 : 0, after: shunn ? 480 : 360 } }));
        const lines = bodyLines(ch.markdown, ch.title);
        lines.forEach((item) => {
            if ('scene' in item) {
                children.push(para([new docx_1.TextRun({ text: '#', font, size })], { alignment: docx_1.AlignmentType.CENTER, spacing: { ...line, before: 240, after: 240 } }));
            }
            else {
                children.push(new docx_1.Paragraph({
                    children: inlineRuns(item.text, { font, size }),
                    spacing: bodySpacing,
                    indent: { firstLine: TWIP.halfInch },
                    alignment: docx_1.AlignmentType.LEFT,
                }));
            }
        });
        void ci;
    });
    // ── Running header (Shunn): Surname / TITLE / page ──
    const surname = (author || 'Author').trim().split(/\s+/).pop() || 'Author';
    const shortTitle = title.split(/\s+/).slice(0, 2).join(' ').toUpperCase();
    const header = shunn ? new docx_1.Header({
        children: [new docx_1.Paragraph({
                alignment: docx_1.AlignmentType.RIGHT,
                children: [new docx_1.TextRun({ text: `${surname} / ${shortTitle} / `, font, size }), new docx_1.TextRun({ children: [docx_1.PageNumber.CURRENT], font, size })],
            })],
    }) : undefined;
    const doc = new docx_1.Document({
        creator: author || 'Konbini',
        title,
        sections: [{
                properties: {
                    page: { margin: { top: TWIP.inch, bottom: TWIP.inch, left: TWIP.inch, right: TWIP.inch } },
                    titlePage: shunn, // first page skips the running header
                },
                headers: header ? { default: header } : undefined,
                children,
            }],
    });
    // Packer.toBuffer only works in Node (it asks JSZip for a nodebuffer);
    // browsers must use toBlob. Branch so this shared builder returns a
    // Uint8Array on both platforms.
    if (typeof window !== 'undefined') {
        const blob = await docx_1.Packer.toBlob(doc);
        return new Uint8Array(await blob.arrayBuffer());
    }
    const buf = await docx_1.Packer.toBuffer(doc);
    return new Uint8Array(buf);
}
