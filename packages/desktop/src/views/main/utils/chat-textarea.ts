export const CHAT_TEXTAREA_MIN_HEIGHT = 36
export const CHAT_TEXTAREA_MAX_HEIGHT = 120

export function textareaHeight(scrollHeight: number): number {
  return Math.min(CHAT_TEXTAREA_MAX_HEIGHT, Math.max(CHAT_TEXTAREA_MIN_HEIGHT, scrollHeight))
}
