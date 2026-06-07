// ─────────────────────────────────────────────────────────────────────────────
// Changeset.jsx — THE KEYSTONE. A pull-request review built for authors.
// Everything AI proposes lands here: inline co-write edits, batch rewrites,
// adversarial cuts, autopilot runs, resolved propagation debt. Grouped by source,
// diffed, accept/reject per change AND per group, before anything hits the binder.
// ─────────────────────────────────────────────────────────────────────────────

function HunkControls({ propId, idx, accepted }) {
  return (
    <div className="hunk-ctl">
      <button className={'hk-btn rej' + (!accepted ? ' on' : '')} onClick={() => { if (accepted) aiActions.toggleHunk(propId, idx); }}>Reject</button>
      <button className={'hk-btn acc' + (accepted ? ' on' : '')} onClick={() => { if (!accepted) aiActions.toggleHunk(propId, idx); }}>Accept</button>
    </div>
  );
}

function ChangeDiff({ proposal }) {
  const segs = React.useMemo(() => buildSegments(proposal.original, proposal.proposed), [proposal.id]);
  return (
    <div className="review-doc">
      {segs.map((s, k) => {
        if (s.type === 'ctx') {
          const lines = s.lines.length > 6 ? [...s.lines.slice(0, 3), '⋯', ...s.lines.slice(-3)] : s.lines;
          return lines.map((ln, j) => <div key={k + '-' + j} className={'rv-line ctx' + (ln === '⋯' ? ' fold' : '')}>{ln === '⋯' ? '⋯' : (ln || '\u00a0')}</div>);
        }
        const isAcc = proposal.accepted.includes(s.idx);
        return (
          <div key={k} className={'rv-hunk' + (isAcc ? ' accepted' : ' rejected')}>
            <HunkControls propId={proposal.id} idx={s.idx} accepted={isAcc} />
            {s.del.map((ln, j) => <div key={'d' + j} className="rv-line del">{ln || '\u00a0'}</div>)}
            {s.add.map((ln, j) => <div key={'a' + j} className="rv-line add">{ln || '\u00a0'}</div>)}
          </div>
        );
      })}
    </div>
  );
}

function ChangesetView() {
  const proposals = useAI((s) => s.proposals.filter((p) => p.status === 'pending'));
  const reviewingId = useAI((s) => s.reviewingId);
  const cost = useAI((s) => s.cost);
  const reviewing = proposals.find((p) => p.id === reviewingId) || proposals[0];

  // group pending proposals
  const groups = React.useMemo(() => {
    const g = {};
    proposals.slice().sort((a, b) => a.seq - b.seq).forEach((p) => { (g[p.group] = g[p.group] || []).push(p); });
    return g;
  }, [proposals.map((p) => p.id + p.accepted.length).join(',')]);

  const totalHunks = proposals.reduce((a, p) => a + p.nHunks, 0);
  const totalAcc = proposals.reduce((a, p) => a + p.accepted.length, 0);

  if (proposals.length === 0) {
    return (
      <div className="main">
        <div className="surface-hd"><Icons.Compile /> <b>Changeset review</b></div>
        <div className="ai-empty">
          <div className="ae-spark">✦</div>
          <div className="ae-title">No changes waiting</div>
          <div className="ae-sub">When AI proposes an edit — from an inline tool, a batch generator, a resolved continuity flag, or an Autopilot run — it collects here as a reviewable changeset. Nothing is written to your binder until you accept it.</div>
          <div className="ae-actions">
            <button className="btn" onClick={() => aiActions.setSurface(null)}>Back to editor</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="main changeset">
      <div className="surface-hd">
        <Icons.Compile /> <b>Changeset review</b>
        <span className="hd-sub">{proposals.length} change{proposals.length === 1 ? '' : 's'} · {totalAcc}/{totalHunks} hunks accepted</span>
        <div className="tb-spacer" />
        <span className="cost-chip" title="Estimated cost of pending generations">batch ≈ {fmtCost(proposals.length * 1.5)}</span>
        <button className="btn ghost sm" onClick={() => proposals.forEach((p) => aiActions.discard(p.id))}>Discard all</button>
        <button className="btn primary sm" onClick={() => proposals.forEach((p) => p.accepted.length && aiActions.apply(p.id))}>Apply all accepted</button>
      </div>
      <div className="cs-body">
        <div className="cs-rail">
          {Object.keys(groups).map((gName) => {
            const items = groups[gName];
            const gAcc = items.reduce((a, p) => a + p.accepted.length, 0);
            const gTot = items.reduce((a, p) => a + p.nHunks, 0);
            return (
              <div className="cs-group" key={gName}>
                <div className="cs-group-hd">
                  <span className="cg-name">{gName}</span>
                  <span className="cg-count">{gAcc}/{gTot}</span>
                  <div className="cg-acts">
                    <button title="Reject group" onClick={() => aiActions.discardGroup(gName)}>✕</button>
                    <button title="Apply group" className="acc" onClick={() => aiActions.applyGroup(gName)}>✓</button>
                  </div>
                </div>
                {items.map((p) => (
                  <button key={p.id} className={'cs-item' + (reviewing && reviewing.id === p.id ? ' sel' : '')} onClick={() => aiActions.review(p.id)}>
                    <span className="ci-bar" style={{ opacity: p.accepted.length ? 1 : 0.25 }} />
                    <div className="ci-main">
                      <div className="ci-t">{p.label}</div>
                      <div className="ci-m">{p.docTitle} · {p.accepted.length}/{p.nHunks} hunks</div>
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        <div className="cs-detail">
          {reviewing ? (
            <>
              <div className="cs-detail-hd">
                <div className="cd-title">
                  <b>{reviewing.label}</b>
                  <span className="cd-sub">{reviewing.group} → <button className="linkish" onClick={() => { actions.select(reviewing.docId); }}>{reviewing.docTitle}</button></span>
                </div>
                <div className="tb-spacer" />
                <button className="btn ghost sm" onClick={() => aiActions.setAllHunks(reviewing.id, false)} disabled={reviewing.accepted.length === 0}>Reject all</button>
                <button className="btn ghost sm" onClick={() => aiActions.setAllHunks(reviewing.id, true)} disabled={reviewing.accepted.length === reviewing.nHunks}>Accept all</button>
                <button className="btn sm" onClick={() => aiActions.discard(reviewing.id)}>Discard</button>
                <button className="btn primary sm" onClick={() => aiActions.apply(reviewing.id)} disabled={reviewing.accepted.length === 0}>
                  Apply to binder
                </button>
              </div>
              <div className="cs-diff-scroll">
                <div className="review-col"><ChangeDiff proposal={reviewing} /></div>
              </div>
            </>
          ) : <div className="ai-empty"><div className="ae-title">Select a change to review</div></div>}
        </div>
      </div>
    </div>
  );
}

window.ChangesetView = ChangesetView;
