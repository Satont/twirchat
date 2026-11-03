/** Navigation history is separate from closed tabs and closed splits. */
export function createChatTabHistory(limit = 100) {
  let entries: string[] = []
  let cursor = -1
  let navigationTarget: string | null = null
  const visit = (id: string) => {
    if (!id) return
    if (navigationTarget === id) {
      navigationTarget = null
      return
    }
    navigationTarget = null
    if (entries[cursor] === id) return
    entries = [...entries.slice(0, cursor + 1), id].slice(-Math.max(1, limit))
    cursor = entries.length - 1
  }
  return {
    visit,
    navigate(direction: 1 | -1, current: string, validIDs: readonly string[]): string | null {
      const valid = new Set(validIDs)
      if (valid.has(current) && entries[cursor] !== current) visit(current)
      const oldCursor = cursor
      const retained = entries
        .map((id, index) => ({ id, index }))
        .filter((entry) => valid.has(entry.id))
      const exactCursor = retained.findIndex((entry) => entry.index === oldCursor)
      cursor =
        exactCursor >= 0
          ? exactCursor
          : retained.filter((entry) => entry.index < oldCursor).length - (direction === 1 ? 1 : 0)
      entries = retained.map((entry) => entry.id)
      navigationTarget = null
      const next = cursor + direction
      if (next < 0 || next >= entries.length) return null
      cursor = next
      navigationTarget = entries[cursor] ?? null
      return navigationTarget
    },
    snapshot: () => ({ entries: [...entries], cursor }),
  }
}
const runtime = globalThis
const histories = (runtime.__twirchatTabHistory ??= new Map())
function history(scope: string) {
  let value = histories.get(scope)
  if (!value) {
    value = createChatTabHistory()
    histories.set(scope, value)
  }
  return value
}
export function visitChatTab(id: string, scope = 'main'): void {
  history(scope).visit(id)
}
export function navigateChatTabHistory(
  direction: 1 | -1,
  current: string,
  validIDs: readonly string[],
  scope = 'main',
): string | null {
  return history(scope).navigate(direction, current, validIDs)
}
export function clearChatTabHistory(scope = 'main'): void {
  histories.delete(scope)
}

declare global {
  var __twirchatTabHistory: Map<string, ReturnType<typeof createChatTabHistory>> | undefined
}
