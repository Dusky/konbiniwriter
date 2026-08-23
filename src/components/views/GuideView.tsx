import React from 'react'
import { useShellStore } from '../../store/shellStore'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import ModalShell from '../common/ModalShell'
import Icon, { type IconName } from '../common/Icon'
import { kbd } from '../../lib/kbd'

interface Props { onClose: () => void; embedded?: boolean }

interface Door { label: string; run: () => void }

/**
 * The orientation surface. Konbini has a binder, an inspector, four view modes,
 * a compile pipeline and — optionally — a whole AI layer, and until this
 * existed nothing anywhere named any of them.
 *
 * It is deliberately not a tour and not documentation: every card is a *door*.
 * Each one says what a surface is for and then opens it, using the same store
 * actions the toolbar and command palette already call. Nothing here is a
 * special path that can rot while the real one moves.
 */
export default function GuideView({ onClose, embedded }: Props): React.ReactElement {
  const toggleBinder = useShellStore((s) => s.toggleBinder)
  const setRailPanel = useShellStore((s) => s.setRailPanel)
  const setModal = useShellStore((s) => s.setModal)
  const setView = useProjectStore((s) => s.setView)
  const openViewTab = useProjectStore((s) => s.openViewTab)
  const aiEnabled = useAIStore((s) => s.enabled)

  // A door has to actually open. The Guide is a view tab, and EditorPane renders
  // the active view tab *instead of* the main pane, so calling setView() alone
  // would change a mode the author cannot see — you'd click "Corkboard" and
  // nothing would happen. Going through a door means leaving the room.
  const goTo = (v: Parameters<typeof setView>[0]) => () => { setView(v); onClose() }

  const card = (icon: IconName, title: string, hint: string | null, body: string, doors: Door[]) => (
    <section className="guide-card" key={title}>
      <div className="guide-card-hd">
        <span className="guide-ic"><Icon name={icon} size={16} /></span>
        <h4>{title}</h4>
        {hint && <span className="guide-kbd">{hint}</span>}
      </div>
      <p>{body}</p>
      <div className="guide-doors">
        {doors.map((d) => (
          <button key={d.label} className="btn" onClick={d.run}>{d.label}</button>
        ))}
      </div>
    </section>
  )

  return (
    <ModalShell embedded={embedded} onClose={onClose} maxWidth={760} label="Guide">
      <div className="modal-hd">
        <h3>Guide</h3>
        <span className="sub">What everything in here is for. Every button below opens the thing it describes.</span>
      </div>

      <div className="modal-body guide-body">
        <p className="guide-lede">
          A Konbini project is a folder of Markdown files on your disk. Nothing here is a
          database and nothing is in the cloud — you can open the same files in any editor,
          and back them up by copying the folder.
        </p>

        <div className="guide-grid">
          {card('panel-left', 'Binder', kbd('mod+alt+b'),
            "Your book's structure, down the left. Folders are parts and chapters; documents are scenes. Drag rows to reorder, shift-click to select a run of them, and drag the whole selection at once.",
            [{ label: 'Toggle the binder', run: toggleBinder }])}

          {card('notebook', 'Editor & Scrivenings', kbd('mod+1'),
            'Click a document to write in it. Click a folder instead and you edit every scene beneath it as one continuous manuscript — type across the breaks, and each scene still saves to its own file.',
            [{ label: 'Go to the editor', run: goTo('editor') }])}

          {card('panel-right', 'Inspector', kbd('mod+alt+i'),
            'The right rail. Synopsis, status and label, word target, keywords, comments anchored to a passage, and every document that links here with [[wikilinks]].',
            [{ label: 'Open the inspector', run: () => setRailPanel('inspector') }])}

          {card('chart', 'Corkboard · Outliner · Story map', `${kbd('mod+2')} · ${kbd('mod+3')} · ${kbd('mod+4')}`,
            'Three ways of looking at the same book. Index cards you can shuffle, a spreadsheet of status and word counts, and a lane of cards per chapter you can drag between. Rearranging in any of them rearranges the manuscript.',
            [
              { label: 'Corkboard', run: goTo('corkboard') },
              { label: 'Outliner', run: goTo('outliner') },
              { label: 'Story map', run: goTo('timeline') },
            ])}

          {card('history', 'Snapshots & History', kbd('mod+shift+s'),
            'Nothing you write is ever lost. Konbini snapshots a document before anything rewrites it, keeps automatic versions as you work, and will show you the diff between any two.',
            [{ label: 'Open history', run: () => setRailPanel('history') }])}

          {card('file-output', 'Compile', kbd('mod+shift+e'),
            'Turn the binder into one manuscript: DOCX (including Shunn standard format), EPUB, print-ready PDF, or plain Markdown. Anything outside the Manuscript folder stays out of the book.',
            [{ label: 'Open compile', run: () => setModal('compile') }])}

          {card('search', 'Search & Replace', kbd('mod+shift+f'),
            'Search every document at once, with whole-word and case options, and replace across the whole project. Renaming a character updates prose, titles, synopses, keywords and comments together.',
            [
              { label: 'Search the project', run: () => setModal('search') },
              { label: 'Rename a character', run: () => setModal('rename') },
            ])}

          {card('sparkle', 'Command palette', kbd('mod+k'),
            'Everything in Konbini, by name. If you can only remember one shortcut, remember this one — every surface on this page is in there too.',
            [{ label: 'Open the palette', run: () => setModal('command-palette') }])}

          {card('settings', 'Preferences & Themes', kbd('mod+,'),
            'Editor font, size and column width; typewriter scrolling; focus and composition modes; nine built-in themes and a full editor for your own.',
            [
              { label: 'Preferences', run: () => openViewTab('prefs') },
              { label: 'Themes', run: () => openViewTab('themes') },
            ])}
        </div>

        {/*
          Invariant 1 — AI off means no AI in the DOM. With AI disabled this is a
          paragraph of text and one button to the settings tab, exactly like the
          toolbar's enable button. No AI component mounts and no AI code runs.
        */}
        {aiEnabled ? (
          <section className="guide-card guide-ai">
            <div className="guide-card-hd">
              <span className="guide-ic"><Icon name="sparkle" size={16} /></span>
              <h4>The AI layer</h4>
            </div>
            <p>
              AI is on. It never writes into your manuscript unreviewed: every edit arrives as a
              proposal you read and accept, and the document is snapshotted before a word changes.
            </p>
            <div className="guide-doors">
              <button className="btn" onClick={() => openViewTab('foundation')}>Foundation — seed → world → cast</button>
              <button className="btn" onClick={() => setRailPanel('codex')}>Codex</button>
              <button className="btn" onClick={() => setRailPanel('assistant')}>Chat</button>
              <button className="btn" onClick={() => openViewTab('adventure')}>Adventure — draft beat by beat</button>
              <button className="btn" onClick={() => openViewTab('batch-generator')}>Generate</button>
              <button className="btn" onClick={() => openViewTab('quality')}>Manuscript quality</button>
              <button className="btn" onClick={() => openViewTab('autopilot')}>Autopilot</button>
              <button className="btn" onClick={() => openViewTab('prompt-registry')}>Prompts — every one is editable</button>
            </div>
          </section>
        ) : (
          <section className="guide-card guide-ai">
            <div className="guide-card-hd">
              <span className="guide-ic"><Icon name="sparkle" size={16} /></span>
              <h4>The AI layer is switched off</h4>
            </div>
            <p>
              Everything above is the whole app — Konbini is a complete writing studio with no AI
              at all, and that is how it ships. Turn it on (you bring your own API key, any
              provider) and you also get inline co-writing, a chat that has read your manuscript,
              a story codex, beat-by-beat drafting, quality scoring and revision agents. Every AI
              edit is reviewed before it lands, and every prompt is yours to edit.
            </p>
            <div className="guide-doors">
              <button className="btn primary" onClick={() => openViewTab('ai-settings')}>Set up AI</button>
            </div>
          </section>
        )}

        <p className="guide-foot">
          Reopen this any time from the command palette, under Help.
        </p>
      </div>
    </ModalShell>
  )
}
