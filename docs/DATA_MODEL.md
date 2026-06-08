# Data Model

All types defined in `src/shared/types.ts`. This file is the canonical reference.

---

## Bundle layout

```
My Novel.konbini/
├── project.json          ← manifest (nodes, metadata, ordering, settings)
│                           docs[].content = "" (content lives in .md files)
│                           docs[].snapshots[] = metadata only (content in files)
├── docs/
│   ├── <nodeId>.md       ← one file per document/scene
│   └── ...
├── snapshots/
│   └── <nodeId>/
│       ├── <snapshotId>.md
│       └── ...
└── ai-overrides.json     ← per-project prompt/agent overrides (Phase 2, optional)
```

---

## `project.json` schema

```typescript
interface Project {
  schemaVersion: 1          // bump on breaking changes; trigger migration on open
  id: string                // stable project ID (uid() on create, never changes)
  title: string
  created: string           // ISO 8601
  modified: string          // ISO 8601 — updated on close and on structural mutations
  rootIds: string[]         // top-level binder node IDs, ordered
  trashId: string | null    // the Trash folder's ID
  nodes: Record<string, KNode>  // normalized binder tree
  docs: Record<string, {        // per-document metadata (NOT content — content in .md)
    snapshots: SnapshotMeta[]   // ordered newest-first
  }>
  settings: ProjectSettings
  // Phase 2 additions:
  codex?: Record<string, Entity>  // entity store
}

interface ProjectSettings {
  location: string          // absolute path to the .konbini folder
  template?: TemplateId     // blank | novel | screenplay | nonfiction
  accent?: string           // per-project accent color override (OKLCH string)
  editorFont?: 'mono' | 'serif' | 'sans'
  editorSize?: number       // 14–22px
  [k: string]: unknown      // extensible — add fields without a schema bump
}
```

**What's NOT in `project.json`:**
- Document content (in `docs/<nodeId>.md`)
- Snapshot content (in `snapshots/<nodeId>/<snapId>.md`)
- UI view state (in `shellStore` — not persisted in the bundle)
- AI proposals (in `aiStore` — session-only, not persisted in bundle)

---

## Node

```typescript
type NodeType = 'folder' | 'document' | 'scene'
type StatusId = 'idea' | 'todo' | 'inprogress' | 'draft' | 'revised' | 'final'
type LabelId  = 'none' | 'scene' | 'chapter' | 'note' | 'character' | 'idea'

interface KNode {
  id: string          // stable, never reused — codex/AI refs rely on this
  type: NodeType
  title: string
  parentId: string | null   // null = root-level
  childIds: string[]        // ordered; drag-reorder writes this
  expanded: boolean         // binder disclosure state
  meta: DocMeta
  ext: Record<string, unknown>  // extensibility bag — future fields never break readers
}

interface DocMeta {
  label: LabelId
  status: StatusId
  synopsis: string          // index-card / corkboard text
  target: number            // word-count target; 0 = none
  includeInCompile: boolean
}
```

**`ext` bag:** Used for forward-compatible extensions. Phase 2 adds `ext.codexRefs: string[]` (IDs of codex entities this document is associated with). Phase 4 adds `ext.aiScore: number` (last evaluation score). Old readers that don't know these fields silently ignore them — no migration needed.

**Status flow:** `idea → todo → inprogress → draft → revised → final`. The dots in the binder and the inspector pills reflect these. The status is author-managed; the AI never changes it (only proposes changes through changeset review).

---

## Snapshot

```typescript
// Stored in project.json (metadata only)
interface SnapshotMeta {
  id: string
  title: string         // optional human label, e.g. "before AI edit"
  takenAt: string       // ISO 8601
  words: number
  // content → snapshots/<nodeId>/<id>.md
}

// Full snapshot with content (loaded on demand for the modal)
interface Snapshot extends SnapshotMeta {
  content: string
}
```

Auto-snapshots are taken before every snapshot restore (non-destructive) and before every AI proposal apply (Phase 2). Manual snapshots are taken via the Snapshot modal or `Cmd+Shift+S`.

---

## DocBody (in-renderer type, not persisted)

```typescript
interface DocBody {
  content: string       // loaded from <nodeId>.md; "" until document is first selected
  snapshots: Snapshot[] // loaded on demand; metadata in project.json
}
```

