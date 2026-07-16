export const CHAT_BOTTOM_TOLERANCE = 40

export function isChatNearBottom(
  scrollSize: number,
  scrollOffset: number,
  viewportSize: number,
): boolean {
  return scrollSize - scrollOffset - viewportSize <= CHAT_BOTTOM_TOLERANCE
}
