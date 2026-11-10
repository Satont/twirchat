import type { Platform } from '@twirchat/shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChatLoggingSettings as LoggingSettings } from '../backend/chat-history'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT } from '../i18n'
import { useTheme } from '../theme-context'
import {
  HistoryButton as Button,
  HistoryChoices as Choices,
  HistoryField as Field,
  HistoryInput as Input,
  HistoryToggle as Toggle,
} from './ChatHistoryFields'
import { SettingsFooter } from './settings/SettingsLayout'
import { Text } from './ui/Text'

export function ChatLoggingSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const { t, tPlural } = useT()
  const [settings, setSettings] = useState<LoggingSettings | null>(null)
  const [retention, setRetention] = useState('100000')
  const [days, setDays] = useState('0')
  const [size, setSize] = useState('32')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [channelPlatform, setChannelPlatform] = useState<Platform>('twitch')
  const [channelId, setChannelId] = useState('')
  const [status, setStatus] = useState<{ error: string | null; queued: number } | null>(null)
  const [persisted, setPersisted] = useState<LoggingSettings | null>(null)
  const [persistedNumbers, setPersistedNumbers] = useState({
    retention: '100000',
    days: '0',
    size: '32',
  })
  const load = useCallback(async () => {
    setBusy(true)
    try {
      const value = await backend.api.getChatLoggingSettings()
      const numbers = {
        retention: String(value.maxMessages),
        days: String(value.maxAgeDays),
        size: String(value.maxFileBytes / 1024 ** 2),
      }
      setSettings(value)
      setPersisted(value)
      setPersistedNumbers(numbers)
      setRetention(numbers.retention)
      setDays(numbers.days)
      setSize(numbers.size)
      setError(null)
      setStatus(await backend.api.getChatLoggingStatus())
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }, [backend])
  useEffect(() => {
    runUiTask(load())
  }, [load])
  const change = (patch: Partial<LoggingSettings>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current))
    setNotice('')
  }
  const numbers = { retention, days, size }
  const draftRef = useRef({ settings, numbers })
  draftRef.current = { settings, numbers }
  const dirty =
    settings !== null &&
    persisted !== null &&
    (JSON.stringify(settings) !== JSON.stringify(persisted) ||
      numbers.retention !== persistedNumbers.retention ||
      numbers.days !== persistedNumbers.days ||
      numbers.size !== persistedNumbers.size)
  const save = async (): Promise<boolean> => {
    if (!settings) return false
    setBusy(true)
    setError(null)
    setNotice('')
    try {
      const snapshot = {
        ...settings,
        maxMessages: Number(retention),
        maxAgeDays: Number(days),
        maxFileBytes: Number(size) * 1024 ** 2,
      }
      const snapshotJson = JSON.stringify({ settings: snapshot, numbers })
      await backend.api.saveChatLoggingSettings(snapshot)
      setSettings(snapshot)
      setPersisted(snapshot)
      setPersistedNumbers(numbers)
      setStatus(await backend.api.getChatLoggingStatus())
      return JSON.stringify(draftRef.current) === snapshotJson
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      return false
    } finally {
      setBusy(false)
    }
  }
  const flush = async () => {
    setBusy(true)
    setError(null)
    try {
      await backend.api.flushChatLogs()
      setStatus(await backend.api.getChatLoggingStatus())
      setNotice(t('chatLoggingSettings.flushed'))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setStatus(await backend.api.getChatLoggingStatus())
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      testId="chat-logging-settings"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <Text style={{ fontSize: 12, color: theme.text2 }}>{t('chatLoggingSettings.intro')}</Text>
      {settings ? (
        <>
          <Toggle
            label={t('chatLoggingSettings.twitchHistory')}
            checked={settings.twitchHistoryEnabled}
            onChange={(twitchHistoryEnabled) => change({ twitchHistoryEnabled })}
          />
          <Text style={{ fontSize: 11, color: theme.text2 }}>
            {t('chatLoggingSettings.twitchHistoryHint')}
          </Text>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <Field label={t('chatLoggingSettings.retention')}>
              <Input testId="chat-history-retention" value={retention} onChange={setRetention} />
            </Field>
            <Field label={t('chatLoggingSettings.days')}>
              <Input testId="chat-history-days" value={days} onChange={setDays} />
            </Field>
          </div>
          <Text style={{ fontSize: 11, color: theme.text2 }}>
            {t('chatLoggingSettings.retentionWarning')}
          </Text>
          <Toggle
            label={t('chatLoggingSettings.writeLogs')}
            checked={settings.enabled}
            onChange={(enabled) => change({ enabled })}
          />
          <Field label={t('chatLoggingSettings.directory')}>
            <Input
              testId="chat-log-directory"
              value={settings.directory}
              onChange={(directory) => change({ directory })}
              placeholder="/home/you/Chat logs"
            />
          </Field>
          <Toggle
            label={t('chatLoggingSettings.timestamps')}
            checked={settings.timestamps}
            onChange={(timestamps) => change({ timestamps })}
          />
          <Field label={t('chatLoggingSettings.startNewLog')}>
            <Choices
              value={settings.rotation}
              options={[
                { value: 'daily', label: t('chatLoggingSettings.rotation.daily') },
                { value: 'session', label: t('chatLoggingSettings.rotation.session') },
              ]}
              onChange={(rotation) => change({ rotation })}
            />
          </Field>
          <Field label={t('chatLoggingSettings.maxFileSize')}>
            <Input testId="chat-log-max-size" value={size} onChange={setSize} />
          </Field>
          <Text style={{ fontSize: 12, color: theme.text2 }}>
            {settings.channels.length
              ? t('chatLoggingSettings.logOnlyChannels')
              : t('chatLoggingSettings.allChannels')}
          </Text>
          {settings.channels.map((channel, index) => (
            <div
              key={`${channel.platform}:${channel.channelId}`}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <Text
                style={{ fontSize: 12, color: theme.text }}
              >{`${channel.platform} / ${channel.channelId}`}</Text>
              <Button
                label={t('chatLoggingSettings.remove')}
                onClick={() =>
                  change({ channels: settings.channels.filter((_, item) => item !== index) })
                }
              />
            </div>
          ))}
          <Choices
            value={channelPlatform}
            options={[
              { value: 'twitch', label: 'Twitch' },
              { value: 'kick', label: 'Kick' },
              { value: 'youtube', label: 'YouTube' },
              { value: 'vkplay', label: 'VK Play Live' },
            ]}
            onChange={setChannelPlatform}
          />
          <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <Input
                testId="chat-log-add-channel"
                value={channelId}
                onChange={setChannelId}
                placeholder={t('chatLoggingSettings.addChannelPlaceholder')}
              />
            </div>
            <Button
              label={t('chatLoggingSettings.addChannel')}
              disabled={!channelId.trim()}
              onClick={() => {
                if (
                  !settings.channels.some(
                    (channel) =>
                      channel.platform === channelPlatform &&
                      channel.channelId === channelId.trim(),
                  )
                )
                  change({
                    channels: [
                      ...settings.channels,
                      { platform: channelPlatform, channelId: channelId.trim() },
                    ],
                  })
                setChannelId('')
              }}
            />
          </div>
          {status ? (
            <Text style={{ fontSize: 11, color: status.error ? theme.dangerText : theme.text2 }}>
              {status.error ?? tPlural('chatLoggingSettings.queued', status.queued)}
            </Text>
          ) : null}
          <SettingsFooter
            sectionId="history"
            dirty={dirty}
            saving={busy}
            error={error ?? undefined}
            note={notice}
            saveTestId="chat-logging-save"
            errorTestId="chat-logging-error"
            onSave={save}
            onDiscard={() => {
              if (!persisted) return
              setSettings(persisted)
              setRetention(persistedNumbers.retention)
              setDays(persistedNumbers.days)
              setSize(persistedNumbers.size)
              setError(null)
              setNotice('')
            }}
          >
            <Button
              label={t('chatLoggingSettings.flush')}
              disabled={busy}
              onClick={() => void flush()}
            />
          </SettingsFooter>
        </>
      ) : (
        <Button
          label={busy ? t('chatLoggingSettings.loading') : t('chatLoggingSettings.retry')}
          disabled={busy}
          onClick={() => void load()}
        />
      )}
    </div>
  )
}
