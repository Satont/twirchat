import type { Platform } from '@twirchat/shared/types'
import { useEffect, useRef, useState } from 'react'

import { useBackend } from '../backend/context'
import type { CustomCommandDefinition } from '../commands'
import { useT } from '../i18n'
import { useStore } from '../state/create-store'
import {
  customCommandsStore,
  loadCustomCommands,
  saveCustomCommands,
} from '../state/custom-commands'
import { useTextInputFocusTracking } from '../state/focus'
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

/** Settings section body. Commands have their own explicit, persisted save. */
export function CustomCommandsSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const { t } = useT()
  const state = useStore(customCommandsStore)
  const [draft, setDraft] = useState(state.commands)
  const edited = useRef(false)
  const latestDraft = useRef(draft)
  latestDraft.current = draft
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.commands)

  useEffect(() => {
    void loadCustomCommands(backend.api).catch(() => {})
  }, [backend])
  useEffect(() => {
    if (!edited.current) setDraft(state.commands)
  }, [state.commands])

  const change = (commands: CustomCommandDefinition[]) => {
    edited.current = true
    setDraft(commands)
  }
  const patch = (id: string, values: Partial<CustomCommandDefinition>) => {
    change(draft.map((command) => (command.id === id ? { ...command, ...values } : command)))
  }
  const move = (index: number, delta: number) => {
    if (index + delta < 0 || index + delta >= draft.length) return
    const commands = [...draft]
    const [command] = commands.splice(index, 1)
    commands.splice(index + delta, 0, command!)
    change(commands)
  }
  const save = async (): Promise<boolean> => {
    const snapshot = draft
    try {
      await saveCustomCommands(backend.api, snapshot)
      if (latestDraft.current !== snapshot) return false
      edited.current = false
      setDraft(customCommandsStore.get().commands)
      return true
    } catch {
      /* The shared store exposes the validation or persistence error below. */
      return false
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Text style={{ fontSize: 12, color: theme.text2 }}>{t('customCommandsSettings.intro')}</Text>
      <Text style={{ fontSize: 11, color: theme.text2 }}>{t('customCommandsSettings.intro2')}</Text>
      {state.loading ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>
          {t('customCommandsSettings.loading')}
        </Text>
      ) : null}
      {!state.loaded && !state.loading && state.error ? (
        <CommandButton
          label={t('customCommandsSettings.retry')}
          onClick={() => void loadCustomCommands(backend.api).catch(() => {})}
        />
      ) : null}
      {draft.length === 0 && state.loaded ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>
          {t('customCommandsSettings.empty')}
        </Text>
      ) : null}
      {draft.map((command, index) => (
        <div
          key={command.id}
          testId={`custom-command-${command.id}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            borderBottomWidth: 1,
            borderColor: theme.border,
            paddingBottom: 14,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <CommandField
              label={t('customCommandsSettings.name')}
              placeholder={t('customCommandsSettings.namePlaceholder')}
              value={command.name}
              onChange={(name) => patch(command.id, { name })}
            />
            <CommandButton
              label={t('customCommandsSettings.moveUp')}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            />
            <CommandButton
              label={t('customCommandsSettings.moveDown')}
              disabled={index === draft.length - 1}
              onClick={() => move(index, 1)}
            />
            <CommandButton
              label={t('customCommandsSettings.delete')}
              danger
              onClick={() => change(draft.filter((entry) => entry.id !== command.id))}
            />
          </div>
          <CommandField
            label={t('customCommandsSettings.template')}
            multiline
            placeholder={t('customCommandsSettings.templatePlaceholder')}
            value={command.template}
            onChange={(template) => patch(command.id, { template })}
          />
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            <Text style={{ fontSize: 12, color: theme.text2 }}>
              {t('customCommandsSettings.platform')}
            </Text>
            {(['all', 'twitch', 'kick', 'youtube'] satisfies ('all' | Platform)[]).map(
              (platform) => (
                <CommandButton
                  key={platform}
                  label={
                    platform === 'all'
                      ? t('customCommandsSettings.platform.all')
                      : platform === 'youtube'
                        ? 'YouTube'
                        : platform === 'twitch'
                          ? 'Twitch'
                          : 'Kick'
                  }
                  active={(command.platform ?? 'all') === platform}
                  onClick={() =>
                    patch(command.id, {
                      platform: platform === 'all' ? undefined : platform,
                    })
                  }
                />
              ),
            )}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <CommandField
              label={t('customCommandsSettings.channelScope')}
              placeholder={t('customCommandsSettings.channelScopePlaceholder')}
              value={command.channel ?? ''}
              onChange={(channel) => patch(command.id, { channel: channel || undefined })}
            />
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingBottom: 5,
              }}
            >
              <Text style={{ fontSize: 12, color: theme.text }}>
                {t('customCommandsSettings.showInMenu')}
              </Text>
              <Switch
                small
                checked={command.showInMessageMenu}
                onChange={(showInMessageMenu) => patch(command.id, { showInMessageMenu })}
              />
            </div>
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
        <CommandButton
          label={t('customCommandsSettings.add')}
          disabled={!state.loaded || draft.length >= 100}
          onClick={() =>
            change([
              ...draft,
              { id: crypto.randomUUID(), name: '', template: '', showInMessageMenu: false },
            ])
          }
        />
      </div>
      <SettingsFooter
        sectionId="commands"
        dirty={dirty}
        saving={state.saving}
        error={state.error || undefined}
        errorTestId="custom-commands-error"
        disabled={!state.loaded}
        saveTestId="custom-commands-save"
        onSave={save}
        onDiscard={() => {
          edited.current = false
          setDraft(state.commands)
        }}
      />
    </div>
  )
}

function CommandField({
  label,
  value,
  placeholder,
  multiline,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  multiline?: boolean
  onChange: (value: string) => void
}) {
  const theme = useTheme()
  const tracking = useTextInputFocusTracking()
  const style = {
    width: '100%',
    padding: 8,
    fontSize: 12,
    color: theme.text,
    backgroundColor: theme.surface2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 140 }}>
      <Text style={{ fontSize: 11, color: theme.text2 }}>{label}</Text>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          minRows={2}
          maxRows={6}
          onChange={(event) => onChange(event.value ?? '')}
          {...tracking}
          theme={{ caret: theme.accent.primary }}
          style={style}
        />
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.value ?? '')}
          {...tracking}
          theme={{ caret: theme.accent.primary }}
          style={style}
        />
      )}
    </div>
  )
}

function CommandButton({
  label,
  onClick,
  disabled,
  active,
  danger,
  testId,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  danger?: boolean
  testId?: string
}) {
  const theme = useTheme()
  return (
    <div
      testId={testId}
      tabIndex={disabled ? undefined : 0}
      onClick={() => {
        if (!disabled) onClick()
      }}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'enter' || event.key === 'space')) {
          event.preventDefault()
          onClick()
        }
      }}
      style={{
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 9,
        paddingRight: 9,
        borderRadius: 6,
        backgroundColor: active ? theme.accent.tint20 : theme.fill,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        flexShrink: 0,
        hover: disabled ? undefined : { backgroundColor: theme.fillHover },
      }}
    >
      <Text
        style={{
          fontSize: 12,
          color: danger ? theme.dangerText : active ? theme.accent.primary : theme.text,
        }}
      >
        {label}
      </Text>
    </div>
  )
}
