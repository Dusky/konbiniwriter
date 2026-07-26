// agentConfig.ts — what the chat assistant is allowed to reconfigure.
//
// This file is the boundary, and it is deliberately a whitelist rather than a
// blocklist: a target that isn't described here cannot be read or written by the
// assistant, no matter what it asks for.
//
// The line it draws is *text the author would otherwise type by hand* versus
// *anything that spends money or changes who you're talking to*. Standing
// instructions, voice fingerprints and prompt templates are craft decisions
// expressed as prose — having the assistant draft them is the same kind of help
// as having it draft a scene, and it lands in the same review queue. Provider,
// API key, model, and token budgets are not on this list and never will be: an
// assistant that can retarget its own endpoint or raise its own spending ceiling
// is a different proposition from one that can suggest a better style guide.
//
// Every write here goes out as a Proposal and is applied by Studio's single
// onApply, so the author sees a diff before anything takes effect.

import type { ID, Project, VoiceProfile } from '@shared/types'
import { promptRegistry } from './PromptRegistry'
import { useProjectStore } from '../store/projectStore'
import { useAIStore } from '../store/aiStore'

export type ConfigTarget =
  /** Standing instructions for this project (travels in the bundle). */
  | 'project-instructions'
  /** Standing instructions for every project (device-local preference). */
  | 'global-instructions'
  /** A named voice profile's style guide. `key` is the profile id or name. */
  | 'voice'
  /** A prompt template. `key` is the prompt id. */
  | 'prompt'

export const CONFIG_TARGETS: ConfigTarget[] = [
  'project-instructions', 'global-instructions', 'voice', 'prompt',
]

/** Human label for the review dialog's heading. */
export interface ConfigSlot {
  target: ConfigTarget
  key?: string
  /** What the review dialog calls this change. */
  label: string
  /** The text as it stands now. */
  current: string
}

export interface ConfigReadDeps {
  project: Project | null
  globalInstructions: string
}

/**
 * Resolve a target (+ key) to a concrete slot, or an error string explaining
 * why not.
 *
 * Returning the reason as a string rather than throwing is deliberate: it goes
 * back to the model as a tool result, and "no voice profile named X — the ones
 * that exist are A, B" is something it can act on, where a stack trace isn't.
 */
export function resolveConfigSlot(
  target: string,
  key: string | undefined,
  deps: ConfigReadDeps,
): ConfigSlot | { error: string } {
  if (!CONFIG_TARGETS.includes(target as ConfigTarget)) {
    return { error: `Unknown setting "${target}". Editable settings are: ${CONFIG_TARGETS.join(', ')}. Provider, API keys, model choice and token budgets are not editable by the assistant.` }
  }
  const t = target as ConfigTarget

  if (t === 'global-instructions') {
    return { target: t, label: 'Global AI instructions', current: deps.globalInstructions }
  }

  if (t === 'project-instructions') {
    if (!deps.project) return { error: 'No project is open.' }
    return {
      target: t,
      label: 'Project AI instructions',
      current: (deps.project.settings.aiInstructions as string | undefined) ?? '',
    }
  }

  if (t === 'voice') {
    if (!deps.project) return { error: 'No project is open.' }
    const profiles = (deps.project.settings.voiceProfiles as VoiceProfile[] | undefined) ?? []
    if (profiles.length === 0) return { error: 'This project has no voice profiles yet. Ask the author to create one first (AI Settings → Voices).' }
    const wanted = (key ?? '').trim().toLowerCase()
    const profile = wanted
      ? profiles.find((p) => p.id === key || p.name.trim().toLowerCase() === wanted)
      : profiles.find((p) => p.id === deps.project!.settings.activeVoiceId) ?? profiles[0]
    if (!profile) {
      return { error: `No voice profile "${key}". This project has: ${profiles.map((p) => p.name).join(', ')}.` }
    }
    return { target: t, key: profile.id, label: `Voice · ${profile.name}`, current: profile.fingerprint }
  }

  // t === 'prompt'
  if (!key) {
    return { error: 'Which prompt? Pass its id, e.g. "builtin:inline:rewrite".' }
  }
  const template = promptRegistry.get(key)
  if (!template) return { error: `No prompt with id "${key}".` }
  return { target: 'prompt', key, label: `Prompt · ${template.name}`, current: template.template }
}

/**
 * The synthetic `docId` a config proposal carries.
 *
 * Proposals are document-shaped, and a setting is not a document. Rather than
 * pretend a node exists, the id is namespaced so nothing can mistake it for one:
 * `project.nodes[…]` misses, which is exactly what the apply path and the debt
 * heuristic both need in order to leave it alone.
 */
export function configDocId(slot: { target: ConfigTarget; key?: string }): ID {
  return `config:${slot.target}${slot.key ? ':' + slot.key : ''}`
}

export function isConfigDocId(docId: string): boolean {
  return docId.startsWith('config:')
}

/**
 * Apply an approved settings change. Returns an error message, or null on success.
 *
 * The stores are read at call time rather than injected because this runs from an
 * apply handler, long after the proposal was made — the profile list or prompt
 * may have moved under it, and a stale closure would write over the wrong thing.
 * Every path re-resolves by id and gives up rather than guessing.
 */
export function applyConfigChange(ref: { target: string; key?: string }, text: string): string | null {
  if (!CONFIG_TARGETS.includes(ref.target as ConfigTarget)) {
    return `Refusing to write an unrecognised setting ("${ref.target}").`
  }
  const projectStore = useProjectStore.getState()
  const aiStore = useAIStore.getState()

  switch (ref.target as ConfigTarget) {
    case 'global-instructions':
      aiStore.setCustomInstructions(text)
      return null

    case 'project-instructions':
      if (!projectStore.project) return 'No project is open.'
      projectStore.setAiInstructions(text)
      return null

    case 'voice': {
      const p = projectStore.project
      if (!p) return 'No project is open.'
      const profiles = (p.settings.voiceProfiles as VoiceProfile[] | undefined) ?? []
      const target = profiles.find((v) => v.id === ref.key)
      if (!target) return 'That voice profile no longer exists — the change was not applied.'
      const now = new Date().toISOString()
      projectStore.saveVoiceProfiles(
        profiles.map((v) => (v.id === target.id ? { ...v, fingerprint: text, modifiedAt: now } : v)),
        p.settings.activeVoiceId as ID | undefined,
      )
      return null
    }

    case 'prompt': {
      if (!ref.key) return 'No prompt id on the change.'
      const template = promptRegistry.get(ref.key)
      if (!template) return 'That prompt no longer exists — the change was not applied.'
      // `save` upserts an override over the built-in default, which is exactly
      // what editing a builtin prompt means here — Reset still restores it.
      promptRegistry.save({ ...template, template: text })
      return null
    }
  }
}
