# AI Layer Design

Covers Phase 2 (proposal spine + co-write), Phase 3 (assisted mode), and Phase 4 (autopilot). Also covers the two cross-cutting subsystems that underpin everything: `MentionIndex` and `ContextBuilder`.

---

## Guiding constraints

Every AI feature is designed under these constraints, without exception:

1. **AI off = zero AI in DOM and zero AI code paths.** The global `aiStore.enabled` flag gates all AI rendering. With it off, the app is byte-for-byte identical to Phase 1.

2. **No AI write reaches `.md` directly.** All AI output flows: AI call → `Proposal` → changeset review → author accept/reject → `ProposalService.apply()` → `updateContent()`.

3. **Every prompt is editable.** Every AI instruction is a `PromptTemplate` in `PromptRegistry`. Users see, edit, and tune every prompt. No hidden system prompts.

4. **Cost is visible before and during every call.** Token estimate shown before each call. Live tally shown during Autopilot runs. A `spendCapCents` hard stop.

5. **The author is always in control.** AI suggests; the author accepts or rejects, at the hunk level. Autopilot can run without interruption only if the author explicitly sets `checkpoint: 'straight'`.

---

## BYOK model

No Konbini-managed API keys. Authors bring their own.

**Supported vendors:**
- Anthropic (Claude) — default for most features
- OpenAI (GPT) — routing option
- Ollama (local) — free, private, for mechanical features (slop scorer, chunked index)

**Key storage:**
- Electron: OS keychain via `keytar`. If `keytar` fails (common on some Linux setups): fall back to AES-256-GCM encrypted file in `userData/konbini/.keys`, key derived from machine fingerprint (CPU ID + hostname hash).
- Browser: `sessionStorage` only (keys lost on tab close — acceptable for development/preview; full BYOK requires Electron).

**Onboarding:**
- AI is off by default. On first enable, a wizard:
  1. Explains what BYOK means and what the key is used for
  2. Shows the key input field
  3. Makes a cheap test call (list models or a short completion) to validate the key before accepting
  4. Shows estimated cost for common operations

**Feature model routing (defaults):**

| Feature | Default model | Reasoning |
|---|---|---|
| Inline tools (rewrite, expand, etc.) | `claude-haiku` | Fast, cheap; quality sufficient for word-level edits |
| Chat (assistant panel) | `claude-sonnet` | Needs real reasoning about the manuscript |
| Slop scorer | `ollama-local` | Mechanical regex + sentence analysis; LLM not needed |
| LLM judge | `claude-sonnet` | Rubric evaluation requires genuine comprehension |
| Scene drafting | `claude-sonnet` | Long-form generation; quality is paramount |
| Foundation phase | `claude-sonnet` | Complex reasoning; the highest-stakes output |
| Codex extraction | `claude-haiku` | Pattern extraction from text; fast is better |

All routing is configurable per feature in AI Settings. Models are assignable from the `PromptRegistry` entry (default) or overridden in AI Settings.

---

## Cost model

Every call goes through `estimateCost(promptId, model)` before it's made:

```typescript
function estimateCost(promptTemplate: PromptTemplate, model: string, contextPacket: ContextPacket): number {
  const inTokens = estimateTokens(promptTemplate.template) + contextPacket.tokenCount
  const outTokens = promptTemplate.maxTokens ?? 1000
  const pricing = MODEL_PRICING[model]
  return (inTokens / 1000) * pricing.inputPer1k + (outTokens / 1000) * pricing.outputPer1k
}
```

The estimate is shown as a chip before the author confirms any AI action. A "¢0.4 estimated" chip on the Rewrite button, for example.

For Autopilot, the pre-run estimate is the sum of all phase estimates. The live tally updates as phases complete. The `spendCapCents` is a hard stop — if the next phase would exceed it, the run pauses and asks for confirmation.

---

## MentionIndex

The foundational data structure that makes Codex backlinks, propagation debt, and smart context selection possible.

### What it is

An inverted index: entity alias → documents that contain it.

