"use strict";
// bundle.ts — how a .konbini bundle is laid out on disk.
//
//   Book.konbini/
//     project.json   manifest: node tree, rootIds, settings
//     codex.json     story bible (sidecar)
//     debt.json      propagation-debt inbox (sidecar)
//     comments.json  margin notes, anchored to spans of prose (sidecar)
//     docs/<id>.md   prose, one file per node
//     snapshots/     version history
//     aux/*.json     derived caches (quality, slop, voice, chat)
//
// Codex, debt, and comments are *sidecars*, not part of the manifest, for two
// reasons: cross-device sync can then merge them independently instead of
// losing one device's character edits to the other's chapter rename; and they
// sit at the bundle root rather than under aux/ because they're primary content
// a writer would be horrified to lose — aux/ is the disposable-cache tier.
//
// Pure: imported by both the renderer and Electron main.
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeComments = exports.serializeDebt = exports.serializeCodex = exports.COMMENTS_FILE = exports.DEBT_FILE = exports.CODEX_FILE = exports.MANIFEST_FILE = void 0;
exports.slimManifest = slimManifest;
exports.serializeManifest = serializeManifest;
exports.adoptSidecars = adoptSidecars;
exports.MANIFEST_FILE = 'project.json';
exports.CODEX_FILE = 'codex.json';
exports.DEBT_FILE = 'debt.json';
exports.COMMENTS_FILE = 'comments.json';
/**
 * The manifest exactly as it should be persisted: doc bodies dropped (prose
 * lives in docs/*.md and snapshot content in snapshots/), and the sidecar
 * collections stripped so they can't be written to two places at once.
 */
function slimManifest(project) {
    // Deliberately pulled out of settings — see the sidecar note above.
    const { codex: _codex, debt: _debt, comments: _comments, ...settings } = project.settings;
    void _codex;
    void _debt;
    void _comments;
    return {
        ...project,
        settings,
        nodes: Object.fromEntries(Object.entries(project.nodes).map(([k, n]) => {
            // `_newId` is how a mutation result points at the node it just created;
            // it belongs to that one round trip and must not survive it. Persisting
            // it meant a reloaded project came back with a live marker on a node
            // from a previous session, which is precisely the state that had AI
            // drafts writing their text into the wrong (or no) document.
            if (n.ext['_newId'] === undefined)
                return [k, n];
            const { _newId: _drop, ...ext } = n.ext;
            void _drop;
            return [k, { ...n, ext }];
        })),
        docs: Object.fromEntries(Object.entries(project.docs).map(([k, v]) => [
            k,
            { snapshots: v.snapshots.map((s) => ({ ...s, content: '' })) },
        ])),
    };
}
function serializeManifest(project) {
    return JSON.stringify(slimManifest(project), null, 2);
}
function parseArray(raw) {
    if (!raw)
        return null;
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v : null;
    }
    catch {
        return null;
    }
}
const serializeCodex = (entries) => JSON.stringify(entries, null, 2);
exports.serializeCodex = serializeCodex;
const serializeDebt = (items) => JSON.stringify(items, null, 2);
exports.serializeDebt = serializeDebt;
const serializeComments = (comments) => JSON.stringify(comments, null, 2);
exports.serializeComments = serializeComments;
/**
 * Fold the sidecars back into the in-memory project after reading the manifest.
 *
 * The app model still carries these collections on `settings`, so nothing above
 * the storage layer had to change — only where the bytes live. Older bundles
 * that still have codex/debt inline in the manifest are adopted as-is; the
 * returned flag says a sidecar write is owed, so open() can upgrade the bundle
 * once. Comments were never inline, so a missing file just means none yet.
 *
 * @returns true when the bundle predates the sidecar split and should be rewritten.
 */
function adoptSidecars(project, codexRaw, debtRaw, commentsRaw = null) {
    const codex = parseArray(codexRaw);
    const debt = parseArray(debtRaw);
    // A sidecar on disk always wins; otherwise keep whatever the manifest had.
    const inlineCodex = project.settings.codex;
    const inlineDebt = project.settings.debt;
    project.settings.codex = codex ?? inlineCodex ?? [];
    project.settings.debt = debt ?? inlineDebt ?? [];
    project.settings.comments = parseArray(commentsRaw) ?? [];
    // Owed a migration if either collection had content only in the manifest.
    const codexNeedsMove = codex == null && !!inlineCodex?.length;
    const debtNeedsMove = debt == null && !!inlineDebt?.length;
    return codexNeedsMove || debtNeedsMove;
}
