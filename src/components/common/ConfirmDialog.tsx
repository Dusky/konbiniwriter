import React from 'react'

interface Props {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/** Small confirmation dialog for destructive actions (delete, clear). */
export default function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }: Props): React.ReactElement {
  return (
    <div className="modal-bg" style={{ zIndex: 1200 }} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 400 }} role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="modal-hd"><h3>{title}</h3></div>
        <div className="modal-body" style={{ fontSize: 13, color: 'var(--text-2)' }}>{message}</div>
        <div className="modal-foot">
          <span className="tb-spacer" />
          <button className="btn" autoFocus onClick={onCancel}>Cancel</button>
          <button
            className="btn"
            style={{ background: 'var(--st-idea)', color: 'var(--accent-fg)', borderColor: 'transparent' }}
            onClick={onConfirm}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
