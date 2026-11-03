// GitHub gemoji's MIT-licensed Unicode aliases; see data/gemoji-LICENSE.
import aliases from '../data/emoji-shortcodes.json'
import type { EmoteSuggestion } from '../views/main/utils/autocompleteUtils'

export const emojiShortcodeSuggestions: EmoteSuggestion[] = Object.entries(aliases).map(
  ([alias, emoji]) => ({
    type: 'emote',
    label: `:${alias}:`,
    emoji,
    imageUrl: '',
    animated: false,
  }),
)
