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
        const manifestText = await readText(bundlePath, 'project.json');
        if (!manifestText)
            throw new Error('Not a Konbini project (no project.json)');
        const project = JSON.parse(manifestText);
        for (const nodeId of Object.keys(project.docs)) {
            const content = await readText(bundlePath, 'docs', `${nodeId}.md`);
            project.docs[nodeId] = { content: content ?? '', snapshots: project.docs[nodeId]?.snapshots ?? [] };
            this.knownMtime.set(`${project.id}:${nodeId}`, await statMtime(path.join(bundlePath, 'docs', `${nodeId}.md`)));
        }
        this.paths.set(project.id, bundlePath);
        this.projects.set(project.id, project);
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
    async mutateNode(projectId, op) {
        const p = this.getPath(projectId);
        const proj = this.getProject(projectId);
        await this.applyOp(proj, op, p);
        proj.modified = new Date().toISOString();
        await this.writeManifest(p, proj);
        return { rootIds: proj.rootIds, nodes: proj.nodes, docs: proj.docs };
    }
    async applyOp(proj, op, dir) {
        switch (op.type) {
            case 'create': {
                const id = (0, utils_1.uid)(op.nodeType);
                proj.nodes[id] = {
                    id, type: op.nodeType,
                    title: op.title ?? (op.nodeType === 'folder' ? 'New Folder' : op.nodeType === 'scene' ? 'New Scene' : 'New Document'),
                    parentId: op.parentId, childIds: [], expanded: op.nodeType === 'folder',
                    meta: { label: op.nodeType === 'scene' ? 'scene' : 'none', status: 'todo', synopsis: '', target: 0, includeInCompile: op.nodeType !== 'folder' },
                    ext: { _newId: id },
                };
                if (op.nodeType !== 'folder') {
                    proj.docs[id] = { content: '', snapshots: [] };
                    await writeText(dir, '', 'docs', `${id}.md`);
                }
                if (op.parentId == null) {
                    proj.rootIds.splice(op.atIndex ?? proj.rootIds.length, 0, id);
                }
                else {
                    const parent = proj.nodes[op.parentId];
                    parent.childIds.splice(op.atIndex ?? parent.childIds.length, 0, id);
                    parent.expanded = true;
                }
                break;
            }
            case 'rename':
                if (proj.nodes[op.id])
                    proj.nodes[op.id].title = op.title;
                break;
            case 'setProjectTitle':
                proj.title = op.title;
                break;
            case 'move': {
                const node = proj.nodes[op.id];
                if (!node || op.id === op.newParentId)
                    break;
                if (op.newParentId != null && this.descendants(proj, op.id).includes(op.newParentId))
                    break;
                if (node.parentId == null)
                    proj.rootIds = proj.rootIds.filter(x => x !== op.id);
                else {
                    const old = proj.nodes[node.parentId];
                    if (old)
                        old.childIds = old.childIds.filter(x => x !== op.id);
                }
                node.parentId = op.newParentId;
                if (op.newParentId == null)
                    proj.rootIds.splice(op.atIndex, 0, op.id);
                else {
                    const np = proj.nodes[op.newParentId];
                    if (np) {
                        np.childIds.splice(op.atIndex, 0, op.id);
                        np.expanded = true;
                    }
                }
                break;
            }
            case 'duplicate': {
                const cloneRec = async (srcId, parentId) => {
                    const src = proj.nodes[srcId];
                    const nid = (0, utils_1.uid)(src.type);
                    proj.nodes[nid] = { ...src, id: nid, parentId, childIds: [], title: src.title + ' copy', meta: { ...src.meta }, ext: { ...src.ext } };
                    if (proj.docs[srcId]) {
                        const content = proj.docs[srcId].content;
                        proj.docs[nid] = { content, snapshots: [] };
                        await writeText(dir, content, 'docs', `${nid}.md`);
                    }
                    proj.nodes[nid].childIds = await Promise.all(src.childIds.map(c => cloneRec(c, nid)));
                    return nid;
                };
                const src = proj.nodes[op.id];
                const newId = await cloneRec(op.id, src.parentId);
                if (src.parentId == null) {
                    const i = proj.rootIds.indexOf(op.id);
                    proj.rootIds.splice(i + 1, 0, newId);
                }
                else {
                    const par = proj.nodes[src.parentId];
                    const i = par.childIds.indexOf(op.id);
                    par.childIds.splice(i + 1, 0, newId);
                }
                break;
            }
            case 'trash': {
                const node = proj.nodes[op.id];
                if (!node || !proj.trashId || node.parentId === proj.trashId)
                    break;
                if (node.parentId == null)
                    proj.rootIds = proj.rootIds.filter(x => x !== op.id);
                else {
                    const old = proj.nodes[node.parentId];
                    if (old)
                        old.childIds = old.childIds.filter(x => x !== op.id);
                }
                node.parentId = proj.trashId;
                proj.nodes[proj.trashId].childIds.push(op.id);
                proj.nodes[proj.trashId].expanded = true;
                break;
            }
            case 'delete': {
                const kill = [op.id, ...this.descendants(proj, op.id)];
                const node = proj.nodes[op.id];
                if (!node)
                    break;
                if (node.parentId == null)
                    proj.rootIds = proj.rootIds.filter(x => x !== op.id);
                else {
                    const old = proj.nodes[node.parentId];
                    if (old)
                        old.childIds = old.childIds.filter(x => x !== op.id);
                }
                for (const k of kill) {
                    await removeFile(dir, 'docs', `${k}.md`);
                    delete proj.nodes[k];
                    delete proj.docs[k];
                }
                break;
            }
            case 'updateMeta':
                if (proj.nodes[op.id])
                    proj.nodes[op.id].meta = { ...proj.nodes[op.id].meta, ...op.patch };
                break;
            case 'setExpanded':
                if (proj.nodes[op.id])
                    proj.nodes[op.id].expanded = op.expanded;
                break;
            case 'setTree':
                // Undo/redo: replace the whole tree; docs are left untouched.
                proj.rootIds = op.rootIds;
                proj.nodes = op.nodes;
                break;
        }
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
                chapters: chapters.map((c, i) => ({
                    id: `ch_${String(i + 1).padStart(4, '0')}`,
                    title: c.title,
                    markdown: c.content,
                })),
            });
            return { blob, filename: `${projectTitle}.epub`, format: 'epub' };
        }
        const combined = chapters.map(c => c.content).join('\n\n---\n\n');
        const { Document, Paragraph, TextRun, Packer } = await Promise.resolve().then(() => __importStar(require('docx')));
        const paras = combined.split('\n').map(line => {
            const h = line.match(/^(#{1,3})\s+(.+)$/);
            if (h)
                return new Paragraph({ text: h[2], heading: h[1].length === 1 ? 'Heading1' : h[1].length === 2 ? 'Heading2' : 'Heading3' });
            return new Paragraph({ children: [new TextRun(line)] });
        });
        const doc = new Document({ sections: [{ children: paras }] });
        const blob = await Packer.toBuffer(doc);
        return { blob: new Uint8Array(blob), filename: `${projectTitle}.docx`, format: 'docx' };
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
        await this.writeManifest(dir, proj);
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
    // ── Helpers ──────────────────────────────────────────────────────────────────
    getPath(projectId) {
        const p = this.paths.get(projectId);
        if (!p)
            throw new Error(`Project not open: ${projectId}`);
        return p;
    }
    getProject(projectId) {
        const p = this.projects.get(projectId);
        if (!p)
            throw new Error(`Project not in cache: ${projectId}`);
        return p;
    }
    async writeManifest(dir, project) {
        const slim = {
            ...project,
            docs: Object.fromEntries(Object.entries(project.docs).map(([k, v]) => [k, { snapshots: v.snapshots.map(s => ({ ...s, content: '' })) }])),
        };
        await writeText(dir, JSON.stringify(slim, null, 2), 'project.json');
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
