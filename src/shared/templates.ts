import type { Project, KNode, DocBody, DocMeta, TemplateId, ID } from './types'
import { uid } from './utils'

function makeNode(
  id: ID,
  type: KNode['type'],
  title: string,
  parentId: ID | null,
  metaOverrides?: Partial<DocMeta>
): KNode {
  return {
    id,
    type,
    title,
    parentId,
    childIds: [],
    expanded: type === 'folder',
    meta: {
      label: type === 'scene' ? 'scene' : 'none',
      status: 'todo',
      synopsis: '',
      target: 0,
      includeInCompile: type !== 'folder',
      ...metaOverrides,
    },
    ext: {},
    rev: 1,
    modified: new Date().toISOString(),
  }
}

export function buildProjectFromTemplate(
  title: string,
  template: TemplateId,
  location: string
): Project {
  const id = uid('proj')
  const now = new Date().toISOString()
  const nodes: Record<ID, KNode> = {}
  const docs: Record<ID, DocBody> = {}
  let rootIds: ID[] = []
  const trashId = uid('trash')

  const addNode = (n: KNode, content = '') => {
    nodes[n.id] = n
    if (n.type !== 'folder') docs[n.id] = { content, snapshots: [] }
  }

  const link = (parentId: ID, childIds: ID[]) => {
    nodes[parentId].childIds = childIds
    childIds.forEach((cid) => { nodes[cid].parentId = parentId })
  }

  // Trash is always present
  const trash = makeNode(trashId, 'folder', 'Trash', null, { includeInCompile: false })
  nodes[trashId] = trash

  if (template === 'blank') {
    const mId = uid('folder')
    const dId = uid('document')
    const m = makeNode(mId, 'folder', 'Manuscript', null, { status: 'inprogress' })
    const d = makeNode(dId, 'document', 'Untitled', mId)
    addNode(m); addNode(d)
    link(mId, [dId])
    rootIds = [mId, trashId]

  } else if (template === 'novel') {
    // — rich sample project (Midnight Aisle) so Phase-1 is immediately testable —
    const mId = 'manuscript', p1Id = 'p1', c1Id = 'c1', s1Id = 's1', s2Id = 's2'
    const c2Id = 'c2', s3Id = 's3', s4Id = 's4'
    const p2Id = 'p2', c3Id = 'c3', s5Id = 's5'
    const charsId = 'characters', chReikoId = 'ch_reiko', chMgrId = 'ch_manager', chWomanId = 'ch_woman'
    const resId = 'research', r1Id = 'r1', r2Id = 'r2'

    addNode(makeNode(mId, 'folder', 'Manuscript', null, { status: 'inprogress', synopsis: 'A night-shift clerk at an all-night convenience store discovers the store keeps a customer it never rang up.' }))
    addNode(makeNode(p1Id, 'folder', 'Part One — Graveyard Shift', mId, { status: 'draft', synopsis: 'Reiko takes the 11pm–7am shift. The store is quiet. It is never quiet for long.' }))
    addNode(makeNode(c1Id, 'folder', 'Chapter 1 — The Bell', p1Id, { label: 'chapter', status: 'revised', synopsis: 'The door chime that rings when no one comes in.' }))
    addNode(makeNode(s1Id, 'scene', 'The first customer', c1Id, { label: 'scene', status: 'final', target: 900, synopsis: 'Reiko clocks in at 11pm. A salaryman buys an umbrella though the sky is clear. The door chimes after he leaves — twice.' }), `# The first customer

The fluorescent lights of the **Sunny-Mart** never fully warmed up. They flickered to life at a frequency just below comfort, a hum [[Reiko]] had stopped hearing on her third night and started hearing again on her thirtieth.

Eleven o'clock. She tied the apron, counted the till, and watched the rain that wasn't falling.

The first customer came at 11:14. A salaryman, tie loosened, eyes the colour of old tea. He set a clear vinyl umbrella on the counter and said nothing.

"It's not raining," she said.

"Not yet." He paid in coins, exact to the yen, and left without a bag.

The door chimed as it closed behind him.

Then it chimed again.

*Nobody came in.*

> Note to self — the second chime. Keep it small. Don't explain it. The reader should hear it before they understand it.

She told herself it was the wind. There was no wind. She wrote the time in the logbook the way [[The Night Manager]] had taught her, and underlined it twice without deciding why.`)

    addNode(makeNode(s2Id, 'scene', 'Aisle Nine', c1Id, { label: 'scene', status: 'draft', target: 1100, synopsis: "Restocking at 3am, Reiko finds an aisle the floor plan does not list. The bento at the back has tomorrow's date." }), `# Aisle Nine

The store had eight aisles. [[Reiko]] had counted them on her first night the way you count exits.

At 3:02 she went to restock the cold case and found a ninth.

It began where the mop closet should have been, narrow and over-lit, the shelves running back further than the building could hold. Onigiri. Egg sandwiches. A single bento at the very back, wrapped, labelled in a neat hand.

The date on the label was *tomorrow*.

> She should put it back. She does not put it back. — fix this beat, too fast.

[[Aisle Nine]] was cold in the way a held breath is cold. When she stepped out, the mop closet was a mop closet again, and the floor plan taped behind the register still showed eight.`)

    link(c1Id, [s1Id, s2Id])

    addNode(makeNode(c2Id, 'folder', 'Chapter 2 — Regulars', p1Id, { label: 'chapter', status: 'draft', synopsis: 'The customers who only come after midnight.' }))
    addNode(makeNode(s3Id, 'scene', 'The Woman in White', c2Id, { label: 'scene', status: 'inprogress', target: 1000, synopsis: 'Every night at 3:33 a woman in a white coat buys one bottle of milk and asks if the bathroom is occupied. It always is.' }), `# The Woman in White

She arrived at 3:33, the way she always arrived at 3:33.

[[The Woman in White]] took one bottle of milk from the case — never two — and set it on the counter without meeting [[Reiko]]'s eyes.

"Is the bathroom occupied?"

Reiko looked at the key on its wooden paddle, hanging on its hook where it always hung.

"No," she said. "It's free."

The woman smiled at something just past Reiko's shoulder. "It's occupied," she said, and left the milk, and left.`)

    addNode(makeNode(s4Id, 'scene', 'Nori-san', c2Id, { label: 'scene', status: 'todo', target: 1200, synopsis: 'The old man who reads the same magazine every night and warns Reiko never to answer the back door.' }))
    link(c2Id, [s3Id, s4Id])
    link(p1Id, [c1Id, c2Id])

    addNode(makeNode(p2Id, 'folder', 'Part Two — Closing Time', mId, { status: 'todo', synopsis: 'The store cannot close. Reiko tries anyway.' }))
    addNode(makeNode(c3Id, 'folder', 'Chapter 3 — Stocktake', p2Id, { label: 'chapter', status: 'idea', synopsis: 'Counting everything in the store, including the things that count back.' }))
    addNode(makeNode(s5Id, 'scene', 'Inventory of the missing', c3Id, { label: 'scene', status: 'idea', target: 1500, synopsis: "Reiko reconciles the stock and finds items sold to customers who were never there — and her own name on a delivery manifest." }))
    link(c3Id, [s5Id]); link(p2Id, [c3Id]); link(mId, [p1Id, p2Id])

    addNode(makeNode(charsId, 'folder', 'Characters', null, { synopsis: 'Cast.' }))
    addNode(makeNode(chReikoId, 'document', 'Reiko Tanaka', charsId, { label: 'character', status: 'draft', synopsis: "22, art-school dropout, took the night shift to avoid sleeping. The reader's anchor." }), `# Reiko Tanaka

**Age** 22 · **Role** night-shift clerk, narrator

Took the graveyard shift at the Sunny-Mart because the daylight hours had started to feel borrowed. Notices everything; trusts none of it. Keeps a logbook.

- Wants: to get through the shift.
- Needs: to stop pretending she doesn't see [[Aisle Nine]].
- Fear: the back door.`)
    addNode(makeNode(chMgrId, 'document', 'The Night Manager', charsId, { label: 'character', status: 'todo', synopsis: 'Trained Reiko in a single shift, then was never rostered again. The logbook is in his handwriting.' }))
    addNode(makeNode(chWomanId, 'document', 'The Woman in White', charsId, { label: 'character', status: 'inprogress', synopsis: 'Arrives at 3:33 every night. Buys one bottle of milk. Asks about the bathroom.' }), `# The Woman in White

Arrives at 3:33 — the ushimitsu hour, the hour of the ox.

Always one bottle of milk. Never two.

She asks whether the bathroom is occupied. The answer is always yes, even when the key is on its hook.

The Aka Manto legend braided into her visits — never named in the prose.`)
    link(charsId, [chReikoId, chMgrId, chWomanId])

    addNode(makeNode(resId, 'folder', 'Research', null, { synopsis: 'Reference material.' }))
    addNode(makeNode(r1Id, 'document', 'Sunny-Mart floor plan', resId, { label: 'note', status: 'final', synopsis: 'Eight aisles. Register front-left. Back door rear-right. Mop closet beside back door.' }), `# Sunny-Mart — Floor Plan Notes

Eight aisles, numbered 1–8 left to right from the register.

- Register: front-left
- Cold cases: back wall, aisles 6–8
- Bathroom: right side, middle of store
- Mop closet: rear-right, beside the back door
- Back door: never answer it

The ninth aisle appears where the mop closet should be. It is not on this floor plan.`)
    addNode(makeNode(r2Id, 'document', 'Japanese folklore notes', resId, { label: 'note', status: 'final', synopsis: 'Ushimitsu-doki, Aka Manto, konbini ghost lore.' }), `# Japanese Folklore — Reference

## Ushimitsu-doki (丑三つ時)
The "hour of the ox" — approximately 2–3 a.m. The traditional witching hour. Spirits are most active. The Woman in White arrives at 3:33, within this window.

## Aka Manto (赤マント)
A spirit that appears in bathroom stalls and asks: "Red paper or blue paper?" Either answer kills. Braided into the Woman in White's bathroom question — **never name the legend in the prose. Imply it only.**

## Konbini lore
All-night convenience stores accumulate their own urban legends. The night shift isolates the worker; the fluorescent light is unchanging; the customers become regulars, then fixtures.`)
    link(resId, [r1Id, r2Id])

    rootIds = [mId, charsId, resId, trashId]

  } else if (template === 'screenplay') {
    const scriptId = uid('folder')
    const act1Id = uid('folder')
    const sc1Id = uid('scene')
    const script = makeNode(scriptId, 'folder', 'Script', null, { status: 'inprogress' })
    const act1 = makeNode(act1Id, 'folder', 'Act One', scriptId, { label: 'chapter', status: 'todo' })
    const sc1 = makeNode(sc1Id, 'scene', 'Scene 1', act1Id, { label: 'scene', status: 'todo' })
    addNode(script); addNode(act1); addNode(sc1)
    link(act1Id, [sc1Id]); link(scriptId, [act1Id])
    rootIds = [scriptId, trashId]

  } else {
    // nonfiction
    const bookId = uid('folder')
    const ch1Id = uid('folder')
    const sec1Id = uid('document')
    const book = makeNode(bookId, 'folder', 'Book', null, { status: 'inprogress' })
    const ch1 = makeNode(ch1Id, 'folder', 'Chapter 1', bookId, { label: 'chapter', status: 'todo' })
    const sec1 = makeNode(sec1Id, 'document', 'Introduction', ch1Id, { status: 'todo' })
    addNode(book); addNode(ch1); addNode(sec1)
    link(ch1Id, [sec1Id]); link(bookId, [ch1Id])
    rootIds = [bookId, trashId]
  }

  return {
    schemaVersion: 2,
    id,
    title,
    created: now,
    modified: now,
    rootIds,
    trashId,
    nodes,
    docs,
    settings: { location, template },
  }
}
