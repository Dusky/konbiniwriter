import { describe, it, expect } from 'vitest'
import { parseXml, isScrivenerBundle, findScrivxPath, parseScrivener } from './scrivener'

const rtf = (t: string) => `{\\rtf1\\ansi ${t}}`

// A realistic v3 binder: a folder with two children, plus Research and Trash.
const SCRIVX_V3 = `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject Version="3.0">
  <Binder>
    <BinderItem UUID="AAA" Type="DraftFolder">
      <Title>Manuscript</Title>
      <Children>
        <BinderItem UUID="BBB" Type="Folder">
          <Title>Chapter 1</Title>
          <Children>
            <BinderItem UUID="CCC" Type="Text"><Title>The Bell</Title></BinderItem>
            <BinderItem UUID="DDD" Type="Text"><Title>Aisle Nine</Title></BinderItem>
          </Children>
        </BinderItem>
      </Children>
    </BinderItem>
    <BinderItem UUID="EEE" Type="ResearchFolder">
      <Title>Research</Title>
      <Children><BinderItem UUID="FFF" Type="Text"><Title>Floor plan</Title></BinderItem></Children>
    </BinderItem>
    <BinderItem UUID="ZZZ" Type="TrashFolder">
      <Title>Trash</Title>
      <Children><BinderItem UUID="YYY" Type="Text"><Title>Deleted scene</Title></BinderItem></Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`

function v3Files(): Map<string, string> {
  return new Map<string, string>([
    ['MyNovel.scrivx', SCRIVX_V3],
    ['Files/Data/CCC/content.rtf', rtf('The bell rang twice.')],
    ['Files/Data/CCC/synopsis.txt', 'Reiko hears the bell.'],
    ['Files/Data/DDD/content.rtf', rtf('Nobody came in.')],
    ['Files/Data/FFF/content.rtf', rtf('Sunny-Mart layout notes.')],
    ['Files/Data/YYY/content.rtf', rtf('This was thrown away.')],
  ])
}

describe('parseXml', () => {
  it('parses nesting, attributes and text', () => {
    const root = parseXml('<a x="1"><b>hi</b><c/></a>')!
    const a = root.children[0]
    expect(a.tag).toBe('a')
    expect(a.attrs.x).toBe('1')
    expect(a.children.map((c) => c.tag)).toEqual(['b', 'c'])
    expect(a.children[0].text).toBe('hi')
  })
  it('handles CDATA, comments, declarations and entities', () => {
    const root = parseXml('<?xml version="1.0"?><!-- skip --><t><![CDATA[a<b]]></t>')!
    expect(root.children[0].text).toBe('a<b')
    expect(parseXml('<t>Tom &amp; Jerry &#65;</t>')!.children[0].text).toBe('Tom & Jerry A')
  })
})

describe('detection', () => {
  it('spots a .scrivx and prefers the shallowest', () => {
    expect(isScrivenerBundle(['N.scriv/N.scrivx', 'N.scriv/Files/x.rtf'])).toBe(true)
    expect(isScrivenerBundle(['notes/a.md'])).toBe(false)
    expect(findScrivxPath(['a/b/deep.scrivx', 'top.scrivx'])).toBe('top.scrivx')
  })
})

describe('parseScrivener (v3)', () => {
  it('rebuilds the binder as nested paths', () => {
    const r = parseScrivener(v3Files())
    if ('error' in r) throw new Error(r.error)
    const paths = r.docs.map((d) => d.path).sort()
    expect(paths).toContain('Manuscript/Chapter 1/The Bell.md')
    expect(paths).toContain('Manuscript/Chapter 1/Aisle Nine.md')
    expect(paths).toContain('Research/Floor plan.md')
  })

  it('converts RTF to prose and keeps the synopsis', () => {
    const r = parseScrivener(v3Files())
    if ('error' in r) throw new Error(r.error)
    const bell = r.docs.find((d) => d.path.endsWith('The Bell.md'))!
    expect(bell.content).toBe('The bell rang twice.')
    expect(bell.synopsis).toBe('Reiko hears the bell.')
  })

  it('does NOT import Scrivener’s Trash', () => {
    const r = parseScrivener(v3Files())
    if ('error' in r) throw new Error(r.error)
    expect(r.docs.some((d) => d.path.includes('Deleted scene'))).toBe(false)
    expect(r.docs.some((d) => d.path.includes('Trash'))).toBe(false)
  })

  it('takes the project title from the .scrivx filename', () => {
    const r = parseScrivener(v3Files())
    if ('error' in r) throw new Error(r.error)
    expect(r.title).toBe('MyNovel')
  })

  it('keeps empty leaf stubs so outline structure survives', () => {
    const files = v3Files()
    files.delete('Files/Data/DDD/content.rtf')
    const r = parseScrivener(files)
    if ('error' in r) throw new Error(r.error)
    const stub = r.docs.find((d) => d.path.endsWith('Aisle Nine.md'))
    expect(stub).toBeDefined()
    expect(stub!.content).toBe('')
    expect(r.emptyCount).toBeGreaterThan(0)
  })

  it('sanitises titles that would otherwise fake a folder level', () => {
    const files = new Map<string, string>([
      ['P.scrivx', `<ScrivenerProject><Binder><BinderItem UUID="Q" Type="Text"><Title>A/B: split</Title></BinderItem></Binder></ScrivenerProject>`],
      ['Files/Data/Q/content.rtf', rtf('body')],
    ])
    const r = parseScrivener(files)
    if ('error' in r) throw new Error(r.error)
    expect(r.docs[0].path).toBe('A-B: split.md')
  })
})

describe('parseScrivener (v2 layout)', () => {
  it('reads Files/Docs/<id>.rtf', () => {
    const files = new Map<string, string>([
      ['Old.scrivx', `<ScrivenerProject><Binder><BinderItem ID="12" Type="Text"><Title>Scene</Title></BinderItem></Binder></ScrivenerProject>`],
      ['Files/Docs/12.rtf', rtf('Legacy prose.')],
      ['Files/Docs/12_synopsis.txt', 'Old synopsis.'],
    ])
    const r = parseScrivener(files)
    if ('error' in r) throw new Error(r.error)
    expect(r.docs[0].content).toBe('Legacy prose.')
    expect(r.docs[0].synopsis).toBe('Old synopsis.')
  })
})

describe('parseScrivener errors', () => {
  it('reports a missing manifest and an unreadable binder', () => {
    expect(parseScrivener(new Map([['a.md', 'x']]))).toHaveProperty('error')
    expect(parseScrivener(new Map([['P.scrivx', '<ScrivenerProject></ScrivenerProject>']]))).toHaveProperty('error')
  })
})
