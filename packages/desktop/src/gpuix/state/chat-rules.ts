import { persistentResource } from '../../state/persistent-resources'
import { DEFAULT_CHAT_RULES, validateChatRules } from '../message-rules'
import type { PreferenceStore } from './preferences'
import { createPreferenceStore } from './preferences'

export const chatRulesPreferences = persistentResource('preference:chat_rules_v1', () =>
  createPreferenceStore('chat_rules_v1', DEFAULT_CHAT_RULES, validateChatRules),
)
export const chatRulesStore = chatRulesPreferences.store

declare module '../../state/persistent-resources' {
  interface PersistentResources {
    'preference:chat_rules_v1': PreferenceStore<typeof DEFAULT_CHAT_RULES>
  }
}
