import { nextTick, ref } from 'vue'

export function useChatScroll(listEl: { value: HTMLElement | null }) {
  const isAtBottom = ref(true)

  function onScroll() {
    if (!listEl.value) return

    const { scrollTop, scrollHeight, clientHeight } = listEl.value
    isAtBottom.value = scrollHeight - scrollTop - clientHeight < 40
  }

  function scrollToBottom(smooth = true) {
    if (!listEl.value) return

    isAtBottom.value = true
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        listEl.value?.scrollTo({
          behavior: smooth ? 'smooth' : 'auto',
          top: listEl.value!.scrollHeight,
        })
      })
    })
  }

  async function scrollToBottomOnNewMessage() {
    if (!isAtBottom.value || !listEl.value) return

    await nextTick()
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