```typescript
class MentionIndex {
  private byEntity = new Map<string, Array<{ docId: string; count: number }>>()
  private byDoc = new Map<string, string[]>()

  rebuild(docs: Record<string, DocBody>, entities: Record<string, Entity>): void {
    this.byEntity.clear()
    this.byDoc.clear()
    for (const [docId, body] of Object.entries(docs)) {
      if (!body.content) continue
      const mentioned: string[] = []
      for (const [entityId, entity] of Object.entries(entities)) {
        let count = 0
        for (const alias of entity.aliases) {
          const re = new RegExp(escapeRegex(alias), 'gi')
          const matches = body.content.match(re)
          if (matches) count += matches.length
        }
        if (count > 0) {
          mentioned.push(entityId)
          const existing = this.byEntity.get(entityId) ?? []
          existing.push({ docId, count })
          this.byEntity.set(entityId, existing)
        }
      }
      if (mentioned.length) this.byDoc.set(docId, mentioned)
    }
    // Sort each entity's doc list by count desc
    for (const [, list] of this.byEntity) list.sort((a, b) => b.count - a.count)
  }

  getMentions(entityId: string): Array<{ docId: string; count: number }> {
    return this.byEntity.get(entityId) ?? []
  }

  getEntitiesInDoc(docId: string): string[] {
    return this.byDoc.get(docId) ?? []
  }
}
```

### Maintenance

Rebuilt on:
1. `project.open()` — full rebuild from all docs
2. `updateContent(docId, content)` — incremental update (re-scan just that doc), debounced 50ms

The debounce prevents rebuilding on every keystroke. At 50ms, the index is at most one word behind real-time, which is fine for all use cases.

### When not to use it

The `MentionIndex` does simple string/regex matching. It cannot:
- Detect pronouns referring to entities ("she" → Reiko)
- Handle misspellings or OCR errors
- Understand narrative context (a dream mention vs a real event)

For these cases, use an LLM-based entity extraction call. The mechanical index handles the common case efficiently; the LLM handles the edge cases on-demand.

---

## ContextBuilder

Assembles the context packet for any AI call. Token-budget aware.

### Assembly order (priority, high to low)

1. **Full document content** (always included; never truncated)
2. **Chapter synopsis** (parent node synopsis; always if it exists)
3. **Relevant codex cards** (entities in the current document per `MentionIndex`; most-mentioned first)
4. **Sibling synopses** (adjacent scene synopses for narrative continuity)
5. **Outline excerpt** (N levels of ancestor synopses)
6. **Voice fingerprint** (from Foundation output; included if available and budget allows)
7. **Canon snapshot** (from Foundation output; included if budget allows)

Each tier knows its approximate token cost. The builder fills tiers top-down, stopping when the budget is exhausted. Tiers 4–7 are dropped first; tiers 1–3 are never dropped.

```typescript
class ContextBuilder {
  static for(
    docId: string,
    feature: PromptFeature,
    project: Project,
    mentionIndex: MentionIndex,
    entities: Record<string, Entity>,
    foundationOutputs?: { voiceFingerprint: string; canon: string },
    budgetTokens: number = 16000
  ): ContextPacket {
    const doc = project.docs[docId]
    const node = project.nodes[docId]
    let used = estimateTokens(doc.content)
    const packet: ContextPacket = { scene: doc.content, chapterSynopsis: '', codexCards: [], outlineExcerpt: '', tokenCount: used }

    // Tier 2: chapter synopsis
    const chapterSynopsis = getAncestorSynopsis(project, docId, 1)
    const t2cost = estimateTokens(chapterSynopsis)
    if (used + t2cost <= budgetTokens) { packet.chapterSynopsis = chapterSynopsis; used += t2cost }

    // Tier 3: codex cards for mentioned entities
    const mentioned = mentionIndex.getEntitiesInDoc(docId)
    for (const entityId of mentioned) {
      const entity = entities[entityId]
      if (!entity) continue
      const card = formatEntityCard(entity)
      const cost = estimateTokens(card)
      if (used + cost > budgetTokens) break
      packet.codexCards.push(entity)
      used += cost
    }

    // Tiers 4–7 elided for brevity — same pattern

    packet.tokenCount = used
    return packet
  }
}
```

