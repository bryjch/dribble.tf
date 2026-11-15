// Parses Valve KeyValues text (items_game.txt, .vmt materials) into plain objects. Keys are
// lowercased. A key seen twice keeps the first value, except that two blocks under one key are
// merged; `[$CONDITION]` suffixes are skipped.

export function parseKeyValues(text) {
  let at = 0
  const n = text.length

  const skip = () => {
    for (;;) {
      while (at < n && /\s/.test(text[at])) at++
      if (text.startsWith('//', at)) {
        const end = text.indexOf('\n', at)
        at = end < 0 ? n : end + 1
        continue
      }
      return
    }
  }

  // A quoted or bare string, a brace, or null at the end.
  const token = () => {
    skip()
    if (at >= n) return null
    const c = text[at]
    if (c === '{' || c === '}') {
      at++
      return { brace: c }
    }
    // No escapes: materials and items_game write paths with literal backslashes.
    if (c === '"') {
      const end = text.indexOf('"', at + 1)
      const value = text.slice(at + 1, end < 0 ? n : end)
      at = end < 0 ? n : end + 1
      return { value }
    }
    const start = at
    while (at < n && !/[\s{}"]/.test(text[at])) at++
    return { value: text.slice(start, at) }
  }

  const skipCondition = () => {
    skip()
    if (text[at] === '[') {
      const end = text.indexOf(']', at)
      at = end < 0 ? n : end + 1
    }
  }

  const block = () => {
    const out = {}
    for (;;) {
      const key = token()
      if (key === null || key.brace === '}') return out
      if (key.brace) continue
      skipCondition()
      const value = token()
      if (value === null) return out
      const k = key.value.toLowerCase()
      if (value.brace === '{') {
        const child = block()
        skipCondition()
        out[k] = typeof out[k] === 'object' ? { ...out[k], ...child } : (out[k] ?? child)
      } else {
        skipCondition()
        if (!(k in out)) out[k] = value.value
      }
    }
  }

  return block()
}
