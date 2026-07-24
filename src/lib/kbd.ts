import { fmtKey } from '@shared/utils'
import { useShellStore } from '../store/shellStore'

// Platform-aware shortcut label. Takes a neutral combo like 'mod+shift+d' and
// renders it for the current OS: ⌘⇧D on macOS, Ctrl+Shift+D elsewhere. Reads the
// platform from the store snapshot (it never changes at runtime), so this is a
// plain function usable in any render or title string — no hook needed.
export const kbd = (combo: string): string =>
  fmtKey(combo, useShellStore.getState().platform)
