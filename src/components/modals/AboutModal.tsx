import React from 'react'

interface Props { onClose: () => void }

export default function AboutModal({ onClose }: Props): React.ReactElement {
  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="about">
        <div className="about-mark">✦</div>
        <div className="about-name">Konbini</div>
        <div className="about-ver">Version {__APP_VERSION__}</div>
        <p className="about-desc">
          A local-first writing studio for long-form fiction.<br />
          Your work. Your files. Your machine.
        </p>
        <button className="btn primary" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
