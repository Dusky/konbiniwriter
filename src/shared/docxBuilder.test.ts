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
