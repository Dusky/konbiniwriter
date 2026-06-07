// ─────────────────────────────────────────────────────────────────────────────
// ai-data.jsx — Phase 2 canned content. The "AI" is simulated: deterministic
// generators + a hand-authored codex for the sample novel. Swapping in real
// Claude calls means replacing generateProposal()/chatReply() bodies only.
// ─────────────────────────────────────────────────────────────────────────────

// ── Codex: entities the future AI would extract. aka[] drives live mention scan.
const CODEX = {
  reiko: {
    id: 'reiko', name: 'Reiko Tanaka', type: 'character', glyph: '人',
    aka: ['Reiko'], linkId: 'ch_reiko',
    fields: { Role: 'Night-shift clerk · narrator', Age: '22', Status: 'Alive (so far)' },
    summary: 'The reader\'s anchor. An art-school dropout who took the graveyard shift to avoid sleeping. Observant, sceptical, keeps a logbook. Her arc bends from denial toward acknowledging Aisle Nine — and the back door she\'s been warned never to answer.',
    flags: [],
  },
  nightmgr: {
    id: 'nightmgr', name: 'The Night Manager', type: 'character', glyph: '人',
    aka: ['Night Manager'], linkId: 'ch_manager',
    fields: { Role: 'Trained Reiko', Status: 'Absent — never re-rostered' },
    summary: 'Trained Reiko in a single shift and was never seen again. The logbook is in his handwriting; he taught her to record the times. A structural absence the plot leans on.',
    flags: [{ severity: 'warn', text: 'Never described physically. If he returns in Part Two, decide his appearance now so it stays consistent.', docId: 'ch_manager' }],
  },
  womanwhite: {
    id: 'womanwhite', name: 'The Woman in White', type: 'character', glyph: '人',
    aka: ['Woman in White'], linkId: 'ch_woman',
    fields: { Arrives: '3:33 a.m.', Buys: 'One bottle of milk — never two', Rule: 'Do not follow her' },
    summary: 'A nightly apparition who buys a single bottle of milk and asks whether the bathroom is occupied. It always is. Tightly bound to the 3:33 hour and the bathroom beat (Aka Manto).',
    flags: [{ severity: 'info', text: 'Consistent: arrives 3:33 in “The Woman in White”; matches the ushimitsu-doki note in Research.', docId: 's3' }],
  },
  nori: {
    id: 'nori', name: 'Nori-san', type: 'character', glyph: '人',
    aka: ['Nori-san', 'Nori'], linkId: null,
    fields: { Role: 'Regular customer', Warns: 'Never answer the back door' },
    summary: 'An old man who reads the same magazine every night and delivers the rule about the back door. Currently a stub (scene “Nori-san” is unwritten).',
    flags: [{ severity: 'warn', text: 'Referenced as a character but the scene is empty (status: To Do). No body text to scan yet.', docId: 's4' }],
  },
  aisle9: {
    id: 'aisle9', name: 'Aisle Nine', type: 'location', glyph: '場',
    aka: ['Aisle Nine', 'ninth aisle', 'ninth'], linkId: null,
    fields: { Nature: 'Anomalous aisle', Appears: 'Where the mop closet should be', Tell: 'Cold as a held breath' },
    summary: 'A ninth aisle in an eight-aisle store, over-lit and impossibly deep, surfacing at ~3 a.m. Holds a bento dated tomorrow. The novel\'s central uncanny space.',
    flags: [{ severity: 'info', text: 'Eight aisles established in “Aisle Nine” and the Research floor plan — the ninth is the anomaly. Consistent.', docId: 'r1' }],
  },
  sunnymart: {
    id: 'sunnymart', name: 'Sunny-Mart', type: 'location', glyph: '場',
    aka: ['Sunny-Mart'], linkId: 'r1',
    fields: { Type: 'All-night konbini', Layout: 'Eight aisles · register front-left', Hazard: 'The back door' },
    summary: 'The convenience store that contains the story. Fluorescent, never quite warm. The setting is a character: it keeps a customer it never rang up.',
    flags: [],
  },
  backdoor: {
    id: 'backdoor', name: 'The Back Door', type: 'lore', glyph: '物',
    aka: ['back door'], linkId: null,
    fields: { Rule: 'Never answer it', Source: 'Nori-san' },
    summary: 'A standing prohibition more than an object yet. Planted by Nori-san and Reiko\'s stated fear. Unpaid Chekhov\'s gun — must fire by the end.',
    flags: [{ severity: 'warn', text: 'Set up (Reiko\'s fear; Nori-san\'s warning) but never paid off in existing scenes. Plan the payoff in Part Two.', docId: 'ch_reiko' }],
  },
  hour333: {
    id: 'hour333', name: 'The 3:33 Hour', type: 'lore', glyph: '物',
    aka: ['3:33', 'hour of the ox', 'ushimitsu'], linkId: 'r2',
    fields: { Aka: 'Ushimitsu-doki', Meaning: 'The hour of the ox', Tie: 'Woman in White' },
    summary: 'The witching hour around which the night-shift hauntings cluster. Documented in Research; dramatised by the Woman in White\'s arrival.',
    flags: [],
  },
  akamanto: {
    id: 'akamanto', name: 'Aka Manto', type: 'lore', glyph: '物',
    aka: ['Aka Manto', 'red paper', 'blue paper'], linkId: 'r2',
    fields: { Form: 'Voice in the stall', Question: 'Red paper or blue paper?', Outcome: 'Either answer kills' },
    summary: 'The bathroom legend braided behind the Woman in White\'s question about the occupied stall. Flagged in Research as a thread to imply, never explain.',
    flags: [{ severity: 'info', text: 'Currently implied through the bathroom beat, not named in prose — matches the “never explain outright” note.', docId: 'r2' }],
  },
};
const CODEX_ORDER = ['reiko', 'womanwhite', 'nightmgr', 'nori', 'aisle9', 'sunnymart', 'backdoor', 'hour333', 'akamanto'];
const ENTITY_TYPE = {
  character: { label: 'Character', color: 'oklch(0.66 0.12 70)' },
  location:  { label: 'Location',  color: 'oklch(0.64 0.09 190)' },
  lore:      { label: 'Lore',      color: 'oklch(0.62 0.11 300)' },
};

