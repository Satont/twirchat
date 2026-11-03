import {
  DEFAULT_CHAT_PAUSE_PREFERENCES,
  validateChatPausePreferences,
  type ChatPausePreferences,
} from '../../services/chat-pause'
import { persistentResource } from './persistent-resources'
import type { PreferenceStore } from './preferences'
import { createPreferenceStore, type PreferenceApi } from './preferences'

export const chatPausePreferences = persistentResource('preference:ui.chatPause', () =>
  createPreferenceStore<ChatPausePreferences>(
    'ui.chatPause',
    { ...DEFAULT_CHAT_PAUSE_PREFERENCES },
    validateChatPausePreferences,
  ),
)
export const chatPauseStore = chatPausePreferences.store
export const loadChatPausePreferences = (api: PreferenceApi): Promise<void> =>
  chatPausePreferences.load(api)

declare module './persistent-resources' {
  interface PersistentResources {
    'preference:ui.chatPause': PreferenceStore<ChatPausePreferences>
  }
}
