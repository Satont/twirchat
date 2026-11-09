import type { KeyEvent } from '@gpuix/react'
import { useEffect, useRef, useState } from 'react'

import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import {
  HOTKEY_ACTIONS,
  isHotkeyCategory,
  recordHotkeyStroke,
  parseHotkeyArguments,
  validateHotkeyBindings,
  type HotkeyAction,
  type HotkeyBinding,
  type HotkeyCategory,
} from '../hotkey-bindings'
import { useT, type MessageKey } from '../i18n'
import {
  actionBindingsPreferences,
  actionBindingsStore,
  loadActionBindings,
  registerHotkeyRecorder,
} from '../state/action-bindings'
import { useStore } from '../state/create-store'
import { useWindowScope } from '../state/window-scope'
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { ActionButton, FormField, FormInput } from './ui/Form'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

const categories = Object.keys(HOTKEY_ACTIONS).filter(isHotkeyCategory)
const categoryNames: Record<HotkeyCategory, MessageKey> = {
  window: 'hotkeySettings.category.window',
  split: 'hotkeySettings.category.split',
  splitInput: 'hotkeySettings.category.splitInput',
  popupWindow: 'hotkeySettings.category.popupWindow',
}
const actionLabels: Record<HotkeyAction, MessageKey> = {
  newSplit: 'hotkeySettings.action.newSplit',
  newTab: 'hotkeySettings.action.newTab',
  openSettings: 'hotkeySettings.action.openSettings',
  openAccountSelector: 'hotkeySettings.action.openAccountSelector',
  openQuickSwitcher: 'hotkeySettings.action.openQuickSwitcher',
  quit: 'hotkeySettings.action.quit',
  removeTab: 'hotkeySettings.action.removeTab',
  reopenSplit: 'hotkeySettings.action.reopenSplit',
  selectTabHistoryBack: 'hotkeySettings.action.selectTabHistoryBack',
  selectTabHistoryForward: 'hotkeySettings.action.selectTabHistoryForward',
  toggleLocalR9K: 'hotkeySettings.action.toggleLocalR9K',
  openFollowedChannels: 'hotkeySettings.action.openFollowedChannels',
  moveTab: 'hotkeySettings.action.moveTab',
  openTab: 'hotkeySettings.action.openTab',
  popup: 'hotkeySettings.action.popup',
  setStreamerMode: 'hotkeySettings.action.setStreamerMode',
  zoom: 'hotkeySettings.action.zoom',
  setTabVisibility: 'hotkeySettings.action.setTabVisibility',
  changeChannel: 'hotkeySettings.action.changeChannel',
  clearMessages: 'hotkeySettings.action.clearMessages',
  createClip: 'hotkeySettings.action.createClip',
  delete: 'hotkeySettings.action.delete',
  openInBrowser: 'hotkeySettings.action.openInBrowser',
  openPlayerInBrowser: 'hotkeySettings.action.openPlayerInBrowser',
  openInCustomPlayer: 'hotkeySettings.action.openInCustomPlayer',
  openInStreamlink: 'hotkeySettings.action.openInStreamlink',
  openModView: 'hotkeySettings.action.openModView',
  openUnbanRequests: 'hotkeySettings.action.openUnbanRequests',
  openRewardQueue: 'hotkeySettings.action.openRewardQueue',
  openViewerList: 'hotkeySettings.action.openViewerList',
  pickFilters: 'hotkeySettings.action.pickFilters',
  reconnect: 'hotkeySettings.action.reconnect',
  scrollToBottom: 'hotkeySettings.action.scrollToBottom',
  scrollToTop: 'hotkeySettings.action.scrollToTop',
  showSearch: 'hotkeySettings.action.showSearch',
  showGlobalSearch: 'hotkeySettings.action.showGlobalSearch',
  debug: 'hotkeySettings.action.debug',
  popupOverlay: 'hotkeySettings.action.popupOverlay',
  openSubscriptionPage: 'hotkeySettings.action.openSubscriptionPage',
  focus: 'hotkeySettings.action.focus',
  reloadEmotes: 'hotkeySettings.action.reloadEmotes',
  runCommand: 'hotkeySettings.action.runCommand',
  scrollPage: 'hotkeySettings.action.scrollPage',
  setChannelNotification: 'hotkeySettings.action.setChannelNotification',
  setModerationMode: 'hotkeySettings.action.setModerationMode',
  toggleOverlayInertia: 'hotkeySettings.action.toggleOverlayInertia',
  setHighlightSounds: 'hotkeySettings.action.setHighlightSounds',
  changeMultichannelContext: 'hotkeySettings.action.changeMultichannelContext',
  clear: 'hotkeySettings.action.clear',
  nextMessage: 'hotkeySettings.action.nextMessage',
  openEmotesPopup: 'hotkeySettings.action.openEmotesPopup',
  paste: 'hotkeySettings.action.paste',
  previousMessage: 'hotkeySettings.action.previousMessage',
  redo: 'hotkeySettings.action.redo',
  selectAll: 'hotkeySettings.action.selectAll',
  selectWord: 'hotkeySettings.action.selectWord',
  toggleTranslateOnSend: 'hotkeySettings.action.toggleTranslateOnSend',
  undo: 'hotkeySettings.action.undo',
  cancelReply: 'hotkeySettings.action.cancelReply',
  copy: 'hotkeySettings.action.copy',
  cursorToStart: 'hotkeySettings.action.cursorToStart',
  cursorToEnd: 'hotkeySettings.action.cursorToEnd',
  sendMessage: 'hotkeySettings.action.sendMessage',
  'incremental-search-history': 'hotkeySettings.action.incremental-search-history',
  reject: 'hotkeySettings.action.reject',
  accept: 'hotkeySettings.action.accept',
  search: 'hotkeySettings.action.search',
  openProfilePictureMenu: 'hotkeySettings.action.openProfilePictureMenu',
  pin: 'hotkeySettings.action.pin',
  execModeratorAction: 'hotkeySettings.action.execModeratorAction',
}
export function HotkeySettings() {
  const backend = useBackend()
  const scope = useWindowScope()
  const theme = useTheme()
  const { t } = useT()
  const state = useStore(actionBindingsStore)
  const [draft, setDraft] = useState(() => structuredClone(state.value))
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const capture = useRef<(event: KeyEvent) => void>(() => {})
  const revision = useRef(0)
  const recordingOriginalKeys = useRef<string[]>([])
  useEffect(() => {
    runUiTask(loadActionBindings(backend.api))
  }, [backend])
  useEffect(() => {
    if (!dirty) setDraft(structuredClone(state.value))
  }, [dirty, state.value])
  useEffect(() => {
    if (recording) return registerHotkeyRecorder(scope, (event) => capture.current(event))
  }, [recording, scope])
  const change = (update: (value: typeof draft) => void) => {
    revision.current++
    setDirty(true)
    setError('')
    setNotice('')
    setDraft((current) => {
      const next = structuredClone(current)
      update(next)
      return next
    })
  }
  const binding = draft.bindings.find((entry) => entry.id === selected)
  const edit = (update: (entry: HotkeyBinding) => void) =>
    change((value) => {
      const entry = value.bindings.find((item) => item.id === selected)
      if (entry) update(entry)
    })
  const validation = (() => {
    try {
      validateHotkeyBindings(draft.bindings)
      return ''
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
  })()
  capture.current = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const result = recordHotkeyStroke(binding?.keys ?? [], event)
    if (!result) return
    if (result.cancelled) {
      edit((entry) => {
        entry.keys = recordingOriginalKeys.current
      })
      setRecording(false)
      return
    }
    edit((entry) => {
      entry.keys = result.keys
    })
    if (result.complete) setRecording(false)
  }
  const save = async (): Promise<boolean> => {
    const requested = revision.current
    try {
      await actionBindingsPreferences.save(backend.api, draft)
      const current = revision.current === requested
      if (current) setDirty(false)
      return current
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 12 }}>
      <Text style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
        {t('hotkeySettings.title')}
      </Text>
      <Text style={{ fontSize: 12, color: theme.text2 }}>{t('hotkeySettings.description')}</Text>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Switch
          checked={draft.legacyNavigation}
          onChange={(value) =>
            change((next) => {
              next.legacyNavigation = value
            })
          }
        />
        <Text style={{ fontSize: 12, color: theme.text }}>
          {t('hotkeySettings.legacyNavigation')}
        </Text>
      </div>
      {!state.loaded ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>{t('hotkeySettings.loading')}</Text>
      ) : null}
      {state.error && !dirty ? (
        <ActionButton
          onClick={() => {
            runUiTask(loadActionBindings(backend.api))
          }}
        >
          {t('hotkeySettings.retry')}
        </ActionButton>
      ) : null}
      {draft.bindings.length === 0 ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>{t('hotkeySettings.empty')}</Text>
      ) : null}
      {draft.bindings.map((entry) => (
        <div key={entry.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <ActionButton
            onClick={() => {
              setSelected(entry.id)
              setRecording(false)
            }}
          >
            {entry.id === 'cancel-reply-default' && entry.name === 'Cancel Reply'
              ? t('hotkeySettings.cancelReplyDefault')
              : entry.name ||
                `${t(categoryNames[entry.category])} · ${t(actionLabels[entry.action])}`}
          </ActionButton>
          <Text style={{ fontSize: 11, color: theme.text2 }}>
            {entry.keys.join(' → ') || t('hotkeySettings.noKeys')}
            {entry.enabled ? '' : ` · ${t('hotkeySettings.disabled')}`}
          </Text>
          <ActionButton
            danger
            onClick={() => {
              change((value) => {
                value.bindings = value.bindings.filter((item) => item.id !== entry.id)
              })
              if (selected === entry.id) {
                setSelected(null)
                setRecording(false)
              }
            }}
          >
            {t('hotkeySettings.remove')}
          </ActionButton>
        </div>
      ))}
      <ActionButton
        testId="hotkey-add"
        disabled={!state.loaded || state.saving || draft.bindings.length >= 512}
        onClick={() => {
          const id = crypto.randomUUID()
          change((value) => {
            value.bindings.push({
              id,
              name: '',
              enabled: true,
              category: 'window',
              action: 'openSettings',
              keys: [],
              arguments: [],
            })
          })
          setSelected(id)
        }}
      >
        {t('hotkeySettings.add')}
      </ActionButton>
      {binding ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 12,
            backgroundColor: theme.surface2,
            borderRadius: 6,
          }}
        >
          <FormField label={t('hotkeySettings.name')}>
            <FormInput
              value={binding.name}
              onChange={(value) =>
                edit((entry) => {
                  entry.name = value
                })
              }
              placeholder={t('hotkeySettings.namePlaceholder')}
            />
          </FormField>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Switch
              checked={binding.enabled}
              onChange={(value) =>
                edit((entry) => {
                  entry.enabled = value
                })
              }
            />
            <Text style={{ fontSize: 12, color: theme.text }}>{t('hotkeySettings.enabled')}</Text>
          </div>
          <FormField label={t('hotkeySettings.context')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {categories.map((category) => (
                <ActionButton
                  key={category}
                  primary={binding.category === category}
                  onClick={() =>
                    edit((entry) => {
                      entry.category = category
                      entry.action = HOTKEY_ACTIONS[category][0]
                      entry.arguments = []
                    })
                  }
                >
                  {t(categoryNames[category])}
                </ActionButton>
              ))}
            </div>
          </FormField>
          <FormField label={t('hotkeySettings.action')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {HOTKEY_ACTIONS[binding.category].map((action) => (
                <ActionButton
                  key={action}
                  primary={binding.action === action}
                  onClick={() =>
                    edit((entry) => {
                      entry.action = action
                      entry.arguments = []
                    })
                  }
                >
                  {t(actionLabels[action])}
                </ActionButton>
              ))}
            </div>
          </FormField>
          <FormField label={t('hotkeySettings.arguments')} hint={t('hotkeySettings.argumentsHint')}>
            <FormInput
              multiline
              value={binding.arguments.join('\n')}
              onChange={(value) =>
                edit((entry) => {
                  entry.arguments = parseHotkeyArguments(value)
                })
              }
            />
          </FormField>
          <FormField
            label={t('hotkeySettings.keySequence')}
            hint={t('hotkeySettings.keySequenceHint')}
          >
            <FormInput
              multiline
              value={binding.keys.join('\n')}
              onChange={(value) =>
                edit((entry) => {
                  entry.keys = value.split('\n')
                })
              }
            />
          </FormField>
          <div style={{ display: 'flex', gap: 6 }}>
            <ActionButton
              testId="hotkey-record"
              onClick={() => {
                recordingOriginalKeys.current = [...binding.keys]
                edit((entry) => {
                  entry.keys = []
                })
                setRecording(true)
              }}
            >
              {t('hotkeySettings.recordKeys')}
            </ActionButton>
            {recording ? (
              <ActionButton onClick={() => setRecording(false)}>
                {t('hotkeySettings.finishRecording')}
              </ActionButton>
            ) : null}
          </div>
          {recording ? (
            <div
              testId="action-hotkey-capture"
              autoFocus
              tabIndex={0}
              onKeyDown={(event) => capture.current(event)}
              style={{ padding: 10, borderWidth: 1, borderColor: theme.border, borderRadius: 5 }}
            >
              <Text style={{ fontSize: 12, color: theme.text }}>
                {t('hotkeySettings.recordingHint')}
              </Text>
            </div>
          ) : null}
        </div>
      ) : null}
      <SettingsFooter
        sectionId="shortcuts"
        dirty={dirty}
        saving={state.saving}
        error={error || state.error || validation}
        errorTestId="hotkey-save-error"
        note={notice}
        disabled={!state.loaded || recording || Boolean(validation)}
        saveTestId="hotkey-save"
        onSave={save}
        onDiscard={() => {
          revision.current++
          setDraft(structuredClone(state.value))
          setDirty(false)
          setError('')
          setNotice('')
        }}
      />
    </div>
  )
}
