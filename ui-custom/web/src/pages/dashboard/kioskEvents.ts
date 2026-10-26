export function attachKioskEventGuards(iframe: HTMLIFrameElement): () => void {
  let doc: Document | null
  try {
    doc = iframe.contentDocument
  } catch {
    return () => undefined
  }
  if (!doc) return () => undefined

  const blockDoubleClick = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  }
  const blockEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
  }

  doc.addEventListener('dblclick', blockDoubleClick, true)
  doc.addEventListener('keydown', blockEscape, true)
  return () => {
    doc.removeEventListener('dblclick', blockDoubleClick, true)
    doc.removeEventListener('keydown', blockEscape, true)
  }
}
