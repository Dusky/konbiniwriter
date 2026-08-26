"use strict";
// shared/utils.ts — pure helpers, no Node/DOM deps
Object.defineProperty(exports, "__esModule", { value: true });
exports.LABEL_ORDER = exports.LABEL_META = exports.STATUS_ORDER = exports.STATUS_META = void 0;
exports.uid = uid;
exports.wordCount = wordCount;
exports.charCount = charCount;
exports.isValidAuxName = isValidAuxName;
exports.describeLocation = describeLocation;
exports.manuscriptText = manuscriptText;
exports.relTime = relTime;
exports.fmtWords = fmtWords;
exports.fmtKey = fmtKey;
let _uid = 0;
/**
 * Per-process entropy, mixed into every id.
 *
 * Without it an id is time + a counter that restarts at 0 on every reload, so
 * two devices creating a node in the same millisecond from a cold start produce
 * the *same* id. Cross-device sync merges the node tree per id, so a collision
 * silently fuses two different scenes into one. Invariant 6 says node ids are
 * stable and never reused; this is what makes that true rather than likely.
 */
const _salt = (() => {
    const g = globalThis;
    if (g.crypto?.getRandomValues) {
        return g.crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    }
    return Math.floor(Math.random() * 0xffffffff).toString(36);
})();
function uid(prefix = 'id') {
    _uid += 1;
    return `${prefix}-${Date.now().toString(36)}-${_salt}-${_uid.toString(36)}`;
}
function stripMd(s) {
    return (s || '')
        .replace(/`{1,3}[^`]*`{1,3}/g, ' ')
        .replace(/[#>*_~\-[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
/**
 * Word count, memoised on the exact text.
 *
 * This is called far more often than it looks. The status bar totals the whole
 * manuscript, every binder folder row sums its subtree, and the outliner,
 * corkboard and compile picker each count per row — and all of them re-run on
 * every keystroke, because typing replaces the `project` object identity and
 * re-renders the tree. Measured on a 300-node / 211k-word project, that was
 * ~40ms of pure recounting per keypress on top of everything else.
 *
 * Caching on the string is safe (the function is pure) and costs almost no
 * memory: the store already holds every document's text, so the keys are
 * strings that exist anyway. Only superseded revisions are retained, and the
 * bound below evicts those.
 */
const WC_CACHE_MAX = 1000;
const wcCache = new Map();
function wordCount(s) {
    if (!s)
        return 0;
    const hit = wcCache.get(s);
    if (hit !== undefined)
        return hit;
    const t = stripMd(s);
    const n = t ? t.split(/\s+/).filter(Boolean).length : 0;
    // Plain FIFO eviction — Map iterates in insertion order. An LRU would buy
    // little here: the working set is "documents currently in the project".
    if (wcCache.size >= WC_CACHE_MAX) {
        const oldest = wcCache.keys().next().value;
        if (oldest !== undefined)
            wcCache.delete(oldest);
    }
    wcCache.set(s, n);
    return n;
}
function charCount(s) {
    return (s || '').length;
}
// Validates names for window.api.aux.* (project "aux" files, e.g. chat.json).
// Guards against path traversal — no slashes, dots-only, or leading dot.
const AUX_NAME_RE = /^[\w][\w.-]*$/;
function isValidAuxName(name) {
    return AUX_NAME_RE.test(name) && !name.includes('..');
}
/**
 * A project's location, as a person would say it.
 *
 * OPFS bundles are addressed `opfs:<projectId>`, which the launch screen was
 * printing verbatim — "opfs:shots" under the project title, which tells a
 * novelist nothing. Real paths are already readable and pass through untouched.
 */
function describeLocation(location) {
    if (!location)
        return '';
    if (location.startsWith('opfs:'))
        return 'In this browser';
    if (location === 'browser-pick')
        return 'On this computer';
    return location;
}
/**
 * Prose on its way out of Konbini.
 *
 * `[[Reiko]]` means something inside the app — a link to a codex entry, a chip
 * in the editor, an entry in the mention index — and nothing at all in a
 * manuscript. Compile used to join raw document content, so the Shunn preview,
 * the format labelled "what agents expect", read
 * `a hum [[Reiko]] had stopped hearing`.
 *
 * Only the app's own syntax is removed. Markdown emphasis, headings and the
 * rest are the *output* format for the Markdown export and the input the DOCX
 * and EPUB builders parse, so they must survive untouched — this is not
 * `speakableText`, which flattens everything for a synthesiser.
 *
 * `[[Target|Display]]` resolves to the display text, since that is what a
 * reader was meant to see. (`speakableText` keeps the target instead; a
 * synthesiser is reading the link, not the sentence.)
 */
function manuscriptText(raw) {
    return raw.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_all, target, display) => {
        const shown = (display ?? '').trim();
        return shown || target.trim();
    });
}
function relTime(ms) {
    const d = (Date.now() - ms) / 1000;
    if (d < 60)
        return 'just now';
    if (d < 3600)
        return `${Math.floor(d / 60)} min ago`;
    if (d < 86400) {
        const h = Math.floor(d / 3600);
        return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
    }
    const days = Math.floor(d / 86400);
    if (days === 1)
        return 'yesterday';
    if (days < 30)
        return `${days} days ago`;
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtWords(n) {
    if (n >= 1000)
        return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}
/** Platform-specific key chord formatting. */
function fmtKey(combo, platform) {
    const mac = platform === 'darwin';
    const map = mac
        ? { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', enter: '⏎', delete: '⌫' }
        : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl', enter: 'Enter', delete: 'Del' };
    const parts = combo.split('+').map((t) => map[t] ?? t.toUpperCase());
    const dedup = parts.filter((p, i) => i === 0 || p !== parts[i - 1]);
    return mac ? dedup.join('') : dedup.join('+');
}
exports.STATUS_META = {
    idea: { label: 'Idea', color: 'var(--st-idea)' },
    todo: { label: 'To Do', color: 'var(--st-todo)' },
    inprogress: { label: 'In Progress', color: 'var(--st-prog)' },
    draft: { label: 'First Draft', color: 'var(--st-draft)' },
    revised: { label: 'Revised', color: 'var(--st-rev)' },
    final: { label: 'Final', color: 'var(--st-final)' },
};
exports.STATUS_ORDER = ['idea', 'todo', 'inprogress', 'draft', 'revised', 'final'];
exports.LABEL_META = {
    none: { label: 'No Label', color: 'transparent' },
    scene: { label: 'Scene', color: 'oklch(0.62 0.11 300)' },
    chapter: { label: 'Chapter', color: 'oklch(0.62 0.10 250)' },
    note: { label: 'Note', color: 'oklch(0.64 0.09 190)' },
    character: { label: 'Character', color: 'oklch(0.66 0.12 70)' },
    idea: { label: 'Idea', color: 'oklch(0.64 0.12 20)' },
};
exports.LABEL_ORDER = ['none', 'scene', 'chapter', 'note', 'character', 'idea'];