// scan all doc bodies for an entity's aliases → [{docId, title, count}]
function scanMentions(entity, state) {
  const out = [];
  for (const id of Object.keys(state.docs)) {
    const text = state.docs[id]?.content || '';
    if (!text) continue;
    let count = 0;
    for (const a of entity.aka) {
      const re = new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const m = text.match(re);
      if (m) count += m.length;
    }
    if (count > 0) out.push({ docId: id, title: state.nodes[id]?.title || id, count });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

// ── canned line-edit: ordered literal find→replace, applied if present ────────
// For the default scene this yields several tasteful hunks; generic fallback
// (filler-tightening) works on any document.
const LINE_EDITS = {
  s1: [
    ['to life at a frequency just below comfort', 'to life at a frequency a half-step below comfort'],
    ['a hum [[Reiko]] had stopped hearing on her third night and started hearing again on her thirtieth.',
     'a hum [[Reiko]] had stopped hearing on her third night — and started hearing again on her thirtieth.'],
    ['He paid in coins, exact to the yen, and left without a bag.',
     'He paid in coins, exact to the yen, and left without taking the bag she offered.'],
    ['She told herself it was the wind. There was no wind.',
     'She told herself it was the wind.\n\nThere was no wind.'],
  ],
  s2: [
    ['narrow and over-lit, the shelves running back further than the building could hold',
     'narrow and over-lit, the shelves running back further than the building had any right to hold'],
    ['The date on the label was *tomorrow*.', 'The date on the label was *tomorrow*. She read it twice.'],
  ],
};
const FILLER = [' just ', ' really ', ' very ', ' quite ', ' simply ', ' actually ', ' somewhat '];

function lineEditProposal(content, docId) {
  let out = content;
  const edits = LINE_EDITS[docId];
  if (edits) {
    for (const [a, b] of edits) if (out.includes(a)) out = out.split(a).join(b);
  } else {
    for (const f of FILLER) out = out.split(f).join(' ');
    out = out.replace(/ {2,}/g, ' ');
  }
  return out;
}

// ── selection-scoped transforms (return replacement for the SELECTED text) ────
const REWRITE_MAP = {
  'There was no wind.': 'No wind. Nothing moved at all.',
  'It always is.': 'It always is — and she never checks.',
};
function transformSelection(cmd, sel) {
  const s = sel.trim();
  if (!s) return sel;
  if (cmd === 'tighten') {
    let t = ' ' + sel + ' ';
    for (const f of FILLER) t = t.split(f).join(' ');
    return t.replace(/ {2,}/g, ' ').trim();
  }
  if (cmd === 'rewrite') {
    if (REWRITE_MAP[s]) return REWRITE_MAP[s];
    // light reword: front the verb / strip a hedge
    return s.replace(/^She told herself /, 'She wanted to believe ')
            .replace(/\bseemed to\b/g, '')
            .replace(/ {2,}/g, ' ').trim();
  }
  if (cmd === 'expand') {
    const adds = [
      ' The fluorescent hum filled the gap where her thought had been.',
      ' She wrote it in the logbook without deciding why.',
      ' Somewhere near the back of the store, something settled.',
    ];
    return sel + adds[s.length % adds.length];
  }
  if (cmd === 'describe') {
    return sel.replace(/\.($|\s)/, ', the cold of the cold case still on her hands.$1');
  }
  return sel;
}

// ── grounded chat (keyword-routed, cites docs/entities) ───────────────────────
function chatReply(q, state) {
  const t = q.toLowerCase();
  const cite = (ids) => ids.map((id) => ({ id, title: state.nodes[id]?.title || (CODEX[id] ? CODEX[id].name : id) }));

  if (/woman in white|3:?33|milk/.test(t)) {
    return { text: 'The Woman in White arrives at 3:33 a.m. — the ushimitsu hour — buys a single bottle of milk, and asks whether the bathroom is occupied. The answer is always yes. She\'s your clearest braid of the Aka Manto legend; keep the question, never name the legend.', cites: cite(['s3', 'r2']) };
  }
  if (/aisle ?nine|ninth|mop/.test(t)) {
    return { text: 'Aisle Nine surfaces at ~3 a.m. where the mop closet should be — over-lit, impossibly deep, holding a bento dated tomorrow. The store is established as eight aisles in both the scene and the floor plan, so the ninth reads as the anomaly. Reiko doesn\'t put the bento back; that beat is currently marked “too fast.”', cites: cite(['s2', 'r1']) };
  }
  if (/back door/.test(t)) {
    return { text: 'The back door is set up twice — as Reiko\'s stated fear and Nori-san\'s warning never to answer it — but never paid off in the existing scenes. It\'s an unfired Chekhov\'s gun; plan the payoff for Part Two.', cites: cite(['ch_reiko', 's4']) };
  }
  if (/summar|recap|what happen|so far/.test(t)) {
    return { text: 'So far: Reiko works the 11pm–7am shift at the Sunny-Mart. A salaryman buys an umbrella under a clear sky; the door chimes twice for one exit. At 3 a.m. she finds Aisle Nine and a bento dated tomorrow. The Woman in White visits at 3:33. Part Two (Closing Time) is outlined but largely unwritten — Chapter 3 “Stocktake” is just an idea.', cites: cite(['s1', 's2', 's3']) };
  }
  if (/continu|consisten|conflict|contradict/.test(t)) {
    return { text: 'No hard contradictions yet. Two things to watch: the Night Manager has no physical description (decide before he returns), and the back door is planted but never paid off. Both are tracked in the Codex as flags.', cites: cite(['nightmgr', 'backdoor']) };
  }
  if (/pov|tense|point of view/.test(t)) {
    return { text: 'You\'re in close third on Reiko, past tense. The italic margin notes (“keep it small”, “fix this beat”) are author asides, not narration — strip them at compile or move them to the synopsis.', cites: cite(['s1']) };
  }
  return { text: 'I can only see what\'s in your project. Ask me about a character, a location, the timeline, continuity, or POV — or select a passage and I\'ll suggest an edit you can review line by line.', cites: [] };
}

const CHAT_SUGGESTIONS = [
  'Summarise the story so far',
  'Any continuity issues?',
  'What\'s unresolved about the back door?',
  'Tell me about the Woman in White',
];

// ── BYOK cost model (cents per call; tokens fabricated but plausible) ─────────
const MODELS = {
  'claude-sonnet':  { label: 'Claude Sonnet 4.5', vendor: 'Anthropic', inK: 0.30, outK: 1.50 },
  'claude-haiku':   { label: 'Claude Haiku 4.5',  vendor: 'Anthropic', inK: 0.08, outK: 0.40 },
  'gpt-5':          { label: 'GPT-5',             vendor: 'OpenAI',    inK: 0.25, outK: 1.20 },
  'ollama-local':   { label: 'Llama 3.3 (local)', vendor: 'Ollama',    inK: 0,    outK: 0 },
};
// which model each feature routes to by default
const FEATURE_ROUTES = {
  inline:    'claude-haiku',   // co-write inline tools
  chat:      'claude-sonnet',
  scorer:    'ollama-local',   // mechanical, cheap → local
  judge:     'claude-sonnet',
  draft:     'claude-sonnet',
  foundation:'claude-sonnet',
};
// rough token footprint per command → cost estimate
const COST_TABLE = {
  lineedit:   { in: 1200, out: 900 },
  tighten:    { in: 400,  out: 300 },
  expand:     { in: 400,  out: 600 },
  rewrite:    { in: 350,  out: 350 },
  describe:   { in: 350,  out: 300 },
  chat:       { in: 2400, out: 500 },
  scorer:     { in: 1500, out: 200 },
  judge:      { in: 1800, out: 900 },
  draft:      { in: 3000, out: 4200 },
  foundation: { in: 2000, out: 3500 },
};
function estimateCost(command, modelId) {
  const t = COST_TABLE[command] || COST_TABLE.tighten;
  const m = MODELS[modelId] || MODELS['claude-sonnet'];
  return (t.in / 1000) * m.inK + (t.out / 1000) * m.outK; // cents
}
function fmtCost(cents) {
  if (cents === 0) return 'free · local';
  if (cents < 1) return '<¢1';
  return '¢' + cents.toFixed(1);
}
function fmtDollars(cents) { return '$' + (cents / 100).toFixed(2); }

// ── mechanical slop scorer: lexicon → flagged spans (prose linting) ───────────
const SLOP = {
  cliche: ['heart pounded', 'heart raced', 'blood ran cold', 'time stood still', 'sent shivers', 'shiver down', 'deafening silence', 'eerie silence', 'without warning', 'little did she know', 'breath caught', 'pit of her stomach', 'cold sweat'],
  banned: ['very', 'really', 'just', 'suddenly', 'somewhat', 'quite', 'actually', 'literally', 'basically', 'simply'],
  filter: ['she saw', 'she felt', 'she heard', 'she noticed', 'she realized', 'she realised', 'she watched', 'she knew that', 'seemed to', 'began to', 'started to'],
  telling: ['she was afraid', 'she was scared', 'she was nervous', 'she was terrified', 'she was angry', 'it was frightening', 'it was terrifying', 'felt afraid'],
};
const SLOP_KINDS = {
  cliche:  { label: 'Cliché',            color: 'oklch(0.62 0.15 20)' },
  banned:  { label: 'Filler word',       color: 'oklch(0.70 0.13 75)' },
  filter:  { label: 'Filter word',       color: 'oklch(0.64 0.10 250)' },
  telling: { label: 'Telling, not showing', color: 'oklch(0.62 0.11 300)' },
  uniform: { label: 'Uniform rhythm',    color: 'oklch(0.60 0.05 190)' },
};
function scoreProse(text) {
  const flags = [];
  const counts = { cliche: 0, banned: 0, filter: 0, telling: 0, uniform: 0 };
  const push = (kind, start, end) => { flags.push({ kind, start, end, text: text.slice(start, end) }); counts[kind]++; };
  for (const kind of ['cliche', 'banned', 'filter', 'telling']) {
    for (const term of SLOP[kind]) {
      const re = new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
      let m;
      while ((m = re.exec(text)) !== null) push(kind, m.index, m.index + m[0].length);
    }
  }
  // sentence-uniformity: flag runs of 3+ sentences within ±2 words of each other
  const sentRe = /[^.!?\n]+[.!?]/g; let sm; const sents = [];
  while ((sm = sentRe.exec(text)) !== null) sents.push({ start: sm.index, end: sm.index + sm[0].length, words: sm[0].trim().split(/\s+/).length });
  for (let i = 0; i + 2 < sents.length; i++) {
    const a = sents[i], b = sents[i + 1], c = sents[i + 2];
    if (Math.abs(a.words - b.words) <= 2 && Math.abs(b.words - c.words) <= 2 && a.words > 5) {
      push('uniform', a.start, c.end); i += 2;
    }
  }
  flags.sort((x, y) => x.start - y.start);
  const total = counts.cliche * 3 + counts.telling * 3 + counts.filter * 1.5 + counts.banned * 1 + counts.uniform * 2;
  const words = Math.max(1, text.trim().split(/\s+/).length);
  const density = (total / words) * 100;
  const score = Math.max(0, Math.min(100, Math.round(100 - density * 9))); // higher = cleaner
  return { flags, counts, score, words };
}

// ── LLM-judge rubric (canned, deterministic-ish from score) ───────────────────
function judgeReport(text) {
  const s = scoreProse(text);
  const base = s.score;
  const j = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(base / 10 + n)));
  return {
    overall: Math.round(base / 10) / 1,
    rubric: [
      { k: 'Prose quality',          v: j(0, 4, 9), note: s.counts.cliche ? `${s.counts.cliche} cliché${s.counts.cliche > 1 ? 's' : ''} drag the line-level craft.` : 'Clean at the line level.' },
      { k: 'Voice adherence',        v: j(1, 5, 9), note: 'Close third on Reiko holds; past tense consistent.' },
      { k: 'Character distinctiveness', v: j(-1, 4, 8), note: 'Reiko reads clearly; secondary cast still thin.' },
      { k: 'Beat coverage',          v: j(0, 5, 9), note: 'Hits the outlined beat; the “too fast” aside is unresolved.' },
    ],
  };
}