### Variable resolution

When a generator calls a `PromptTemplate`, the `{{variable}}` placeholders are resolved from the `ContextPacket`:

```typescript
function resolveTemplate(template: string, packet: ContextPacket): string {
  return template
    .replace('{{document}}', packet.scene)
    .replace('{{document.synopsis}}', packet.chapterSynopsis)
    .replace('{{codex.characters}}', packet.codexCards.filter(e => e.type === 'character').map(formatEntityCard).join('\n\n'))
    // ... etc
}
```

The resolved prompt is what actually goes to the API. The `contextFingerprint` on the `Proposal` is `sha256(JSON.stringify(packet))`, making the context that produced any output reproducible.

---

## Phase 2: Proposal spine + Co-write

### ProposalService

The single entry point for all AI-initiated document changes.

```typescript
class ProposalService {
  async propose(opts: {
    docId: string
    command: ProposalCommand
    label: string
    group: string
    selection?: { text: string; start: number; end: number }
    silentReview?: boolean  // add to queue without opening review immediately
  }): Promise<Proposal> {
    const project = useProjectStore.getState().project!
    const ai = useAIStore.getState()

    // 1. Assemble context
    const packet = ContextBuilder.for(opts.docId, /* ... */)

    // 2. Get prompt template
    const template = promptRegistry.get(`inline.${opts.command}`)

    // 3. Resolve template with context
    const prompt = resolveTemplate(template.template, packet, opts.selection)

    // 4. Estimate cost, show to user (or proceed if already confirmed)
    const costCents = estimateCost(template, ai.routes[opts.command], packet)

    // 5. Call AI
    const response = await callAI(prompt, template.model, template.temperature, abortController)

    // 6. Build proposed content
    const original = project.docs[opts.docId].content
    const proposed = opts.selection
      ? original.slice(0, opts.selection.start) + response + original.slice(opts.selection.end)
      : response

    // 7. Build proposal (diff computed here)
    const proposal = makeProposal({ ...opts, original, proposed, template, packet, costCents })

    // 8. Add to store
    aiStore.addProposal(proposal)

    return proposal
  }

  async apply(proposalId: string): Promise<void> {
    const proposal = aiStore.getProposal(proposalId)

    // MANDATORY — no exceptions
    await window.api.snapshot.take(project.id, proposal.docId, 'before AI edit')

    // Compute accepted result
    const segments = buildSegments(proposal.original, proposal.proposed)
    const result = applySegments(segments, proposal.accepted)

    // The one seam
    await window.api.doc.write(project.id, proposal.docId, result)
    useProjectStore.getState().updateContent(proposal.docId, result)

    // Raise propagation debt if needed
    debtService.maybeRaiseFromProposal(proposal, result)

    aiStore.markApplied(proposalId)
  }
}
```

### Co-write selection toolbar

Appears above selected text. Built as a floating `div` positioned by `document.getSelection().getRangeAt(0).getBoundingClientRect()`.

Actions: **Rewrite** · **Expand** · **Tighten** · **Describe** · **Brainstorm**

Each action:
1. Reads selection range from CM6 (`EditorView.state.selection.main`)
2. Calls `ProposalService.propose({ docId, command, selection: { text, start, end } })`
3. Shows "thinking" indicator
4. Opens changeset review with the result

The "Tighten" action is cheap enough (haiku, short completion) to show an optimistic preview while the call is in-flight.

### Assistant panel (chat)

Context-scoped chat with the manuscript. Not a generic chatbot — it only knows what's in the project.

```typescript
async function chat(message: string, scope: 'doc' | 'manuscript' | 'project'): Promise<ChatMessage> {
  const packet = ContextBuilder.for(selectedDocId, 'chat', project, mentionIndex, entities)
  const template = promptRegistry.get('chat.assistant')
  const prompt = resolveTemplate(template.template, packet) + '\n\nUser: ' + message
  const response = await callAI(prompt, template.model, template.temperature)
  return { role: 'ai', text: response.text, cites: extractCitations(response) }
}
```

