import { nextTick, ref, type Ref } from 'vue'

const SCROLL_AT_BOTTOM_THRESHOLD = 40

export function useChatScroll(listEl: Ref<HTMLElement | null>): {
  isAtBottom: Ref<boolean>
  onScroll: () => void
  scrollToBottom: (smooth?: boolean) => void
  scrollToBottomOnNewMessage: () => Promise<void>
} {
  const isAtBottom = ref(true)

  function onScroll(): void {
    if (!listEl.value) return

    const { scrollTop, scrollHeight, clientHeight } = listEl.value
    isAtBottom.value = scrollHeight - scrollTop - clientHeight < SCROLL_AT_BOTTOM_THRESHOLD
  }

  function scrollToBottom(smooth = true): void {
    if (!listEl.value) return

    isAtBottom.value = true
    // Double rAF ensures layout/paint is complete before scrolling (fixes Windows scroll bug)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        listEl.value?.scrollTo({
          behavior: smooth ? 'smooth' : 'auto',
          top: listEl.value!.scrollHeight,
        })
      })
    })
  }

  async function scrollToBottomOnNewMessage(): Promise<void> {
    if (!isAtBottom.value || !listEl.value) return

    await nextTick()
    // Double rAF ensures layout/paint is complete before scrolling (fixes Windows scroll bug)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        listEl.value?.scrollTo({
          behavior: 'smooth',
          top: listEl.value!.scrollHeight,
        })
      })
    })
  }

  return { isAtBottom, onScroll, scrollToBottom, scrollToBottomOnNewMessage }
}
