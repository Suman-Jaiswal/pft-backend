export type DirectChildLabel = {
  name: string
  leaf: string
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function prepareGeminiBody(raw: string, maxLen: number): string {
  return stripHtml(raw).slice(0, maxLen)
}

export function listDirectChildLabels(allLabelNames: string[], parentName: string): DirectChildLabel[] {
  const prefix = `${parentName}/`
  return allLabelNames.flatMap((name) => {
    if (!name.startsWith(prefix)) return []
    const leaf = name.slice(prefix.length)
    if (!leaf || leaf.includes('/')) return []
    return [{ name, leaf }]
  })
}
