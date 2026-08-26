#!/usr/bin/env node
/**
 * scripts/shots.mjs — a camera, not a test.
 *
 * `scripts/smoke.mjs` asserts invariants and fails the build. This drives the
 * same app and only takes pictures; a person reads the output. Both exist
 * because every serious bug this project has shipped compiled cleanly and
 * passed the unit suite — and two rounds of simply *looking at the app* then
 * found thirteen more: a compile modal that never says what it is about to
 * export, wikilink syntax leaking into finished manuscripts, Adventure drafting
 * a novel into a character sheet, Scrivenings unreachable by clicking a folder.
 *
 * It is checked in rather than thrown away because it had been rebuilt from
 * scratch three times before anyone noticed that was waste.
 *
 *   npm run shots                  # writes to ./shots
 *   OUT=/tmp/before npm run shots  # elsewhere, so two runs can be compared
 *
 * Comparing two runs is the point: a before/after pair is what caught the
 * Scrivenings regression and confirmed the Adventure default was fixed.
 *
 * Runs against OPFS (File System Access is deleted before boot, so no directory
 * picker appears) and against a mocked OpenAI-compatible endpoint, so the AI
 * surfaces can be photographed holding real-shaped output with no key and no
 * network. The mock routes on each prompt's opening line — every builtin
 * template starts "You are a ...", which is stable enough to key on.
 *
 * Requires the dev server: `npm run dev` in another terminal.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:5173'
const PID = 'shots'
const OUT = process.env.OUT
const exe = ['/opt/pw-browsers/chromium/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p))

const PROSE = {
  s1: `# The first customer

The fluorescent lights of the Sunny-Mart never fully warmed up. They flickered to life at a frequency just below comfort, a hum [[Reiko]] had stopped hearing on her third night and started hearing again on her thirtieth.

Eleven o'clock. She tied the apron, counted the till, and watched the rain that wasn't falling.

The first customer came at 11:14. A salaryman, tie loosened, eyes the colour of old tea. He set a clear vinyl umbrella on the counter and said nothing.

"It's not raining," she said.

"Not yet." He paid in coins, exact to the yen, and left without a bag.

The door chimed as it closed behind him. Then it chimed again.

*Nobody came in.*

She told herself it was the wind. There was no wind. She wrote the time in the logbook the way [[The Night Manager]] had taught her, and underlined it twice without deciding why.`,
  s2: `# Aisle Nine

The store had eight aisles. [[Reiko]] had counted them on her first night the way you count exits.

At 3:02 she went to restock the cold case and found a ninth.

It began where the mop closet should have been, narrow and over-lit, the shelves running back further than the building could hold. Onigiri. Egg sandwiches. A single bento at the very back, wrapped, labelled in a neat hand.

The date on the label was *tomorrow*.`,
  s3: `# The Woman in White

She arrived at 3:33, the way she always arrived at 3:33.

[[The Woman in White]] took one bottle of milk from the case — never two — and set it on the counter without meeting [[Reiko]]'s eyes.

"Is the bathroom occupied?"`,
  ch: `# Reiko Tanaka

**Age** 22 · **Role** night-shift clerk, narrator

Took the graveyard shift at the Sunny-Mart because the daylight hours had started to feel borrowed. Notices everything; trusts none of it.`,
}
async function seed(page) {
  return page.evaluate(async ({ pid, prose }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('konbini-projects', { create: true })
    const bundle = await root.getDirectoryHandle(`${pid}.konbini`, { create: true })
    const docs = await bundle.getDirectoryHandle('docs', { create: true })
    await bundle.getDirectoryHandle('snapshots', { create: true })
    const write = async (dir, name, text) => {
      const fh = await dir.getFileHandle(name, { create: true })
      const w = await fh.createWritable(); await w.write(text); await w.close()
    }
    const now = new Date().toISOString()
    const mk = (id, type, title, parentId, meta = {}) => ({
      id, type, title, parentId, childIds: [], expanded: true,
      meta: { label: type === 'scene' ? 'scene' : 'none', status: 'draft', synopsis: '', target: 0, includeInCompile: true, keywords: [], ...meta },
      ext: {}, rev: 1, modified: now,
    })
    const nodes = {}, dd = {}
    const add = (n) => { nodes[n.id] = n; if (n.type !== 'folder') dd[n.id] = { snapshots: [] }; return n }
    const link = (p, kids) => { nodes[p].childIds = kids; kids.forEach((k) => { nodes[k].parentId = p }) }

    add(mk('trash', 'folder', 'Trash', null, { includeInCompile: false }))
    add(mk('ms', 'folder', 'Manuscript', null, { status: 'inprogress', synopsis: 'A night-shift clerk discovers the store keeps a customer it never rang up.' }))
    add(mk('p1', 'folder', 'Part One — Graveyard Shift', 'ms', { status: 'draft' }))
    add(mk('c1', 'folder', 'Chapter 1 — The Bell', 'p1', { label: 'chapter', status: 'revised', synopsis: 'The door chime that rings when no one comes in.' }))
    add(mk('s1', 'scene', 'The first customer', 'c1', { status: 'final', target: 900, synopsis: 'Reiko clocks in at 11pm. A salaryman buys an umbrella though the sky is clear. The door chimes after he leaves — twice.', keywords: ['night', 'omen'] }))
    add(mk('s2', 'scene', 'Aisle Nine', 'c1', { status: 'draft', target: 1100, synopsis: 'Restocking at 3am, Reiko finds an aisle the floor plan does not list.', keywords: ['omen'] }))
    link('c1', ['s1', 's2'])
    add(mk('c2', 'folder', 'Chapter 2 — Regulars', 'p1', { label: 'chapter', status: 'draft', synopsis: 'The customers who only come after midnight.' }))
    add(mk('s3', 'scene', 'The Woman in White', 'c2', { status: 'inprogress', target: 1000, synopsis: 'Every night at 3:33 a woman in white buys one bottle of milk.' }))
    add(mk('s4', 'scene', 'Nori-san', 'c2', { status: 'todo', target: 1200, synopsis: 'The old man who warns Reiko never to answer the back door.' }))
    link('c2', ['s3', 's4']); link('p1', ['c1', 'c2'])
    add(mk('p2', 'folder', 'Part Two — Closing Time', 'ms', { status: 'todo' }))
    add(mk('c3', 'folder', 'Chapter 3 — Stocktake', 'p2', { label: 'chapter', status: 'idea' }))
    add(mk('s5', 'scene', 'Inventory of the missing', 'c3', { status: 'idea', target: 1500, synopsis: 'Reiko finds items sold to customers who were never there.' }))
    link('c3', ['s5']); link('p2', ['c3']); link('ms', ['p1', 'p2'])
    add(mk('chars', 'folder', 'Characters', null))
    add(mk('ch1', 'document', 'Reiko Tanaka', 'chars', { label: 'character', status: 'draft', synopsis: '22, art-school dropout, took the night shift to avoid sleeping.' }))
    add(mk('ch2', 'document', 'The Woman in White', 'chars', { label: 'character', status: 'inprogress', synopsis: 'Arrives at 3:33 every night.' }))
    link('chars', ['ch1', 'ch2'])
    add(mk('res', 'folder', 'Research', null))
    add(mk('r1', 'document', 'Japanese folklore notes', 'res', { label: 'note', status: 'final' }))
    link('res', ['r1'])

    await write(docs, 's1.md', prose.s1)
    await write(docs, 's2.md', prose.s2)
    await write(docs, 's3.md', prose.s3)
    await write(docs, 'ch1.md', prose.ch)
    await write(docs, 's4.md', ''); await write(docs, 's5.md', ''); await write(docs, 'ch2.md', ''); await write(docs, 'r1.md', '')

    await write(bundle, 'project.json', JSON.stringify({
      schemaVersion: 2, id: pid, title: 'Midnight Aisle', created: now, modified: now,
      rootIds: ['ms', 'chars', 'res', 'trash'], trashId: 'trash', nodes, docs: dd,
      settings: { location: 'opfs:' + pid, template: 'novel', author: 'D. Usky' },
    }))
    window.api.prefs.set('konbini_recents_v1', JSON.stringify([
      { id: pid, title: 'Midnight Aisle', location: 'opfs:' + pid, opened: Date.now(), words: 12480 },
    ]))
  }, { pid: PID, prose: PROSE })
}

// ── the model, mocked ────────────────────────────────────────────────────────

const sse = (d, extra = {}) => `data: ${JSON.stringify({ choices: [{ delta: d, ...extra }] })}\n\n`

/**
 * Answers keyed on the prompt's opening line.
 *
 * Each value is what that surface's parser expects, so panels render populated
 * rather than empty — an empty Reader panel says nothing about whether a reader
 * verdict is legible, and until now that is the only state any of these had
 * ever been seen in.
 */
