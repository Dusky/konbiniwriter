import type { PromptTemplate, AgentTemplate, AgentCategory, PromptFeature } from '@shared/types'
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
    id: 'builtin:foundation:concept',
    name: 'Foundation · Concept',
    description: 'Expand a one-line seed into a story concept.',
    feature: 'autopilot',
    phase: 'foundation',
    model: 'claude-opus-4-8',
    temperature: 0.8,
    maxTokens: 2000,
    template: `You are a developmental editor shaping a story concept from a one-line seed.

<seed>
{{seed}}
</seed>

Expand this into a story concept. Cover, as short markdown sections:
- Genre & tone
- Logline (one sharp sentence)
- The central dramatic question
- Primary conflict and stakes
- Core themes
- What makes it distinct

Be concrete and specific — no generic placeholders. Return only the markdown, no preamble.`,
    variables: [{ name: 'seed', description: 'The one-line premise' }],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:foundation:world',
    name: 'Foundation · World Bible',
    description: 'Derive a setting bible from the story concept.',
    feature: 'autopilot',
    phase: 'foundation',
    model: 'claude-opus-4-8',
    temperature: 0.8,
    maxTokens: 3000,
    template: `You are a worldbuilder establishing the setting bible for a novel.

<concept>
{{concept}}
</concept>

Write a concise world bible as short markdown sections:
- Setting & time period
- Rules that govern this world (social, physical, or magical)
- Atmosphere & sensory texture
- Key locations (3–6, each one line)

Ground every choice in the concept. Return only the markdown, no preamble.`,
    variables: [{ name: 'concept', description: 'The story concept' }],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:foundation:characters',
    name: 'Foundation · Characters',
    description: 'Build the principal cast from concept and world.',
    feature: 'autopilot',
    phase: 'foundation',
    model: 'claude-opus-4-8',
    temperature: 0.85,
    maxTokens: 3000,
    template: `You are a developmental editor building the principal cast for a novel.

<concept>
{{concept}}
</concept>

<world>
{{world}}
</world>

Create the principal cast (4–7 characters). For each, a short markdown section with:
- **Name** — role (protagonist / antagonist / supporting)
- Core description (one line)
- A defining contradiction or wound
- Their relationship to the central conflict

Avoid archetypes; make each specific to this story. Return only the markdown, no preamble.`,
    variables: [
      { name: 'concept', description: 'The story concept' },
      { name: 'world', description: 'The world bible' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:foundation:outline',
    name: 'Foundation · Outline',
    description: 'Build a chapter-by-chapter outline from concept, world, and cast.',
    feature: 'autopilot',
    phase: 'foundation',
    model: 'claude-opus-4-8',
    temperature: 0.75,
    maxTokens: 5000,
    template: `You are a story structure consultant outlining a novel.

<concept>
{{concept}}
</concept>

<world>
{{world}}
</world>

<characters>
{{characters}}
</characters>

Produce a chapter-by-chapter outline (as many chapters as the story needs). For each chapter:
- **Chapter N — Title**
- A 2–3 sentence synopsis: what happens and what changes
- Principal characters present

Group into acts if it helps. Keep momentum and causality clear (each chapter should set up the next). Return only the markdown.`,
    variables: [
      { name: 'concept', description: 'The story concept' },
      { name: 'world', description: 'The world bible' },
      { name: 'characters', description: 'The cast' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:foundation:voice',
    name: 'Foundation · Voice Fingerprint',
    description: 'Derive a prose style guide from sample prose (or the concept if none exists yet).',
    feature: 'autopilot',
    phase: 'foundation',
    model: 'claude-opus-4-8',
    temperature: 0.4,
    maxTokens: 2000,
    template: `You are a prose-style analyst producing a VOICE FINGERPRINT — a concise, prescriptive style guide an author or AI co-writer can follow to keep one consistent voice.

<samples>
{{samples}}
</samples>

Describe the target prose voice as short markdown sections:
- POV & tense
- Sentence rhythm & length
- Diction & register (word choice, formality)
- Imagery & figurative language
- Dialogue style
- Pacing tendencies
- Things to avoid

Be specific and prescriptive (rules, not vibes). Return only the markdown.`,
    variables: [{ name: 'samples', description: 'Prose samples, or a description of the intended work' }],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:evaluation:outline-gate',
    name: 'Outline Quality Gate',
    description: 'Score a novel outline for structural quality and decide pass/revise.',
    feature: 'evaluation',
    model: 'claude-opus-4-8',
    temperature: 0.2,
    maxTokens: 1500,
    template: `You are a tough but fair developmental editor scoring a novel OUTLINE for structural quality.

<concept>
{{concept}}
</concept>

<world>
{{world}}
</world>

<characters>
{{characters}}
</characters>

<outline>
{{outline}}
</outline>

Score the outline 0–100 overall, judging: act/structure shape, causality (each chapter sets up the next), escalation of stakes, character-arc progression, pacing, and originality (avoids cliché beats).

Return ONLY JSON:
{ "overall": <0-100>, "issues": ["<concrete structural problem>", ...], "suggestions": ["<specific, actionable fix>", ...] }

Be specific and concrete — every issue should name where in the outline it occurs. Return ONLY valid JSON.`,
    variables: [
      { name: 'concept', description: 'The story concept' },
      { name: 'world', description: 'The world bible' },
      { name: 'characters', description: 'The cast' },
      { name: 'outline', description: 'The outline to score' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:foundation:outline-revise',
    name: 'Foundation · Revise Outline',
    description: 'Revise a novel outline to address editor critique (quality-gate loop).',
    feature: 'autopilot',
    phase: 'foundation',
    model: 'claude-opus-4-8',
    temperature: 0.75,
    maxTokens: 5000,
    template: `You are revising a novel outline to fix specific structural problems.

<concept>
{{concept}}
</concept>

<world>
{{world}}
</world>

<characters>
{{characters}}
</characters>

<current_outline>
{{outline}}
</current_outline>

<editor_notes>
{{critique}}
</editor_notes>

Produce an improved chapter-by-chapter outline that addresses every editor note while keeping what already works. Keep the same format: **Chapter N — Title**, a 2–3 sentence synopsis, and principal characters present. Return only the markdown outline.`,
    variables: [
      { name: 'concept', description: 'The story concept' },
      { name: 'world', description: 'The world bible' },
      { name: 'characters', description: 'The cast' },
      { name: 'outline', description: 'The current outline' },
      { name: 'critique', description: 'Editor notes to address' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:foundation:canon',
    name: 'Foundation · World → Canon',
    description: 'Extract structured world canon (locations, items, lore, concepts) from the world bible.',
    feature: 'autopilot',
    phase: 'foundation',
    model: 'claude-sonnet-4-6',
    temperature: 0.3,
    maxTokens: 3000,
    template: `You are extracting structured world canon from a setting bible.

<world>
{{world}}
</world>

<concept>
{{concept}}
</concept>

Return a JSON array — one object per notable world entity (places, organizations/factions, items/artifacts, and key concepts, rules, or systems). DO NOT include characters (people).
[{ "category": "location" | "item" | "lore" | "concept", "name": "<name>", "aliases": ["<alt name>", ...], "summary": "<1-2 sentence overview>", "facts": [{ "label": "...", "value": "..." }] }]

Categories: "location" for places, "item" for objects/artifacts, "lore" for history/myth/factions/organizations, "concept" for rules/systems/abstract ideas. Include 2–5 concrete facts each; "aliases" may be empty. Return ONLY valid JSON.`,
    variables: [
      { name: 'world', description: 'The world bible to structure' },
      { name: 'concept', description: 'The story concept (for grounding)' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:foundation:outline-parse',
    name: 'Foundation · Parse Outline',
    description: 'Convert an outline into a structured chapter list for scaffolding.',
    feature: 'autopilot',
    phase: 'foundation',
    model: 'claude-sonnet-4-6',
    temperature: 0.2,
    maxTokens: 4000,
    template: `You are converting a novel outline into a structured chapter list.

<outline>
{{outline}}
</outline>

Return a JSON array, one object per chapter, IN ORDER:
[{ "title": "<chapter heading, e.g. 'Chapter 1 — The Cartographer'>", "synopsis": "<a 1–3 sentence brief a writer can draft this chapter from: what happens and what changes>" }]

Preserve the outline's chapters exactly — do not invent, merge, or drop chapters. Return ONLY valid JSON.`,
    variables: [{ name: 'outline', description: 'The outline markdown to parse' }],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:foundation:codex',
    name: 'Foundation · Cast → Codex',
    description: 'Extract structured character records (for the Codex) from a cast description.',
    feature: 'autopilot',
    phase: 'foundation',
    model: 'claude-sonnet-4-6',
    temperature: 0.3,
    maxTokens: 3000,
    template: `You are extracting structured character records from a cast description.

<cast>
{{characters}}
</cast>

Return a JSON array — one object per character:
[{ "name": "<full name>", "aliases": ["<nickname>", ...], "summary": "<1-2 sentence overview>", "facts": [{ "label": "Role", "value": "..." }, { "label": "...", "value": "..." }] }]

Include 2–5 concrete facts per character (role, age, occupation, defining trait, key relationship — only what the text supports). "aliases" may be empty. Return ONLY valid JSON.`,
    variables: [{ name: 'characters', description: 'The cast markdown to structure' }],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:evaluation:continuity',
    name: 'Continuity Check',
    description: 'Find places where a scene contradicts established Codex facts.',
    feature: 'evaluation',
    model: 'claude-opus-4-8',
    temperature: 0.2,
    maxTokens: 2000,
    template: `You are a continuity checker for a novel. Compare the scene against the established canon facts and find genuine CONTRADICTIONS — places where the prose states or strongly implies something that conflicts with a fact.

<canon_facts>
{{facts}}
</canon_facts>

<scene>
{{document}}
</scene>

Return a JSON array. Each entry is a real contradiction (not a mere omission):
[{ "entity": "<entity name>", "fact": "<fact label>", "value": "<the canon value>", "issue": "<what the scene says and why it conflicts, one sentence>" }]

Only report clear conflicts. If the scene is consistent (or simply silent) on a fact, do not report it. Return ONLY valid JSON. If there are no contradictions, return [].`,
    variables: [
      { name: 'facts', description: 'Formatted canon facts for entities in the scene' },
      { name: 'document', description: 'The scene prose to check' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:evaluation:professor',
    name: 'Professor Critique',
    description: 'A developmental, margin-notes critique of a scene — the few highest-impact fixes.',
    feature: 'evaluation',
    model: 'claude-opus-4-8',
    temperature: 0.4,
    maxTokens: 2000,
    template: `You are a writing professor giving a developmental critique of a single scene. Be incisive and specific — name the few changes that would most improve it, not a laundry list. Reward what works; don't manufacture problems.

<synopsis>
{{synopsis}}
</synopsis>

<context>
{{context}}
</context>

<scene>
{{document}}
</scene>

Return ONLY JSON:
{ "assessment": "<2-3 sentences: an honest overall read — what works and what holds it back>", "notes": [{ "issue": "<a specific craft problem (structure, characterization, prose, momentum, theme); name where it occurs>", "suggestion": "<a concrete, actionable direction to fix it>" }] }

Give 2–5 notes, ordered by importance. Return ONLY valid JSON.`,
    variables: [
      { name: 'synopsis', description: 'What this scene is meant to do' },
      { name: 'context', description: 'Scene/codex/voice context' },
      { name: 'document', description: 'The scene prose to critique' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:evaluation:compare',
    name: 'Pairwise Compare',
    description: 'Judge which of two versions of the same scene is the stronger prose.',
    feature: 'evaluation',
    model: 'claude-opus-4-8',
    temperature: 0.2,
    maxTokens: 600,
    template: `You are blind-judging which of two versions of the SAME scene is stronger prose. They share the same intended content; judge execution only — prose quality, voice, vividness, pacing, dialogue, and freedom from slop.

<version_a>
{{a}}
</version_a>

<version_b>
{{b}}
</version_b>

Pick the better version. Return ONLY JSON: { "winner": "A" | "B" | "tie", "reason": "<one sentence>" }. Use "tie" only if they are genuinely indistinguishable in quality.`,
    variables: [
      { name: 'a', description: 'Version A' },
      { name: 'b', description: 'Version B' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:evaluation:draft-gate',
    name: 'Draft Quality Gate',
    description: 'Score a chapter of prose for craft quality and return issues + fixes.',
    feature: 'evaluation',
    model: 'claude-opus-4-8',
    temperature: 0.2,
    maxTokens: 1500,
    template: `You are a demanding fiction editor scoring a single chapter of prose for craft quality.

<synopsis>
{{synopsis}}
</synopsis>

<context>
{{context}}
</context>

<chapter>
{{document}}
</chapter>

Score the chapter 0–100 overall, judging: prose quality and rhythm, concrete sensory detail (show, don't tell), scene and dialogue craft, pacing, voice consistency, and freedom from AI "slop" (clichés, filler, hedging, repetition, throat-clearing).

Return ONLY JSON:
{ "overall": <0-100>, "issues": ["<specific craft problem, with a brief quote or location>", ...], "suggestions": ["<specific, actionable fix>", ...] }

Be concrete — vague praise or nitpicks are useless. Return ONLY valid JSON.`,
    variables: [
      { name: 'synopsis', description: 'What this chapter is meant to cover' },
      { name: 'context', description: 'Scene/codex/voice context' },
      { name: 'document', description: 'The chapter prose to score' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:revision:draft',
    name: 'Revise Chapter Draft',
    description: 'Rewrite a chapter to fix craft problems without changing the plot (gate loop).',
    feature: 'autopilot',
    phase: 'revise',
    model: 'claude-opus-4-8',
    temperature: 0.7,
    maxTokens: 8000,
    template: `You are revising a chapter of fiction to fix specific craft problems, without changing the plot.

<synopsis>
{{synopsis}}
</synopsis>

<context>
{{context}}
</context>

<editor_notes>
{{critique}}
</editor_notes>

<chapter>
{{document}}
</chapter>

Rewrite the chapter to address every editor note — sharpen the prose, add concrete detail, tighten dialogue and pacing, and cut slop — while preserving all plot events, character actions, and scene structure. Do not add or remove scenes. Return only the revised chapter prose, no commentary.`,
    variables: [
      { name: 'synopsis', description: 'What this chapter is meant to cover' },
      { name: 'context', description: 'Scene/codex/voice context' },
      { name: 'critique', description: 'Editor notes to address' },
      { name: 'document', description: 'The chapter prose to revise' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:evaluation:voice-drift',
    name: 'Voice Drift Check',
    description: 'Flag where a scene drifts from the established voice fingerprint.',
    feature: 'evaluation',
    model: 'claude-opus-4-8',
    temperature: 0.2,
    maxTokens: 2000,
    template: `You are a prose-voice auditor. Compare the scene against the established VOICE FINGERPRINT and flag where the prose drifts from it.

<voice_fingerprint>
{{voice}}
</voice_fingerprint>

<scene>
{{document}}
</scene>

Report only genuine, specific drifts — places where the prose breaks a rule of the voice (POV, tense, diction/register, rhythm, imagery, dialogue style). Ignore nitpicks and content you can't judge from the fingerprint. Return a JSON array:
[{ "aspect": "<POV | tense | diction | rhythm | imagery | dialogue | pacing>", "issue": "<what drifts and why it breaks the voice, one sentence>", "excerpt": "<short verbatim quote from the scene, <=120 chars>" }]

If the scene is consistent with the voice, return []. Return ONLY valid JSON.`,
    variables: [
      { name: 'voice', description: 'The saved voice fingerprint / style guide' },
      { name: 'document', description: 'The scene prose to audit' },
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
  {
    id: 'builtin:revision:voice',
    name: 'Revise to Voice',
    description: 'Rewrite a scene so its prose conforms to the voice fingerprint (voice debt).',
    feature: 'autopilot',
    phase: 'revise',
    model: 'claude-opus-4-8',
    temperature: 0.5,
    maxTokens: 8000,
    template: `You are a line editor revising a scene to match an established prose voice — without changing what happens.

<voice_fingerprint>
{{voice}}
</voice_fingerprint>

<drift_notes>
{{issues}}
</drift_notes>

<context>
{{context}}
</context>

<document>
{{document}}
</document>

Rewrite the document so its prose conforms to the voice fingerprint, addressing the drift notes. Preserve every plot event, beat, line of dialogue's meaning, and the scene's structure — change only the prose style (rhythm, diction, POV/tense handling, imagery). Do not add or remove story content. Return only the full revised document text, no commentary.`,
    variables: [
      { name: 'voice', description: 'The saved voice fingerprint / style guide' },
      { name: 'issues', description: 'The flagged drift notes to address' },
      { name: 'context', description: 'Scene/codex context' },
      { name: 'document', description: 'Full current document markdown' },
    ],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },

  // ── Reader-panel personas (editable system prompts behind the reader agents) ──
  {
    id: 'builtin:reader:adventurous',
    name: 'Reader · Adventurous',
    description: 'Reader persona: reads for excitement, pace, and surprise.',
    feature: 'evaluation',
    model: 'claude-sonnet-4-6',
    temperature: 0.8,
    maxTokens: 500,
    template: `You are an adventurous fiction reader who loves fast-paced stories, unexpected twists, and compelling hooks. You prioritize excitement, momentum, and whether you'd keep reading. Be direct and specific. 200 words max.`,
    variables: [],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:reader:literary',
    name: 'Reader · Literary',
    description: 'Reader persona: reads for prose, voice, and depth.',
    feature: 'evaluation',
    model: 'claude-sonnet-4-6',
    temperature: 0.8,
    maxTokens: 500,
    template: `You are a literary fiction reader who prizes distinctive prose, thematic depth, and authentic voice. You're sensitive to rhythm, imagery, and subtext. Be specific about what works and what doesn't. 200 words max.`,
    variables: [],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:reader:commercial',
    name: 'Reader · Commercial',
    description: 'Reader persona: reads for marketability and audience appeal.',
    feature: 'evaluation',
    model: 'claude-sonnet-4-6',
    temperature: 0.8,
    maxTokens: 500,
    template: `You are a commercial fiction editor who thinks about market positioning, reader expectations, and genre conventions. You evaluate clarity, hooks, and broad appeal. Be practical and specific. 200 words max.`,
    variables: [],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
  {
    id: 'builtin:reader:skeptic',
    name: 'Reader · Skeptic',
    description: 'Reader persona: hunts for plot holes, inconsistencies, and weak spots.',
    feature: 'evaluation',
    model: 'claude-sonnet-4-6',
    temperature: 0.8,
    maxTokens: 500,
    template: `You are a skeptical reader who actively looks for plot holes, weak character motivation, logical inconsistencies, and prose problems. Be critical and specific — your job is to find what's broken. 200 words max.`,
    variables: [],
    isBuiltin: true,
    createdAt: ISO(),
    modifiedAt: ISO(),
  },
]

// Reader agents tie a persona prompt to a model/temperature. `model: ''` means
// "use the active provider's default model" so the panel works on any backend.
const readerAgent = (id: string, name: string, emoji: string, description: string, promptId: string): AgentTemplate => ({
  id, name, description, category: 'reader',
  systemPromptId: promptId, model: '', temperature: 0.8,
  parameters: { emoji, maxTokens: 500 },
  isBuiltin: true, createdAt: ISO(), modifiedAt: ISO(),
})

export const DEFAULT_AGENTS: AgentTemplate[] = [
  readerAgent('builtin:agent:reader:adventurous', 'Adventurous', '🗺', 'Reads for excitement, pace, and surprise', 'builtin:reader:adventurous'),
  readerAgent('builtin:agent:reader:literary', 'Literary', '📚', 'Reads for prose, voice, and depth', 'builtin:reader:literary'),
  readerAgent('builtin:agent:reader:commercial', 'Commercial', '📈', 'Reads for marketability and audience appeal', 'builtin:reader:commercial'),
  readerAgent('builtin:agent:reader:skeptic', 'Skeptic', '🔍', 'Hunts for plot holes and weak spots', 'builtin:reader:skeptic'),
]

// ── Registry ─────────────────────────────────────────────────────────────────

const STORAGE_KEY_PROMPTS = 'konbini:promptRegistry'
const STORAGE_KEY_AGENTS  = 'konbini:agentRegistry'

function loadFrom<T extends { id: string }>(key: string): T[] {
  try {
    return JSON.parse(window.api.prefs.get(key) ?? '[]') as T[]
  } catch {
    return []
  }
}

function saveTo<T>(key: string, items: T[]): void {
  window.api.prefs.set(key, JSON.stringify(items))
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
    const defaults = DEFAULT_AGENTS.map((a) => this.overrides.get(a.id) ?? a)
    const defaultIds = new Set(DEFAULT_AGENTS.map((a) => a.id))
    const userAgents = [...this.overrides.values()].filter((a) => !defaultIds.has(a.id))
    return [...defaults, ...userAgents]
  }

  byCategory(category: AgentCategory): AgentTemplate[] {
    return this.all().filter((a) => a.category === category)
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

  delete(id: string): void {
    if (DEFAULT_AGENTS.some((a) => a.id === id)) return // can't delete builtins (use reset)
    this.overrides.delete(id)
    saveTo(STORAGE_KEY_AGENTS, [...this.overrides.values()])
  }

  duplicate(id: string): AgentTemplate | null {
    const source = this.get(id)
    if (!source) return null
    const copy: AgentTemplate = {
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
}

// Singletons — one registry per app instance
export const promptRegistry = new PromptRegistry()
export const agentRegistry = new AgentRegistry()
