import React from 'react'

interface Props {
  /** When true, render in-flow for a main-pane tab instead of a centered dialog. */
  embedded?: boolean
  onClose: () => void
  maxWidth?: number
  label?: string
  children: React.ReactNode
}

// Shared wrapper so a surface can render either as a centered modal (backdrop +
// dialog box) or embedded in the main pane as a tab (in-flow, scrollable),
// reusing the same .modal-hd/.modal-body/.modal-foot content without duplicating it.
export default function ModalShell({ embedded, onClose, maxWidth = 520, label, children }: Props): React.ReactElement {
  if (embedded) {
    // Reuse the .modal box (flex column + internal body scroll) so every
    // surface's layout — including wide, tall, internally-scrolling ones —
    // behaves as it did in a dialog, but rendered in-flow and full-bleed.
    return (
      <div className="view-host">
        <div className="modal view-embedded" style={{ maxWidth }}>{children}</div>
      </div>
    )
  }
  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth }} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  )
}
