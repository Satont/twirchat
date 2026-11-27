import { useGpuixRequired, useWindowSize } from '@gpuix/react'
import {
  CHAT_HEADER_ACTIONS,
  DEFAULT_SETTINGS,
  type AppSettings,
  type ChatHeaderAction,
  type UsernameDisplayMode,
} from '@twirchat/shared/types'
import { useEffect } from 'react'

import { useBackend } from '../../backend/context'
import { CHAT_HEADER_ACTION_META } from '../../chat-header-actions'
import { useT, type MessageKey } from '../../i18n'
import {
  MENTION_AVATAR_OPTION_BY_STYLE,
  MENTION_AVATAR_OPTIONS,
  resolveMentionAvatarStyle,
} from '../../mention-avatar'
import { settingsStore } from '../../state/app'
import { CHAT_FONT_SIZE_MAX, CHAT_FONT_SIZE_MIN } from '../../state/chat-font-size'
import { useTheme } from '../../theme-context'
import { formatChatAuthorName, PREVIEW_LOCALIZED_AUTHOR } from '../../username-display'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Slider } from '../ui/Slider'
import { Switch } from '../ui/Switch'
import { Text } from '../ui/Text'
import { ChatAppearancePreview } from './ChatAppearancePreview'

interface UsernameDisplayOption {
  readonly value: UsernameDisplayMode
  readonly labelKey: MessageKey
}

const USERNAME_DISPLAY_OPTIONS: readonly UsernameDisplayOption[] = [
  {
    value: 'localized-and-username',
    labelKey: 'settings.chat.usernameDisplayMode.localizedAndUsername',
  },
  {
    value: 'localized',
    labelKey: 'settings.chat.usernameDisplayMode.localized',
  },
  {
    value: 'username',
    labelKey: 'settings.chat.usernameDisplayMode.username',
  },
]

