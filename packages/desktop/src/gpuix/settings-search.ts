import { t, type MessageKey } from './i18n'
import { THEME_PRESETS } from './theme'

interface SettingsCategoryMetadata {
  id: string
  label: string
  description: string
  aliases: string
}
function defineSettingsCategories<const Categories extends readonly SettingsCategoryMetadata[]>(
  categories: Categories,
): Categories {
  return categories
}
export const SETTINGS_CATEGORIES = defineSettingsCategories([
  {
    id: 'general',
    label: 'General',
    description: 'Appearance and updates',
    aliases: 'appearance general общие внешний вид настройки',
  },
  {
    id: 'chat',
    label: 'Chat',
    description: 'Notifications, rules and history',
    aliases: 'chat messages чат сообщения',
  },
  {
    id: 'emotes',
    label: 'Emotes',
    description: 'Providers and cosmetics',
    aliases: 'emotes cosmetics providers badges emoji эмоуты смайлы косметика значки',
  },
  {
    id: 'privacy',
    label: 'Privacy',
    description: 'Streamer mode and private details',
    aliases: 'privacy streamer mode stream software obs приватность стример режим скрыть',
  },
  {
    id: 'translation',
    label: 'Translation',
    description: 'Languages and providers',
    aliases: 'translation translator languages перевод переводчик языки',
  },
  {
    id: 'moderation',
    label: 'Moderation',
    description: 'Timeouts and reasons',
    aliases: 'moderation timeout ban reasons user card модерация таймаут бан причины',
  },
  {
    id: 'commands',
    label: 'Commands',
    description: 'Custom commands and actions',
    aliases: 'commands aliases macros actions команды алиасы макросы действия',
  },
  {
    id: 'plugins',
    label: 'Plugins',
    description: 'Local and remote extensions and channel transports',
    aliases: 'plugins extensions transports manifest github url плагины расширения транспорты',
  },
  {
    id: 'donations',
    label: 'Donations',
    description: 'Live donation alerts in My channels',
    aliases: 'donations tips alerts events донаты пожертвования алерты события',
  },
  {
    id: 'overlay',
    label: 'OBS overlay',
    description: 'Browser source appearance',
    aliases: 'obs overlay browser source оверлей обс браузер источник',
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    description: 'Keyboard bindings',
    aliases: 'shortcuts keyboard hotkeys bindings keys клавиатура хоткеи сочетания клавиши',
  },
  {
    id: 'twitch-session',
    label: 'Twitch session',
    description: 'Additional web session',
    aliases: 'twitch session account web auth token твич сессия аккаунт авторизация токен',
  },
])
export type SettingsCategoryId = (typeof SETTINGS_CATEGORIES)[number]['id']
export type SettingsSaveMode = 'section' | 'action'

const CATEGORY_LABEL_KEYS: Record<SettingsCategoryId, MessageKey> = {
  general: 'settings.category.general',
  chat: 'settings.category.chat',
  emotes: 'settings.category.emotes',
  privacy: 'settings.category.privacy',
  translation: 'settings.category.translation',
  moderation: 'settings.category.moderation',
  commands: 'settings.category.commands',
  plugins: 'settings.category.plugins',
  donations: 'settings.category.donations',
  overlay: 'settings.category.overlay',
  shortcuts: 'settings.category.shortcuts',
  'twitch-session': 'settings.category.twitch-session',
}

const CATEGORY_DESCRIPTION_KEYS: Record<SettingsCategoryId, MessageKey> = {
  general: 'settings.category.general.desc',
  chat: 'settings.category.chat.desc',
  emotes: 'settings.category.emotes.desc',
  privacy: 'settings.category.privacy.desc',
  translation: 'settings.category.translation.desc',
  moderation: 'settings.category.moderation.desc',
  commands: 'settings.category.commands.desc',
  plugins: 'settings.category.plugins.desc',
  donations: 'settings.category.donations.desc',
  overlay: 'settings.category.overlay.desc',
  shortcuts: 'settings.category.shortcuts.desc',
  'twitch-session': 'settings.category.twitch-session.desc',
}

export function settingsCategoryLabel(id: SettingsCategoryId): string {
  return t(CATEGORY_LABEL_KEYS[id])
}

export function settingsCategoryDescription(id: SettingsCategoryId): string {
  return t(CATEGORY_DESCRIPTION_KEYS[id])
}
export interface SettingsSectionMetadata {
  id: SettingsSectionId
  category: SettingsCategoryId
  title: string
  keywords: string
  saveMode: SettingsSaveMode
}
export type SettingsSectionId =
  | 'appearance'
  | 'updates'
  | 'notifications'
  | 'rules'
  | 'history'
  | 'image-uploader'
  | 'self-ping'
  | 'emotes'
  | 'translation'
  | 'moderation'
  | 'commands'
  | 'twir-integration'
  | 'players'
  | 'plugins'
  | 'donations'
  | 'streamer-mode'
  | 'similarity'
  | 'pause'
  | 'overlay'
  | 'shortcuts'
  | 'twitch-session'