const ANSWERS = [
  [/codex editor for a novel/, JSON.stringify([
    { name: 'Nori-san', category: 'character', aliases: ['the old man'], summary: 'A regular who reads the same magazine every night and warns Reiko about the back door.', facts: [{ label: 'warning', value: 'Never answer the back door' }] },
    { name: 'Aisle Nine', category: 'location', aliases: [], summary: 'An aisle that appears where the mop closet should be, holding stock dated tomorrow.', facts: [{ label: 'appears', value: 'Only after 3am' }] },
  ])],
  [/rigorous literary critic/, JSON.stringify([
    { dimension: 'Voice', score: 8, note: 'The flat retail register does real work — "counted the till" against "the rain that wasn\'t falling".' },
    { dimension: 'Imagery', score: 7, note: 'The umbrella is doing the heavy lifting; the lighting is generic by comparison.' },
    { dimension: 'Tension', score: 9, note: 'The second chime is placed exactly right and never explained.' },
    { dimension: 'Specificity', score: 6, note: '"eyes the colour of old tea" is good; "just below comfort" is a shrug.' },
    { dimension: 'Dialogue', score: 8, note: 'Four lines, two characters, one of them never named. Efficient.' },
    { dimension: 'Prose rhythm', score: 7, note: 'Short paragraphs carry the dread; one or two want a longer sentence against them.' },
  ]) + '\n\nA controlled opening that trusts the reader. The lighting description is the only place it reaches for atmosphere instead of earning it.'],
  [/adventurous fiction reader/, 'I would absolutely keep reading. The second chime is the hook and you do not explain it — that is the whole trick, and it works. The umbrella buy is a great cold open: it promises weather that has not arrived. My only worry is pace; if the next scene also ends on an unexplained noise I will start to feel handled rather than hooked.'],
  [/literary fiction reader/, 'The register is the achievement here — clerical verbs ("tied", "counted", "wrote") holding a supernatural pressure without ever straining for it. "The rain that wasn\'t falling" is the line I would keep. "A frequency just below comfort" is the line I would cut; it explains a feeling the rest of the paragraph has already produced.'],
  [/commercial fiction editor/, 'Clean genre positioning — konbini horror with a working-class narrator is a shelf people are actively buying. The hook lands inside 200 words, which is what a first page needs to do. I would want the back-cover promise clearer by the end of chapter one: is this a haunting, a loop, or a disappearance?'],
  [/skeptical reader/, 'Two things do not hold yet. If Reiko has worked thirty nights, the logbook ritual should be automatic rather than something she notices herself doing — you are using her attention as a delivery device. And the salaryman pays "exact to the yen" for an umbrella whose price we never learn, which reads as significant but resolves to nothing.'],
  [/writing professor/, JSON.stringify({
    verdict: 'A disciplined opening that knows what to withhold. The restraint is real, but the scene is currently a mood rather than a want — Reiko is receptive to strangeness instead of after anything.',
    notes: [
      { issue: 'Reiko has no objective in the scene, so the tension is entirely environmental (structure).', suggestion: 'Give her something ordinary she is trying to finish before the shift ends; let the chime interrupt it.' },
      { issue: 'The lighting paragraph explains its own effect ("just below comfort") (prose).', suggestion: 'Cut the explanation and keep the flicker; the reader supplies the discomfort.' },
      { issue: 'The salaryman exits before he costs her anything (momentum).', suggestion: 'Let him leave behind something she has to decide what to do with.' },
    ],
  })],
  [/blind-judging which of two versions/, JSON.stringify({ winner: 'B', reason: 'B trusts the second chime to land on its own instead of naming the feeling it produces.' })],
  [/brutally honest prose quality evaluator/, JSON.stringify([
    { text: 'never fully warmed up', reason: 'Slightly limp verb phrase where a concrete one would carry more.', severity: 'low' },
    { text: 'a frequency just below comfort', reason: 'Explains the effect the sentence has already achieved.', severity: 'medium' },
  ])],
  [/assessing whether a passage matches/, JSON.stringify({ score: 82, notes: ['Sentence length matches the fingerprint closely.', 'Slightly more abstract diction than the reference scenes.'] })],
  [/developmental editor helping build a novel's character roster/, `- **Reiko Tanaka** — protagonist. Twenty-two, art-school dropout on the graveyard shift. Notices everything and trusts none of it. *Contradiction:* took the night shift to avoid sleeping, and is now the only person awake to see what the store does.\n- **The Night Manager** — supporting. Trained her in a single shift and was never rostered again. The logbook is in his handwriting. *Contradiction:* the only person who explained the rules is the one the rules removed.\n- **The Woman in White** — antagonist-adjacent. Arrives at 3:33, buys one bottle of milk, asks whether the bathroom is occupied. *Contradiction:* she is unfailingly polite and the politeness is the threat.\n- **Nori-san** — supporting. Reads the same magazine nightly; warns her never to answer the back door. *Contradiction:* he knows what is out there and keeps coming back anyway.`],
  [/story structure consultant generating a beat sheet/, `1. **Opening image** — Sunny-Mart, 11pm. Reiko ties the apron, counts the till. Status quo: the store is quiet and she is not.\n2. **Inciting incident** — The salaryman's umbrella. The door chimes twice and nobody comes in.\n3. **First plot point** — Aisle Nine appears where the mop closet should be. She takes the bento dated tomorrow.\n4. **Midpoint reversal** — The logbook's older entries are in her own handwriting, on nights she never worked.\n5. **Dark night** — The back door opens from the inside. Nori-san does not come in the next night, or any night after.\n6. **Climax** — Reiko works the shift the manifest says she works, and rings up the customer the store keeps.\n7. **Resolution** — The store is quiet. She ties the apron. The bell over the door has been taken down.`],
  [/skilled fiction writer drafting a chapter/, `The bell over the door had a screw loose, and on the third night Reiko had found the exact angle of push that made it ring without anyone touching it.\n\nShe did not tell the day staff. It was the only thing in the building that answered to her.\n\nAt 2:40 the cold case began to tick as its compressor cycled, and she went down the aisles with the price gun the way a night nurse walks a ward — not looking for anything, just confirming that nothing had moved.\n\nSomething had moved.`],
  [/developmental editor shaping a story concept/, `**Concept.** A night-shift clerk at an all-night convenience store discovers her shop keeps a customer it has never rung up — and that the store's records show her working nights she has no memory of.\n\n**Genre.** Quiet supernatural horror, contemporary Japan, close third.\n\n**Promise.** The reader is promised a haunting that operates by retail logic: inventory, shifts, and receipts. Every rule the store breaks is one a convenience store is supposed to obey.\n\n**Stakes.** Not death — replacement. The store is completing a roster, and Reiko is on it.`],
  [/worldbuilder establishing the setting/, `**The Sunny-Mart.** Eight aisles, numbered left to right from the register. Cold cases along the back wall. A bathroom key on a wooden paddle. A back door nobody answers.\n\n**Aisle Nine.** Appears where the mop closet should be, after 3am, over-lit and deeper than the building. Stock is dated tomorrow.\n\n**The hours.** 11pm to 7am. The ushimitsu window — roughly 2 to 3am — is when the store stops behaving like a shop.\n\n**The rules.** Write the time in the logbook. Do not answer the back door. Never say the bathroom is free.`],
  [/developmental editor building the principal cast/, `**Reiko Tanaka** — 22, narrator. Wants to get through the shift; needs to stop pretending she cannot see Aisle Nine.\n\n**The Night Manager** — trained her in one shift, never rostered again. His handwriting fills the logbook.\n\n**The Woman in White** — 3:33 every night, one bottle of milk, the bathroom question.\n\n**Nori-san** — the regular who knows the rules and keeps coming anyway.`],
  [/story structure consultant outlining a novel/, `## Part One — Graveyard Shift\n**Ch.1 The Bell** — the umbrella, the second chime, the logbook.\n**Ch.2 Regulars** — the Woman in White; Nori-san's warning.\n\n## Part Two — Closing Time\n**Ch.3 Stocktake** — the manifest with Reiko's name on it.\n**Ch.4 The Back Door** — it opens from the inside.\n\n## Part Three — Handover\n**Ch.5 The Roster** — she works the shift she does not remember.`],
  [/prose-style analyst producing a VOICE FINGERPRINT/, `**Sentences.** Short to mid, declarative. Long sentences only when listing stock or procedure.\n\n**Diction.** Concrete, retail, procedural. Verbs of routine ("tied", "counted", "wrote") carry dread; avoid abstraction.\n\n**Tense & person.** Past, close third on Reiko.\n\n**Rules.** Never explain the supernatural in narration. Never name a folklore source in the prose. Let the reader hear a thing before they understand it.`],
]

function answerFor(prompt) {
  for (const [re, text] of ANSWERS) if (re.test(prompt)) return text
  return ''
}

// ── scripted turns, for the surfaces that are a loop and not a question ──────
//
// The keyed table above answers a *question*: one request, one reply. Chat is
// not that. `runAgent` drives a loop — ask for a tool, take a `role: "tool"`
// result back, ask again, and only then answer in prose. A keyed lookup cannot
// express a sequence, which is why chat photographed as a spinner: its system
// prompt matched no key, `answerFor` returned '', and the panel sat on an empty
// assistant turn.
//
// So a script can be armed instead: an ordered list of raw SSE bodies, served
// one per request. The shapes are borrowed from `scripts/smoke.mjs`, including
// its unkindness — arguments split mid-key across frames, `index` missing from
// continuation frames, and `finish_reason: "stop"` on a turn that is still
// asking for a tool. Those are the three ways real compat servers (Ollama,
// vLLM, llama.cpp) diverge from the spec, and a panel that only renders against
// a well-behaved server is worth knowing about.

const frame = (o) => `data: ${JSON.stringify(o)}\n\n`
const delta = (d, extra = {}) => frame({ object: 'chat.completion.chunk', choices: [{ index: 0, delta: d, ...extra }] })
const DONE = 'data: [DONE]\n\n'

let script = null   // { turns: string[], seen: number } while armed
const armScript = (turns) => { script = { turns, seen: 0 } }
const disarm = () => { script = null }

async function mockModel(page) {
  await page.route('**/chat/completions', async (route) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
    }
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }

    if (script) {
      const body = script.turns[script.seen] ?? script.turns[script.turns.length - 1]
      script.seen++
      // A turn may be a function of the request — used to fail one deliberately.
      const resolved = typeof body === 'function' ? body(route.request()) : body
      if (resolved && resolved.status && resolved.status >= 400) {
        await route.fulfill({ status: resolved.status, headers: cors, body: resolved.body ?? '' })
        return
      }
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: resolved })
      return
    }

    const body = JSON.parse(route.request().postData() ?? '{}')
    const prompt = (body.messages ?? []).map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'text/event-stream' },
      body: sse({ role: 'assistant', content: '' }) + sse({ content: answerFor(prompt) })
        + sse({}, { finish_reason: 'stop' }) + DONE,
    })
  })
}