In `projectStore.docs`, this is the live document body. The `content` field is the source of truth for the current text. It's updated by `updateContent()` and written to disk by `useAutosave`.

---

## NodeOp (mutation discriminated union)

All structural changes go through `window.api.node.mutate(projectId, op)`. The main process validates and applies the op, writes `project.json`, and returns the updated tree.

```typescript
type NodeOp =
  | { type: 'create'; parentId: string | null; nodeType: NodeType; title?: string; atIndex?: number }
  | { type: 'rename'; id: string; title: string }
  | { type: 'move'; id: string; newParentId: string | null; atIndex: number }
  | { type: 'duplicate'; id: string }
  | { type: 'trash'; id: string }           // moves to Trash folder
  | { type: 'delete'; id: string }           // permanent (must already be in Trash)
  | { type: 'updateMeta'; id: string; patch: Partial<DocMeta> }
  | { type: 'setExpanded'; id: string; expanded: boolean }
  | { type: 'setProjectTitle'; title: string }
```

The renderer applies mutations optimistically (updates store immediately), then sends the op to the service. On success, the returned tree is applied again (idempotent). On failure (rare), the store would need to roll back — not yet implemented, acceptable for Phase 1.

---

## Proposal (Phase 2)

```typescript
type ProposalCommand =
  | 'rewrite' | 'expand' | 'tighten' | 'describe' | 'brainstorm'  // selection tools
  | 'draft'       // scene drafting
  | 'foundation'  // autopilot foundation phase
  | 'revision'    // autopilot revision phase
  | 'batch'       // batch generator output

type ProposalStatus = 'pending' | 'applied' | 'discarded'

interface Proposal {
  id: string
  docId: string
  docTitle: string
  command: ProposalCommand
  label: string           // human label: "Tighten selection"
  group: string           // groups proposals in the review rail: "Co-write" | "Autopilot · Revision"
  original: string        // full document content BEFORE
  proposed: string        // full document content AFTER (AI output)
  createdAt: string
  accepted: number[]      // hunk indices currently accepted (default = all hunks)
  nHunks: number          // total number of diff hunks
  status: ProposalStatus
  seq: number             // insertion order

  // Provenance — attached from day one
  promptId: string        // PromptRegistry entry that generated this
  agentId?: string        // AgentRegistry entry (for agentic outputs)
  model: string           // model ID used
  temperature: number
  contextFingerprint: string  // SHA-256 of the ContextPacket JSON (for reproducibility)
  costCents: number

  // Computed at render time, never stored
  // segments: DiffSegment[]  ← buildSegments(original, proposed)
}

type DiffSegment =
  | { type: 'ctx'; lines: string[] }
  | { type: 'hunk'; idx: number; del: string[]; add: string[] }
```

**Proposal lifecycle:**
1. AI call → `makeProposal({ docId, command, original, proposed, ... })`
2. Added to `aiStore.proposals` with status `'pending'`, `accepted` = all hunks
3. `reviewingId` set → changeset review opens
4. Author toggles hunks, accepts/rejects
5. "Apply to binder" → `ProposalService.apply(proposalId)`:
   - `snapshot.take(docId, 'before AI edit')` ← mandatory
   - `applySegments(buildSegments(original, proposed), accepted)` → result
   - `window.api.doc.write(projectId, docId, result)` ← seam
   - `updateContent(docId, result)` ← store update
   - Proposal status → `'applied'`

---

## PromptTemplate (Phase 2)

```typescript
type PromptFeature = 'inline' | 'chat' | 'codex' | 'batch' | 'evaluation' | 'autopilot'
type AutopilotPhase = 'foundation' | 'draft' | 'eval' | 'revise'

interface PromptTemplate {
  id: string              // e.g. "inline.rewrite", "autopilot.foundation.seed"
  name: string
  description: string
  feature: PromptFeature
  phase?: AutopilotPhase
  model: string           // default model for this prompt
  temperature: number
  maxTokens?: number      // context budget for ContextBuilder
  template: string        // prompt text with {{variable}} placeholders
  variables: PromptVariable[]
  isBuiltin: boolean      // true = shipped default
  parentId?: string       // user override of a builtin
  createdAt: string
  modifiedAt: string
}

interface PromptVariable {
  name: string            // e.g. "selection"
  description: string     // shown in the prompt editor's variable picker
  example?: string        // sample value for preview
}
```

