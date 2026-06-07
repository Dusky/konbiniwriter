// ─────────────────────────────────────────────────────────────────────────────
// Editor.jsx — live-styled markdown surface (the "CodeMirror" of the prototype).
// Technique: a transparent <textarea> for editing sits exactly over a <pre>
// highlight layer that re-renders the same text with markdown tokens decorated
// (iA-Writer style: syntax stays but is dimmed; emphasis is styled in place).
// Uniform font size keeps caret + highlight perfectly aligned.
// ─────────────────────────────────────────────────────────────────────────────

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// inline tokens on an already HTML-escaped string
function inlineMd(s) {
  return s
    .replace(/`([^`]+)`/g, '<span class="mk">`</span><span class="cd">$1</span><span class="mk">`</span>')
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="mk">[[</span><span class="lk">$1</span><span class="mk">]]</span>')
    .replace(/\*\*([^*]+)\*\*/g, '<span class="mk">**</span><span class="b">$1</span><span class="mk">**</span>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<span class="mk">*</span><span class="i">$2</span><span class="mk">*</span>')
    .replace(/\b_([^_\n]+)_\b/g, '<span class="mk">_</span><span class="i">$1</span><span class="mk">_</span>');
}

function highlightLine(raw) {
  const line = escHtml(raw);
  let m;
  if ((m = line.match(/^(\s*)(#{1,6})(\s)(.*)$/))) {
    return m[1] + '<span class="mk">' + m[2] + '</span>' + m[3] + '<span class="h">' + inlineMd(m[4]) + '</span>';
  }
  if ((m = line.match(/^(\s*)(&gt;+\s?)(.*)$/))) {
    return m[1] + '<span class="mk">' + m[2] + '</span><span class="q">' + inlineMd(m[3]) + '</span>';
  }
  if ((m = line.match(/^(\s*)([-*+]\s)(.*)$/))) {
    return m[1] + '<span class="bul">' + m[2] + '</span>' + inlineMd(m[3]);
  }
  return inlineMd(line);
}

function highlightDoc(text, activeLine) {
  const lines = text.split('\n');
  return lines.map((ln, i) => {
    const cls = 'ln' + (i === activeLine ? ' active' : '');
    return '<span class="' + cls + '">' + highlightLine(ln) + '</span>';
  }).join('\n') + (text.endsWith('\n') ? '\u200b' : '');
}

function MarkdownEditor({ docId, focusMode, autofocus }) {
  const body = useStore((s) => s.docs[docId]);
  const taRef = React.useRef(null);
  const [activeLine, setActiveLine] = React.useState(0);
  const content = body ? body.content : '';

  const recalcActive = React.useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const before = ta.value.slice(0, ta.selectionStart);
    setActiveLine(before.split('\n').length - 1);
  }, []);

  React.useEffect(() => { recalcActive(); }, [docId]);
  React.useEffect(() => {
    if (autofocus && taRef.current) {
      const ta = taRef.current;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      recalcActive();
    }
  }, [docId, autofocus]);

  const onInput = (e) => {
    actions.updateContent(docId, e.target.value);
    recalcActive();
    // gentle keep-caret-in-view (typewriter-ish)
    requestAnimationFrame(() => {
      const ta = taRef.current; if (!ta) return;
      const wrap = ta.closest('.editor-wrap, .comp-scroll'); if (!wrap) return;
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 28;
      const before = ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
      const caretY = ta.getBoundingClientRect().top - wrap.getBoundingClientRect().top + before * lh;
      const h = wrap.clientHeight;
      if (caretY > h - 180) wrap.scrollTop += (caretY - (h - 180));
      else if (caretY < 120) wrap.scrollTop += (caretY - 120);
    });
  };

  // keep textarea sized to its content so the page (not the textarea) scrolls
  const html = React.useMemo(() => highlightDoc(content, focusMode ? activeLine : -1),
    [content, activeLine, focusMode]);

  return (
    <div className={'cm' + (focusMode ? ' focusmode' : '')}>
      <pre aria-hidden="true" dangerouslySetInnerHTML={{ __html: html + '\n' }} />
      <textarea
        ref={taRef}
        value={content}
        spellCheck={false}
        onChange={onInput}
        onKeyUp={recalcActive}
        onClick={recalcActive}
        onSelect={recalcActive}
        placeholder="Begin writing…"
      />
    </div>
  );
}

// ── inline slop proofing (read-only marked overlay of the same column) ────────
function buildProofHtml(text, flags) {
  // weave flagged spans into escaped text, non-overlapping (flags pre-sorted)
  let out = '', cur = 0;
  const used = [];
  for (const f of flags) {
    if (f.start < cur) continue; // skip overlaps
    out += escHtml(text.slice(cur, f.start));
    out += '<mark class="slop slop-' + f.kind + '" data-kind="' + f.kind + '">' + escHtml(text.slice(f.start, f.end)) + '</mark>';
    cur = f.end; used.push(f);
  }
  out += escHtml(text.slice(cur));
  return out.replace(/\n/g, '<br>');
}

function ProofView({ node }) {
  const body = useStore((s) => s.docs[node.id]);
  const text = body?.content || '';
  const result = React.useMemo(() => scoreProse(text), [text]);
  const kinds = Object.keys(SLOP_KINDS);
  return (
    <div className="main">
      <div className="doc-bar proof-bar">
        <span className="crumb"><b>{node.title}</b> · proofing</span>
        <div className="tb-spacer" />
        <span className={'slop-score' + (result.score >= 75 ? ' good' : result.score >= 55 ? ' mid' : ' bad')}>Slop score {result.score}<small>/100</small></span>
        <button className="btn ghost sm" onClick={() => aiActions.proof(node.id)}>Done proofing</button>
      </div>
      <div className="proof-counts">
        {kinds.map((k) => (
          <span key={k} className={'pc' + (result.counts[k] ? '' : ' zero')}><span className="pc-dot" style={{ background: SLOP_KINDS[k].color }} />{SLOP_KINDS[k].label}<b>{result.counts[k]}</b></span>
        ))}
      </div>
      <div className="editor-wrap">
        <div className="editor-col">
          <div className="cm proof-doc" dangerouslySetInnerHTML={{ __html: buildProofHtml(text, result.flags) }} />
        </div>
      </div>
    </div>
  );
}

// ── the main editor view (doc bar + scrolling column) ────────────────────────
function EditorView() {
  const sel = useStore((s) => s.selectedId);
  const node = useStore((s) => (s.selectedId ? s.nodes[s.selectedId] : null));
  const crumbs = useStore((s) => {
    if (!s.selectedId) return [];
    const path = []; let cur = s.nodes[s.selectedId];
    while (cur) { path.unshift(cur.title); cur = cur.parentId ? s.nodes[cur.parentId] : null; }
    return path;
  });
  const focusMode = useStore((s) => s.ui.focusMode);
  const proofId = (window.useAI ? useAI((s) => s.proofDocId) : null);

  if (!node) {
    return (
      <div className="main">
        <div className="empty-state">
          <div>
            <div className="wm">混</div>
            <div className="big">No document selected</div>
            <div>Pick a scene from the binder, or create one.</div>
          </div>
        </div>
      </div>
    );
  }
  if (node.type === 'folder') return <CorkboardView folderId={node.id} />;
  if (proofId === node.id) return <ProofView node={node} />;

  return (
    <div className="main">
      <div className="doc-bar">
        <span className="crumb">{crumbs.slice(0, -1).join('  ›  ')}{crumbs.length > 1 ? '  ›  ' : ''}<b>{crumbs[crumbs.length - 1]}</b></span>
      </div>
      <div className="editor-wrap">
        <div className="editor-col">
          <MarkdownEditor docId={node.id} focusMode={focusMode} autofocus key={node.id} />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { MarkdownEditor, EditorView, highlightDoc, ProofView });
