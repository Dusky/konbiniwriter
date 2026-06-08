import type { PromptTemplate, AgentTemplate, PromptFeature } from '@shared/types'
import { uid } from '@shared/utils'

// ── Default built-in prompts ─────────────────────────────────────────────────

const ISO = () => new Date().toISOString()

export const DEFAULT_PROMPTS: PromptTemplate[] = [
  {
    id: 'builtin:inline:rewrite',
    name: 'Rewrite Selection',
    description: 'Rewrite the selected passage with improved clarity, rhythm, and voice consistency.',
    feature: 'inline',
    model: 'claude-opus-4-8',
    temperature: 0.7,
    maxTokens: 2000,
    template: `You are a skilled fiction editor helping improve prose quality.

<context>
{{context}}
</context>

<selection>
{{selection}}
</selection>

Rewrite the selection. Preserve meaning and character voice. Return only the rewritten text — no commentary, no quotes, no preamble.`,
    variables: [
      { name: 'context', description: 'Surrounding scene context', example: '...' },
      { name: 'selection', description: 'The text to rewrite' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:inline:expand',
    name: 'Expand',
    description: 'Expand the selection with more detail, sensory description, or dialogue.',
    feature: 'inline',
    model: 'claude-opus-4-8',
    temperature: 0.75,
    maxTokens: 3000,
    template: `You are a skilled fiction editor expanding a passage.

<context>
{{context}}
</context>

<selection>
{{selection}}
</selection>

Expand this passage. Add sensory detail, interiority, or dialogue as appropriate. Match the existing voice and tense. Return only the expanded text.`,
    variables: [
      { name: 'context', description: 'Surrounding scene context' },
      { name: 'selection', description: 'The text to expand' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:inline:tighten',
    name: 'Tighten',
    description: 'Cut the selection to its essential meaning — remove filler, redundancy, passive constructions.',
    feature: 'inline',
    model: 'claude-opus-4-8',
    temperature: 0.5,
    maxTokens: 1500,
    template: `You are a ruthless line editor cutting prose to its core.

<selection>
{{selection}}
</selection>

Tighten this passage. Cut filler words, redundancy, and weak constructions. Keep every word that earns its place. Return only the tightened text.`,
    variables: [
      { name: 'selection', description: 'The text to tighten' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:inline:describe',
    name: 'Describe Setting',
    description: 'Generate a sensory setting description for the current scene location.',
    feature: 'inline',
    model: 'claude-opus-4-8',
    temperature: 0.8,
    maxTokens: 1000,
    template: `You are a literary fiction writer describing a setting.

<context>
{{context}}
</context>

Write a vivid, concise setting description (2-4 sentences). Ground it in specific sensory details. Match the tone and POV of the surrounding context. Return only the description.`,
    variables: [
      { name: 'context', description: 'Scene context for setting inference' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:inline:brainstorm',
    name: 'Brainstorm',
    description: 'Generate 5 alternative directions or continuations for the selected passage.',
    feature: 'inline',
    model: 'claude-sonnet-4-6',
    temperature: 0.9,
    maxTokens: 2000,
    template: `You are a creative writing collaborator generating options.

<context>
{{context}}
</context>

<selection>
{{selection}}
</selection>

Generate 5 distinct alternatives or continuations for this passage. Each should take a meaningfully different approach (different tone, focus, direction, or technique). Number them 1-5. Keep each under 100 words. Return only the numbered list.`,
    variables: [
      { name: 'context', description: 'Scene context' },
      { name: 'selection', description: 'The passage to brainstorm from' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:evaluation:slop',
    name: 'Slop Scorer',
    description: 'Flag overused phrases, clichés, and AI-sounding constructions in prose.',
    feature: 'evaluation',
    model: 'claude-haiku-4-5-20251001',
    temperature: 0.2,
    maxTokens: 2000,
    template: `You are a brutally honest prose quality evaluator. Identify clichés, purple prose, overused filler phrases, and AI-sounding constructions.

<text>
{{content}}
</text>

Return a JSON array of flagged phrases. Each entry must quote the EXACT text from the passage (verbatim, for string matching):
[{ "excerpt": "<exact verbatim text from passage>", "reason": "<concise explanation>", "severity": "low|medium|high" }]

Guidelines:
- "high": egregious clichés, AI tells-not-shows, "in the realm of", "it's worth noting", "tapestry", "testament to"
- "medium": overused phrases, weak verbs, redundant adverbs
- "low": minor style suggestions

Return ONLY valid JSON. If no issues, return [].`,
    variables: [
      { name: 'content', description: 'The prose to evaluate' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:batch:cast',
    name: 'Generate Cast',
    description: 'Generate a full character roster from the project outline and synopsis.',
    feature: 'batch',
    model: 'claude-opus-4-8',
    temperature: 0.8,
    maxTokens: 4000,
    template: `You are a developmental editor helping build a novel's character roster.

<project_context>
{{context}}
</project_context>

Generate a cast of characters appropriate to this story. For each character provide:
- Name and role (protagonist / antagonist / supporting / minor)
- One-sentence core description
- Key trait or contradiction
- Their relationship to the central conflict

Format as a markdown list. Be specific and avoid archetypes.`,
    variables: [
      { name: 'context', description: 'Project outline and synopsis context' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:batch:beat-sheet',
    name: 'Beat Sheet',
    description: 'Generate a chapter-level beat sheet from synopsis and outline.',
    feature: 'batch',
    model: 'claude-opus-4-8',
    temperature: 0.75,
    maxTokens: 5000,
    template: `You are a story structure consultant generating a beat sheet.

<context>
{{context}}
</context>

<synopsis>
{{synopsis}}
</synopsis>

Generate a beat sheet with the following structure beats (adapt to this story's genre/tone):
- Opening image / status quo
- Inciting incident
- First plot point / crossing the threshold
- Midpoint reversal
- Dark night / all is lost
- Climax
- Resolution

For each beat: scene location, who's present, what changes, emotional register. Be specific to this story — no generic placeholders.`,
    variables: [
      { name: 'context', description: 'Project context' },
      { name: 'synopsis', description: 'Story synopsis' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:batch:chapter-draft',
    name: 'Draft Chapter',
    description: 'Draft prose for a chapter from its synopsis and outline.',
    feature: 'batch',
    model: 'claude-opus-4-8',
    temperature: 0.85,
    maxTokens: 8000,
    template: `You are a skilled fiction writer drafting a chapter.

<context>
{{context}}
</context>

<chapter_synopsis>
{{synopsis}}
</chapter_synopsis>

Write the full chapter prose. Requirements:
- Match the voice, tense, and POV established in the context
- Show don't tell — use scene, dialogue, and action
- Avoid clichés and AI-sounding phrasing
- End the chapter with forward momentum

Return only the chapter prose, no commentary.`,
    variables: [
      { name: 'context', description: 'Scene context and surrounding chapters' },
      { name: 'synopsis', description: 'This chapter synopsis and beat notes' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:evaluation:judge',
    name: 'LLM Judge',
    description: 'Score prose on six craft dimensions with specific improvement suggestions.',
    feature: 'evaluation',
    model: 'claude-opus-4-8',
    temperature: 0.3,
    maxTokens: 3000,
    template: `You are a rigorous literary critic evaluating prose quality.

<text>
{{content}}
</text>

Score this passage on each dimension (1–10) and give ONE specific improvement note per dimension:

1. Voice consistency — does the narrator's voice remain distinct and controlled?
2. Show vs tell — are emotions and states dramatized or just stated?
3. Pacing — does scene rhythm serve the tension?
4. Specificity — are details concrete and chosen, or generic?
5. Dialogue — does speech reveal character and advance scene?
6. Prose rhythm — does sentence variety prevent monotony?

Return JSON: [{ "dimension": "<name>", "score": <1-10>, "note": "<one specific observation>" }]
Then a brief overall verdict (2 sentences max).`,
    variables: [
      { name: 'content', description: 'The prose passage to evaluate' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:revision:canon',
    name: 'Reconcile Canon Change',
    description: 'Revise a document so it stays consistent after a Codex fact changed (propagation debt).',
    feature: 'autopilot',
    phase: 'revise',
    model: 'claude-opus-4-8',
    temperature: 0.4,
    maxTokens: 8000,
    template: `You are a continuity editor revising a scene to match updated canon.

<canon_change>
Entity: {{entity}}
Fact: {{fact}}
Was: {{oldValue}}
Now: {{newValue}}
</canon_change>

<context>
{{context}}
</context>

<document>
{{document}}
</document>

Revise the document so every reference to {{entity}} is consistent with the updated fact. Change ONLY what the canon update requires — preserve the voice, structure, tense, and all unrelated content. If nothing in the document actually depends on this fact, return the document unchanged. Return only the full revised document text, no commentary.`,
    variables: [
      { name: 'entity', description: 'The entity whose fact changed' },
      { name: 'fact', description: 'The fact label that changed' },
      { name: 'oldValue', description: 'Previous fact value' },
      { name: 'newValue', description: 'Updated fact value' },
      { name: 'context', description: 'Scene/codex context' },
      { name: 'document', description: 'Full current document markdown' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
]

export const DEFAULT_AGENTS: AgentTemplate[] = [
  {
    id: 'builtin:agent:reader:general',
    name: 'General Reader',
    description: 'A thoughtful general fiction reader with broad tastes.',
    category: 'reader',
    systemPromptId: 'builtin:inline:rewrite',
    model: 'claude-sonnet-4-6',
    temperature: 0.7,
    parameters: {
      persona: 'general reader',
      focusAreas: ['pacing', 'clarity', 'engagement'],
    },
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
]

// ── Registry ─────────────────────────────────────────────────────────────────

const STORAGE_KEY_PROMPTS = 'konbini:promptRegistry'
const STORAGE_KEY_AGENTS  = 'konbini:agentRegistry'

function loadFrom<T extends { id: string }>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[]
  } catch {
    return []
  }
}

function saveTo<T>(key: string, items: T[]): void {
  localStorage.setItem(key, JSON.stringify(items))
}

export class PromptRegistry {
  private overrides: Map<string, PromptTemplate>

  constructor() {
    const stored = loadFrom<PromptTemplate>(STORAGE_KEY_PROMPTS)
    this.overrides = new Map(stored.map((p) => [p.id, p]))
  }

  all(feature?: PromptFeature): PromptTemplate[] {
    const base = DEFAULT_PROMPTS.filter((p) => !feature || p.feature === feature)
    return base.map((p) => this.overrides.get(p.id) ?? p)
  }

  get(id: string): PromptTemplate | null {
    return this.overrides.get(id) ?? DEFAULT_PROMPTS.find((p) => p.id === id) ?? null
  }

  save(prompt: PromptTemplate): void {
    this.overrides.set(prompt.id, { ...prompt, modifiedAt: new Date().toISOString() })
    saveTo(STORAGE_KEY_PROMPTS, [...this.overrides.values()])
  }

  reset(id: string): void {
    this.overrides.delete(id)
    saveTo(STORAGE_KEY_PROMPTS, [...this.overrides.values()])
  }

  duplicate(id: string): PromptTemplate | null {
    const source = this.get(id)
    if (!source) return null
    const copy: PromptTemplate = {
      ...source,
      id: `user:${uid()}`,
      name: `${source.name} (copy)`,
      isBuiltin: false,
      parentId: source.id,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    }
    this.save(copy)
    return copy
  }

  delete(id: string): void {
    if (DEFAULT_PROMPTS.some((p) => p.id === id)) return // can't delete builtins
    this.overrides.delete(id)
    saveTo(STORAGE_KEY_PROMPTS, [...this.overrides.values()])
  }

  /** Fill template variables and return the rendered prompt string. */
  render(id: string, vars: Record<string, string>): string {
    const prompt = this.get(id)
    if (!prompt) throw new Error(`Prompt not found: ${id}`)
    return prompt.template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
  }
}

export class AgentRegistry {
  private overrides: Map<string, AgentTemplate>

  constructor() {
    const stored = loadFrom<AgentTemplate>(STORAGE_KEY_AGENTS)
    this.overrides = new Map(stored.map((a) => [a.id, a]))
  }

  all(): AgentTemplate[] {
    return DEFAULT_AGENTS.map((a) => this.overrides.get(a.id) ?? a)
  }

  get(id: string): AgentTemplate | null {
    return this.overrides.get(id) ?? DEFAULT_AGENTS.find((a) => a.id === id) ?? null
  }

  save(agent: AgentTemplate): void {
    this.overrides.set(agent.id, { ...agent, modifiedAt: new Date().toISOString() })
    saveTo(STORAGE_KEY_AGENTS, [...this.overrides.values()])
  }

  reset(id: string): void {
    this.overrides.delete(id)
    saveTo(STORAGE_KEY_AGENTS, [...this.overrides.values()])
  }
}

// Singletons — one registry per app instance
export const promptRegistry = new PromptRegistry()
export const agentRegistry = new AgentRegistry()