/** Search only this small index; matching a setting never mounts or loads its editor. */
export const SETTINGS_SECTIONS: readonly SettingsSectionMetadata[] = [
  {
    id: 'streamer-mode',
    category: 'privacy',
    title: 'Streamer Mode',
    saveMode: 'section',
    keywords:
      'streamer mode auto obs streaming software privacy private avatar thumbnails moderation restricted whispers blocked terms viewer count duration mute mentions hideUsercardAvatars hideLinkThumbnails hideModActions hideRestrictedUsers muteMentions suppressInlineWhispers hideBlockedTermText hideViewerCountAndDuration suppressLiveNotifications приватность стример автоматический скрыть аватар зрители',
  },
  {
    id: 'similarity',
    category: 'chat',
    title: 'Similar Messages',
    saveMode: 'section',
    keywords:
      'similarity similar duplicates repetition R9K hideSimilar threshold maxMessages delaySeconds sameUserOnly excludeOwn graySimilar shownSimilarTriggerHighlights похожие одинаковые дубли повторы',
  },
  {
    id: 'pause',
    category: 'chat',
    title: 'Chat Pausing',
    saveMode: 'section',
    keywords:
      'pause hover mouse keyboard modifier control alt shift command double click links hoverSeconds doubleClickLinks пауза наведение мышь модификатор двойной клик ссылки',
  },
  {
    id: 'players',
    category: 'commands',
    title: 'Stream Players',
    saveMode: 'section',
    keywords:
      'players streamlink mpv vlc external executable custom player stream quality arguments url channel platform плеер стримлинк проигрыватель трансляция',
  },
  {
    id: 'appearance',
    category: 'general',
    title: 'Appearance',
    saveMode: 'section',
    keywords: `${THEME_PRESETS.map((preset) => preset.label).join(' ')} theme custom palette color mode variant hex accent font fontFamily Inter Manrope system appearance typography language locale English Russian язык локаль английский русский шрифт тема темная светлая палитра цвет акцент`,
  },
  {
    id: 'updates',
    category: 'general',
    title: 'Updates',
    saveMode: 'section',
    keywords:
      'version installed release feed check now automatic auto check startup autoCheckUpdates версия обновления проверить автоматически запуск',
  },
  {
    id: 'notifications',
    category: 'chat',
    title: 'Notifications',
    saveMode: 'section',
    keywords:
      'enable highlight notifications play rule sounds show desktop alerts custom sound file muted channels enabled soundEnabled desktopEnabled soundPath mutedChannels twitch kick youtube звук уведомления файл отключить каналы mute',
  },
  {
    id: 'rules',
    category: 'chat',
    title: 'Highlights, Ignores & Filters',
    saveMode: 'section',
    keywords:
      'chat rules highlights ignores ignored filters saved own messages replies platform highlight message username user id badge filter expression regular regex PCRE2 phrase whole words case sensitive name color RRGGBB RRGGBBAA mention sound flash window suppression replacement literal placeholder hidden enabled preview preset priority порядок подсветка игнор фильтр замена регулярное выражение значок пользователь',
  },
  {
    id: 'history',
    category: 'chat',
    title: 'History & Logging',
    saveMode: 'section',
    keywords:
      'history logging retention keep messages days age limit write chat logs files absolute folder path include timestamps start new log daily session maximum file size MiB rotation channel overrides flush pending logs export история логи хранение дни папка файл ротация журнал',
  },
  {
    id: 'image-uploader',
    category: 'chat',
    title: 'Image Uploader',
    saveMode: 'section',
    keywords:
      'paste clipboard screenshot image upload Twir OAuth sign in account ShareX Chatterino Leafyrino sxcu HTTP request URL multipart form field custom headers authorization image link deletion link import export загрузка изображений картинки скриншот вставка буфер обмена заголовки вход',
  },
  {
    id: 'self-ping',
    category: 'chat',
    title: 'Self-Ping Highlight',
    saveMode: 'section',
    keywords:
      'self ping nickname own mention enable highlights highlight color rgba preview selfPing самопинг никнейм упоминание цвет подсветки',
  },
  {
    id: 'emotes',
    category: 'emotes',
    title: 'Emotes & Cosmetics',
    saveMode: 'section',
    keywords:
      'platform emotes twitch 7TV seventv BetterTTV BTTV FrankerFaceZ FFZ FFZ:AP FFZAP DankChat Chatsen Homies Custom Twir community provider precedence priority move up down zero width layering modifiers personal badges paints name gradients emoji shortcode completion favorite emotes presence share active channel collectibles wide flip rotate shake party cursed эмоуты смайлы провайдеры порядок косметика краска значки избранное присутствие',
  },
  {
    id: 'translation',
    category: 'translation',
    title: 'Translation',
    saveMode: 'section',
    keywords:
      'translation provider Google free Microsoft free DeepL LibreTranslate Google Cloud Azure endpoint region server API key credential secret clipboard paste remove source target language auto detection incoming outgoing off preview send Morse recognize decode channel override custom languages перевод переводчик язык источник цель автоопределение входящие исходящие морзе ключ сервер регион',
  },
  {
    id: 'moderation',
    category: 'moderation',
    title: 'Moderation',
    saveMode: 'section',
    keywords:
      'show chat moderation slider drag user card eight timeout buttons label seconds durations quick reasons one per line default reason Twitch Kick 1 1209600 60 чат модерация слайдер ползунок перетаскивание карточка таймаут длительность секунды кнопки причины причина',
  },
  {
    id: 'commands',
    category: 'commands',
    title: 'Custom Commands',
    saveMode: 'section',
    keywords:
      'custom command name template variables placeholders platform scope channel message menu action add delete priority order move up down macro alias команды имя шаблон переменные платформа канал меню действия макрос',
  },
  {
    id: 'twir-integration',
    category: 'commands',
    title: 'Twir Integration',
    saveMode: 'section',
    keywords:
      'twir bot command autocomplete completion suggestions команды бота автодополнение интеграция',
  },
  {
    id: 'plugins',
    category: 'plugins',
    title: 'Plugins',
    saveMode: 'action',
    keywords:
      'install enable disable remove manifest version transport TypeScript локальные установить включить выключить удалить',
  },
  {
    id: 'donations',
    category: 'donations',
    title: 'Donation Providers',
    saveMode: 'action',
    keywords:
      'DonationAlerts donation alerts DonatePay DonatPay MemeAlerts MemoAlerts OAuth sign in API key clipboard events connect disconnect донаты пожертвования донаталертс донатпей мемалертс ключ подключить события',
  },
  {
    id: 'overlay',
    category: 'overlay',
    title: 'OBS Overlay',
    saveMode: 'section',
    keywords:
      'OBS overlay browser source URL copy port background transparent chroma key text color colour font size max messages animation slide fade none position bottom top show platform icon avatars overlay.port overlay.background overlay.textColor overlay.fontSize overlay.maxMessages overlay.animation overlay.position showPlatformIcon showAvatar оверлей обс ссылка копировать порт фон прозрачный цвет размер шрифта сообщения анимация позиция аватары',
  },
  {
    id: 'shortcuts',
    category: 'shortcuts',
    title: 'Keyboard Shortcuts',
    saveMode: 'section',
    keywords:
      'keyboard shortcuts hotkeys recording press key newTab nextTab prevTab tabSelector open new tab next previous cycle fuzzy search Ctrl Tab Ctrl K Alt Shift arrow combination клавиатура хоткеи сочетания запись новая вкладка следующая предыдущая поиск клавиша',
  },
  {
    id: 'twitch-session',
    category: 'twitch-session',
    title: 'Additional Twitch Session',
    saveMode: 'action',
    keywords:
      'additional Twitch web session OAuth token clipboard paste connect clear encrypted credentials identity channel points rewards polls predictions pins following whispers session токен сессия аккаунт подключить очистить буфер обмена награды опросы прогнозы закрепления шепот',
  },
]
const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
const index = SETTINGS_SECTIONS.map((section) => ({
  section,
  words: normalize(
    `${section.title} ${section.keywords} ${section.saveMode === 'action' ? 'actions apply immediately connect clear' : 'save discard unsaved changes'} ${SETTINGS_CATEGORIES.find((category) => category.id === section.category)!.aliases}`,
  ).split(/\s+/u),
}))
export interface SettingsSearchResult {
  query: string
  sections: readonly SettingsSectionMetadata[]
  categories: readonly (typeof SETTINGS_CATEGORIES)[number][]
}
export function searchSettings(query: string): SettingsSearchResult {
  const normalized = normalize(query)
  const tokens = normalized.split(/\s+/u).filter(Boolean)
  const sections = tokens.length
    ? index
        .filter((entry) =>
          tokens.every((token) => entry.words.some((word) => word.startsWith(token))),
        )
        .map((entry) => entry.section)
    : SETTINGS_SECTIONS
  return {
    query: normalized,
    sections,
    categories: SETTINGS_CATEGORIES.filter((category) =>
      sections.some((section) => section.category === category.id),
    ),
  }
}
export function resolveSettingsCategory(
  preferred: SettingsCategoryId,
  result: SettingsSearchResult,
): SettingsCategoryId | null {
  return result.categories.some((category) => category.id === preferred)
    ? preferred
    : (result.categories[0]?.id ?? null)
}
export function visibleSettingsSections(
  category: SettingsCategoryId | null,
  result: SettingsSearchResult,
): SettingsSectionId[] {
  return result.sections
    .filter((section) => section.category === category)
    .map((section) => section.id)
}
/** Retain mounted editors so moving between categories never discards local drafts. */
export function retainMountedSettingsSections(
  mounted: ReadonlySet<SettingsSectionId>,
  visible: readonly SettingsSectionId[],
): ReadonlySet<SettingsSectionId> {
  if (visible.every((id) => mounted.has(id))) return mounted
  return new Set([...mounted, ...visible])
}
export function stepSettingsCategory(
  ids: readonly SettingsCategoryId[],
  current: SettingsCategoryId,
  direction: 1 | -1,
): SettingsCategoryId | null {
  if (!ids.length) return null
  const index = ids.indexOf(current)
  if (index < 0) return direction === 1 ? ids[0]! : ids.at(-1)!
  return ids[(index + direction + ids.length) % ids.length]!
}
