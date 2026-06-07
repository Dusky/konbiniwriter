// ─────────────────────────────────────────────────────────────────────────────
// ai-engine.jsx — the opt-in AI layer's OWN store + proposal/hunk engine.
//
// ARCHITECTURE (the Phase-1 seam paying off):
//   • AI state lives in aiStore, persisted separately (konbini_ai_v1).
//   • The AI layer READS the project store but NEVER mutates document text
//     directly — it only calls window.actions.updateContent(), the single
//     document-mutation API. Every AI change becomes a reviewable proposal that
//     lands in the changeset review before anything is written to the binder.
//   • Turn AI off → the studio is byte-for-byte Phase 1.
//
//   MODES (the spine): cowrite | assisted | autopilot — set default posture.
//   COST (BYOK): every call estimates ¢ before and adds to a running tally.
// ─────────────────────────────────────────────────────────────────────────────

const AI_LS_KEY = 'konbini_ai_v2';

function aiDefault() {
  return {
    enabled: false,
    mode: 'cowrite',            // cowrite | assisted | autopilot
    panelOpen: true,
    surface: null,              // null | 'changes' | 'codex' | 'autopilot' | 'debt' | 'settings'
    chat: [],
    scope: 'project',           // project | doc | manuscript
    proposals: [],              // pending/applied/discarded changesets
    reviewingId: null,
    thinking: null,
    cost: 0,                    // running tally, cents
    debt: window.debtSeeds ? window.debtSeeds() : [],
    proofDocId: null,           // doc currently slop-proofed inline
    run: null,                  // active autopilot run
    draftQueue: [],
    routes: Object.assign({}, window.FEATURE_ROUTES),
    keys: { Anthropic: '••••••••live', OpenAI: '', Ollama: 'http://localhost:11434' },
    features: { inline: true, chat: true, scorer: true, judge: true, draft: true, foundation: true },
  };
}
function aiLoad() {
  try {
    const raw = localStorage.getItem(AI_LS_KEY);
    if (raw) { const p = JSON.parse(raw); if (p && typeof p.enabled === 'boolean') return Object.assign(aiDefault(), p); }
  } catch (e) {}
  return aiDefault();
}

const aiStore = (function () {
  let state = aiLoad();
  const listeners = new Set();
  return {
    get: () => state,
    set(u) { state = typeof u === 'function' ? u(state) : { ...state, ...u };
      try { localStorage.setItem(AI_LS_KEY, JSON.stringify(state)); } catch (e) {}
      listeners.forEach((l) => l()); },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
  };
})();

function useAI(selector) {
  const sel = selector || ((s) => s);
  const [snap, setSnap] = React.useState(() => sel(aiStore.get()));
  React.useEffect(() => { const u = () => setSnap(sel(aiStore.get())); u(); return aiStore.subscribe(u); }, []);
  return snap;
}

// ── hunk engine ────────────────────────────────────────────────────────────────
function buildSegments(original, proposed) {
  const diff = window.lineDiff(original, proposed);
  const segs = []; let hunkIdx = 0, i = 0;
  while (i < diff.length) {
    if (diff[i].t === 'ctx') {
      const lines = []; while (i < diff.length && diff[i].t === 'ctx') { lines.push(diff[i].v); i++; }
      segs.push({ type: 'ctx', lines });
    } else {
      const del = [], add = [];
      while (i < diff.length && diff[i].t !== 'ctx') { (diff[i].t === 'del' ? del : add).push(diff[i].v); i++; }
      segs.push({ type: 'hunk', idx: hunkIdx++, del, add });
    }
  }
  return segs;
}
function applySegments(segs, acceptedIdx) {
  const lines = [];
  for (const s of segs) lines.push(...(s.type === 'ctx' ? s.lines : (acceptedIdx.includes(s.idx) ? s.add : s.del)));
  return lines.join('\n');
}
function countHunks(segs) { return segs.filter((s) => s.type === 'hunk').length; }

let _propSeq = 0;
function makeProposal({ docId, command, label, group, original, proposed }) {
  const segs = buildSegments(original, proposed);
  return {
    id: window.uid('prop'), docId, docTitle: store.get().nodes[docId]?.title || docId,
    command, label, group: group || 'Manual edits',
    original, proposed, createdAt: new Date().toISOString(),
    accepted: segs.filter((x) => x.type === 'hunk').map((x) => x.idx),
    nHunks: countHunks(segs), status: 'pending', seq: _propSeq++,
  };
}

