"use strict";
// electron/NodeProjectService.ts — Node.js fs/promises implementation of the project layer.
// Used by the Electron preload. All paths are real filesystem paths.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.nodeProjectService = exports.NodeProjectService = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const utils_1 = require("../src/shared/utils");
const templates_1 = require("../src/shared/templates");
const importer_1 = require("../src/shared/importer");
const nodeOps_1 = require("../src/shared/nodeOps");
const bundle_1 = require("../src/shared/bundle");
const sync_1 = require("../src/shared/sync");
// ── FS helpers ────────────────────────────────────────────────────────────────
async function readText(dir, ...parts) {
    try {
        return await fs.readFile(path.join(dir, ...parts), 'utf-8');
    }
    catch {
        return null;
    }
}
// Write via temp-file-then-rename so a crash mid-write can never leave a
// truncated .md or manifest behind (rename is atomic on the same filesystem).
async function writeText(dir, content, ...parts) {
    const p = path.join(dir, ...parts);
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${process.pid}`;
    try {
        await fs.writeFile(tmp, content, 'utf-8');
        await fs.rename(tmp, p);
    }
    catch (e) {
        await fs.unlink(tmp).catch(() => { });
        throw e;
    }
}
async function removeFile(dir, ...parts) {
    try {
        await fs.unlink(path.join(dir, ...parts));
    }
    catch { /* ignore */ }
}
async function statMtime(full) {
    try {
        return (await fs.stat(full)).mtimeMs;
    }
    catch {
        return 0;
    }
}
// ── Service ───────────────────────────────────────────────────────────────────
class NodeProjectService {
    projects = new Map();
    paths = new Map(); // projectId → bundle dir
    knownMtime = new Map(); // `${projectId}:${nodeId}` → last mtime we read/wrote
    conflictListeners = new Set();
    /** Subscribe to external-edit conflicts (a .conflict backup was written). */
    onConflict(cb) {
        this.conflictListeners.add(cb);
        return () => { this.conflictListeners.delete(cb); };
    }
    emitConflict(e) {
        for (const cb of this.conflictListeners) {
            try {
                cb(e);
            }
            catch { /* ignore */ }
        }
    }
    // ── Open ────────────────────────────────────────────────────────────────────
    async open(bundlePath) {
        const manifestText = await readText(bundlePath, bundle_1.MANIFEST_FILE);
        if (!manifestText)
            throw new Error('Not a Konbini project (no project.json)');
        const project = JSON.parse(manifestText);
        // Upgrade an older bundle once, on open, so the file on disk stops
        // lagging what we hold in memory.
        const didMigrate = (0, nodeOps_1.migrateProject)(project);
        // Codex/debt/comments live in sidecar files so sync can merge them apart
        // from the manifest; older bundles still carry codex and debt inline.
        const owesSidecars = (0, bundle_1.adoptSidecars)(project, await readText(bundlePath, bundle_1.CODEX_FILE), await readText(bundlePath, bundle_1.DEBT_FILE), await readText(bundlePath, bundle_1.COMMENTS_FILE));
        for (const nodeId of Object.keys(project.docs)) {
            const content = await readText(bundlePath, 'docs', `${nodeId}.md`);
            project.docs[nodeId] = { content: content ?? '', snapshots: project.docs[nodeId]?.snapshots ?? [] };
            this.knownMtime.set(`${project.id}:${nodeId}`, await statMtime(path.join(bundlePath, 'docs', `${nodeId}.md`)));
        }
        this.paths.set(project.id, bundlePath);
        this.projects.set(project.id, project);
        if (didMigrate || owesSidecars) {
            await writeText(bundlePath, (0, bundle_1.serializeCodex)(project.settings.codex ?? []), bundle_1.CODEX_FILE);
            await writeText(bundlePath, (0, bundle_1.serializeDebt)(project.settings.debt ?? []), bundle_1.DEBT_FILE);
            await this.writeManifest(bundlePath, project);
        }
        return project;
    }
    // ── Create ──────────────────────────────────────────────────────────────────
    async create(opts) {
        const bundleName = `${opts.title.replace(/[<>:"/\\|?*]/g, '_')}.konbini`;
        const bundlePath = path.join(opts.location, bundleName);
        await fs.mkdir(path.join(bundlePath, 'docs'), { recursive: true });
        await fs.mkdir(path.join(bundlePath, 'snapshots'), { recursive: true });
        const project = (0, templates_1.buildProjectFromTemplate)(opts.title, opts.template, bundlePath);
        for (const [nodeId, body] of Object.entries(project.docs)) {
            if (body.content) {
                await writeText(bundlePath, body.content, 'docs', `${nodeId}.md`);
            }
        }
        await this.writeManifest(bundlePath, project);
        this.paths.set(project.id, bundlePath);
        this.projects.set(project.id, project);
        return project;
    }
    // ── Import ────────────────────────────────────────────────────────────────────
    async import(opts) {
        const bundleName = `${opts.title.replace(/[<>:"/\\|?*]/g, '_')}.konbini`;
        const bundlePath = path.join(opts.location, bundleName);
        await fs.mkdir(path.join(bundlePath, 'docs'), { recursive: true });
        await fs.mkdir(path.join(bundlePath, 'snapshots'), { recursive: true });
        const project = (0, importer_1.buildProjectFromDocs)(opts.title, bundlePath, opts.docs);
        for (const [nodeId, body] of Object.entries(project.docs)) {
            await writeText(bundlePath, body.content, 'docs', `${nodeId}.md`);
            this.knownMtime.set(`${project.id}:${nodeId}`, await statMtime(path.join(bundlePath, 'docs', `${nodeId}.md`)));
        }
        await this.writeManifest(bundlePath, project);
        this.paths.set(project.id, bundlePath);
        this.projects.set(project.id, project);
        return project;
    }
    // ── Close ───────────────────────────────────────────────────────────────────
    async close(id) {
        const project = this.projects.get(id);
        const p = this.paths.get(id);
        if (project && p) {
            project.modified = new Date().toISOString();
            await this.writeManifest(p, project);
        }
        this.projects.delete(id);
        this.paths.delete(id);
    }
    // ── Doc ─────────────────────────────────────────────────────────────────────
    async readDoc(projectId, nodeId) {
        const p = this.getPath(projectId);
        const content = (await readText(p, 'docs', `${nodeId}.md`)) ?? '';
        this.knownMtime.set(`${projectId}:${nodeId}`, await statMtime(path.join(p, 'docs', `${nodeId}.md`)));
        return content;
    }
    async writeDoc(projectId, nodeId, content) {
        const p = this.getPath(projectId);
        const full = path.join(p, 'docs', `${nodeId}.md`);
        const key = `${projectId}:${nodeId}`;
        // Conflict guard: if the file changed on disk since we last read/wrote it,
        // an external editor (git, Dropbox, vim…) touched it. Preserve that version
        // as a .conflict backup before overwriting, so nothing is silently lost.
        const known = this.knownMtime.get(key) ?? 0;
        if (known) {
            const cur = await statMtime(full);
            if (cur > known + 1) {
                const onDisk = await readText(p, 'docs', `${nodeId}.md`);
                if (onDisk != null && onDisk !== content) {
                    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const file = `${nodeId}.conflict-${stamp}.md`;
                    await writeText(p, onDisk, 'docs', file).catch(() => { });
                    this.emitConflict({ projectId, nodeId, file });
                }
            }
        }
        await writeText(p, content, 'docs', `${nodeId}.md`);
        const proj = this.projects.get(projectId);
        if (proj?.docs[nodeId])
            proj.docs[nodeId].content = content;
        this.knownMtime.set(key, await statMtime(full));
    }
    // ── Node mutations ───────────────────────────────────────────────────────────
    /** The only platform-specific half of a node op: doc-file writes and deletes. */
    nodeIO(dir) {
        return {
            writeDoc: (nodeId, content) => writeText(dir, content, 'docs', `${nodeId}.md`),
            removeDoc: (nodeId) => removeFile(dir, 'docs', `${nodeId}.md`),
        };
    }
    async mutateNode(projectId, op) {
        const p = this.getPath(projectId);
        const proj = this.getProject(projectId);
        await (0, nodeOps_1.applyNodeOp)(proj, op, this.nodeIO(p));
        proj.modified = new Date().toISOString();
        await this.writeManifest(p, proj);
        return { rootIds: proj.rootIds, nodes: proj.nodes, docs: proj.docs };
    }
    // ── Snapshots ────────────────────────────────────────────────────────────────
    async takeSnapshot(projectId, nodeId, title = '', kind = 'manual') {
        const dir = this.getPath(projectId);
        const proj = this.getProject(projectId);
        const content = proj.docs[nodeId]?.content ?? '';
        const snap = { id: (0, utils_1.uid)('snap'), title, takenAt: new Date().toISOString(), content, words: (0, utils_1.wordCount)(content), kind };
        await writeText(dir, content, 'snapshots', nodeId, `${snap.id}.md`);
        if (!proj.docs[nodeId])
            proj.docs[nodeId] = { content, snapshots: [] };
        proj.docs[nodeId].snapshots = [{ ...snap, content: '' }, ...proj.docs[nodeId].snapshots];
        proj.modified = new Date().toISOString();
        await this.writeManifest(dir, proj);
        return snap;
    }
    async restoreSnapshot(projectId, nodeId, snapshotId) {
        const dir = this.getPath(projectId);
        const content = await readText(dir, 'snapshots', nodeId, `${snapshotId}.md`);
        if (content === null)
            throw new Error('Snapshot file not found');
        await this.takeSnapshot(projectId, nodeId, 'before restore');
        await this.writeDoc(projectId, nodeId, content);
        const proj = this.getProject(projectId);
        const meta = proj.docs[nodeId]?.snapshots.find(s => s.id === snapshotId);
        return { content, snapshot: meta ? { ...meta, content } : { id: snapshotId, title: '', takenAt: new Date().toISOString(), content, words: (0, utils_1.wordCount)(content) } };
    }
    async listSnapshots(projectId, nodeId) {
        const dir = this.getPath(projectId);
        const proj = this.getProject(projectId);
        const metas = proj.docs[nodeId]?.snapshots ?? [];
        return Promise.all(metas.map(async (m) => {
            const content = await readText(dir, 'snapshots', nodeId, `${m.id}.md`) ?? '';
            return { ...m, content };
        }));
    }
    async deleteSnapshot(projectId, nodeId, snapshotId) {
        const dir = this.getPath(projectId);
        const proj = this.getProject(projectId);
        await removeFile(dir, 'snapshots', nodeId, `${snapshotId}.md`);
        if (proj.docs[nodeId])
            proj.docs[nodeId].snapshots = proj.docs[nodeId].snapshots.filter(s => s.id !== snapshotId);
        await this.writeManifest(dir, proj);
    }
    // ── Compile ──────────────────────────────────────────────────────────────────
    async compile(projectId, rootId, includedIds, format) {
        const dir = this.getPath(projectId);
        const proj = this.getProject(projectId);
        const chapters = [];
        const gather = async (id) => {
            const node = proj.nodes[id];
            if (!node)
                return;
            if (node.type !== 'folder' && includedIds.includes(id)) {
                const content = proj.docs[id]?.content ?? await readText(dir, 'docs', `${id}.md`) ?? '';
                if (content.trim())
                    chapters.push({ title: node.title, content: content.trim() });
            }
            for (const cid of node.childIds)
                await gather(cid);
        };
        await gather(rootId);
        const projectTitle = proj.title.replace(/[<>:"/\\|?*]/g, '_');
        if (format === 'markdown') {
            const combined = chapters.map(c => c.content).join('\n\n---\n\n');
            return { blob: new TextEncoder().encode(combined), filename: `${projectTitle}.md`, format: 'markdown' };
        }
        if (format === 'epub') {
            const { buildEpub } = await Promise.resolve().then(() => __importStar(require('../src/shared/epubBuilder')));
            const blob = await buildEpub({
                title: proj.title,
                author: proj.settings.author,
                language: proj.settings.language,
                chapters: chapters.map((c, i) => ({
                    id: `ch_${String(i + 1).padStart(4, '0')}`,
                    title: c.title,
                    markdown: c.content,
                })),
            });
            return { blob, filename: `${projectTitle}.epub`, format: 'epub' };
        }
        const { buildDocx } = await Promise.resolve().then(() => __importStar(require('../src/shared/docxBuilder')));
        const blob = await buildDocx({
            title: proj.title,
            author: proj.settings.author,
            style: format === 'shunn' ? 'shunn' : 'manuscript',
            chapters: chapters.map(c => ({ title: c.title, markdown: c.content })),
        });
        const suffix = format === 'shunn' ? '.manuscript.docx' : '.docx';
        return { blob, filename: `${projectTitle}${suffix}`, format };
    }
    // ── Settings / Codex ─────────────────────────────────────────────────────────
    async saveSettings(projectId, patch) {
        const dir = this.getPath(projectId);
        const proj = this.getProject(projectId);
        Object.assign(proj.settings, patch);
        proj.modified = new Date().toISOString();
        await this.writeManifest(dir, proj);
    }
    async saveCodex(projectId, entries) {
        const dir = this.getPath(projectId);
        const proj = this.getProject(projectId);
        proj.settings.codex = entries;
        proj.modified = new Date().toISOString();
        // Sidecar write only — the codex is no longer part of the manifest.
        await writeText(dir, (0, bundle_1.serializeCodex)(entries), bundle_1.CODEX_FILE);
    }
    async saveDebt(projectId, items) {
        const dir = this.getPath(projectId);
        const proj = this.getProject(projectId);
        proj.settings.debt = items;
        proj.modified = new Date().toISOString();
        await writeText(dir, (0, bundle_1.serializeDebt)(items), bundle_1.DEBT_FILE);
    }
    async saveComments(projectId, comments) {
        const dir = this.getPath(projectId);
        const proj = this.getProject(projectId);
        proj.settings.comments = comments;
        proj.modified = new Date().toISOString();
        await writeText(dir, (0, bundle_1.serializeComments)(comments), bundle_1.COMMENTS_FILE);
    }
    // ── Aux files ─────────────────────────────────────────────────────────────
    async readAux(projectId, name) {
        if (!(0, utils_1.isValidAuxName)(name))
            throw new Error(`Invalid aux file name: ${name}`);
        const dir = this.getPath(projectId);
        return readText(dir, 'aux', name);
    }
    async writeAux(projectId, name, content) {
        if (!(0, utils_1.isValidAuxName)(name))
            throw new Error(`Invalid aux file name: ${name}`);
        const dir = this.getPath(projectId);
        await writeText(dir, content, 'aux', name);
    }
    async removeAux(projectId, name) {
        if (!(0, utils_1.isValidAuxName)(name))
            throw new Error(`Invalid aux file name: ${name}`);
        const dir = this.getPath(projectId);
        await removeFile(dir, 'aux', name);
    }
    // ── Sync (Tier 0) ─────────────────────────────────────────────────────────
    /** File → mtime for the manifest and every doc; a cheap "did anything move?". */
    async probe(projectId) {
        const dir = this.getPath(projectId);
        const out = {};
        const m = await statMtime(path.join(dir, bundle_1.MANIFEST_FILE));
        if (m)
            out[bundle_1.MANIFEST_FILE] = m;
        try {
            for (const name of await fs.readdir(path.join(dir, 'docs'))) {
                if (!name.endsWith('.md'))
                    continue;
                out[`docs/${name}`] = await statMtime(path.join(dir, 'docs', name));
            }
        }
        catch { /* no docs dir yet */ }
        return out;
    }
    /**
     * Read the bundle straight off disk, ignoring our in-memory copy — this is how
     * we see what an external syncer (Dropbox/iCloud/Syncthing/git) left behind.
     */
    async readBundle(projectId) {
        const dir = this.getPath(projectId);
        const manifestText = await readText(dir, bundle_1.MANIFEST_FILE);
        if (!manifestText)
            throw new Error('Bundle has no project.json');
        const onDisk = JSON.parse(manifestText);
        (0, nodeOps_1.migrateProject)(onDisk); // an older bundle may predate per-node revs
        const docs = {};
        for (const nodeId of Object.keys(onDisk.docs ?? {})) {
            docs[nodeId] = { content: (await readText(dir, 'docs', `${nodeId}.md`)) ?? '' };
        }
        return { rootIds: onDisk.rootIds, nodes: onDisk.nodes, docs };
    }
    /**
     * Persist a merge. Divergent remote text is written beside the document as
     * `<id>.conflict-<stamp>.md` — never discarded — using the same convention as
     * an external-edit conflict, so one resolution surface covers both.
     */
    async applyMerge(projectId, merged) {
        const dir = this.getPath(projectId);
        const proj = this.getProject(projectId);
        const written = [];
        for (const [docId, text] of Object.entries(merged.conflicts)) {
            const file = (0, sync_1.conflictFileName)(docId);
            await writeText(dir, text, 'docs', file);
            written.push(file);
        }
        for (const [docId, content] of Object.entries(merged.docs)) {
            await writeText(dir, content, 'docs', `${docId}.md`);
            if (proj.docs[docId])
                proj.docs[docId].content = content;
            else
                proj.docs[docId] = { content, snapshots: [] };
        }
        // Drop docs the merge decided are gone.
        for (const docId of Object.keys(proj.docs)) {
            if (!merged.nodes[docId]) {
                delete proj.docs[docId];
                await removeFile(dir, 'docs', `${docId}.md`);
            }
        }
        proj.nodes = merged.nodes;
        proj.rootIds = merged.rootIds;
        proj.modified = new Date().toISOString();
        await this.writeManifest(dir, proj);
        return written;
    }
    // ── Helpers ──────────────────────────────────────────────────────────────────
    getPath(projectId) {
        const p = this.paths.get(projectId);
        if (!p)
            throw new Error(`Project not open: ${projectId}`);
        return p;
    }
    /** Public bundle path for the open project (used to run a local agent in it). */
    bundlePath(projectId) {
        return this.paths.get(projectId) ?? null;
    }
    getProject(projectId) {
        const p = this.projects.get(projectId);
        if (!p)
            throw new Error(`Project not in cache: ${projectId}`);
        return p;
    }
    async writeManifest(dir, project) {
        await writeText(dir, (0, bundle_1.serializeManifest)(project), bundle_1.MANIFEST_FILE);
    }
    descendants(proj, id) {
        const acc = [];
        const walk = (i) => { for (const c of proj.nodes[i]?.childIds ?? []) {
            acc.push(c);
            walk(c);
        } };
        walk(id);
        return acc;
    }
}
exports.NodeProjectService = NodeProjectService;
exports.nodeProjectService = new NodeProjectService();
