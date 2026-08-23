#!/usr/bin/env node
/**
 * Invariant smoke test — drives the real app in a real browser.
 *
 * `npm test` covers pure functions, and it has never caught a serious bug in
 * this codebase. Every one that shipped and was fixed — AI-created documents
 * arriving blank, a context menu that closed itself on open, a multi-select menu
 * whose every action threw ReferenceError, an outliner that ejected you to the
 * editor on the first click — compiled cleanly and passed the unit suite. They
 * were only visible by driving the app.
 *
 * So this asserts the things CLAUDE.md calls non-negotiable, against the running
 * studio:
 *
 *   1 · AI off  ⇒ no AI component renders, no AI path is reachable.
 *   2 · No AI write reaches a .md except through Proposal → review → apply.
 *   4 · updateContent() is the only mutation seam, and it reaches disk.
 *   5 · ProposalService.apply() snapshots before it writes. No exceptions.
 *   6 · Node ids are stable, unique, and never reused.
 *
 * plus the WCAG AA contrast floors on the muted text ramp, in every theme.
 *
 * Where a claim is about *durability*, the assertion reads persisted bytes out
 * of OPFS rather than the DOM — the blank-document bug passed every DOM check
 * while writing nothing to disk.
 *
 * Runs against the OPFS backend (File System Access is deleted before the app
 * boots) so there is no directory-picker prompt to satisfy.
 *
 *   node scripts/smoke.mjs
 *   BASE=http://localhost:4173 node scripts/smoke.mjs
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const PID = 'smoke'

// CI images often preinstall a browser at a known path; otherwise use whatever
// `playwright install chromium` put down.
const executablePath = ['/opt/pw-browsers/chromium/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find((p) => fs.existsSync(p))

let failed = 0
let ran = 0
function check(label, ok, detail) {
  ran++
  if (!ok) failed++
  console.log(`${ok ? '\x1b[32m  ok\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}`)
  if (!ok && detail !== undefined) console.log(`        got: ${JSON.stringify(detail)}`)
}
function section(name) { console.log(`\n\x1b[1m${name}\x1b[0m`) }

// ── fixture ─────────────────────────────────────────────────────────────────

const ORIGINAL = 'The original text of this scene, written by a human being. '

function seed(page) {
  return page.evaluate(async ({ pid, original }) => {
    const root = await (await navigator.storage.getDirectory())
      .getDirectoryHandle('konbini-projects', { create: true })
    const bundle = await root.getDirectoryHandle(`${pid}.konbini`, { create: true })
    const docsDir = await bundle.getDirectoryHandle('docs', { create: true })
    await bundle.getDirectoryHandle('snapshots', { create: true })
    const write = async (dir, name, text) => {
      const fh = await dir.getFileHandle(name, { create: true })
      const w = await fh.createWritable()
      await w.write(text)
      await w.close()
    }
    const now = new Date().toISOString()
    const mk = (id, type, title, parentId) => ({
      id, type, title, parentId, childIds: [], expanded: true,
      meta: { label: 'scene', status: 'draft', synopsis: '', target: 500, includeInCompile: true, keywords: [] },
      ext: {}, rev: 1, modified: now,
    })
    const nodes = { trash: mk('trash', 'folder', 'Trash', null), ch1: mk('ch1', 'folder', 'Chapter One', null) }
    const docs = {}
    for (let i = 0; i < 3; i++) {
      const sid = `sc${i}`
      nodes[sid] = mk(sid, 'scene', `Scene ${i + 1}`, 'ch1')
      nodes.ch1.childIds.push(sid)
      docs[sid] = { snapshots: [] }
      await write(docsDir, `${sid}.md`, original.repeat(6))
    }
    // A written character sheet, in a folder that sorts after the manuscript.
    // Adventure used to default to "the last written document anywhere", which
    // is exactly this node — and drafted the novel into it.
    nodes.chars = mk('chars', 'folder', 'Characters', null)
    nodes.who = mk('who', 'document', 'Cast note', 'chars')
    nodes.chars.childIds = ['who']
    docs.who = { snapshots: [] }
    await write(docsDir, 'who.md', 'A written note about the cast, not a scene.')

    await write(bundle, 'project.json', JSON.stringify({
      schemaVersion: 2, id: pid, title: 'Smoke', created: now, modified: now,
      rootIds: ['ch1', 'chars', 'trash'], trashId: 'trash', nodes, docs,
      settings: { location: 'opfs:' + pid, template: 'novel' },
    }))
    for (const f of ['codex.json', 'debt.json', 'comments.json']) await write(bundle, f, '[]')
    window.api.prefs.set('konbini_recents_v1', JSON.stringify([
      { id: pid, title: 'Smoke', location: 'opfs:' + pid, opened: Date.now(), words: 100 },
    ]))
  }, { pid: PID, original: ORIGINAL })
}

/** Read a file out of the bundle in OPFS — the durable truth, not the store. */
function readBundle(page, path) {
  return page.evaluate(async ({ pid, path: p }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('konbini-projects')
    let dir = await root.getDirectoryHandle(`${pid}.konbini`)
    const parts = p.split('/')
    const file = parts.pop()
    for (const seg of parts) dir = await dir.getDirectoryHandle(seg)
    try { return await (await (await dir.getFileHandle(file)).getFile()).text() }
    catch { return null }
  }, { pid: PID, path })
}

function listBundle(page, sub) {
  return page.evaluate(async ({ pid, sub: s }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('konbini-projects')
    let dir = await root.getDirectoryHandle(`${pid}.konbini`)
    // A node with no snapshots yet has no directory at all.
    try { for (const seg of (s ? s.split('/') : [])) dir = await dir.getDirectoryHandle(seg) }
    catch { return [] }
    const out = []
    for await (const [name] of dir.entries()) out.push(name)
    return out.sort()
  }, { pid: PID, sub })
}

// ── boot ────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
await page.addInitScript(() => { try { delete window.showDirectoryPicker } catch { /* already absent */ } })

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

await page.goto(BASE)
await page.waitForFunction(() => !!window.api, null, { timeout: 30000 })
await seed(page)
await page.reload()
await page.locator('.recent-row').first().click()
await page.waitForSelector('.tree-row', { timeout: 30000 })
await page.waitForTimeout(600)

/** The AI panels, by the label the rail actually renders. */
const AI_TABS = ['Chat', 'Codex', 'Readers', 'Critic']
const railTabs = () => page.evaluate(() =>
  [...document.querySelectorAll('.rail-tabs > button')].map((b) => b.title || b.textContent.trim()))
/**
 * Flip the AI layer the way a writer does — through the settings screen.
 *
 * Deliberately not by importing aiStore: a dev server that has hot-reloaded a
 * module serves it at `…?t=<stamp>`, so a fresh `import()` from the test gets
 * its own instance with its own state, and every assertion after it would be
 * measuring a store the app has never heard of.
 */
const setAI = async (on) => {
  // Reached through the command palette rather than the toolbar: the toolbar's
  // "AI" button only exists while AI is *off*, so it can't be used to turn it
  // back off again.
  // The palette labels the same screen "Enable AI…" while AI is off and
  // "AI Settings…" once it is on, so ask for whichever one exists right now.
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(300)
  await page.keyboard.type(on ? 'Enable AI' : 'AI Settings', { delay: 20 })
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  const box = page.locator('label:has-text("Enable AI features") input[type=checkbox]')
  await box.waitFor({ timeout: 10000 })
  if ((await box.isChecked()) !== on) await box.setChecked(on)
  await page.waitForTimeout(300)
  // Leave the settings screen so the rail is measurable again.
  const close = page.locator('.tab-x').last()
  if (await close.count()) await close.click()
  await page.waitForTimeout(400)
}

// ── first run ───────────────────────────────────────────────────────────────
section('First run · the studio names its own surfaces')

// We are one click off a cold boot and `pref:seenGuide` has never been set, so
// this is exactly what a stranger sees the first time they open a project.
const guideTab = page.locator('.tab-strip .tab', { hasText: 'Guide' })
check('the Guide opens by itself on the very first project', await guideTab.count() === 1)
check('and it is the tab in front', (await guideTab.getAttribute('class') ?? '').includes('on'))
check('the flag is persisted through the prefs seam, not localStorage',
  await page.evaluate(() => window.api.prefs.get('pref:seenGuide')) === 'true')

