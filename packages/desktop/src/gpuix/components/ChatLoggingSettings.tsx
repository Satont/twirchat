import type { Platform } from '@twirchat/shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChatLoggingSettings as LoggingSettings } from '../backend/chat-history'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
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
      setNotice('Pending history and file logs saved.')
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
      <Text style={{ fontSize: 12, color: theme.text2 }}>
        Local history includes watched channels. File logging is optional and starts after you
        enable it and save.
      </Text>
      {settings ? (
        <>
          <Toggle
            label="Load Twitch history through backend"
            checked={settings.twitchHistoryEnabled}
            onChange={(twitchHistoryEnabled) => change({ twitchHistoryEnabled })}
          />
          <Text style={{ fontSize: 11, color: theme.text2 }}>
            Fetch available messages from third-party history services through the backend. Coverage
            depends on the channels and dates they retain. Disable this to use only locally stored
            history; providers are configured on the backend.
          </Text>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <Field label="Keep at most this many history messages">
              <Input testId="chat-history-retention" value={retention} onChange={setRetention} />
            </Field>
            <Field label="Keep history for days · 0 means no age limit">
              <Input testId="chat-history-days" value={days} onChange={setDays} />
            </Field>
          </div>
          <Text style={{ fontSize: 11, color: theme.text2 }}>
            Saving a shorter retention period permanently removes older local history.
          </Text>
          <Toggle
            label="Write chat logs to files"
            checked={settings.enabled}
            onChange={(enabled) => change({ enabled })}
          />
          <Field label="Absolute folder path">
            <Input
              testId="chat-log-directory"
              value={settings.directory}
              onChange={(directory) => change({ directory })}
              placeholder="/home/you/Chat logs"
            />
          </Field>
          <Toggle
            label="Include timestamps"
            checked={settings.timestamps}
            onChange={(timestamps) => change({ timestamps })}
          />
          <Field label="Start a new log">
            <Choices
              value={settings.rotation}
              options={[
                { value: 'daily', label: 'Every day' },
                { value: 'session', label: 'Every app session' },
              ]}
              onChange={(rotation) => change({ rotation })}
            />
          </Field>
          <Field label="Maximum file size in MiB · larger logs rotate automatically">
            <Input testId="chat-log-max-size" value={size} onChange={setSize} />
          </Field>
          <Text style={{ fontSize: 12, color: theme.text2 }}>
            {settings.channels.length
              ? 'Log only these channels:'
              : 'All channels are logged while file logging is enabled.'}
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
                label="Remove"
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
            ]}
            onChange={setChannelPlatform}
          />
          <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <Input
                testId="chat-log-add-channel"
                value={channelId}
                onChange={setChannelId}
                placeholder="Channel name or ID, matching its chat source"
              />
            </div>
            <Button
              label="Add channel"
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
              {status.error ?? `${status.queued} messages waiting to be saved.`}
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
            <Button label="Flush pending logs" disabled={busy} onClick={() => void flush()} />
          </SettingsFooter>
        </>
      ) : (
        <Button
          label={busy ? 'Loading…' : 'Retry loading settings'}
          disabled={busy}
          onClick={() => void load()}
        />
      )}
    </div>
  )
}