// ── AI actions ──────────────────────────────────────────────────────────────
const aiActions = {
  enable(on) { aiStore.set((s) => ({ ...s, enabled: on, panelOpen: on ? true : s.panelOpen, surface: on ? s.surface : null })); },
  setMode(mode) { aiStore.set((s) => ({ ...s, mode })); },
  togglePanel() { aiStore.set((s) => ({ ...s, panelOpen: !s.panelOpen })); },
  openPanel() { aiStore.set((s) => ({ ...s, panelOpen: true })); },
  setSurface(surface) { aiStore.set((s) => ({ ...s, surface })); },
  setScope(scope) { aiStore.set((s) => ({ ...s, scope })); },
  addCost(c) { aiStore.set((s) => ({ ...s, cost: s.cost + c })); },
  setRoute(feature, model) { aiStore.set((s) => ({ ...s, routes: { ...s.routes, [feature]: model } })); },
  setFeature(feature, on) { aiStore.set((s) => ({ ...s, features: { ...s.features, [feature]: on } })); },
  setKey(vendor, v) { aiStore.set((s) => ({ ...s, keys: { ...s.keys, [vendor]: v } })); },

  // CO-WRITE / ASSISTED: create proposal(s)
  propose({ docId, command, label, selection, group, silentReview }) {
    const s = store.get(); const node = s.nodes[docId];
    if (!node || node.type === 'folder') return;
    const original = s.docs[docId]?.content || '';
    const model = aiStore.get().routes.inline;
    aiStore.set((st) => ({ ...st, thinking: { docId, label }, panelOpen: true }));
    setTimeout(() => {
      let proposed;
      if (selection && selection.text && command !== 'lineedit') {
        proposed = original.slice(0, selection.start) + window.transformSelection(command, selection.text) + original.slice(selection.end);
      } else { proposed = window.lineEditProposal(original, docId); }
      const p = makeProposal({ docId, command, label, group, original, proposed });
      aiActions.addCost(window.estimateCost(command, model));
      if (p.nHunks === 0) {
        aiStore.set((st) => ({ ...st, thinking: null, chat: [...st.chat, { role: 'ai', text: 'No changes to suggest — this passage already reads clean.', cites: [] }] }));
        return;
      }
      aiStore.set((st) => ({ ...st, thinking: null,
        proposals: [p, ...st.proposals],
        reviewingId: silentReview ? st.reviewingId : p.id,
        surface: silentReview ? st.surface : 'changes' }));
    }, 800);
  },

  review(id) { aiStore.set((s) => ({ ...s, reviewingId: id, surface: 'changes' })); },
  closeReview() { aiStore.set((s) => ({ ...s, reviewingId: null })); },
  toggleHunk(id, idx) {
    aiStore.set((s) => ({ ...s, proposals: s.proposals.map((p) => p.id === id
      ? { ...p, accepted: p.accepted.includes(idx) ? p.accepted.filter((x) => x !== idx) : [...p.accepted, idx].sort((a, b) => a - b) } : p) }));
  },
  setAllHunks(id, all) {
    aiStore.set((s) => ({ ...s, proposals: s.proposals.map((p) => {
      if (p.id !== id) return p;
      const segs = buildSegments(p.original, p.proposed);
      return { ...p, accepted: all ? segs.filter((x) => x.type === 'hunk').map((x) => x.idx) : [] };
    }) }));
  },

  // THE seam: apply accepted hunks through the Phase-1 document-mutation API.
  apply(id) {
    const p = aiStore.get().proposals.find((x) => x.id === id); if (!p) return;
    const result = applySegments(buildSegments(p.original, p.proposed), p.accepted);
    window.actions.takeSnapshot(p.docId, 'before AI edit');
    window.actions.updateContent(p.docId, result);
    aiActions.maybeDebtFromEdit(p);
    aiStore.set((s) => {
      const remaining = s.proposals.filter((x) => x.id !== id || x.status !== 'pending');
      const next = s.proposals.filter((x) => x.status === 'pending' && x.id !== id)[0];
      return { ...s, reviewingId: next ? next.id : null,
        proposals: s.proposals.map((x) => x.id === id ? { ...x, status: 'applied' } : x) };
    });
  },
  applyGroup(group) {
    const pend = aiStore.get().proposals.filter((p) => p.status === 'pending' && p.group === group);
    pend.forEach((p) => aiActions.apply(p.id));
  },
  discard(id) { aiStore.set((s) => ({ ...s, reviewingId: s.reviewingId === id ? null : s.reviewingId, proposals: s.proposals.filter((x) => x.id !== id) })); },
  discardGroup(group) { aiStore.set((s) => ({ ...s, proposals: s.proposals.filter((p) => !(p.status === 'pending' && p.group === group)) })); },

  // CHAT (scoped)
  chat(text) {
    const q = text.trim(); if (!q) return;
    aiStore.set((s) => ({ ...s, chat: [...s.chat, { role: 'user', text: q }], thinking: { chat: true } }));
    setTimeout(() => {
      const r = window.chatReply(q, store.get());
      aiActions.addCost(window.estimateCost('chat', aiStore.get().routes.chat));
      aiStore.set((s) => ({ ...s, thinking: null, chat: [...s.chat, { role: 'ai', text: r.text, cites: r.cites }] }));
    }, 700);
  },
  clearChat() { aiStore.set((s) => ({ ...s, chat: [] })); },

  // SLOP scorer (inline proofing)
  proof(docId) { aiStore.set((s) => ({ ...s, proofDocId: s.proofDocId === docId ? null : docId }));
    if (aiStore.get().proofDocId === docId) aiActions.addCost(window.estimateCost('scorer', aiStore.get().routes.scorer)); },

  // PROPAGATION debt
  maybeDebtFromEdit(p) {
    // if an applied edit touches an entity alias, raise a debt item (demo heuristic)
    const text = p.proposed;
    for (const eid of window.CODEX_ORDER) {
      const ent = window.CODEX[eid];
      if (p.command === 'lineedit' && ent.aka.some((a) => p.original.includes(a) && !p.proposed.includes(a))) {
        aiActions.raiseDebt({ layer: ent.type, title: `${ENTITY_TYPE[ent.type].label} reference removed: ${ent.name}`,
          detail: `An edit to “${p.docTitle}” dropped a mention of ${ent.name}. Check the codex backlinks are still accurate.`, source: eid });
      }
    }
  },
  raiseDebt(d) {
    const item = { id: window.uid('debt'), createdAt: new Date().toISOString(),
      affected: window.scanMentions(window.CODEX[d.source] || { aka: [] }, store.get()).slice(0, 4).map((m) => ({ docId: m.docId, note: `${m.count} mention${m.count > 1 ? 's' : ''}`, resolved: false })), ...d };
    aiStore.set((s) => ({ ...s, debt: [item, ...s.debt] }));
  },
  resolveAffected(debtId, docId) {
    aiStore.set((s) => ({ ...s, debt: s.debt.map((d) => d.id === debtId
      ? { ...d, affected: d.affected.map((a) => a.docId === docId ? { ...a, resolved: true } : a) } : d) }));
  },
  dismissDebt(debtId) { aiStore.set((s) => ({ ...s, debt: s.debt.filter((d) => d.id !== debtId) })); },

  // edit a codex fact → raises propagation debt across referencing docs
  editEntityFact(eid, key, value) {
    aiActions.raiseDebt({ layer: window.CODEX[eid].type,
      title: `Canon changed: ${window.CODEX[eid].name} — ${key}`,
      detail: `You changed “${key}” to “${value}”. Scenes and the outline referencing ${window.CODEX[eid].name} may now hold stale information.`, source: eid });
  },

  // AUTOPILOT run (per-run checkpoint choice)
  startRun({ scope, checkpoint, cap }) {
    const run = { id: window.uid('run'), scope, checkpoint, cap, startedAt: Date.now(),
      phaseIdx: 0, phases: window.PIPELINE.map((p) => ({ id: p.id, label: p.label, status: 'pending' })),
      spent: 0, status: 'running', log: [] };
    aiStore.set((s) => ({ ...s, run, surface: 'autopilot' }));
    aiActions._tickRun();
  },
  _tickRun() {
    const st = aiStore.get(); const run = st.run; if (!run || run.status !== 'running') return;
    const i = run.phaseIdx;
    if (i >= run.phases.length) { aiStore.set((s) => ({ ...s, run: { ...s.run, status: 'done' } })); return; }
    // mark current running
    aiStore.set((s) => ({ ...s, run: { ...s.run, phases: s.run.phases.map((p, k) => k === i ? { ...p, status: 'running' } : p) } }));
    setTimeout(() => {
      const cur = aiStore.get().run; if (!cur || cur.status !== 'running') return;
      const phaseCost = window.estimateCost('foundation', cur.scope === 'local' ? 'ollama-local' : 'claude-sonnet') * (3 + i);
      aiActions.addCost(phaseCost);
      aiStore.set((s) => ({ ...s, run: { ...s.run, spent: s.run.spent + phaseCost,
        phases: s.run.phases.map((p, k) => k === i ? { ...p, status: 'done' } : p),
        log: [...s.run.log, `${window.PIPELINE[i].label} complete · ${window.fmtCost(phaseCost)}`] } }));
      const next = aiStore.get().run;
      // drafting phase seeds the queue + a sample proposal into changeset review
      if (window.PIPELINE[i].id === 'draft') aiActions._seedDraftQueue();
      if (window.PIPELINE[i].id === 'revise') aiActions._seedRevisionProposals();
      if (next.checkpoint === 'pause') {
        aiStore.set((s) => ({ ...s, run: { ...s.run, status: 'paused', phaseIdx: i + 1 } }));
      } else {
        aiStore.set((s) => ({ ...s, run: { ...s.run, phaseIdx: i + 1 } }));
        aiActions._tickRun();
      }
    }, 1100);
  },
  resumeRun() { aiStore.set((s) => ({ ...s, run: { ...s.run, status: 'running' } })); aiActions._tickRun(); },
  stopRun() { aiStore.set((s) => ({ ...s, run: s.run ? { ...s.run, status: 'stopped' } : null })); },
  clearRun() { aiStore.set((s) => ({ ...s, run: null })); },
  _seedDraftQueue() {
    aiStore.set((s) => ({ ...s, draftQueue: window.DRAFT_QUEUE_SEED.map((d) => ({ ...d })) }));
    // simulate drafting each queued chapter
    window.DRAFT_QUEUE_SEED.forEach((d, k) => {
      setTimeout(() => {
        const score = 72 + ((k * 11) % 18);
        const kept = score >= 78;
        aiStore.set((s) => ({ ...s, draftQueue: s.draftQueue.map((q) => q.docId === d.docId
          ? { ...q, status: kept ? 'kept' : 'retrying', score, retries: kept ? 0 : 1 } : q) }));
        if (!kept) setTimeout(() => aiStore.set((s) => ({ ...s, draftQueue: s.draftQueue.map((q) => q.docId === d.docId ? { ...q, status: 'kept', score: score + 9, retries: 1 } : q) })), 1200);
      }, 700 + k * 900);
    });
  },
  _seedRevisionProposals() {
    // revision creates proposals that flow into changeset review, grouped by the run
    const s = store.get();
    [['s1', 'Autopilot · Revision brief'], ['s2', 'Autopilot · Revision brief']].forEach(([docId, group]) => {
      const original = s.docs[docId]?.content || '';
      const proposed = window.lineEditProposal(original, docId);
      const p = makeProposal({ docId, command: 'lineedit', label: 'Rewrite from brief', group, original, proposed });
      if (p.nHunks > 0) aiStore.set((st) => ({ ...st, proposals: [p, ...st.proposals] }));
    });
  },

  resetAI() { localStorage.removeItem(AI_LS_KEY); aiStore.set(() => aiDefault()); },

  // clear project-scoped AI artifacts when switching projects (keeps enabled/keys/cost)
  resetForProject(projectId) {
    aiStore.set((s) => ({
      ...s, proposals: [], reviewingId: null, run: null, draftQueue: [],
      surface: null, proofDocId: null, thinking: null, chat: [],
      debt: projectId === 'proj-midnight-aisle' && window.debtSeeds ? window.debtSeeds() : [],
    }));
  },
};

Object.assign(window, { aiStore, useAI, aiActions, buildSegments, applySegments, countHunks });
