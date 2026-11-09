import { useState } from 'react'

import type { ObsAudioInput, ObsRemoteCommand } from '../../../services/obs-remote'
import { useTheme } from '../../theme-context'
import { ActionButton, FormInput } from '../ui/Form'
import { Text } from '../ui/Text'
import { Section } from './Controls'
import { Fader } from './Fader'

const CHANNEL_WIDTH = 270
const CHANNEL_PADDING = 10

interface MixerProps {
  inputs: ObsAudioInput[]
  panicActive: boolean
  run: (command: ObsRemoteCommand) => void
  disabled: boolean
}

function Meter({ levels, muted = false }: { levels: number[]; muted?: boolean }) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%' }}>
      {[0, 1].map((channel) => {
        const level = muted ? 0 : (levels[channel] ?? levels[0] ?? 0)
        const db = level > 0 ? 20 * Math.log10(level) : -60
        return (
          <div
            key={channel}
            style={{
              height: 7,
              width: '100%',
              backgroundColor: theme.border,
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: 7,
                width: `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`,
                backgroundColor: db >= -9 ? '#ef4444' : db >= -20 ? '#eab308' : '#22c55e',
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

function Channel({
  input,
  run,
  hide,
  disabled,
}: {
  input: ObsAudioInput
  run: MixerProps['run']
  hide: () => void
  disabled: boolean
}) {
  const theme = useTheme()
  const [draft, setDraft] = useState<string | null>(null)
  const db = Number(draft)
  return (
    <div
      style={{
        width: CHANNEL_WIDTH,
        flexShrink: 0,
        backgroundColor: theme.surface2,
        borderRadius: 7,
        padding: CHANNEL_PADDING,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>{input.name}</Text>
      <Text style={{ fontSize: 10, color: theme.text2 }}>
        {`${input.global ? 'Global' : input.active ? 'Active' : 'Inactive'} · ${input.monitoring === 'OBS_MONITORING_TYPE_MONITOR_ONLY' ? 'Monitor only · no output' : input.monitoring === 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT' ? 'Monitor + output' : 'Output'}`}
      </Text>
      <Meter levels={input.levels} muted={input.muted} />
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <div style={{ width: 86, flexShrink: 0 }}>
          <FormInput
            testId={`obs-volume-${input.name}`}
            value={draft ?? input.volumeDb.toFixed(1)}
            onChange={setDraft}
          />
        </div>
        <Text style={{ color: theme.text2, fontSize: 11 }}>dB</Text>
        <ActionButton
          disabled={
            disabled ||
            draft === null ||
            draft.trim() === '' ||
            !Number.isFinite(db) ||
            db < -100 ||
            db > 26
          }
          onClick={() => {
            run({ kind: 'volume', input: input.name, db })
            setDraft(null)
          }}
        >
          Set
        </ActionButton>
      </div>
      <Fader
        name={input.name}
        value={input.volumeDb}
        width={CHANNEL_WIDTH - 2 * CHANNEL_PADDING}
        disabled={disabled}
        onCommit={(next) => run({ kind: 'volume', input: input.name, db: next })}
      />
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        <ActionButton
          testId={`obs-mute-${input.name}`}
          disabled={disabled}
          danger={input.muted}
          onClick={() => run({ kind: 'mute', input: input.name, muted: !input.muted })}
        >
          {input.muted ? 'Unmute' : 'Mute'}
        </ActionButton>
        <ActionButton
          disabled={disabled}
          primary={input.monitoring === 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'}
          onClick={() =>
            run({
              kind: 'monitoring',
              input: input.name,
              mode:
                input.monitoring === 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'
                  ? 'OBS_MONITORING_TYPE_NONE'
                  : 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT',
            })
          }
        >
          Monitor
        </ActionButton>
        <ActionButton
          testId={`obs-reset-volume-${input.name}`}
          disabled={disabled}
          onClick={() => {
            setDraft(null)
            run({ kind: 'volume', input: input.name, db: 0 })
          }}
        >
          0 dB
        </ActionButton>
        <ActionButton testId={`obs-hide-${input.name}`} onClick={hide}>
          Hide
        </ActionButton>
      </div>
    </div>
  )
}

export function Mixer({ inputs, panicActive, run, disabled }: MixerProps) {
  const theme = useTheme()
  const [hidden, setHidden] = useState<string[]>([])
  const mix = [0, 1].map((channel) =>
    Math.sqrt(
      inputs.reduce((sum, input) => {
        if (input.muted || !input.active || input.monitoring === 'OBS_MONITORING_TYPE_MONITOR_ONLY')
          return sum
        const level = input.levels[channel] ?? input.levels[0] ?? 0
        return sum + level * level
      }, 0),
    ),
  )
  return (
    <Section
      title="Audio mixer"
      action={
        <div style={{ display: 'flex', flexDirection: 'row', gap: 6 }}>
          {hidden.length ? (
            <ActionButton testId="obs-restore-channels" onClick={() => setHidden([])}>
              {`Restore hidden (${hidden.length})`}
            </ActionButton>
          ) : null}
          <ActionButton
            testId="obs-panic"
            disabled={disabled}
            danger
            onClick={() => run({ kind: panicActive ? 'undo-panic' : 'panic' })}
          >
            {panicActive ? 'Undo panic mute' : 'Panic mute'}
          </ActionButton>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ color: theme.text2, fontSize: 11 }}>Estimated mix</Text>
        <div style={{ width: 180 }}>
          <Meter levels={mix} />
        </div>
        <Text style={{ color: theme.text2, fontSize: 10 }}>
          −60 · −20 · −9 · 0 dBFS · approximate, track routing excluded
        </Text>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {inputs
          .filter((input) => !hidden.includes(input.name))
          .map((input) => (
            <Channel
              key={input.name}
              input={input}
              disabled={disabled}
              run={run}
              hide={() =>
                setHidden((current) => [
                  ...current.filter((name) => inputs.some((item) => item.name === name)),
                  input.name,
                ])
              }
            />
          ))}
        {!inputs.length ? (
          <Text style={{ color: theme.text2, fontSize: 12 }}>
            Audio inputs appear when OBS is connected.
          </Text>
        ) : null}
      </div>
    </Section>
  )
}
