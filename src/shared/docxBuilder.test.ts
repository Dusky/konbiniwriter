import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildDocx } from './docxBuilder'

const chapters = [
  { title: 'Chapter One', markdown: '# Chapter One\n\nA **bold** claim and an *italic* aside.\n\n---\n\nAfter the break.' },
  { title: 'Chapter Two', markdown: 'Second chapter body.' },
]

async function docXml(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  return {
    doc: await zip.file('word/document.xml')!.async('string'),
    headerFile: Object.keys(zip.files).find((f) => /header\d*\.xml$/.test(f)),
    zip,
  }
}

describe('buildDocx', () => {
  it('produces a valid .docx zip for the manuscript style', async () => {
    const bytes = await buildDocx({ title: 'My Book', author: 'Jane Novelist', style: 'manuscript', chapters })
    expect(bytes.byteLength).toBeGreaterThan(0)
    const { doc } = await docXml(bytes)
    expect(doc).toContain('Georgia')          // readable serif, not Courier
    expect(doc).not.toContain('Courier New')
    expect(doc).toContain('My Book')
  })

  it('shunn style is Courier, double-spaced, with a running header incl. surname + page number', async () => {
    const bytes = await buildDocx({ title: 'My Book', author: 'Jane Novelist', style: 'shunn', chapters })
    const { doc, headerFile, zip } = await docXml(bytes)
    expect(doc).toContain('Courier New')
    expect(doc).toMatch(/words/)              // word-count title page
    expect(headerFile).toBeTruthy()
    const header = await zip.file(headerFile!)!.async('string')
    expect(header).toContain('Novelist')      // surname in the running header
    expect(header).toContain('PAGE')          // page-number field
  })
})

describe('footnotes', () => {
  const noted = [
    { title: 'One', markdown: 'She paid the toll.[^1] She crossed.\n\n[^1]: Two coins, always.' },
    { title: 'Two', markdown: 'A later note.[^a]\n\n[^a]: Filed second.' },
  ]

  it('writes real Word footnotes, not literal [^1] in the prose', async () => {
    const bytes = await buildDocx({ title: 'B', style: 'manuscript', chapters: noted })
    const { doc, zip } = await docXml(bytes)
    expect(doc).toContain('footnoteReference')
    expect(doc).not.toContain('[^1]')
    const fn = await zip.file('word/footnotes.xml')?.async('string')
    expect(fn).toContain('Two coins, always.')
  })

  it('never prints the definition line as body text', async () => {
    const { doc } = await docXml(await buildDocx({ title: 'B', style: 'manuscript', chapters: noted }))
    expect(doc).not.toContain('Two coins, always.')
  })

  it('numbers across the whole document, not per chapter', async () => {
    const { zip } = await docXml(await buildDocx({ title: 'B', style: 'manuscript', chapters: noted }))
    const fn = await zip.file('word/footnotes.xml')?.async('string') ?? ''
    // Chapter two's note is the document's second, even though its label is 'a'.
    expect(fn.indexOf('Two coins')).toBeLessThan(fn.indexOf('Filed second'))
  })

  it('leaves a document without notes exactly as it was', async () => {
    const { doc } = await docXml(await buildDocx({ title: 'B', style: 'manuscript', chapters }))
    expect(doc).not.toContain('footnoteReference')
  })
})
