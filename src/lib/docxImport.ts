// docxImport.ts — extract plain prose from a .docx file for project import.
//
// Import reads files in the renderer for every backend (see NewProjectModal),
// so this is renderer-side. mammoth is heavy (~1MB + jszip), so it's lazy-
// imported and only pulled in when a .docx is actually encountered — the main
// bundle is unaffected. We use extractRawText rather than HTML/markdown
// conversion: fiction manuscripts import cleanest as prose with paragraph
// breaks preserved and no heading/style noise to strip back out later.

/** True for files this module can convert. */
export function isDocx(name: string): boolean {
  return /\.docx$/i.test(name)
}

/**
 * Convert a .docx file to plain text with paragraph breaks preserved.
 * Throws with a readable message if the file isn't a valid Word document.
 */
export async function docxToText(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  // mammoth emits one paragraph per line; turn each into a blank-line-separated
  // paragraph so the prose reads naturally in the Markdown editor.
  return result.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n\n')
    .trim()
}
