// epubBuilder.ts — pure EPUB 3 builder. Works in both browser and Node.js.
// Imported by all three compile() backends (BrowserProjectService, OPFSProjectService,
// NodeProjectService) so the format lives in one place.

import JSZip from 'jszip'

export interface EpubChapter {
  id: string       // safe file stem, e.g. "ch_0001"
  title: string
  markdown: string
}

export interface EpubOptions {
  title: string
  language?: string
  chapters: EpubChapter[]
}

// ── Minimal Markdown → XHTML ──────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inlineMarkup(line: string): string {
  return esc(line)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
}

function mdToXhtml(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let para: string[] = []

  const flushPara = () => {
    if (!para.length) return
    out.push(`<p>${inlineMarkup(para.join(' '))}</p>`)
    para = []
  }

  for (const raw of lines) {
    const h1 = raw.match(/^#\s+(.+)$/)
    const h2 = raw.match(/^##\s+(.+)$/)
    const h3 = raw.match(/^###\s+(.+)$/)
    const hr = /^-{3,}$/.test(raw.trim())

    if (h1 || h2 || h3) {
      flushPara()
      const lvl = h1 ? 1 : h2 ? 2 : 3
      const text = esc((h1 ?? h2 ?? h3)![1])
      out.push(`<h${lvl}>${text}</h${lvl}>`)
    } else if (hr) {
      flushPara()
      out.push('<hr/>')
    } else if (raw.trim() === '') {
      flushPara()
    } else {
      para.push(raw)
    }
  }
  flushPara()
  return out.join('\n')
}

function chapterXhtml(ch: EpubChapter): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${esc(ch.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${mdToXhtml(ch.markdown)}
</body>
</html>`
}

const STYLESHEET = `
body { font-family: Georgia, "Times New Roman", serif; line-height: 1.8; margin: 1em 2em; }
h1, h2, h3 { margin-top: 2em; font-weight: bold; }
p { margin: 0; text-indent: 1.5em; }
p + p { margin-top: 0.2em; }
h1 + p, h2 + p, h3 + p, p:first-of-type { text-indent: 0; }
hr { border: none; text-align: center; margin: 2em 0; }
hr::before { content: "* * *"; }
`.trim()

// ── EPUB assembly ─────────────────────────────────────────────────────────────

export async function buildEpub(opts: EpubOptions): Promise<Uint8Array> {
  const { title, language = 'en', chapters } = opts
  const uid = `urn:uuid:epub-${Date.now().toString(36)}`
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  const zip = new JSZip()

  // mimetype must be first and stored without compression per the EPUB spec
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)

  zip.file('OEBPS/style.css', STYLESHEET)

  for (const ch of chapters) {
    zip.file(`OEBPS/${ch.id}.xhtml`, chapterXhtml(ch))
  }

  const manifestItems = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...chapters.map(ch =>
      `<item id="${ch.id}" href="${ch.id}.xhtml" media-type="application/xhtml+xml"/>`),
  ].join('\n    ')

  const spineItems = chapters
    .map(ch => `<itemref idref="${ch.id}"/>`)
    .join('\n    ')

  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uid}</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
    <dc:language>${language}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`)

  const navItems = chapters
    .map((ch, i) =>
      `      <li><a href="${ch.id}.xhtml">${String(i + 1).padStart(2, '0')}. ${esc(ch.title)}</a></li>`)
    .join('\n')

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
</html>`)

  return zip.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' })
}