// ── boot ─────────────────────────────────────────────────────────────────────

const outDir = OUT ?? 'shots'
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 })).newPage()
await page.addInitScript(() => { try { delete window.showDirectoryPicker } catch { /* already gone */ } })

// A surface that throws on open is itself a finding, so never swallow these.
const pageErrors = []
page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  PAGEERROR', e.message) })

let n = 0
const shot = async (name) => {
  await page.waitForTimeout(450)
  const file = `${String(++n).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: `${outDir}/${file}` })
  console.log('  ' + file)
}
const section = (name) => console.log(`\n${name}`)

/**
 * Close whatever is in front. Some of these surfaces are view tabs and some are
 * still modals (Propagation Debt, for one), so dismiss a backdrop first — a tab
 * behind a modal is unclickable and the click just times out.
 */
const closeTab = async () => {
  if (await page.locator('.modal-bg').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(350)
  }
  const x = page.locator('.tab-x')
  if (await x.count()) { await x.last().click().catch(() => {}); await page.waitForTimeout(350) }
}
/** Open a surface through the palette — the one door that reaches everything. */
const palette = async (query) => {
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(280)
  await page.keyboard.type(query, { delay: 15 })
  await page.waitForTimeout(380)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
}
const pick = (title) => page.locator('.tree-row').filter({ hasText: title }).first()

await page.goto(BASE)
await page.waitForFunction(() => !!window.api, null, { timeout: 30000 })
await seed(page)
await page.reload()
await page.waitForTimeout(900)

section('launch + first run')
await shot('launch')
await page.locator('.recent-row').first().click()
await page.waitForSelector('.tree-row', { timeout: 30000 })
await page.waitForTimeout(1200)
await shot('first-run-guide')
await closeTab()

section('the four views')
await pick('The first customer').click(); await page.waitForTimeout(800)
await shot('editor')
await page.locator('.tb-btn[aria-label="Toggle Inspector"]').click(); await page.waitForTimeout(600)
await shot('editor-inspector')
await pick('Chapter 1').click(); await page.waitForTimeout(900)
await shot('scrivenings')
for (const [label, name] of [['Corkboard', 'corkboard'], ['Outliner', 'outliner'], ['Story map', 'storymap']]) {
  await page.locator('.seg button', { hasText: label }).click()
  await page.waitForTimeout(700)
  await shot(name)
}
await page.locator('.seg button', { hasText: 'Editor' }).click(); await page.waitForTimeout(500)

section('tier A — the surfaces that need no AI')
await pick('The first customer').click(); await page.waitForTimeout(500)

// Compile, in every format it offers.
await page.keyboard.press('Control+Shift+e')
await page.waitForTimeout(1000)
await shot('compile-markdown')
for (const [label, name] of [['Word (.docx)', 'compile-docx'], ['Manuscript (Shunn)', 'compile-shunn'], ['EPUB', 'compile-epub'], ['Print / PDF', 'compile-pdf']]) {
  const btn = page.locator('.modal button', { hasText: label }).first()
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(700); await shot(name) }
}
await page.keyboard.press('Escape'); await page.waitForTimeout(400)

// Project-wide search, with a query that actually matches.
await page.keyboard.press('Control+Shift+f')
await page.waitForTimeout(700)
await page.keyboard.type('chimed', { delay: 25 })
await page.waitForTimeout(1100)
await shot('search')
await page.keyboard.press('Escape'); await page.waitForTimeout(400)

// The two reference modals.
await page.keyboard.press('Control+/'); await page.waitForTimeout(700); await shot('shortcuts')
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
await palette('About'); await shot('about')
await page.keyboard.press('Escape'); await page.waitForTimeout(300)

// Rename everywhere, primed with a real name.
await palette('Rename Everywhere')
const renameInput = page.locator('.modal input').first()
if (await renameInput.count()) { await renameInput.fill('Reiko'); await page.waitForTimeout(1200) }
await shot('rename')
await page.keyboard.press('Escape'); await page.waitForTimeout(400)

// The rail panels that need no AI.
await palette('History')
await shot('history-panel')
await palette('Comments')
await shot('comments-panel')

// The view tabs that need no AI.
for (const [q, name] of [['Writing Stats', 'stats'], ['Preferences', 'prefs'], ['Themes', 'themes'], ['Sync', 'sync']]) {
  await palette(q); await shot(name); await closeTab()
}

// Modes and layouts.
await pick('The first customer').click(); await page.waitForTimeout(500)
await page.keyboard.press('Control+Backslash'); await page.waitForTimeout(900); await shot('split-view')
await page.keyboard.press('Control+Backslash'); await page.waitForTimeout(600)
await page.keyboard.press('Control+Alt+o'); await page.waitForTimeout(900); await shot('focus-mode')
await page.keyboard.press('Control+Alt+o'); await page.waitForTimeout(500)
await page.keyboard.press('Control+Alt+c'); await page.waitForTimeout(1200); await shot('composition-mode')
await page.keyboard.press('Escape'); await page.waitForTimeout(700)

section('tiers B and C — the AI surfaces, empty then holding output')
await mockModel(page)

// Turn AI on the way a writer does, through the settings screen.
await palette('Enable AI')
const aiBox = page.locator('label:has-text("Enable AI features") input[type=checkbox]')
await aiBox.waitFor({ timeout: 10000 }).catch(() => {})
if (await aiBox.count() && !(await aiBox.isChecked())) await aiBox.setChecked(true)
await page.waitForTimeout(600)
await shot('ai-settings')
await closeTab()

await page.locator('.tb-btn:has-text("AI")').first().click()
await page.waitForTimeout(600)
await shot('ai-menu')
await page.keyboard.press('Escape'); await page.waitForTimeout(300)

await pick('The first customer').click(); await page.waitForTimeout(600)

// The rail panels: idle, then holding a real answer.
const railRun = async (query, name, runLabel) => {
  await palette(query)
  await shot(`${name}-idle`)
  const run = page.locator('.rail button', { hasText: runLabel }).first()
  if (await run.count()) {
    await run.click()
    await page.waitForTimeout(4000)
    await shot(name)
  } else {
    console.log(`  (no "${runLabel}" control found in ${name})`)
  }
}
await railRun('Codex', 'codex', 'Scan')
await railRun('Reader Panel', 'readers', 'Run')
await railRun('Critic', 'critic', 'Critique')
// Chat is a loop, so it gets a script rather than a keyed answer. The session:
// read the scene, propose a revision to it, then answer in prose — which is the
// path the author's own report ("it takes additional effort before it will edit
// a file") is about.
const revised = 'The fluorescent lights never warmed up. They came on at a frequency just under comfort, a hum Reiko had stopped hearing on her third night and started hearing again on her thirtieth.'
const editArgs = JSON.stringify({ document: 'The first customer', new_text: revised })
const cut = Math.floor(editArgs.length / 2)

armScript([
  // 1 · reads the scene. Arguments split mid-key across two frames.
  delta({ role: 'assistant', content: '' })
    + delta({ content: 'Let me read that scene first.' })
    + delta({ tool_calls: [{ index: 0, id: 'call_read', type: 'function', function: { name: 'get_document', arguments: '' } }] })
    + delta({ tool_calls: [{ index: 0, function: { arguments: '{"docu' } }] })
    + delta({ tool_calls: [{ index: 0, function: { arguments: 'ment":"The first customer"}' } }] })
    + delta({}, { finish_reason: 'tool_calls' }) + DONE,
  // 2 · proposes the edit. No `index` on continuations, and it claims to have
  //     stopped normally while still asking for a tool.
  delta({ tool_calls: [{ id: 'call_edit', type: 'function', function: { name: 'propose_edit', arguments: '' } }] })
    + delta({ tool_calls: [{ function: { arguments: editArgs.slice(0, cut) } }] })
    + delta({ tool_calls: [{ function: { arguments: editArgs.slice(cut) } }] })
    + delta({}, { finish_reason: 'stop' }) + DONE,
  // 3 · the prose answer, plus a trailing usage frame.
  delta({ content: 'I tightened the opening: the lighting explains itself less, so the second chime lands harder. It is queued for your review.' })
    + frame({ choices: [], usage: { prompt_tokens: 2400, completion_tokens: 82 } })
    + delta({}, { finish_reason: 'stop' }) + DONE,
])

await palette('AI Chat')
await shot('chat-idle')
const chatBox = page.locator('.rail textarea, .rail input[type=text]').first()
if (await chatBox.count()) {
  await chatBox.fill('The opening paragraph over-explains itself. Tighten it.')
  await page.locator('.rail .send-btn').first().click().catch(() => {})
  // Mid-loop: a tool is running and no prose has arrived yet.
  await page.waitForTimeout(1400)
  await shot('chat-working')
  await page.waitForTimeout(6000)
  await shot('chat-tool-round-trip')
}

// The propose_edit should be waiting in the changeset review, not applied.
if (await page.locator('.cs-body').count()) {
  await shot('chat-changeset')
  await page.locator('.modal-foot .btn.primary').click().catch(() => {})
  await page.waitForTimeout(1500)
  await shot('chat-after-apply')
}

// What a failed turn looks like — the surface nobody has seen.
armScript([{ status: 429, body: JSON.stringify({ error: { message: 'Rate limit exceeded.' } }) }])
if (await chatBox.count()) {
  await chatBox.fill('And now do the same for Aisle Nine.')
  await page.locator('.rail .send-btn').first().click().catch(() => {})
  await page.waitForTimeout(4000)
  await shot('chat-error')
}
disarm()

// The view tabs.
const tabRun = async (query, name, runLabel) => {
  await palette(query)
  await shot(`${name}-idle`)
  if (runLabel) {
    const run = page.locator('.modal-body button, .dock-body button', { hasText: runLabel }).first()
    if (await run.count()) { await run.click(); await page.waitForTimeout(5000); await shot(name) }
    else console.log(`  (no "${runLabel}" control found in ${name})`)
  }
  await closeTab()
}
await tabRun('Manuscript Quality', 'quality', 'Evaluate all')
await tabRun('Foundation', 'foundation', null)
await tabRun('Batch Generators', 'generate', null)
await tabRun('Best of N', 'bestof', null)
await tabRun('Autopilot', 'autopilot', null)
await tabRun('Prompt Registry', 'prompts', null)
await tabRun('Propagation Debt', 'debt', null)

// ── done ─────────────────────────────────────────────────────────────────────

console.log(`\n${n} frames -> ${outDir}`)
if (pageErrors.length) console.log(`${pageErrors.length} uncaught page error(s) — each one is a finding`)
await browser.close()