export function ChatAppearanceDialog({
  settings,
  onClose,
}: {
  settings: AppSettings
  onClose?: () => void
}) {
  const theme = useTheme()
  const backend = useBackend()
  const { t } = useT()
  const renderer = useGpuixRequired()
  const windowSize = useWindowSize()
  const narrow = windowSize.width < 820

  // Clicking the trigger doesn't blur a focused text editor, which would
  // block the window-level ESC handler — drop that focus on open.
  useEffect(() => {
    renderer.blur?.()
  }, [renderer])

  const patch = (partial: Partial<AppSettings>) => {
    const next = { ...settings, ...partial }
    settingsStore.set(next)
    void backend.api.saveSettings(next).catch((error) => {
      console.warn('[appearance] saveSettings failed:', error)
    })
  }

  const toggleHeaderAction = (action: ChatHeaderAction) => {
    const current = settings.chatHeaderActions ?? []
    patch({
      chatHeaderActions: current.includes(action)
        ? current.filter((entry) => entry !== action)
        : [...current, action],
    })
  }

  const activeMentionAvatarStyle = resolveMentionAvatarStyle(
    settings.mentionAvatarStyle,
    settings.showMentionAvatar,
  )

  const toggles: { key: keyof AppSettings; label: string }[] = [
    { key: 'showPlatformColorStripe', label: t('chat.appearance.toggle.stripe') },
    { key: 'showPlatformIcon', label: t('chat.appearance.toggle.platformIcon') },
    { key: 'showAvatars', label: t('chat.appearance.toggle.avatars') },
    { key: 'showBadges', label: t('chat.appearance.toggle.badges') },
    { key: 'showTimestamp', label: t('chat.appearance.toggle.timestamp') },
    { key: 'showChannelLabel', label: t('chat.appearance.toggle.channelLabel') },
    { key: 'emoteSessionCache', label: t('chat.appearance.toggle.emoteCache') },
    { key: 'showChatImagePreviews', label: t('chat.imagePreview.setting') },
  ]

  return (
    <Modal width={780} onClose={() => onClose?.()}>
      <div
        testId="appearance-dialog"
        style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <div
          style={{
            flexShrink: 0,
            paddingTop: 18,
            paddingBottom: 18,
            paddingLeft: 20,
            paddingRight: 20,
            borderBottomWidth: 1,
            borderColor: theme.border,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Text style={{ fontSize: 16, fontWeight: 700, color: theme.text }}>
              {t('chat.appearance.title')}
            </Text>
            <Text style={{ fontSize: 11, color: theme.text2 }}>
              {t('chat.appearance.subtitle')}
            </Text>
          </div>
          <div
            testId="appearance-close"
            role="button"
            aria-label={t('chat.appearance.closeLabel')}
            tabIndex={0}
            onClick={() => onClose?.()}
            onKeyDown={(event) => {
              if (event.key === 'enter' || event.key === 'space') {
                event.preventDefault()
                onClose?.()
              }
            }}
            style={{
              width: 30,
              height: 30,
              borderRadius: 7,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
              hover: { backgroundColor: theme.fillHover },
            }}
          >
            <Icon name="close" size={18} color={theme.text2} />
          </div>
        </div>

        <div
          testId="appearance-scroll"
          style={{
            flexGrow: 1,
            minHeight: 0,
            overflowY: 'scroll',
            scrollbarColor: theme.scrollbar,
            scrollbarWidth: 4,
            padding: 20,
            display: 'flex',
            flexDirection: narrow ? 'column' : 'row',
            alignItems: narrow ? 'stretch' : 'flex-start',
            gap: 16,
          }}
        >
          <div
            style={{
              flexGrow: 1,
              minWidth: 0,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 12,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: 700, color: theme.text2 }}>
                {t('chat.appearance.preview').toUpperCase()}
              </Text>
              <Text style={{ fontSize: 10, color: theme.text2 }}>{t('chat.appearance.live')}</Text>
            </div>
            <ChatAppearancePreview settings={settings} height={narrow ? 240 : 360} />
            <Text style={{ fontSize: 10, color: theme.text2 }}>
              {t('chat.appearance.sampleHint')}
            </Text>
          </div>

          <div
            style={{
              width: narrow ? '100%' : 300,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Font size */}
            <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text2 }}>
                  {t('chat.appearance.fontSize').toUpperCase()}
                </Text>
                <Text style={{ fontSize: 12, fontWeight: 500, color: theme.text }}>
                  {`${settings.fontSize}px`}
                </Text>
              </div>
              <Slider
                value={settings.fontSize}
                min={CHAT_FONT_SIZE_MIN}
                max={CHAT_FONT_SIZE_MAX}
                width={narrow ? 208 : 260}
                onChange={(fontSize) => patch({ fontSize })}
              />
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  marginTop: 4,
                }}
              >
                <Text style={{ fontSize: 10, color: theme.text2 }}>{CHAT_FONT_SIZE_MIN}</Text>
                <Text style={{ fontSize: 10, color: theme.text2 }}>{CHAT_FONT_SIZE_MAX}</Text>
              </div>
              <Text style={{ fontSize: 10, color: theme.text2, marginTop: 4 }}>
                {t('chat.appearance.fontSizeHint')}
              </Text>
            </div>

            {/* Display toggles */}
            <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column' }}>
              <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text2, marginBottom: 10 }}>
                {t('chat.appearance.display').toUpperCase()}
              </Text>
              {toggles.map((toggle, index) => (
                <div
                  key={toggle.key}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: index === 0 ? 0 : 7,
                    paddingBottom: 7,
                    borderBottomWidth: index === toggles.length - 1 ? 0 : 1,
                    borderColor: theme.divider,
                  }}
                >
                  <div style={{ minWidth: 0, flexGrow: 1, paddingRight: 8, gap: 2 }}>
                    <Text style={{ fontSize: 13, color: theme.text }}>{toggle.label}</Text>
                    {toggle.key === 'showChatImagePreviews' ? (
                      <Text style={{ fontSize: 11, color: theme.text2 }}>
                        {t('chat.imagePreview.privacy')}
                      </Text>
                    ) : null}
                  </div>
                  <Switch
                    small
                    aria-label={toggle.label}
                    checked={Boolean(settings[toggle.key] ?? DEFAULT_SETTINGS[toggle.key])}
                    onChange={(value) => patch({ [toggle.key]: value })}
                  />
                </div>
              ))}
            </div>

            {/* Mentioned user avatar */}
            <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column' }}>
              <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text2, marginBottom: 8 }}>
                {t('chat.appearance.mentionAvatar').toUpperCase()}
              </Text>
              <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {MENTION_AVATAR_OPTIONS.map((option) => {
                  const active = activeMentionAvatarStyle === option.value
                  const label = t(option.labelKey)
                  const selectStyle = () =>
                    patch({
                      mentionAvatarStyle: option.value,
                      showMentionAvatar: option.value !== 'off',
                    })
                  return (
                    <div
                      key={option.value}
                      testId={`appearance-mention-avatar-${option.value}`}
                      role="button"
                      aria-label={label}
                      aria-description={active ? t('misc.toggle.selected') : undefined}
                      aria-pressed={active}
                      tabIndex={0}
                      onClick={selectStyle}
                      onKeyDown={(event) => {
                        if (event.key === 'enter' || event.key === 'space') {
                          event.preventDefault()
                          selectStyle()
                        }
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 5,
                        paddingTop: 5,
                        paddingBottom: 5,
                        paddingLeft: 9,
                        paddingRight: 10,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: active ? theme.accent.primary : theme.hairline,
                        backgroundColor: active ? theme.accent.tint12 : theme.fill,
                        cursor: 'pointer',
                        hover: { backgroundColor: active ? theme.accent.tint20 : theme.fillHover },
                        focusVisible: {
                          outlineWidth: 1,
                          outlineColor: theme.link,
                          outlineOffset: -2,
                        },
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: active ? 600 : 500,
                          color: active ? theme.accent.primary : theme.text,
                        }}
                      >
                        {label}
                      </Text>
                    </div>
                  )
                })}
              </div>
              <Text style={{ fontSize: 10, color: theme.text2, marginTop: 6 }}>
                {t(MENTION_AVATAR_OPTION_BY_STYLE[activeMentionAvatarStyle].hintKey)}
              </Text>
            </div>

            {/* Pane header buttons */}
            <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column' }}>
              <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text2, marginBottom: 8 }}>
                {t('chat.appearance.buttons').toUpperCase()}
              </Text>
              <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {CHAT_HEADER_ACTIONS.map((action) => {
                  const meta = CHAT_HEADER_ACTION_META[action]
                  const label = t(meta.labelKey)
                  const active = (settings.chatHeaderActions ?? []).includes(action)
                  return (
                    <div
                      key={action}
                      testId={`appearance-header-action-${action}`}
                      role="button"
                      aria-label={label}
                      aria-description={active ? t('misc.toggle.selected') : undefined}
                      aria-pressed={active}
                      tabIndex={0}
                      onClick={() => toggleHeaderAction(action)}
                      onKeyDown={(event) => {
                        if (event.key === 'enter' || event.key === 'space') {
                          event.preventDefault()
                          toggleHeaderAction(action)
                        }
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 5,
                        paddingTop: 5,
                        paddingBottom: 5,
                        paddingLeft: 8,
                        paddingRight: 9,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: active ? theme.accent.primary : theme.hairline,
                        backgroundColor: active ? theme.accent.tint12 : theme.fill,
                        cursor: 'pointer',
                        hover: { backgroundColor: active ? theme.accent.tint20 : theme.fillHover },
                        focusVisible: {
                          outlineWidth: 1,
                          outlineColor: theme.link,
                          outlineOffset: -2,
                        },
                      }}
                    >
                      <Icon
                        name={active ? 'check' : meta.icon}
                        size={12}
                        color={active ? theme.accent.primary : theme.text2}
                      />
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: active ? 600 : 500,
                          color: active ? theme.accent.primary : theme.text,
                        }}
                      >
                        {label}
                      </Text>
                    </div>
                  )
                })}
              </div>
              <Text style={{ fontSize: 10, color: theme.text2, marginTop: 6 }}>
                {t('chat.appearance.buttonsHint')}
              </Text>
            </div>

            {/* Username display */}
            <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column' }}>
              <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text2, marginBottom: 8 }}>
                {t('chat.appearance.usernames').toUpperCase()}
              </Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {USERNAME_DISPLAY_OPTIONS.map((option) => {
                  const active = settings.usernameDisplayMode === option.value
                  const label = t(option.labelKey)
                  const example = formatChatAuthorName(PREVIEW_LOCALIZED_AUTHOR, option.value)
                  return (
                    <div
                      key={option.value}
                      testId={`appearance-username-display-${option.value}`}
                      role="button"
                      aria-label={label}
                      aria-description={active ? t('misc.toggle.selected') : undefined}
                      tabIndex={0}
                      onClick={() => patch({ usernameDisplayMode: option.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'enter' || event.key === 'space') {
                          event.preventDefault()
                          patch({ usernameDisplayMode: option.value })
                        }
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        paddingTop: 6,
                        paddingBottom: 6,
                        paddingLeft: 10,
                        paddingRight: 10,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: active ? theme.accent.primary : theme.hairline,
                        backgroundColor: active ? theme.accent.tint12 : theme.fill,
                        cursor: 'pointer',
                        hover: { backgroundColor: active ? theme.accent.tint20 : theme.fillHover },
                        focusVisible: {
                          outlineWidth: 1,
                          outlineColor: theme.link,
                          outlineOffset: -2,
                        },
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: active ? 600 : 500,
                          color: active ? theme.accent.primary : theme.text,
                        }}
                      >
                        {label}
                      </Text>
                      <Text style={{ fontSize: 11, color: theme.text2, flexShrink: 0 }}>
                        {example}
                      </Text>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Theme cards */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text2, marginBottom: 10 }}>
                {t('chat.appearance.layout').toUpperCase()}
              </Text>
              <div style={{ display: 'flex', flexDirection: 'row', gap: 10 }}>
                <ThemeCard
                  label={t('chat.appearance.modern')}
                  active={settings.chatTheme === 'modern'}
                  onClick={() => patch({ chatTheme: 'modern' })}
                  preview="modern"
                />
                <ThemeCard
                  label={t('chat.appearance.compact')}
                  active={settings.chatTheme === 'compact'}
                  onClick={() => patch({ chatTheme: 'compact' })}
                  preview="compact"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function ThemeCard({
  label,
  active,
  onClick,
  preview,
}: {
  label: string
  active: boolean
  onClick: () => void
  preview: 'modern' | 'compact'
}) {
  const theme = useTheme()
  return (
    <div
      testId={`theme-${preview}`}
      onClick={onClick}
      style={{
        flexGrow: 1,
        backgroundColor: active ? 'rgba(167, 139, 250, 0.1)' : theme.fill,
        borderWidth: 1,
        borderColor: active ? theme.accent.primary : theme.hairline,
        borderRadius: 10,
        paddingTop: 10,
        paddingBottom: 8,
        paddingLeft: 8,
        paddingRight: 8,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        hover: { backgroundColor: theme.fillHover },
      }}
    >
      {preview === 'modern' ? (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[0, 1].map((row) => (
            <div key={row} style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: theme.scrollbar,
                  flexShrink: 0,
                  marginTop: 1,
                }}
              />
              <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div
                  style={{
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: 'rgba(167, 139, 250, 0.5)',
                    width: '40%',
                  }}
                />
                <div
                  style={{
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: theme.hairline,
                    width: '85%',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[28, 28, 18].map((nameWidth, row) => (
            <div
              key={row}
              style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 3 }}
            >
              <div
                style={{
                  width: `${nameWidth}%`,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: 'rgba(167, 139, 250, 0.5)',
                  flexShrink: 0,
                }}
              />
              <div
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: 1,
                  backgroundColor: theme.scrollbar,
                  flexShrink: 0,
                }}
              />
              <div
                style={{
                  flexGrow: 1,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: theme.hairline,
                }}
              />
            </div>
          ))}
        </div>
      )}
      <Text style={{ fontSize: 11, fontWeight: 500, color: active ? theme.link : theme.text2 }}>
        {label}
      </Text>
    </div>
  )
}
