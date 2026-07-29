import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildEpub } from './epubBuilder'

const read = async (bytes: Uint8Array, name: string) => {
  const zip = await JSZip.loadAsync(bytes)
  const path = Object.keys(zip.files).find((f) => f.endsWith(name))
  return path ? await zip.file(path)!.async('string') : null
}

const chapters = [
  { id: 'ch_0001', title: 'One', markdown: 'She paid the toll.[^1] She crossed.\n\n[^1]: Two coins, always.' },
]

describe('buildEpub footnotes', () => {
  it('links the reference to a note instead of printing [^1]', async () => {
    const bytes = await buildEpub({ title: 'B', chapters })
    const xhtml = await read(bytes, 'ch_0001.xhtml') ?? ''
    expect(xhtml).toContain('epub:type="noteref"')
    expect(xhtml).toContain('href="#ch_0001-fn1"')
    expect(xhtml).not.toContain('[^1]')
  })

  it('renders the note as an EPUB 3 footnote, so readers can pop it up', async () => {
    const xhtml = await read(await buildEpub({ title: 'B', chapters }), 'ch_0001.xhtml') ?? ''
    expect(xhtml).toContain('epub:type="footnote"')
    expect(xhtml).toContain('Two coins, always.')
    // And a way back, for readers that navigate rather than pop up.
    expect(xhtml).toContain('href="#ch_0001-ref1"')
  })

  it('never leaves the definition line in the prose', async () => {
    const xhtml = await read(await buildEpub({ title: 'B', chapters }), 'ch_0001.xhtml') ?? ''
    expect(xhtml).not.toContain('[^1]:')
    expect(xhtml).toMatch(/<p>She paid the toll\.<a[^>]*>1<\/a> She crossed\.<\/p>/)
  })

  it('adds no notes section to a chapter that has none', async () => {
    const plain = [{ id: 'ch_0001', title: 'One', markdown: 'Just prose.' }]
    const xhtml = await read(await buildEpub({ title: 'B', chapters: plain }), 'ch_0001.xhtml') ?? ''
    expect(xhtml).not.toContain('epub:type="footnotes"')
    expect(xhtml).toContain('<p>Just prose.</p>')
  })

  it('keeps emphasis working alongside a reference', async () => {
    const md = [{ id: 'ch_0001', title: 'One', markdown: 'An *aside*[^1] here.\n\n[^1]: note' }]
    const xhtml = await read(await buildEpub({ title: 'B', chapters: md }), 'ch_0001.xhtml') ?? ''
    expect(xhtml).toContain('<em>aside</em>')
    expect(xhtml).toContain('noteref')
  })
})
