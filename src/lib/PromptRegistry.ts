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
    id: 'builtin:evaluation:slop',
    name: 'Slop Scorer',
    description: 'Flag overused phrases, clichés, and AI-sounding constructions in prose.',
    feature: 'evaluation',
    model: 'claude-haiku-4-5-20251001',
    temperature: 0.2,
    maxTokens: 2000,
    template: `You are a prose quality evaluator. Identify clichés, overused phrases, purple prose, and AI-sounding constructions.

<text>
{{content}}
</text>

Return a JSON array of flagged spans:
[{ "start": <char_offset>, "end": <char_offset>, "reason": "<brief explanation>", "severity": "low|medium|high" }]

Return only valid JSON. If no issues found, return [].`,
    variables: [
      { name: 'content', description: 'The prose to evaluate' },
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
