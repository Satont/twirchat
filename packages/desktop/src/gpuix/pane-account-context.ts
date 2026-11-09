import { createContext, useContext } from 'react'

/**
 * The saved account the surrounding chat pane acts with (sending, moderation, chat commands).
 * Undefined outside a watched-chat pane, where actions use the chat's or the default account.
 */
export const PaneAccountContext = createContext<string | undefined>(undefined)

export function usePaneAccountId(): string | undefined {
  return useContext(PaneAccountContext)
}