Citations are doc/entity IDs embedded in the response (via a structured format in the prompt). The UI renders them as clickable chips that jump to the cited document or codex card.

---

## Phase 3: Assisted mode

### Batch generators

Each batch generator wraps the single-document logic in a loop:

```typescript
async function generateCast(project: Project): Promise<Proposal[]> {
  const characters = detectCharacters(project)  // scan for named characters not in codex
  const proposals: Proposal[] = []
  for (const name of characters) {
    const p = await ProposalService.propose({
      docId: findBestDoc(name, project),  // doc with most mentions
      command: 'batch',
      label: `Generate character note: ${name}`,
      group: 'Generate cast',
      silentReview: true,  // accumulate; open review once at the end
    })
    proposals.push(p)
  }
  aiStore.setSurface('changes')  // open changeset review with all proposals
  return proposals
}
```

All batch generators offer "just this one" vs "the whole set" at invocation. The `silentReview` flag accumulates proposals without opening the review panel mid-batch.

### Slop scorer (inline proofing)

Mechanical — no LLM needed. Applied to a document or selection.

```typescript
interface SlopFlag { kind: SlopKind; start: number; end: number; text: string }
type SlopKind = 'cliche' | 'banned' | 'filter' | 'telling' | 'uniform'

function scoreProse(text: string, lexicon: SlopLexicon): SlopResult {
  const flags: SlopFlag[] = []
  // Scan for clichés, banned words, filter words, telling phrases
  for (const kind of ['cliche', 'banned', 'filter', 'telling']) {
    for (const term of lexicon[kind]) {
      const re = new RegExp('\\b' + escapeRegex(term) + '\\b', 'gi')
      // ... push flags
    }
  }
  // Sentence uniformity: flag runs of 3+ sentences within ±2 words of each other
  // ...
  const score = Math.max(0, Math.min(100, Math.round(100 - density * 9)))
  return { flags, counts, score, words: wordCount(text) }
}
```

The lexicon is a `PromptTemplate` of type `"evaluation.slop.lexicon"` — an editable JSON list. Authors can add their own banned phrases, adjust thresholds, or disable categories.

Inline highlights in the editor: a CM6 decoration plugin reads `slopResult.flags` and draws coloured underlines at the flagged positions.

### LLM judge

Sends the document + the rubric template to the model. Parses the structured response.

```typescript
interface JudgeReport {
  overall: number          // 1–10
  rubric: Array<{
    criterion: string
    score: number          // 1–10
    note: string           // one-sentence explanation
  }>
}
```

The rubric template (`"evaluation.judge.rubric"`) lists the criteria and their descriptions. It instructs the model to respond in a specific JSON format. The response is parsed and rendered as a grid in the evaluation report.

---

## Phase 4: Autopilot

### Pipeline phase definitions

All phases are defined in `resources/prompts/registry.json` and `resources/prompts/agents.json`. The pipeline sequence itself is configurable — removing or reordering phases is an admin action, not a code change.

```json
// resources/prompts/agents.json (excerpt)
{
  "id": "autopilot.foundation",
  "name": "Foundation Orchestrator",
  "category": "autopilot",
  "systemPromptId": "autopilot.foundation.orchestrator",
  "model": "claude-sonnet",
  "temperature": 0.7,
  "parameters": {
    "phases": ["seed", "world", "characters", "outline", "foreshadowing", "canon", "voice"],
    "qualityGate": { "promptId": "autopilot.foundation.quality-gate", "threshold": 75, "maxLoops": 3 }
  }
}
```

### Foundation quality gate

After generating the outline, the quality gate scores it against a rubric (registry-editable: `"autopilot.foundation.quality-gate"`). If the score is below the threshold (default: 75/100), the outline is revised and re-scored. This loop repeats up to `maxLoops` times. The threshold and max loops are in the agent parameters, not hardcoded.

### Drafting keep-or-retry

Each chapter draft is scored by the slop scorer and LLM judge. If the combined score is below the gate (default: 78/100), the chapter is redrafted with the evaluation feedback injected as `{{previousDraft}}` and `{{evaluationFeedback}}`. Up to N retries (configurable per-project). The UI shows each chapter with status, score, and retry count.

