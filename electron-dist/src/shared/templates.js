"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProjectFromTemplate = buildProjectFromTemplate;
const utils_1 = require("./utils");
function makeNode(id, type, title, parentId, metaOverrides) {
    return {
        id,
        type,
        title,
        parentId,
        childIds: [],
        expanded: type === 'folder',
        meta: {
            label: type === 'scene' ? 'scene' : 'none',
            status: 'todo',
            synopsis: '',
            target: 0,
            includeInCompile: type !== 'folder',
            ...metaOverrides,
        },
        ext: {},
        rev: 1,
        modified: new Date().toISOString(),
    };
}
function buildProjectFromTemplate(title, template, location) {
    const id = (0, utils_1.uid)('proj');
    const now = new Date().toISOString();
    const nodes = {};
    const docs = {};
    let rootIds = [];
    const trashId = (0, utils_1.uid)('trash');
    const addNode = (n, content = '') => {
        nodes[n.id] = n;
        if (n.type !== 'folder')
            docs[n.id] = { content, snapshots: [] };
    };
    const link = (parentId, childIds) => {
        nodes[parentId].childIds = childIds;
        childIds.forEach((cid) => { nodes[cid].parentId = parentId; });
    };
    // Trash is always present
    const trash = makeNode(trashId, 'folder', 'Trash', null, { includeInCompile: false });
    nodes[trashId] = trash;
    if (template === 'blank') {
        const mId = (0, utils_1.uid)('folder');
        const dId = (0, utils_1.uid)('document');
        const m = makeNode(mId, 'folder', 'Manuscript', null, { status: 'inprogress' });
        const d = makeNode(dId, 'document', 'Untitled', mId);
        addNode(m);
        addNode(d);
        link(mId, [dId]);
        rootIds = [mId, trashId];
    }
    else if (template === 'novel') {
        // Structure only — no prose. A new novel project is *your* novel; the
        // template's job is to give it a shape and then get out of the way. The
        // folder synopses are the one place a template can talk to the author
        // without inventing sentences for them.
        const mId = (0, utils_1.uid)('folder');
        const charsId = (0, utils_1.uid)('folder');
        const resId = (0, utils_1.uid)('folder');
        addNode(makeNode(mId, 'folder', 'Manuscript', null, {
            status: 'inprogress',
            synopsis: 'The book itself. Everything under here compiles; everything outside it does not.',
        }));
        const partIds = [];
        const PARTS = [
            ['Part One', 'Setup — the world as it is, and the thing that breaks it.'],
            ['Part Two', 'Confrontation — what it costs to want the thing.'],
            ['Part Three', 'Resolution — what it turns out to have been about.'],
        ];
        PARTS.forEach(([title, synopsis], i) => {
            const pId = (0, utils_1.uid)('folder');
            const cId = (0, utils_1.uid)('folder');
            const sId = (0, utils_1.uid)('scene');
            addNode(makeNode(pId, 'folder', title, mId, { status: 'todo', synopsis }));
            addNode(makeNode(cId, 'folder', `Chapter ${i + 1}`, pId, { label: 'chapter', status: 'todo' }));
            addNode(makeNode(sId, 'scene', 'Scene 1', cId, { label: 'scene', status: 'todo', target: 1500 }));
            link(cId, [sId]);
            link(pId, [cId]);
            partIds.push(pId);
        });
        link(mId, partIds);
        addNode(makeNode(charsId, 'folder', 'Characters', null, {
            synopsis: 'Cast — one document per character. Write [[Their Name]] in your prose and it links here.',
        }));
        addNode(makeNode(resId, 'folder', 'Research', null, {
            synopsis: 'Notes, references, anything you want at hand but not in the book.',
        }));
        rootIds = [mId, charsId, resId, trashId];
    }
    else if (template === 'screenplay') {
        const scriptId = (0, utils_1.uid)('folder');
        const act1Id = (0, utils_1.uid)('folder');
        const sc1Id = (0, utils_1.uid)('scene');
        const script = makeNode(scriptId, 'folder', 'Script', null, { status: 'inprogress' });
        const act1 = makeNode(act1Id, 'folder', 'Act One', scriptId, { label: 'chapter', status: 'todo' });
        const sc1 = makeNode(sc1Id, 'scene', 'Scene 1', act1Id, { label: 'scene', status: 'todo' });
        addNode(script);
        addNode(act1);
        addNode(sc1);
        link(act1Id, [sc1Id]);
        link(scriptId, [act1Id]);
        rootIds = [scriptId, trashId];
    }
    else {
        // nonfiction
        const bookId = (0, utils_1.uid)('folder');
        const ch1Id = (0, utils_1.uid)('folder');
        const sec1Id = (0, utils_1.uid)('document');
        const book = makeNode(bookId, 'folder', 'Book', null, { status: 'inprogress' });
        const ch1 = makeNode(ch1Id, 'folder', 'Chapter 1', bookId, { label: 'chapter', status: 'todo' });
        const sec1 = makeNode(sec1Id, 'document', 'Introduction', ch1Id, { status: 'todo' });
        addNode(book);
        addNode(ch1);
        addNode(sec1);
        link(ch1Id, [sec1Id]);
        link(bookId, [ch1Id]);
        rootIds = [bookId, trashId];
    }
    return {
        schemaVersion: 2,
        id,
        title,
        created: now,
        modified: now,
        rootIds,
        trashId,
        nodes,
        docs,
        settings: { location, template },
    };
}