const guide = await page.evaluate(() => ({
  cards: document.querySelectorAll('.guide-card').length,
  doors: [...document.querySelectorAll('.guide-doors button')].map((b) => b.textContent.trim()),
  ai: document.querySelector('.guide-ai h4')?.textContent.trim() ?? null,
}))
check('it names every surface as a card, not a wall of prose', guide.cards >= 8, guide.cards)
check('every card carries a door you can walk through', guide.doors.length >= 10, guide.doors.length)

// Invariant 1 inside the Guide: with AI off the AI section is one paragraph and
// one button to the settings screen — the same affordance the toolbar shows.
// None of the AI surfaces are named as doors, because none of them exist yet.
const AI_DOORS = ['Foundation', 'Codex', 'Chat', 'Adventure', 'Autopilot', 'Manuscript quality']
check('with AI off the Guide offers no AI door',
  guide.doors.every((d) => !AI_DOORS.some((a) => d.startsWith(a))), guide.doors)
check('it says so plainly rather than hiding the section',
  /switched off/i.test(guide.ai ?? ''), guide.ai)
check('and the one door it does offer is the setup screen',
  guide.doors.includes('Set up AI'), guide.doors)

// A door has to open. Clicking a view door must actually land you in that view —
// the Guide owns the main pane while it is the active tab, so a door that only
// flipped a mode would look broken.
await page.locator('.guide-doors button', { hasText: 'Corkboard' }).first().click()
await page.waitForTimeout(500)
check('the Corkboard door lands you on the corkboard',
  await page.locator('.cork').count() === 1 && await page.locator('.tab-strip .tab', { hasText: 'Guide' }).count() === 0)