// ── reader-panel personas ─────────────────────────────────────────────────────
const READERS = [
  { name: 'The Genre Fan', glyph: '怖', take: 'The second chime is the hook — I\'d turn the page. Don\'t over-explain Aisle Nine; the date on the bento is enough.', verdict: 'keep reading' },
  { name: 'The Lit-Fic Reader', glyph: '文', take: 'Restrained and atmospheric. The margin notes break the spell — cut them. Strong control of withheld information.', verdict: 'admires' },
  { name: 'The Skeptic', glyph: '?', take: 'Why doesn\'t she just leave? Give Reiko a concrete reason to stay on shift or I\'ll stop believing it.', verdict: 'needs work' },
  { name: 'The Speed Reader', glyph: '⚡', take: 'Moves well. The umbrella beat is the only place I skimmed — tighten the salaryman exchange.', verdict: 'mostly engaged' },
];

// ── adversarial editor: classified suggested cuts on a doc ────────────────────
function suggestCuts(text, target) {
  const cuts = [];
  for (const term of [...SLOP.banned, ...SLOP.filter]) {
    const re = new RegExp('\\s?\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    const m = text.match(re);
    if (m) cuts.push({ kind: term.includes(' ') ? 'filter' : 'filler', text: m[0].trim(), at: m.index, words: m[0].trim().split(/\s+/).length });
  }
  return cuts.slice(0, 12);
}

// ── Autopilot pipeline definition ─────────────────────────────────────────────
const PIPELINE = [
  { id: 'foundation', label: 'Foundation', icon: '◆', desc: 'Seed concept, world bible, character registry, outline + beats, canon, voice fingerprint.',
    artifacts: ['Seed concept', 'World bible', 'Character registry', 'Outline + beat sheet', 'Foreshadowing ledger', 'Canon database', 'Voice fingerprint'] },
  { id: 'draft', label: 'Drafting', icon: '✎', desc: 'Per-chapter drafting under anti-slop rules; keep-or-retry against a score gate.',
    artifacts: ['Chapter drafts', 'Per-chapter scores', 'Retry log'] },
  { id: 'eval', label: 'Evaluation', icon: '⊛', desc: 'Slop scorer, LLM judge, adversarial cuts, Elo ranking, reader panel, review loop.',
    artifacts: ['Slop report', 'Judge rubric', 'Reader panel', 'Review items'] },
  { id: 'revise', label: 'Revision', icon: '↻', desc: 'Revision briefs from evaluation; rewrite-from-brief; batch cut applicator.',
    artifacts: ['Revision briefs', 'Rewrites', 'Applied cuts'] },
];
// a fabricated drafting queue for the "draft this part" demo
const DRAFT_QUEUE_SEED = [
  { docId: 's4', title: 'Nori-san', status: 'queued', score: null, retries: 0 },
  { docId: 's5', title: 'Inventory of the missing', status: 'queued', score: null, retries: 0 },
];

// ── propagation-debt seeds (cross-layer change tracking) ──────────────────────
function debtSeeds() {
  return [
    {
      id: 'debt-seed-1', layer: 'canon', createdAt: new Date(Date.now() - 3600e3).toISOString(),
      title: 'Canon changed: the store has eight aisles',
      detail: 'You set “eight aisles” in the Research floor plan. The prose and outline reference it — verify nothing says seven or nine (besides the anomaly).',
      source: 'r1',
      affected: [
        { docId: 's2', note: 'Mentions the ninth aisle as the anomaly — consistent.', resolved: false },
        { docId: 's1', note: 'No aisle count stated — safe.', resolved: false },
      ],
    },
    {
      id: 'debt-seed-2', layer: 'character', createdAt: new Date(Date.now() - 7200e3).toISOString(),
      title: 'Character changed: Woman in White buys “one bottle of milk — never two”',
      detail: 'This rule now lives in the codex. Scenes that depict her purchase must honour it.',
      source: 'womanwhite',
      affected: [
        { docId: 's3', note: 'Shows her taking one bottle — consistent.', resolved: false },
      ],
    },
  ];
}

Object.assign(window, {
  CODEX, CODEX_ORDER, ENTITY_TYPE, scanMentions,
  lineEditProposal, transformSelection, chatReply, CHAT_SUGGESTIONS,
  MODELS, FEATURE_ROUTES, COST_TABLE, estimateCost, fmtCost, fmtDollars,
  SLOP, SLOP_KINDS, scoreProse, judgeReport, READERS, suggestCuts,
  PIPELINE, DRAFT_QUEUE_SEED, debtSeeds,
});
