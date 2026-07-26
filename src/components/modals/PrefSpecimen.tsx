import React, { useEffect, useRef, useState } from 'react'

const SAMPLE =
  'The fluorescent lights never fully warmed up. They flickered at a frequency ' +
  'just below comfort, a hum she had stopped hearing on her third night and ' +
  'started hearing again on her thirtieth.'

/** Typographic comfort zone for a single column of prose. */
const MEASURE_MIN = 45
const MEASURE_MAX = 75

/**
 * Average character advance for a font, measured rather than guessed.
 *
 * Canvas is the only way to get this honestly: a proportional face has no
 * single character width, so the sample string has to be representative prose
 * rather than a repeated letter.
 */
function avgCharWidth(font: string): number {
  const cv = document.createElement('canvas')
  const ctx = cv.getContext('2d')
  if (!ctx) return 0
  ctx.font = font
  return ctx.measureText(SAMPLE).width / SAMPLE.length
}

/**
 * Live specimen for the editor-appearance settings.
 *
 * Preferences opens as a tab in the main pane, which means it covers the very
 * editor whose font, size and column width these controls change — so without
 * this, dragging the size slider looks like it does nothing at all. The
 * specimen renders in the real editor face at the real size, and reports the
 * resulting measure in characters, which is the number that actually decides
 * whether a column is comfortable to read.
 */
export default function PrefSpecimen({ colWidth }: { colWidth: number }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [chars, setChars] = useState<number | null>(null)

  // Read the resolved font/size off the specimen itself rather than
  // reconstructing them: they come from CSS variables the store writes.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const cs = getComputedStyle(el)
    const w = avgCharWidth(`${cs.fontSize} ${cs.fontFamily}`)
    // The editor column carries 56px of padding on each side.
    const textWidth = Math.max(0, colWidth - 112)
    setChars(w > 0 ? Math.round(textWidth / w) : null)
  })

  const verdict = chars === null ? null
    : chars < MEASURE_MIN ? 'narrow'
    : chars > MEASURE_MAX ? 'wide'
    : 'comfortable'

  return (
    <div className="pref-spec">
      <div className="pref-spec-body" ref={ref}>{SAMPLE}</div>
      {chars !== null && (
        <div className={`pref-spec-note ${verdict}`}>
          about {chars} characters per line — {verdict}
          {verdict !== 'comfortable' && <span className="pref-spec-ideal"> ({MEASURE_MIN}–{MEASURE_MAX} reads best)</span>}
        </div>
      )}
    </div>
  )
}