---

## AgentTemplate (Phase 2)

```typescript
type AgentCategory = 'reader' | 'critic' | 'judge' | 'codex' | 'autopilot'

interface AgentTemplate {
  id: string              // e.g. "reader.genre-fan", "eval.judge"
  name: string            // "The Genre Fan"
  description: string
  category: AgentCategory
  systemPromptId: string  // → PromptTemplate.id for the system prompt
  model: string
  temperature: number
  parameters: Record<string, unknown>  // e.g. { maxTurns: 3, stopCondition: 'no-major-issues' }
  isBuiltin: boolean
  parentId?: string
  createdAt: string
  modifiedAt: string
}
```

**Built-in agents:**
- `reader.genre-fan` — "The Genre Fan": hook-focused, wants to turn pages
- `reader.lit-fic` — "The Lit-Fic Reader": prose quality, withheld information
- `reader.skeptic` — "The Skeptic": motivation and believability
- `reader.speed-reader` — "The Speed Reader": pacing and skim resistance
- `eval.judge` — LLM judge applying the rubric
- `eval.adversarial` — Adversarial editor suggesting cuts
- `eval.critic` — Critic providing overall assessment
- `eval.professor` — Close-reading professor
- `autopilot.orchestrator` — Pipeline phase coordinator

---

## Entity (Codex, Phase 2)

```typescript
type EntityType = 'character' | 'location' | 'lore'

interface Entity {
  id: string
  type: EntityType
  name: string
  aliases: string[]         // all names/terms that refer to this entity (MentionIndex scan targets)
  summary: string           // AI-generated, author-editable
  facts: Record<string, string>  // structured key-value: { Role: 'Night-shift clerk', Age: '22' }
  flags: ContinuityFlag[]
  linkedDocId?: string      // associated binder document node
  createdAt: string
  modifiedAt: string
}

interface ContinuityFlag {
  severity: 'warn' | 'info'
  text: string
  docId?: string            // associated document
}
```

---

## DebtItem (Phase 4)

```typescript
type DebtLayer = 'voice' | 'world' | 'character' | 'outline' | 'prose' | 'canon'

interface DebtItem {
  id: string
  layer: DebtLayer
  title: string             // e.g. "Canon changed: store has eight aisles"
  detail: string            // what changed and why it creates debt
  source: string            // entity ID or doc ID that caused the change
  affected: Array<{
    docId: string
    note: string            // e.g. "Mentions ninth aisle as anomaly — consistent"
    resolved: boolean
  }>
  createdAt: string
}
```

---

## MentionIndex (Phase 2, in-memory)

```typescript
interface MentionEntry {
  docId: string
  count: number             // occurrences of any alias in this doc
}

interface MentionIndex {
  byEntity: Map<string, MentionEntry[]>    // entityId → [{docId, count}] sorted by count desc
  byDoc: Map<string, string[]>            // docId → [entityId]
  lastBuilt: number                        // timestamp
}
```

Built by scanning `docs[*].content` for all entity aliases. Rebuilt on `updateContent` (debounced 50ms). Not persisted — always rebuilt from doc content. Used by Codex backlinks, debt inbox, and `ContextBuilder`.

---

## Schema migration

On `project.open()`, the service reads `schemaVersion` and runs any needed migrations before returning the `Project` to the renderer.

```typescript
function migrateProject(raw: unknown): Project {
  const p = raw as Project
  if (p.schemaVersion === 1) return p  // current
  // Future: if (p.schemaVersion < 2) p = migrate1to2(p)
  return p
}
```

Migration functions are append-only. Old fields in `ext` bags are preserved through migrations (readers that don't know a field ignore it — no migration needed for ext additions).

---

## Recents registry

Stored in `localStorage` (browser) or `userData/konbini/recents.json` (Electron). Not in the bundle — it's app-level, not project-level.

```typescript
interface RecentEntry {
  id: string          // project ID
  title: string
  location: string    // display path (may not be resolvable without a new picker gesture)
  opened: number      // epoch ms
  words: number       // cached total at time of last open
  template?: TemplateId
  accent?: string     // per-project accent color (for the spine display)
}
```

Max 10 entries. Sorted by `opened` descending. Trimmed on write.