### Propagation debt service

```typescript
class DebtService {
  raise(event: DebtEvent): void {
    // Called by:
    // - Codex: entity fact edited
    // - ProposalService: AI edit applied
    // - Author: binder structure changed (doc moved, renamed)
    const affected = this.findAffected(event)
    if (affected.length === 0) return
    const item: DebtItem = {
      id: uid('debt'),
      layer: event.layer,
      title: event.title,
      detail: event.detail,
      source: event.source,
      affected,
      createdAt: new Date().toISOString(),
    }
    aiStore.addDebt(item)
  }

  private findAffected(event: DebtEvent): DebtItem['affected'] {
    // Uses MentionIndex for character/location/canon events
    // Uses outline structure for outline events
    // Uses all docs for voice events
    // ...
  }

  maybeRaiseFromProposal(proposal: Proposal, newContent: string): void {
    // Check if the proposal changed any entity alias references
    // If so, raise a character/canon debt item
  }
}
```

### AutopilotRunner (resumable)

```typescript
class AutopilotRunner {
  private abortController: AbortController | null = null

  async start(opts: RunOptions): Promise<void> {
    const run = createRun(opts)
    aiStore.setRun(run)
    this.abortController = new AbortController()
    await this.tick(run.id)
  }

  stop(): void {
    this.abortController?.abort()
    aiStore.updateRun({ status: 'stopped' })
  }

  async resume(runId: string): Promise<void> {
    const run = aiStore.getRun(runId)
    if (!run || run.status !== 'paused') return
    this.abortController = new AbortController()
    aiStore.updateRun({ status: 'running' })
    await this.tick(runId)
  }

  private async tick(runId: string): Promise<void> {
    const run = aiStore.getRun(runId)
    if (!run || run.status !== 'running') return
    if (run.phaseIdx >= run.phases.length) {
      aiStore.updateRun({ status: 'done' })
      return
    }

    const phase = PIPELINE_PHASES[run.phases[run.phaseIdx].id]
    aiStore.markPhaseRunning(runId, run.phaseIdx)

    try {
      await phase.execute(run, this.abortController!.signal)
      aiStore.markPhaseDone(runId, run.phaseIdx)
      aiStore.incrementPhase(runId)

      if (run.checkpoint === 'pause') {
        aiStore.updateRun({ status: 'paused' })
        return  // wait for user to call resume()
      }

      // Check spend cap
      if (aiStore.getRun(runId)!.spentCents >= run.spendCapCents) {
        aiStore.updateRun({ status: 'paused' })
        // Notify user: cap reached, confirm to continue
        return
      }

      await this.tick(runId)  // next phase
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        aiStore.updateRun({ status: 'stopped' })
      } else {
        aiStore.markPhaseFailed(runId, run.phaseIdx, String(e))
        aiStore.updateRun({ status: 'error' })
      }
    }
  }
}
```

The run state is persisted to `localStorage` via `aiStore`. On app reopen, an incomplete run is shown with "Resume" and "Discard" options.

---

## Prompt library (management UI)

A dedicated surface (AI Settings → Prompts) for browsing and editing every prompt and agent.

**Layout:** Left sidebar groups by feature (Inline Tools, Chat, Codex, Evaluation, Autopilot). Selecting a group shows all templates in that feature as cards. Selecting a card shows:
- Name, description, feature, phase (if applicable)
- Template text editor with syntax highlighting for `{{variables}}`
- Variable picker: click a variable to insert it at cursor; hover for description
- Model + temperature + maxTokens controls
- "This is a builtin — editing creates a personal override" banner (if builtin)
- Actions: Save · Reset to Default · Duplicate · Export JSON · Import JSON

**Import/export:** A template exported as JSON can be shared with other authors or backed up. Import validates the schema before accepting. Importing a template with an ID that already exists asks: "Update existing" or "Import as new."

**Per-project overrides:** A toggle in the template editor: "Apply this override to this project only." Creates an `ai-overrides.json` in the bundle instead of the user-global override file.