// Reopen it from the palette — the permanent way back once the tab is closed.
await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
await page.keyboard.type('Guide', { delay: 20 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
check('the command palette reopens it under Help',
  await page.locator('.guide-card').count() >= 8)

// A rail door opens the rail beside the Guide rather than replacing it. Close
// the rail first so the check can't pass on a panel that was already showing —
// and so it would catch a door wired to a *toggle*, which closes it instead.
if (await page.locator('.rail-close').count()) {
  await page.locator('.rail-close').click()
  await page.waitForTimeout(300)
}
await page.locator('.guide-doors button', { hasText: 'Open the inspector' }).first().click()
await page.waitForTimeout(400)
check('the Inspector door opens the rail without closing the Guide',
  await page.locator('.rail .inspector').count() === 1 && await page.locator('.guide-card').count() >= 8)

// Close it, and the editor's empty state — the screen a lost author stares at —
// still offers a way back.
await page.locator('.tab-strip .tab', { hasText: 'Guide' }).locator('.tab-x').click()
await page.waitForTimeout(400)
await page.locator('.seg button', { hasText: 'Editor' }).click()
await page.waitForTimeout(400)
check('the editor empty state offers the Guide',
  await page.locator('.empty-state button', { hasText: 'Guide' }).count() === 1)
await page.locator('.empty-state button', { hasText: 'Guide' }).click()
await page.waitForTimeout(400)
check('and that button opens it', await page.locator('.guide-card').count() >= 8)
await page.locator('.tab-strip .tab', { hasText: 'Guide' }).locator('.tab-x').click()
await page.waitForTimeout(300)

// Once seen, never imposed again — including across a reload.
await page.reload()
await page.waitForFunction(() => !!window.api, null, { timeout: 30000 })
await page.locator('.recent-row').first().click()
await page.waitForSelector('.tree-row', { timeout: 30000 })
await page.waitForTimeout(600)
check('it does not reappear on the next launch',
  await page.locator('.tab-strip .tab', { hasText: 'Guide' }).count() === 0)

// ── invariant 1 ─────────────────────────────────────────────────────────────
section('Invariant 1 · AI off means zero AI in the DOM')

// Off is observable without reaching into state: the toolbar shows the
// "enable" affordance rather than the AI controls.
check('AI is off out of the box (BYOK — nothing runs unasked)',
  await page.locator('.tb-btn.ai-enable').count() === 1)

const offTabs = await railTabs()
check('no AI panel is offered in the rail', AI_TABS.every((t) => !offTabs.includes(t)), offTabs)
check('the AI switch is still visible, so the feature is discoverable',
  await page.locator('.tb-btn.ai-enable').count() === 1)

// Prove the check above isn't vacuous: the same selectors must find AI when on.
await setAI(true)
const onTabs = await railTabs()
check('turning AI on adds every AI panel (guard is not vacuous)',
  AI_TABS.every((t) => onTabs.includes(t)), onTabs)
// The one AI capability that can rewrite the app's own configuration must be
// off until the author asks for it — separately from AI itself being on.
await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
await page.keyboard.type('AI Settings', { delay: 20 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
const cfgBox = page.locator('label:has-text("Let the assistant edit its own instructions") input[type=checkbox]')
await cfgBox.waitFor({ timeout: 10000 }).catch(() => {})
check('the assistant cannot edit its own settings by default',
  await cfgBox.count() === 1 && !(await cfgBox.isChecked()))
await page.locator('.tab-x').last().click()
await page.waitForTimeout(400)

await setAI(false)
check('turning AI back off removes them all', (await railTabs()).every((t) => !AI_TABS.includes(t)))

// ── invariant 6 ─────────────────────────────────────────────────────────────
section('Invariant 6 · node ids are unique and never reused')

// Create nodes through the platform seam as fast as the app can, which keeps
// the whole burst inside a millisecond or two — exactly the window where a
// time-plus-counter id collides between two devices.
const burst = await page.evaluate(async () => {
  const pid = 'smoke'
  const out = []
  for (let i = 0; i < 30; i++) {
    const r = await window.api.node.mutate(pid, { type: 'create', parentId: null, nodeType: 'document' })
    out.push(Object.values(r.nodes).filter((n) => n.ext._newId !== undefined).map((n) => n.id))
  }
  return out
})
const burstIds = burst.flat()
check('30 rapid creates yield 30 distinct ids',
  new Set(burstIds).size === burstIds.length && burstIds.length === 30, burstIds.length)
check('ids carry per-process entropy, not just time+counter',
  burstIds.every((id) => id.split('-').length >= 4), burstIds[0])

// The `_newId` marker must be one-shot. A stale one made every AI-created
// document resolve to the *first* node of the session — which is how AI drafts
// arrived blank.
check('each create marks exactly one new node', burst.every((m) => m.length === 1), burst)
check('consecutive creates never resolve to the same node',
  new Set(burst.map((m) => m[0])).size === burst.length)

const manifest = JSON.parse(await readBundle(page, 'project.json'))
const nodeIds = Object.keys(manifest.nodes)
check('persisted ids are unique', new Set(nodeIds).size === nodeIds.length, nodeIds.length)
check('every childId resolves to a real node',
  Object.values(manifest.nodes).every((n) => n.childIds.every((c) => manifest.nodes[c])))
check('every parentId resolves to a real node',
  Object.values(manifest.nodes).every((n) => n.parentId === null || !!manifest.nodes[n.parentId]))
check('no node is its own child',
  Object.values(manifest.nodes).every((n) => !n.childIds.includes(n.id)))
check('no _newId marker was persisted',
  Object.values(manifest.nodes).every((n) => n.ext?._newId === undefined),
  Object.values(manifest.nodes).filter((n) => n.ext?._newId !== undefined).map((n) => n.id))

// ── invariant 4 ─────────────────────────────────────────────────────────────
section('Invariant 4 · typed text reaches disk through the one seam')

await page.locator('.tree-row').filter({ hasText: 'Scene 1' }).first().click()
await page.waitForSelector('.cm-content', { timeout: 20000 })
await page.locator('.cm-content').click()
await page.keyboard.press('Control+End')
await page.keyboard.type(' HUMAN_EDIT.', { delay: 15 })
await page.waitForFunction(
  () => /saved/i.test(document.querySelector('.statusbar')?.textContent ?? ''),
  null, { timeout: 15000 },
).catch(() => { /* fall through to the byte check, which is the real assertion */ })
await page.waitForTimeout(1200)
const afterTyping = await readBundle(page, 'docs/sc0.md')
check('the .md on disk contains what was typed',
  !!afterTyping && afterTyping.includes('HUMAN_EDIT.'), afterTyping?.slice(-60))

// ── invariants 2 & 5 ────────────────────────────────────────────────────────
section('Invariants 2 & 5 · edits are gated by review, and snapshotted first')

// Driven through project-wide replace, which queues proposals into exactly the
// pipeline every AI command uses: createProposal → the store's queue →
// ChangesetModal → Studio's single onApply, which snapshots and then writes.
// Using replace rather than a mocked AI call means the gate and the snapshot are
// proved by a real user flow with nothing stubbed.
const snapsBefore = await listBundle(page, 'snapshots/sc1')
const diskBefore = await readBundle(page, 'docs/sc1.md')
check('fixture text is on disk to begin with', diskBefore.includes('human being'), diskBefore?.slice(0, 40))

await page.keyboard.press('Control+Shift+F')
await page.waitForSelector('.srch-input', { timeout: 10000 })
await page.locator('.srch-input').first().fill('human being')
await page.waitForTimeout(500)
await page.locator('.srch-replace').fill('REVIEWED_REPLACEMENT')
await page.waitForTimeout(400)
const replaceAll = page.locator('.modal-foot .btn.primary, .btn.primary:has-text("Replace all")').last()
check('replace offers a reviewable "replace all"', await replaceAll.count() > 0)
await replaceAll.click()

await page.waitForSelector('.cs-body', { timeout: 10000 })
check('a changeset review opens before anything is written', true)
check('the review offers per-hunk accept/reject', await page.locator('.cs-hunk').count() > 0)

// The gate has to be load-bearing: nothing may have reached disk yet.
const diskDuringReview = await readBundle(page, 'docs/sc1.md')
check('nothing is written while a change is only proposed',
  diskDuringReview === diskBefore && !diskDuringReview.includes('REVIEWED_REPLACEMENT'),
  diskDuringReview?.slice(0, 60))

// Apply every queued proposal; the queue auto-advances to the next document.
let applied = 0
for (let i = 0; i < 6; i++) {
  if (await page.locator('.cs-body').count() === 0) break
  await page.locator('.modal-foot .btn.primary').click()
  applied++
  await page.waitForTimeout(700)
}
await page.waitForTimeout(800)
check('every queued document was reviewed one at a time', applied >= 1, applied)

const diskAfter = await readBundle(page, 'docs/sc1.md')
check('applying writes the reviewed text to the .md',
  !!diskAfter && diskAfter.includes('REVIEWED_REPLACEMENT'), diskAfter?.slice(0, 60))
check('a proposal applied to a document that is not open still reaches disk',
  diskAfter !== diskBefore)

// Snapshots are filed per node: snapshots/<nodeId>/<snapshotId>.md
const snapsAfter = await listBundle(page, 'snapshots/sc1')
const newSnaps = snapsAfter.filter((s2) => !snapsBefore.includes(s2))
check('applying took a snapshot first', newSnaps.length > 0, { snapsBefore, snapsAfter })
if (newSnaps.length) {
  const bodies = (await Promise.all(newSnaps.map((s2) => readBundle(page, `snapshots/sc1/${s2}`)))).join('\n')
  check('the snapshot holds the pre-change text', bodies.includes('human being'))
  check('the snapshot does NOT hold the new text — it is a rollback point',
    !bodies.includes('REVIEWED_REPLACEMENT'))
}

// ── binder drag & split panes ───────────────────────────────────────────────
section('Binder · a multi-selection drags as one, and a folder opens anywhere')

// Two long-standing gaps, both of the kind that look like the app ignoring you:
// dragging three selected chapters moved only the row under the pointer, and
// dropping a folder into a split pane dead-ended on a placeholder.

const childIdsOf = async (id) =>
  (JSON.parse(await readBundle(page, 'project.json')).nodes[id]?.childIds) ?? []

// The fixture's scenes all live under ch1; give them somewhere to go. It goes
// directly after ch1 rather than at the end of the tree: the id-uniqueness
// section above leaves 30 nodes at root, and a drag needs both rows on screen
// at once.
const ch2 = await page.evaluate(async () => {
  const r = await window.api.node.mutate('smoke', { type: 'create', parentId: null, nodeType: 'folder', title: 'Chapter Two', atIndex: 1 })
  return Object.values(r.nodes).find((n) => n.ext._newId !== undefined)?.id
})
await page.reload()
await page.locator('.recent-row').first().click()
await page.waitForSelector('.tree-row', { timeout: 30000 })
await page.waitForTimeout(700)

const ch1Before = await childIdsOf('ch1')
check('the fixture chapter has scenes to drag', ch1Before.length >= 2, ch1Before)

await page.locator('.tree-row').filter({ hasText: 'Scene 1' }).first().click()
await page.locator('.tree-row').filter({ hasText: 'Scene 2' }).first().click({ modifiers: ['Shift'] })
await page.waitForTimeout(300)

const dragRow = page.locator('.tree-row').filter({ hasText: 'Scene 1' }).first()
const dropRow = page.locator('.tree-row').filter({ hasText: 'Chapter Two' }).first()
await dropRow.scrollIntoViewIfNeeded()
await dragRow.scrollIntoViewIfNeeded()
const from = await dragRow.boundingBox()
const to = await dropRow.boundingBox()
check('both rows are on screen, so the drag is a real one', !!from && !!to && to.y > 0)
if (from && to) {
  await page.mouse.move(from.x + 20, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 12 })
  await page.mouse.move(to.x + 20, to.y + to.height / 2 + 1, { steps: 3 })
  await page.mouse.up()
  await page.waitForTimeout(1400)
}

const movedTo = await childIdsOf(ch2)
const ch1After = await childIdsOf('ch1')
check('dragging a selection of two moves both, not just the grabbed row',
  movedTo.length === 2, { movedTo, ch1After })
check('and they land in binder order, together',
  movedTo[0] === ch1Before[0] && movedTo[1] === ch1Before[1], { movedTo, ch1Before })
check('the rest of the chapter is left alone',
  ch1After.length === ch1Before.length - 2, { ch1After, ch1Before })

// A folder dropped into the right pane must open as Scrivenings, not a shrug.
await page.keyboard.press('Control+Backslash')
await page.waitForTimeout(700)
const rightPane = page.locator('[aria-label="Second editor pane"]')
check('split view opens a second pane', await rightPane.count() === 1)
await page.evaluate(() => {
  // A real HTML5 drop: the pane keys off the node MIME type, so a synthetic
  // mouse drag would not carry the payload.
  const dt = new DataTransfer()
  dt.setData('application/x-konbini-node', 'ch1')
  const pane = document.querySelector('[aria-label="Second editor pane"]')
  pane?.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
  pane?.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(1200)
const rightText = await rightPane.innerText().catch(() => '')
check('a folder dropped into a split pane opens its scenes, not a placeholder',
  /Scrivenings/.test(rightText) && !/no documents yet/.test(rightText), rightText.slice(0, 120))
check('and it is a real editor, not a preview',
  await rightPane.locator('.cm-content').count() >= 1)

await page.keyboard.press('Control+Backslash')
await page.waitForTimeout(500)

// ── reaching Scrivenings, and the story map ─────────────────────────────────
section('Browsing · a folder click keeps the view you are in')

// Clicking a folder used to bounce you from the editor to the corkboard, which
// meant Scrivenings — the whole point of a folder in the editor — could not be
// reached by clicking the folder. You had to click it, then click Editor again,
// and the view control changed under you on the way.
await page.locator('.seg button', { hasText: 'Editor' }).click()
await page.waitForTimeout(400)
await page.locator('.tree-row').filter({ hasText: 'Chapter One' }).first().click()
await page.waitForTimeout(900)
const activeView = async () => (await page.locator('.seg button.on').innerText().catch(() => '')).trim()
check('clicking a folder from the editor opens Scrivenings, with no second click',
  /Scrivenings/.test(await page.locator('.main').innerText().catch(() => '')))
check('and the view control still says Editor — nothing switched under you',
  await activeView() === 'Editor', await activeView())
check('it is a real editor, not a preview',
  await page.locator('.main .cm-content').count() >= 1)

// The same click from the corkboard stays on the corkboard.
await page.locator('.seg button', { hasText: 'Corkboard' }).click()
await page.waitForTimeout(400)
await page.locator('.tree-row').filter({ hasText: 'Chapter Two' }).first().click()
await page.waitForTimeout(600)
check('and from the corkboard a folder click stays on the corkboard',
  await activeView() === 'Corkboard' && await page.locator('.cork').count() === 1, await activeView())

section('Story map · one lane per chapter, and no lane for the trash')

await page.locator('.seg button', { hasText: 'Story map' }).click()
await page.waitForTimeout(800)
const lanes = await page.locator('.tl-row-hd').evaluateAll((els) => els.map((e) => e.innerText.trim()))
check('the view is offered under its real name', lanes.length > 0, lanes)
check('the trash gets no lane', !lanes.some((l) => /Trash/i.test(l)), lanes)
// Lane headers are uppercased by CSS and carry a count, so match loosely.
check('each chapter gets its own lane instead of one flattened manuscript row',
  lanes.some((l) => /chapter one/i.test(l)) && lanes.some((l) => /chapter two/i.test(l)), lanes)
check('a deleted scene is not on the board',
  !/Trash/i.test(await page.locator('.main.tl').innerText().catch(() => '')))
await page.locator('.seg button', { hasText: 'Editor' }).click()
await page.waitForTimeout(400)

// ── deadline math ───────────────────────────────────────────────────────────
section('Deadline · a date and a target become a daily number, honestly')

// The failure this guards against isn't arithmetic, it's discouragement: pacing
// from the project's creation would tell someone who sets a deadline mid-book
// that they are tens of thousands of words behind on day one. A deadline stores
// where the book stood when the promise was made, and resetting the date is a
// new promise, not a carried-forward debt.

const dayKeyOf = (offsetDays) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Ten days into a twenty-day run, with almost nothing written: solidly behind.
await page.evaluate(async ({ pid, startedOn, date }) => {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('konbini-projects')
  const bundle = await root.getDirectoryHandle(`${pid}.konbini`)
  const manifest = JSON.parse(await (await (await bundle.getFileHandle('project.json')).getFile()).text())
  manifest.settings.wordTarget = 50_000
  manifest.settings.deadline = { date, startedOn, startWords: 0 }
  const fh = await bundle.getFileHandle('project.json', { create: true })
  const w = await fh.createWritable(); await w.write(JSON.stringify(manifest)); await w.close()
}, { pid: PID, startedOn: dayKeyOf(-10), date: dayKeyOf(10) })
await page.reload()
await page.locator('.recent-row').first().click()
await page.waitForSelector('.tree-row', { timeout: 30000 })
await page.waitForTimeout(700)

const sbText = await page.locator('.statusbar').innerText()
check('the status bar shows the pace while you write', /\/day/.test(sbText), sbText.replace(/\n/g, ' '))
check('and says plainly that you are behind', /behind/.test(sbText), sbText.replace(/\n/g, ' '))

await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
await page.keyboard.type('Writing Stats', { delay: 20 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForSelector('.stats-pace', { timeout: 10000 }).catch(() => {})
check('Stats shows the pace panel', await page.locator('.stats-pace').count() === 1)
check('being behind is visible, not just stated',
  (await page.locator('.stats-pace').getAttribute('class') ?? '').includes('behind'))
const paceText = await page.locator('.stats-pace').innerText()
check('it reports the days left and the words remaining',
  /writing days? left/.test(paceText) && /to go/.test(paceText), paceText.replace(/\n/g, ' '))

// Moving the date is a new promise. Re-anchoring is what keeps a deadline from
// carrying a debt the author has just decided to renegotiate.
await page.locator('input[aria-label="Deadline date"]').fill(dayKeyOf(30))
await page.waitForTimeout(800)
check('moving the deadline re-anchors instead of carrying the shortfall forward',
  !/behind/.test(await page.locator('.stats-pace').innerText()),
  await page.locator('.stats-pace').innerText())

const dlManifest = JSON.parse(await readBundle(page, 'project.json'))
check('the new promise is persisted with its own baseline',
  dlManifest.settings?.deadline?.date === dayKeyOf(30)
  && dlManifest.settings?.deadline?.startedOn === dayKeyOf(0), dlManifest.settings?.deadline)

// Writing days, not calendar days — the number that matters is sessions.
const perDayBefore = (await page.locator('.stats-pace-hd b').innerText()).match(/[\d,]+/)?.[0]
for (const i of [1, 2, 3, 4, 5]) await page.locator('.stats-pace-days .chip').nth(i).click()
await page.waitForTimeout(700)
const perDayAfter = (await page.locator('.stats-pace-hd b').innerText()).match(/[\d,]+/)?.[0]
check('dropping to weekends raises the daily number',
  !!perDayAfter && !!perDayBefore
  && Number(perDayAfter.replace(/,/g, '')) > Number(perDayBefore.replace(/,/g, '')),
  { perDayBefore, perDayAfter })

await page.locator('.tab-x').last().click()
await page.waitForTimeout(300)
// Leave the fixture without a deadline so later sections read a clean status bar.
await page.evaluate(async ({ pid }) => {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('konbini-projects')
  const bundle = await root.getDirectoryHandle(`${pid}.konbini`)
  const manifest = JSON.parse(await (await (await bundle.getFileHandle('project.json')).getFile()).text())
  delete manifest.settings.deadline
  delete manifest.settings.wordTarget
  const fh = await bundle.getFileHandle('project.json', { create: true })
  const w = await fh.createWritable(); await w.write(JSON.stringify(manifest)); await w.close()
}, { pid: PID })

// ── rename everywhere ───────────────────────────────────────────────────────
section('Rename · a character rename leaves nothing pointing at the old name')

// Project-wide replace rewrites prose and stops, which leaves the binder, the
// codex and — worst — comment anchors disagreeing with the manuscript. A
// comment recovers itself by its quoted text, so renaming the prose without the
// quote orphans the note. This drives the whole operation and reads the bytes.

const RN_SCENE = 'sc0'
await page.evaluate(async ({ pid }) => {
  // Give the fixture the things a rename has to reach beyond prose.
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('konbini-projects')
  const bundle = await root.getDirectoryHandle(`${pid}.konbini`)
  const write = async (name, text) => {
    const fh = await bundle.getFileHandle(name, { create: true })
    const w = await fh.createWritable(); await w.write(text); await w.close()
  }
  const manifest = JSON.parse(await (await (await bundle.getFileHandle('project.json')).getFile()).text())
  manifest.nodes.sc0.title = 'Mira at the River'
  manifest.nodes.sc0.meta.synopsis = 'Mira waits for the tide.'
  manifest.nodes.sc0.meta.keywords = ['pov-mira', 'river']
  await write('project.json', JSON.stringify(manifest))
  const docs = await bundle.getDirectoryHandle('docs')
  const fh = await docs.getFileHandle('sc0.md', { create: true })
  const w = await fh.createWritable()
  await w.write('Mira counted the coins. [[Mira]] said nothing. The admiral watched.')
  await w.close()
  const now = new Date().toISOString()
  await write('codex.json', JSON.stringify([{
    id: 'e1', name: 'Mira', aliases: ['Mira Vance'], category: 'character',
    summary: 'Mira runs the ferry.',
    facts: [{ id: 'f1', label: 'role', value: 'Mira pilots it', aiGenerated: false, confirmedAt: null }],
    createdAt: now, modifiedAt: now, aiGenerated: false,
  }]))
  await write('comments.json', JSON.stringify([{
    id: 'c1', docId: 'sc0', anchor: { from: 0, to: 23, quote: 'Mira counted the coins.' },
    body: 'Would Mira really count twice?', author: 'me', origin: 'author', createdAt: now, resolved: false,
  }]))
}, { pid: PID })
await page.reload()
await page.locator('.recent-row').first().click()
await page.waitForSelector('.tree-row', { timeout: 30000 })
await page.waitForTimeout(700)

await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
await page.keyboard.type('Rename Everywhere', { delay: 20 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForSelector('.rn-fields', { timeout: 10000 }).catch(() => {})
check('rename is reachable from the command palette', await page.locator('.rn-fields').count() === 1)

await page.locator('.rn-fields input').first().fill('Mira')
await page.locator('.rn-fields input').last().fill('Sera')
await page.waitForTimeout(600)

const rnGroups = await page.locator('.rn-group-hd').allInnerTexts()
const named = (label) => rnGroups.some((g) => g.startsWith(label))
check('the preview inventories every place the name hides',
  ['Documents', 'Binder titles', 'Synopses', 'Keywords', 'Codex', 'Comments'].every(named), rnGroups)

const rnSnapsBefore = await listBundle(page, `snapshots/${RN_SCENE}`)
await page.locator('.modal-foot .btn.primary').click()
await page.waitForTimeout(2500)

const rnProse = await readBundle(page, `docs/${RN_SCENE}.md`)
check('prose is renamed, wikilink included',
  !!rnProse && rnProse.includes('Sera counted') && rnProse.includes('[[Sera]]'), rnProse?.slice(0, 70))
check('a name inside another word is left alone',
  !!rnProse && rnProse.includes('admiral'), rnProse?.slice(0, 70))
check('a snapshot was taken before the document was rewritten',
  (await listBundle(page, `snapshots/${RN_SCENE}`)).length > rnSnapsBefore.length)

const rnManifest = JSON.parse(await readBundle(page, 'project.json'))
const rnNode = rnManifest.nodes[RN_SCENE]
check('the binder title no longer says the old name — the gap replace left',
  rnNode?.title === 'Sera at the River', rnNode?.title)
check('the synopsis follows', rnNode?.meta?.synopsis === 'Sera waits for the tide.', rnNode?.meta?.synopsis)
check('the binder keyword follows, in the case the tag was using',
  (rnNode?.meta?.keywords ?? []).includes('pov-sera'), rnNode?.meta?.keywords)

const rnCodex = JSON.parse(await readBundle(page, 'codex.json') ?? '[]')
check('the codex entry, its aliases, summary and facts all follow',
  rnCodex[0]?.name === 'Sera'
  && rnCodex[0]?.aliases?.includes('Sera Vance')
  && rnCodex[0]?.summary?.includes('Sera')
  && rnCodex[0]?.facts?.[0]?.value?.includes('Sera'), rnCodex[0])

const rnComments = JSON.parse(await readBundle(page, 'comments.json') ?? '[]')
check('the comment\'s quoted anchor follows the prose, so the note is not orphaned',
  rnComments[0]?.anchor?.quote === 'Sera counted the coins.', rnComments[0]?.anchor)
check('and the note text follows too',
  (rnComments[0]?.body ?? '').includes('Sera'), rnComments[0]?.body)
check('nothing anywhere still says the old name',
  !JSON.stringify([rnProse, rnManifest.nodes[RN_SCENE], rnCodex, rnComments]).includes('Mira'))

// ── invariant 2, on a non-Anthropic provider ────────────────────────────────
section('Invariant 2 · assistant tools work on an OpenAI-compatible provider')

// The tool loop was Anthropic-only for one reason — only one wire format had
// been implemented — which made the "let the assistant use tools" switch
// tickable but inert on every other provider. This drives the whole loop over a
// mocked OpenAI-compatible endpoint: tool schemas out, streamed `tool_calls`
// deltas in, results returned as `role: "tool"` messages, and the resulting
// edit still gated by review and snapshotted before it reaches disk.
//
// The mock is deliberately unkind. It splits tool arguments across frames,
// drops `index` from continuation frames, and reports `finish_reason: "stop"`
// on a turn that is asking for a tool — the three ways real compat servers
// (Ollama, vLLM, llama.cpp) diverge from the spec.

const MOCK_BASE = 'https://mock-openai.konbini.test/v1'
const AI_MARKER = 'AI_VIA_OPENAI_TOOLS'
const NEW_TEXT = `Rewritten by the assistant over an OpenAI-compatible endpoint. ${AI_MARKER}`

const frame = (o) => `data: ${JSON.stringify(o)}\n\n`
const delta = (d, extra = {}) => frame({ object: 'chat.completion.chunk', choices: [{ index: 0, delta: d, ...extra }] })
const editArgs = JSON.stringify({ document: 'Scene 3', new_text: NEW_TEXT })
const cut = Math.floor(editArgs.length / 2)

const TURNS = [
  // 1 · asks to read a document; arguments split mid-key across two frames.
  delta({ role: 'assistant', content: '' })
    + delta({ content: 'Let me read that scene.' })
    + delta({ tool_calls: [{ index: 0, id: 'call_read', type: 'function', function: { name: 'get_document', arguments: '' } }] })
    + delta({ tool_calls: [{ index: 0, function: { arguments: '{"tit' } }] })
    + delta({ tool_calls: [{ index: 0, function: { arguments: 'le":"Scene 3"}' } }] })
    + delta({}, { finish_reason: 'tool_calls' }) + 'data: [DONE]\n\n',
  // 2 · proposes an edit — no `index` on the continuation frames, and it claims
  //     to have stopped normally while still asking for a tool.
  delta({ tool_calls: [{ id: 'call_edit', type: 'function', function: { name: 'propose_edit', arguments: '' } }] })
    + delta({ tool_calls: [{ function: { arguments: editArgs.slice(0, cut) } }] })
    + delta({ tool_calls: [{ function: { arguments: editArgs.slice(cut) } }] })
    + delta({}, { finish_reason: 'stop' }) + 'data: [DONE]\n\n',
  // 3 · the final answer, plus the trailing usage frame.
  delta({ content: 'Queued the revision for your review.' })
    + frame({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 40 } })
    + delta({}, { finish_reason: 'stop' }) + 'data: [DONE]\n\n',
]

const wire = []
await page.route('**/chat/completions', async (route) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
  }
  if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
  try { wire.push(JSON.parse(route.request().postData() ?? '{}')) } catch { wire.push(null) }
  const body = TURNS[wire.length - 1] ?? TURNS[TURNS.length - 1]
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body })
})

// Configure the provider the way an author does — through the settings screen.
await setAI(true)
await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
await page.keyboard.type('AI Settings', { delay: 20 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForSelector('.seg button', { timeout: 10000 })
await page.locator('.seg button', { hasText: 'Custom' }).first().click()
await page.waitForTimeout(300)
const toolsBox = page.locator('label:has-text("Let the assistant use tools") input[type=checkbox]')
check('the tools switch is not labelled as one vendor’s privilege',
  !/claude only/i.test(await page.locator('label:has-text("Let the assistant use tools")').first().innerText()))
if ((await toolsBox.count()) && !(await toolsBox.isChecked())) await toolsBox.setChecked(true)
await page.locator('.ai-row:has-text("Base URL") input').first().fill(MOCK_BASE)
await page.locator('.ai-row:has-text("API Key") input').first().fill('sk-mock')
await page.locator('.ai-row:has-text("Model") input').first().fill('mock-tools-model')
await page.waitForTimeout(300)
await page.locator('.tab-x').last().click()
await page.waitForTimeout(400)

const sc2Disk = await readBundle(page, 'docs/sc2.md')
const sc2Snaps = await listBundle(page, 'snapshots/sc2')

// Ask the assistant to revise a scene it has to go and read first.
await page.locator('.rail-tabs > button').filter({ hasText: 'Chat' }).first().click()
  .catch(() => page.locator('.rail-tabs > button[title="Chat"]').first().click())
await page.waitForSelector('.asst-input textarea', { timeout: 10000 })
await page.locator('.asst-input textarea').fill('Read Scene 3 and propose a revision.')
await page.keyboard.press('Enter')

await page.waitForSelector('.cs-body', { timeout: 20000 }).catch(() => {})

check('the assistant called out to the OpenAI-compatible endpoint', wire.length >= 1, wire.length)
const req1 = wire[0] ?? {}
const toolNames = (req1.tools ?? []).map((t) => t?.function?.name)
check('it advertised the tools in OpenAI function-schema form',
  Array.isArray(req1.tools) && req1.tools.every((t) => t.type === 'function' && !!t.function?.parameters)
    && toolNames.includes('get_document') && toolNames.includes('propose_edit'),
  toolNames)
check('it left the choice of tool to the model', req1.tool_choice === 'auto', req1.tool_choice)
check('it sent the provider’s own model, not a Claude id',
  req1.model === 'mock-tools-model', req1.model)
check('the config tools stay unadvertised until the author opts in',
  !toolNames.includes('propose_config'), toolNames)

// The second request is the real proof: results have to go back in the shape
// the endpoint expects, or the model is answering into a void.
const msgs2 = wire[1]?.messages ?? []
const asstTurn = msgs2.find((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))
const toolMsg = msgs2.find((m) => m.role === 'tool')
check('the assistant’s tool_calls turn is replayed back to the endpoint',
  asstTurn?.tool_calls?.[0]?.function?.name === 'get_document', asstTurn?.tool_calls)
check('the tool result comes back as a role:"tool" message on the right id',
  !!toolMsg && toolMsg.tool_call_id === asstTurn?.tool_calls?.[0]?.id,
  { got: toolMsg?.tool_call_id, want: asstTurn?.tool_calls?.[0]?.id })
check('the tool actually ran and returned the document’s real text',
  !!sc2Disk && !!toolMsg && toolMsg.content.includes(sc2Disk.trim().slice(0, 40)),
  toolMsg?.content?.slice(0, 80))
check('arguments split across frames were reassembled (the edit named its document)',
  (wire[2]?.messages ?? []).some((m) => m.role === 'tool' && /Changeset/.test(m.content ?? '')),
  (wire[2]?.messages ?? []).filter((m) => m.role === 'tool').map((m) => m.content?.slice(0, 60)))
check('the loop kept going despite finish_reason:"stop" on a tool turn', wire.length >= 3, wire.length)

// And the invariant itself: an AI edit is still only ever a proposal.
check('the AI edit opened a changeset review instead of writing',
  await page.locator('.cs-body').count() === 1)
const sc2During = await readBundle(page, 'docs/sc2.md')
check('nothing reached the .md while the AI edit was only proposed',
  sc2During === sc2Disk && !sc2During.includes(AI_MARKER), sc2During?.slice(0, 60))

await page.locator('.modal-foot .btn.primary').click()
await page.waitForTimeout(900)
const sc2After = await readBundle(page, 'docs/sc2.md')
check('accepting the AI edit writes it to disk', !!sc2After && sc2After.includes(AI_MARKER), sc2After?.slice(0, 80))
const sc2SnapsAfter = await listBundle(page, 'snapshots/sc2')
const sc2New = sc2SnapsAfter.filter((s2) => !sc2Snaps.includes(s2))
check('the AI edit was snapshotted before it was applied', sc2New.length > 0, { sc2Snaps, sc2SnapsAfter })
if (sc2New.length) {
  const before = await readBundle(page, `snapshots/sc2/${sc2New[0]}`)
  check('the snapshot is the pre-AI text', !!before && !before.includes(AI_MARKER), before?.slice(0, 60))
}

// The chat surfaces what the assistant did, so the author can audit the turn.
const chatText = await page.locator('.asst-chat').innerText().catch(() => '')
check('the conversation names the tools that ran', /Read "Scene 3"/.test(chatText), chatText.slice(-200))

await page.unroute('**/chat/completions')

// ── discoverability & the chat menu ─────────────────────────────────────────
section('Reach · a feature only the command palette knows about does not exist')

// Adventure shipped reachable from ⌘K alone, which is the same as not shipping
// it. And the chat transcript — where names and coinages get invented — had no
// way to act on a word at all.

await page.locator('.tb-btn').filter({ hasText: 'AI' }).first().click()
await page.waitForTimeout(400)
const aiMenuText = await page.locator('[role=menu]').first().innerText().catch(() => '')
check('Adventure is in the AI menu, not just the palette', /Adventure/.test(aiMenuText), aiMenuText.slice(0, 160))
await page.locator('[role=menuitem]').filter({ hasText: 'Adventure' }).first().click()
await page.waitForTimeout(900)
check('and it opens from there', await page.locator('.adv-setup, .adv-deck').count() > 0)
await page.locator('.tab-x').last().click()
await page.waitForTimeout(400)

// The transcript menu, on a real selection.
await page.locator('.rail-tabs > button').filter({ hasText: 'Chat' }).first().click()
await page.waitForSelector('.asst-chat', { timeout: 10000 })
await page.waitForTimeout(500)
const hasReply = await page.locator('.msg-text').count() > 0
check('the fixture conversation is on screen to right-click', hasReply)
if (hasReply) {
  const word = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.msg-text')].pop()
    if (!el) return ''
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node = walk.nextNode()
    while (node && !/\w{4,}/.test(node.textContent ?? '')) node = walk.nextNode()
    if (!node) return ''
    const m = /\w{4,}/.exec(node.textContent ?? '')
    if (!m) return ''
    const r = document.createRange()
    r.setStart(node, m.index)
    r.setEnd(node, m.index + m[0].length)
    const sel = getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    return m[0]
  })
  // Right-click must land *inside* the selection; outside it the browser
  // collapses the selection first, which is correct and means no word items.
  const rect = await page.evaluate(() => {
    const r = getSelection()?.getRangeAt(0).getBoundingClientRect()
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
  })
  check('a word in the transcript can be selected', !!word && !!rect, { word, rect })
  if (rect) {
    await page.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2, { button: 'right' })
    await page.waitForTimeout(500)
    const chatMenuText = await page.locator('[role=menu]').last().innerText().catch(() => '')
    check('right-clicking a selected word offers to file it',
      /Dictionary/.test(chatMenuText) && /Codex/.test(chatMenuText), chatMenuText.replace(/\n/g, ' | '))

    // The menu is portalled to <body>: rendered inside the rail it sat under the
    // rail's own resize handle, and these items could not be clicked at all.
    const clickable = await page.locator('[role=menuitem]').filter({ hasText: 'Dictionary' }).first()
      .click({ timeout: 4000 }).then(() => true).catch(() => false)
    check('and the item is actually clickable, not buried under the rail resizer', clickable)
    await page.waitForTimeout(800)
    const dict = JSON.parse(await readBundle(page, 'project.json')).settings?.dictionary ?? []
    check('filing the word persists it to the project dictionary', dict.includes(word), { dict, word })
  }
}
await page.locator('.rail-tabs > button').first().click()
await page.waitForTimeout(300)

// ── adventure mode ──────────────────────────────────────────────────────────
section('Adventure · drafting only ever appends, and every append is undoable')

// Adventure writes into the real manuscript, so its safety story is different
// from every other AI surface: no changeset gate (there is nothing to review —
// the text is new), but a snapshot before every append and a step-back that
// puts the manuscript *and* the outline back exactly as they were. That claim
// is only worth anything measured against persisted bytes.

const ADV_PASSAGE = 'ADVENTURE_PASSAGE He broke the seal with his thumb.'
const ADV_REVISED = 'ADVENTURE_REVISED He broke the seal.'
const ADV_CONTINUED = 'ADVENTURE_CONTINUED The river carried on without him.'
const ADV_ANSWER = 'ADVENTURE_ANSWER Her sister is never named in the manuscript.'
const advSeen = []
// What the classifier will say about the next line the author types.
let advIntent = 'continue'
await page.route('**/chat/completions', async (route) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
  }
  if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
  const body = JSON.parse(route.request().postData() ?? '{}')
  const prompt = (body.messages ?? []).map((m) => m.content).join('\n')
  const kind = /Classify what/.test(prompt) ? 'intent'
    : /novelist revising a passage/.test(prompt) ? 'revise'
    : /handed\s+you the pen/.test(prompt) ? 'continue'
    : /stopped drafting to/.test(prompt) ? 'answer'
    : /directions the story could take/.test(prompt) ? 'options'
    : /Continue directly from the preceding text/.test(prompt) ? 'passage'
    : /story bible editor/.test(prompt) ? 'notes'
    : /running summary of a novel/.test(prompt) ? 'summary'
    : 'other'
  advSeen.push(kind)
  const reply = {
    options: '[{"text":"He opens the letter"},{"text":"He rows for the far bank"}]',
    passage: ADV_PASSAGE,
    notes: '[{"name":"Vass","category":"character","summary":"The ferryman.","facts":[{"label":"role","value":"ferryman"}]}]',
    summary: 'A ferryman finds a letter addressed to himself.',
    intent: JSON.stringify({ intent: advIntent }),
    revise: ADV_REVISED,
    continue: ADV_CONTINUED,
    answer: ADV_ANSWER,
    other: '',
  }[kind]
  await route.fulfill({
    status: 200,
    headers: { ...cors, 'content-type': 'text/event-stream' },
    body: delta({ role: 'assistant', content: '' }) + delta({ content: reply }) + delta({}, { finish_reason: 'stop' }) + 'data: [DONE]\n\n',
  })
})

await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
await page.keyboard.type('Adventure', { delay: 20 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForSelector('.adv-setup', { timeout: 10000 }).catch(() => {})
check('Adventure opens on a setup screen, not straight into generation',
  await page.locator('.adv-setup').count() === 1)
check('it offers to continue from prose that already exists',
  await page.locator('.adv-setup-mode button').first().innerText().catch(() => '') === 'Continue from here')

// The regression lock: the project has a written "Cast note" that comes after
// the manuscript in binder order. Defaulting to the last written document
// anywhere picks that sheet and drafts the novel into it.
const advDefault = await page.locator('.adv-setup select').first().inputValue().catch(() => '')
check('it does NOT default to a character sheet just because it was written last',
  advDefault !== 'who', advDefault)
check('it defaults to a manuscript scene', /^sc\d$/.test(advDefault), advDefault)
const advGroups = await page.locator('.adv-setup select optgroup').evaluateAll((els) => els.map((e) => e.label))
check('scenes and notes are offered as separate groups', advGroups.includes('Manuscript scenes'), advGroups)

await page.locator('.adv-start').click()
await page.waitForSelector('.adv-deck', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(900)
const cardValues = await page.locator('.adv-card-text').evaluateAll((els) => els.map((e) => e.value))
check('picking up from a scene offers a deck of beats', cardValues.length === 2, cardValues)
check('the beats are the model\'s directions, editable in place',
  cardValues[0] === 'He opens the letter', cardValues)
check('the author\'s own beat is offered alongside them',
  await page.locator('.adv-own textarea').count() === 1)

// Which scene it picked up from is the session's business, not the test's —
// reading it back keeps this independent of binder order, which earlier
// sections legitimately change.
const advScene = JSON.parse(await readBundle(page, 'aux/adventure.json') ?? '{}').activeSceneId
check('the session records which scene it is drafting into', !!advScene, advScene)
const advDoc = `docs/${advScene}.md`
const advBefore = await readBundle(page, advDoc)
const advSnapsBefore = await listBundle(page, `snapshots/${advScene}`)

await page.locator('.adv-card-num').first().click()
await page.waitForTimeout(3500)

const advAfter = await readBundle(page, advDoc)
check('choosing a beat appends its prose to the scene on disk',
  !!advAfter && advAfter.includes(ADV_PASSAGE), advAfter?.slice(-80))
check('the append leaves what was already written untouched',
  !!advAfter && !!advBefore && advAfter.startsWith(advBefore.trimEnd()), advAfter?.slice(0, 60))
const advSnapsAfter = await listBundle(page, `snapshots/${advScene}`)
const advNewSnaps = advSnapsAfter.filter((s2) => !advSnapsBefore.includes(s2))
check('a snapshot was taken before the passage was written', advNewSnaps.length > 0, { advSnapsBefore, advSnapsAfter })
if (advNewSnaps.length) {
  const body = await readBundle(page, `snapshots/${advScene}/${advNewSnaps[0]}`)
  check('the snapshot is the pre-passage text, so step back is exact',
    !!body && !body.includes(ADV_PASSAGE), body?.slice(-60))
}
check('the deck, notes and summary all ran for one beat',
  advSeen.filter((k) => k === 'passage').length === 1
  && advSeen.includes('notes') && advSeen.includes('summary'), advSeen)

// The outline is written as a side effect of drafting.
const manifestAdv = JSON.parse(await readBundle(page, 'project.json'))
const spine = Object.values(manifestAdv.nodes).find((n) => n.title === 'Story spine')
check('the chosen beats are mirrored into a binder document', !!spine,
  Object.values(manifestAdv.nodes).map((n) => n.title))
if (spine) {
  const spineBody = await readBundle(page, `docs/${spine.id}.md`)
  check('the spine records the beat that was chosen',
    !!spineBody && spineBody.includes('He opens the letter'), spineBody)
}

// Nothing is filed to the codex without the author.
check('what the assistant noticed waits in an inbox',
  /Vass/.test(await page.locator('.adv-notes').innerText().catch(() => '')))
check('and is NOT in the codex until it is accepted',
  !(await readBundle(page, 'codex.json') ?? '').includes('Vass'))
await page.locator('.adv-note-act .btn.primary').first().click()
await page.waitForTimeout(700)
check('accepting it writes the entry to the codex sidecar',
  (await readBundle(page, 'codex.json') ?? '').includes('Vass'))

// Step back: the whole beat comes off, manuscript and outline together.
await page.locator('.adv-strip button:has-text("Step back")').click()
await page.waitForTimeout(1600)
const advUndone = await readBundle(page, advDoc)
check('stepping back removes the passage from disk',
  !!advUndone && !advUndone.includes(ADV_PASSAGE), advUndone?.slice(-60))
check('stepping back restores exactly what was there before', advUndone === advBefore)
if (spine) {
  const spineBody = await readBundle(page, `docs/${spine.id}.md`)
  check('stepping back also un-writes the outline — no orphan beat',
    !(spineBody ?? '').includes('He opens the letter'), spineBody)
}

// ── adventure as a conversation ─────────────────────────────────────────────
section('Adventure · talking to it, and the line a revision must not cross')

// Free text is classified before it is acted on, because "that's too flowery"
// is an instruction about the passage just written, not a direction for the
// next one. The three outcomes have three different safety stories, and the
// only one that matters here is the middle one: a revision REPLACES prose, so
// it must go through the changeset gate that appending is exempt from.

const say = async (text) => {
  await page.locator('.adv-own textarea').fill(text)
  await page.locator('.adv-own textarea').press('Enter')
}
const script = () => page.locator('.adv-script').innerText().catch(() => '')

// (a) forward — the author says what happens next, in their own words.
advIntent = 'continue'
const convBefore = await readBundle(page, advDoc)
await say('He opens the letter and reads it twice.')
await page.waitForTimeout(3800)
const convAfter = await readBundle(page, advDoc)
check('a line the classifier reads as forward appends prose to the scene',
  !!convAfter && convAfter.includes(ADV_PASSAGE) && convAfter !== convBefore, convAfter?.slice(-70))
check('the transcript keeps what the author actually asked for',
  /He opens the letter and reads it twice\./.test(await script()), (await script()).slice(0, 200))
check('the transcript is persisted with the session, not just rendered',
  ((JSON.parse(await readBundle(page, 'aux/adventure.json') ?? '{}').turns) ?? [])
    .some((t) => /reads it twice/.test(t.said ?? '')))

// (b) backward — a note about the passage that was just written.
advIntent = 'revise'
const revBefore = await readBundle(page, advDoc)
await say('That last bit is too flowery — tighten it.')
await page.waitForSelector('.cs-body', { timeout: 20000 }).catch(() => {})
check('a revision opens a changeset review instead of rewriting the scene',
  await page.locator('.cs-body').count() === 1)
check('and NOTHING on disk changed while it waits for review (invariant 2)',
  (await readBundle(page, advDoc)) === revBefore, (await readBundle(page, advDoc))?.slice(-70))
check('the classifier was actually consulted before the rewrite',
  advSeen.includes('intent') && advSeen.includes('revise'), advSeen.slice(-6))

await page.locator('.modal-foot .btn.primary').click()
await page.waitForTimeout(1600)
const revApplied = await readBundle(page, advDoc)
check('accepting the review swaps the passage on disk',
  !!revApplied && revApplied.includes(ADV_REVISED), revApplied?.slice(-70))
check('the revision replaced the old passage rather than appending a second one',
  !!revApplied && !revApplied.includes(ADV_PASSAGE), revApplied?.slice(-90))
check('and it touched only that passage — the scene before it is intact',
  !!revApplied && !!convBefore && revApplied.startsWith(convBefore.trimEnd()), revApplied?.slice(0, 60))

// (c) a question — an answer, and not one word written.
advIntent = 'ask'
const askBefore = await readBundle(page, advDoc)
await say('What was her sister called again?')
await page.waitForTimeout(3000)
check('a question is answered in the conversation',
  /ADVENTURE_ANSWER/.test(await script()), (await script()).slice(-200))
check('and writes nothing at all to the manuscript',
  (await readBundle(page, advDoc)) === askBefore)

// (d) handing the pen back — carry on with no direction given.
const contSpine = Object.values(JSON.parse(await readBundle(page, 'project.json')).nodes)
  .find((n) => n.title === 'Story spine')
const contSpineBefore = contSpine ? await readBundle(page, `docs/${contSpine.id}.md`) : ''
await page.locator('.adv-deck-tools button:has-text("Continue")').click()
await page.waitForTimeout(3800)
const contAfter = await readBundle(page, advDoc)
check('Continue drafts on from where the text stops, with no beat',
  !!contAfter && contAfter.includes(ADV_CONTINUED), contAfter?.slice(-70))
check('it used the take-the-pen prompt, not the beat prompt', advSeen.includes('continue'), advSeen.slice(-8))
if (contSpine) {
  check('carrying on adds no line to the outline — it decided nothing',
    (await readBundle(page, `docs/${contSpine.id}.md`)) === contSpineBefore,
    await readBundle(page, `docs/${contSpine.id}.md`))
}

// The deck is optional: when you know what happens next, a menu of what could
// happen instead is noise.
await page.locator('.adv-deck-tools button:has-text("Beats")').click()
await page.waitForTimeout(400)
check('the deck of suggestions can be put away', await page.locator('.adv-card').count() === 0)
check('but the conversation stays', await page.locator('.adv-own textarea').count() === 1)

await page.unroute('**/chat/completions')
await page.locator('.tab-x').last().click()
await page.waitForTimeout(400)
await setAI(false)
check('Adventure is not offered with AI switched off (invariant 1)',
  !(await railTabs()).includes('Adventure')
  && await page.locator('.adv-deck').count() === 0)

// ── contrast floors ─────────────────────────────────────────────────────────
section('Contrast · the muted text ramp clears WCAG AA in every theme')

const measureContrast = () => page.evaluate(() => {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const ctx = cv.getContext('2d')
  const rgb = (c) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1, 1)
    ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]]
  }
  const lum = (c) => {
    const [r, g, b] = rgb(c)
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (hi + 0.05) / (lo + 0.05)
  }
  const root = document.documentElement
  const val = (t) => getComputedStyle(root).getPropertyValue(t).trim()
  const SURFACES = ['--bg', '--bg-2', '--bg-3', '--editor-bg', '--sidebar']
  // --dim is decorative and disabled marks, so AA Large (3:1); the rest carry
  // information and take the full 4.5:1.
  const FLOORS = { '--text': 4.5, '--text-2': 4.5, '--text-3': 4.5, '--dim': 3.0 }

  const worst = []
  const measure = (name) => {
    for (const [tok, floor] of Object.entries(FLOORS)) {
      for (const s of SURFACES) {
        const r = ratio(val(tok), val(s))
        if (r < floor) worst.push({ theme: name, token: tok, on: s, ratio: +r.toFixed(2), floor })
      }
    }
    // Blockquotes are prose and sit on the editor background specifically.
    const q = ratio(val('--hl-quote'), val('--editor-bg'))
    if (q < 4.5) worst.push({ theme: name, token: '--hl-quote', on: '--editor-bg', ratio: +q.toFixed(2), floor: 4.5 })
  }

  measure(document.querySelector('.thm-card.on .thm-name')?.textContent?.trim() ?? root.dataset.theme)
  return worst
})
// Sweep every skin through the app's own Themes screen, so the real derivation
// engine (including the contrast clamp) is what gets measured.
await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
// "Skins" rather than "Themes": the latter also matches the Layout command
// "Theme: switch to Light", which ranks first and would just flip the theme.
await page.keyboard.type('Skins', { delay: 20 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForSelector('.thm-card', { timeout: 10000 })
const cards = await page.locator('.thm-card').count()
check('the Themes screen lists the built-in skins', cards >= 5, cards)

const allFailures = []
for (let i = 0; i < cards; i++) {
  await page.locator('.thm-card .thm-apply').nth(i).click()
  await page.waitForTimeout(350)
  allFailures.push(...await measureContrast())
}
check(`the muted ramp clears its floor on every surface, across ${cards} skins`,
  allFailures.length === 0, allFailures.slice(0, 8))

// ── document structure ─────────────────────────────────────────────────────
section('Structure · a screen reader gets landmarks and a heading')

const structure = await page.evaluate(() => ({
  h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
  landmarks: [...document.querySelectorAll('header, nav, main, aside, footer, [role=main], [role=navigation], [role=complementary], [role=contentinfo], [role=banner]')]
    .map((e) => e.getAttribute('role') ?? e.tagName.toLowerCase()),
  tree: !!document.querySelector('[role=tree]'),
  treeitems: document.querySelectorAll('[role=treeitem]').length,
  tabStops: document.querySelectorAll('[role=treeitem][tabindex="0"]').length,
}))
check('the page has exactly one h1, and it names the project',
  structure.h1.length === 1 && structure.h1[0] === 'Smoke', structure.h1)
check('the shell exposes landmarks (banner/nav/main/complementary/contentinfo)',
  ['header', 'nav', 'main', 'aside', 'footer'].every((r) => structure.landmarks.includes(r)),
  structure.landmarks)
check('the binder is a tree with treeitem rows', structure.tree && structure.treeitems > 0, structure)
check('the tree has exactly one tab stop (roving tabindex)', structure.tabStops === 1, structure.tabStops)

// ── templates ───────────────────────────────────────────────────────────────
section('Templates · a new project is yours, not a demo')

// `novel` used to return an entire finished sample manuscript — and it is the
// default card — so "New Project → Create", the most likely first action anyone
// takes, handed the author a stranger's book to delete. Checked on disk, because
// the claim is about the bytes a template persists.
await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
await page.keyboard.type('New Project', { delay: 20 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForSelector('.tmpl-grid', { timeout: 10000 })
check('a second project can be started without closing this one',
  await page.locator('.tmpl-grid').count() === 1)
check('the Novel template is the default card',
  (await page.locator('.tmpl-card.on .tc-label').first().textContent()).trim() === 'Novel')
await page.locator('.tmpl-card', { hasText: 'Novel' }).first().click()
await page.fill('.np-field .inp', 'Fresh Novel')
await page.locator('.btn.primary', { hasText: 'Create Project' }).click()
await page.waitForSelector('.tree-row', { timeout: 30000 })
await page.waitForTimeout(800)

const fresh = await page.evaluate(async () => {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('konbini-projects')
  let bundle = null
  for await (const [name, handle] of root.entries()) {
    if (name === 'smoke.konbini') continue
    const manifest = JSON.parse(await (await (await handle.getFileHandle('project.json')).getFile()).text())
    if (manifest.title === 'Fresh Novel') bundle = { handle, manifest }
  }
  if (!bundle) return null
  const docs = []
  const dir = await bundle.handle.getDirectoryHandle('docs')
  for await (const [name, fh] of dir.entries()) docs.push([name, await (await fh.getFile()).text()])
  return { titles: Object.values(bundle.manifest.nodes).map((n) => n.title).sort(), docs }
})
check('the new project reached disk', fresh !== null)
check('every document it created is empty — no prose the author has to delete',
  fresh !== null && fresh.docs.every(([, text]) => text.trim() === ''),
  fresh && fresh.docs.filter(([, t]) => t.trim() !== '').map(([n, t]) => [n, t.slice(0, 60)]))
check('but it does arrive with a shape to write into',
  fresh !== null && ['Manuscript', 'Part One', 'Chapter 1', 'Scene 1', 'Characters', 'Research', 'Trash']
    .every((t) => fresh.titles.includes(t)), fresh && fresh.titles)
check('the binder shows that shape',
  await page.locator('.tree-row', { hasText: 'Manuscript' }).count() >= 1)

// ── nothing threw ───────────────────────────────────────────────────────────
section('No uncaught errors')
check('no uncaught page errors during the run', pageErrors.length === 0, pageErrors)

await browser.close()

console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${ran - failed}/${ran} checks passed\x1b[0m`)
process.exit(failed === 0 ? 0 : 1)
