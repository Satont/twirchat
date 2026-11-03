import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { sanitizeDisplayText, truncateGraphemes } from '../../views/shared/utils/display-text'
import { useBackend } from '../backend/context'
import { compileFilterExpression } from '../filter-expression'
import { runUiTask } from '../hooks/run-ui-task'
import {
  compileMessageRules,
  validateChatRules,
  type ChatRules,
  type HighlightRule,
  type IgnoreRule,
  type SavedFilter,
  type TextRule,
} from '../message-rules'
import { accountsStore, homeMessagesStore, watchedMessagesStore } from '../state/app'
import { chatRulesPreferences, chatRulesStore } from '../state/chat-rules'
import { useStore } from '../state/create-store'
import { useTextInputFocusTracking } from '../state/focus'
import { accent } from '../theme'
import { useTheme } from '../theme-context'
import { Icon } from './ui/Icon'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

type Section = 'highlights' | 'ignores' | 'filters'

export function ChatRulesSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const persisted = useStore(chatRulesStore)
  const accounts = useStore(accountsStore)
  const home = useStore(homeMessagesStore)
  const watched = useStore(watchedMessagesStore)
  const [draft, setDraft] = useState<ChatRules>(() => structuredClone(persisted.value))
  const [dirty, setDirty] = useState(false)
  const [section, setSection] = useState<Section>('highlights')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const editRevision = useRef(0)

  useEffect(() => {
    runUiTask(chatRulesPreferences.load(backend.api))
  }, [backend])
  useEffect(() => {
    if (!dirty) setDraft(structuredClone(persisted.value))
  }, [persisted.value, dirty])

  const samples = useMemo(
    () => [...home, ...[...watched.values()].flat()].slice(-1000),
    [home, watched],
  )
  const validation = useMemo(() => {
    try {
      return { value: validateChatRules(draft), error: null }
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [draft])
  const preview = useMemo(() => {
    if (!validation.value) return null
    const compiled = compileMessageRules(validation.value, accounts)
    const matches = samples.map((message) => compiled.classify(message))
    return {
      highlighted: matches.filter((message) => message.highlighted).length,
      hidden: matches.filter((message) => message.hidden).length,
      replaced: matches.filter((message, index) => message.message !== samples[index]).length,
    }
  }, [validation.value, accounts, samples])

  const change = (mutate: (value: ChatRules) => void) => {
    editRevision.current += 1
    setDirty(true)
    setSaveError(null)
    setDraft((current) => {
      const next = structuredClone(current)
      mutate(next)
      return next
    })
  }
  const move = (id: string, direction: -1 | 1) =>
    change((next) => {
      const reorder = <T extends { id: string }>(list: T[]) => {
        const index = list.findIndex((rule) => rule.id === id)
        const target = index + direction
        if (index < 0 || target < 0 || target >= list.length) return
        const [item] = list.splice(index, 1)
        list.splice(target, 0, item!)
      }
      if (section === 'highlights') reorder(next.highlights)
      else if (section === 'ignores') reorder(next.ignores)
      else reorder(next.filters)
    })
  const remove = (id: string) =>
    change((next) => {
      if (section === 'highlights')
        next.highlights = next.highlights.filter((rule) => rule.id !== id)
      else if (section === 'ignores') next.ignores = next.ignores.filter((rule) => rule.id !== id)
      else {
        next.filters = next.filters.filter((rule) => rule.id !== id)
        for (const pane of Object.keys(next.paneFilters))
          next.paneFilters[pane] = next.paneFilters[pane]!.filter((filter) => filter !== id)
      }
    })
  const add = () => {
    const id = crypto.randomUUID()
    change((next) => {
      const common: TextRule = {
        id,
        pattern: '',
        enabled: true,
        regex: false,
        caseSensitive: false,
        wholeWord: false,
      }
      if (section === 'highlights')
        next.highlights.push({
          ...common,
          target: 'message',
          color: '#a78bfa',
          mentions: false,
          sound: false,
          flash: false,
        })
      else if (section === 'ignores')
        next.ignores.push({ ...common, target: 'message', placeholder: true })
      else next.filters.push({ id, name: '', expression: 'message.length > 0' })
    })
    setEditingId(id)
  }
  const save = async () => {
    if (!validation.value) return
    const requestedAt = editRevision.current
    try {
      await chatRulesPreferences.save(backend.api, validation.value)
      if (requestedAt === editRevision.current) setDirty(false)
      setSaveError(null)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div
      testId="chat-rules-settings"
      style={{
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 14,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        marginBottom: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: 700, color: theme.text }}>Chat rules</Text>
        <Button
          testId="chat-rules-save"
          label={persisted.saving ? 'Saving…' : dirty ? 'Save rules' : 'Rules saved'}
          disabled={!dirty || !persisted.loaded || persisted.saving || !!validation.error}
          onClick={() => void save()}
          primary
        />
      </div>
      <Text style={{ fontSize: 12, color: theme.text2 }}>
        Highlight messages, hide unwanted chatter, and save filters for individual panes.
      </Text>
      {!persisted.loaded ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>Loading chat rules…</Text>
      ) : (
        <>
          <Choices
            value={section}
            options={[
              { value: 'highlights', label: `Highlights (${draft.highlights.length})` },
              { value: 'ignores', label: `Ignores (${draft.ignores.length})` },
              { value: 'filters', label: `Filters (${draft.filters.length})` },
            ]}
            onChange={(value) => {
              setSection(value)
              setEditingId(null)
            }}
          />
          {section === 'filters' ? (
            <Toggle
              label="Apply saved filters to my own messages"
              value={draft.filterOwnMessages !== false}
              onChange={(value) =>
                change((next) => {
                  next.filterOwnMessages = value
                })
              }
            />
          ) : null}
          {section === 'highlights' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Toggle
                label="Highlight my own messages"
                value={draft.highlightOwnMessages}
                onChange={(value) =>
                  change((next) => {
                    next.highlightOwnMessages = value
                  })
                }
              />
              <Toggle
                label="Highlight replies to me"
                value={draft.highlightReplies}
                onChange={(value) =>
                  change((next) => {
                    next.highlightReplies = value
                  })
                }
              />
              <Toggle
                label="Show platform highlights"
                value={draft.providerHighlights}
                onChange={(value) =>
                  change((next) => {
                    next.providerHighlights = value
                  })
                }
              />
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Text style={{ fontSize: 11, color: theme.text2 }}>
              {section === 'filters'
                ? 'All filters assigned to a pane must match.'
                : 'Rules run in this order.'}
            </Text>
            <Button
              testId={`chat-rules-add-${section}`}
              label={`Add ${section === 'highlights' ? 'highlight' : section === 'ignores' ? 'ignore' : 'filter'}`}
              onClick={add}
              disabled={draft[section].length >= 1000}
            />
          </div>
          {draft[section].length === 0 ? (
            <Text style={{ fontSize: 12, color: theme.text2, paddingTop: 4, paddingBottom: 8 }}>
              {section === 'highlights'
                ? 'No custom highlights. Add a phrase, username or badge to watch for.'
                : section === 'ignores'
                  ? 'No ignored users or phrases. Ignores affect this app only.'
                  : 'No saved filters. Create one, then assign it from a chat pane.'}
            </Text>
          ) : null}
          {section === 'highlights'
            ? draft.highlights.map((rule, index) => (
                <RuleItem
                  key={rule.id}
                  id={rule.id}
                  label={rule.name || rule.pattern || 'New highlight'}
                  index={index}
                  count={draft.highlights.length}
                  expanded={editingId === rule.id}
                  onEdit={() => setEditingId(editingId === rule.id ? null : rule.id)}
                  onMove={(direction) => move(rule.id, direction)}
                  onRemove={() => remove(rule.id)}
                >
                  <HighlightEditor
                    rule={rule}
                    onChange={(patch) =>
                      change((next) => {
                        Object.assign(
                          next.highlights.find((item) => item.id === rule.id)!,
                          patch,
                        )
                      })
                    }
                  />
                </RuleItem>
              ))
            : section === 'ignores'
              ? draft.ignores.map((rule, index) => (
                  <RuleItem
                    key={rule.id}
                    id={rule.id}
                    label={rule.name || rule.pattern || rule.userId || 'New ignore'}
                    index={index}
                    count={draft.ignores.length}
                    expanded={editingId === rule.id}
                    onEdit={() => setEditingId(editingId === rule.id ? null : rule.id)}
                    onMove={(direction) => move(rule.id, direction)}
                    onRemove={() => remove(rule.id)}
                  >
                    <IgnoreEditor
                      rule={rule}
                      onChange={(patch) =>
                        change((next) => {
                          Object.assign(
                            next.ignores.find((item) => item.id === rule.id)!,
                            patch,
                          )
                        })
                      }
                    />
                  </RuleItem>
                ))
              : draft.filters.map((filter, index) => (
                  <RuleItem
                    key={filter.id}
                    id={filter.id}
                    label={filter.name || 'New filter'}
                    index={index}
                    count={draft.filters.length}
                    expanded={editingId === filter.id}
                    onEdit={() => setEditingId(editingId === filter.id ? null : filter.id)}
                    onMove={(direction) => move(filter.id, direction)}
                    onRemove={() => remove(filter.id)}
                  >
                    <FilterEditor
                      filter={filter}
                      samples={samples}
                      onChange={(patch) =>
                        change((next) => {
                          Object.assign(
                            next.filters.find((item) => item.id === filter.id)!,
                            patch,
                          )
                        })
                      }
                    />
                  </RuleItem>
                ))}
          {preview && section !== 'filters' ? (
            <Text
              style={{ fontSize: 11, color: theme.text2 }}
            >{`Preview across ${samples.length} buffered messages: ${preview.highlighted} highlighted, ${preview.hidden} hidden, ${preview.replaced} replaced.`}</Text>
          ) : null}
          {validation.error || saveError || persisted.error ? (
            <Text testId="chat-rules-error" style={{ fontSize: 12, color: theme.dangerText }}>
              {validation.error ?? saveError ?? persisted.error}
            </Text>
          ) : null}
          {persisted.error && !dirty ? (
            <Button
              label="Retry loading rules"
              onClick={() => void chatRulesPreferences.load(backend.api)}
            />
          ) : null}
          {dirty ? (
            <Button
              label="Discard unsaved changes"
              onClick={() => {
                setDraft(structuredClone(persisted.value))
                setDirty(false)
                setSaveError(null)
              }}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

function HighlightEditor({
  rule,
  onChange,
}: {
  rule: HighlightRule
  onChange: (patch: Partial<HighlightRule>) => void
}) {
  return (
    <>
      <Field label="Rule name · optional">
        <Input
          id={`rule-${rule.id}-name`}
          value={rule.name ?? ''}
          onChange={(name) => onChange({ name })}
        />
      </Field>
      <Field label="Match against">
        <Choices
          value={rule.target}
          options={[
            { value: 'message', label: 'Message text' },
            { value: 'user', label: 'Username' },
            { value: 'badge', label: 'Badge' },
            { value: 'filter', label: 'Filter expression' },
          ]}
          onChange={(target) =>
            onChange({
              target,
              ...(target === 'filter' && rule.target !== 'filter'
                ? { pattern: 'flags.first_message' }
                : {}),
            })
          }
        />
      </Field>
      {rule.target === 'filter' ? (
        <>
          <Toggle
            label="Enabled"
            value={rule.enabled}
            onChange={(enabled) => onChange({ enabled })}
          />
          <Field label="Filter expression">
            <Input
              id={`rule-${rule.id}-pattern`}
              value={rule.pattern}
              onChange={(pattern) => onChange({ pattern })}
              multiline
            />
          </Field>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
            {[
              ['First message', 'flags.first_message'],
              ['Subscription', 'flags.sub_message'],
              ['Reward', 'flags.reward_message'],
              ['Whisper', 'flags.whisper'],
              ['Announcement', 'flags.announcement'],
              ['Restricted', 'flags.restricted'],
              ['Watch streak', 'flags.watch_streak'],
              ['Follow', 'flags.follow_message'],
            ].map(([label, pattern]) => (
              <Button
                key={pattern}
                label={label!}
                onClick={() => onChange({ pattern: pattern! })}
              />
            ))}
          </div>
          {compileFilterExpression(rule.pattern).error ? (
            <ErrorText>{compileFilterExpression(rule.pattern).error}</ErrorText>
          ) : null}
        </>
      ) : (
        <PatternEditor rule={rule} onChange={onChange} />
      )}
      <Field label="Highlight color · #RRGGBB or #RRGGBBAA">
        <Input
          id={`rule-${rule.id}-color`}
          value={rule.color}
          onChange={(color) => onChange({ color })}
          placeholder="#a78bfa"
        />
      </Field>
      <Toggle
        label="Count matching messages as mentions"
        value={rule.mentions}
        onChange={(mentions) => onChange({ mentions })}
      />
      <Toggle
        label="Play highlight sound"
        value={rule.sound}
        onChange={(sound) => onChange({ sound })}
      />
      <Toggle
        label="Flash the window for a highlight"
        value={rule.flash}
        onChange={(flash) => onChange({ flash })}
      />
    </>
  )
}

function IgnoreEditor({
  rule,
  onChange,
}: {
  rule: IgnoreRule
  onChange: (patch: Partial<IgnoreRule>) => void
}) {
  return (
    <>
      <Field label="Rule name · optional">
        <Input
          id={`rule-${rule.id}-name`}
          value={rule.name ?? ''}
          onChange={(name) => onChange({ name })}
        />
      </Field>
      <PatternEditor rule={rule} onChange={onChange} />
      <Field label="Match against">
        <Choices
          value={rule.target}
          options={[
            { value: 'message', label: 'Message text' },
            { value: 'user', label: 'Username' },
          ]}
          onChange={(target) =>
            onChange({
              target,
              ...(target === 'user'
                ? {
                    replacement: undefined,
                    ...(rule.action === 'replace' ? { action: 'hide' } : {}),
                  }
                : { userId: undefined }),
            })
          }
        />
      </Field>
      <Field label="Platform">
        <Choices
          value={rule.platform ?? 'all'}
          options={[
            { value: 'all', label: 'All' },
            { value: 'twitch', label: 'Twitch' },
            { value: 'kick', label: 'Kick' },
            { value: 'youtube', label: 'YouTube' },
          ]}
          onChange={(platform) => onChange({ platform: platform === 'all' ? undefined : platform })}
        />
      </Field>
      {rule.target === 'user' ? (
        <Field label="Exact platform user ID · optional">
          <Input
            id={`rule-${rule.id}-user-id`}
            value={rule.userId ?? ''}
            onChange={(userId) =>
              onChange({
                userId: userId || undefined,
                ...(!rule.pattern ? { pattern: userId } : {}),
              })
            }
          />
        </Field>
      ) : null}
      <Field label="Action">
        <Choices
          value={rule.action ?? (rule.replacement !== undefined ? 'replace' : 'hide')}
          options={[
            { value: 'hide', label: 'Hide message' },
            ...(rule.target === 'message'
              ? ([{ value: 'replace', label: 'Replace matching text' }] satisfies {
                  value: NonNullable<IgnoreRule['action']>
                  label: string
                }[])
              : []),
            { value: 'suppress-highlights', label: 'Suppress highlights' },
          ]}
          onChange={(action) =>
            onChange({ action, replacement: action === 'replace' ? '' : undefined })
          }
        />
      </Field>
      {(rule.action ?? (rule.replacement !== undefined ? 'replace' : 'hide')) === 'replace' ? (
        <Field label="Literal replacement · leave empty to remove matching text">
          <Input
            id={`rule-${rule.id}-replacement`}
            value={rule.replacement ?? ''}
            onChange={(replacement) => onChange({ replacement })}
          />
        </Field>
      ) : rule.action !== 'suppress-highlights' ? (
        <Toggle
          label="Show an ignored-message placeholder"
          value={rule.placeholder}
          onChange={(placeholder) => onChange({ placeholder })}
        />
      ) : null}
    </>
  )
}

function PatternEditor({
  rule,
  onChange,
}: {
  rule: TextRule
  onChange: (patch: Partial<TextRule>) => void
}) {
  const error = useMemo(() => {
    try {
      validateChatRules({
        highlights: [],
        ignores: [{ ...rule, target: 'message', placeholder: false }],
        filters: [],
        paneFilters: {},
      })
      return null
    } catch (failure) {
      return failure instanceof Error ? failure.message : String(failure)
    }
  }, [rule])
  return (
    <>
      <Toggle label="Enabled" value={rule.enabled} onChange={(enabled) => onChange({ enabled })} />
      <Field label={rule.regex ? 'Regular expression' : 'Phrase or username'}>
        <Input
          id={`rule-${rule.id}-pattern`}
          value={rule.pattern}
          onChange={(pattern) => onChange({ pattern })}
          placeholder={rule.regex ? 'hello|welcome' : 'Enter text to match'}
        />
      </Field>
      <Choices
        value={rule.regex ? 'regex' : 'literal'}
        options={[
          { value: 'literal', label: 'Literal text' },
          { value: 'regex', label: 'Regular expression' },
        ]}
        onChange={(mode) => onChange({ regex: mode === 'regex' })}
      />
      <Toggle
        label="Case sensitive"
        value={rule.caseSensitive}
        onChange={(caseSensitive) => onChange({ caseSensitive })}
      />
      <Toggle
        label="Whole words only"
        value={rule.wholeWord}
        onChange={(wholeWord) => onChange({ wholeWord })}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  )
}

function FilterEditor({
  filter,
  onChange,
  samples,
}: {
  filter: SavedFilter
  onChange: (patch: Partial<SavedFilter>) => void
  samples: NormalizedChatMessage[]
}) {
  const theme = useTheme()
  const compiled = useMemo(() => compileFilterExpression(filter.expression), [filter.expression])
  const matches = useMemo(
    () => samples.filter((message) => compiled.matches(message)),
    [samples, compiled],
  )
  return (
    <>
      <Field label="Filter name">
        <Input
          id={`filter-${filter.id}-name`}
          value={filter.name}
          onChange={(name) => onChange({ name })}
          placeholder="Moderators and mentions"
        />
      </Field>
      <Field label="Filter expression">
        <Input
          id={`filter-${filter.id}-expression`}
          value={filter.expression}
          onChange={(expression) => onChange({ expression })}
          placeholder={'author.badges contains "moderator"'}
          multiline
        />
      </Field>
      <Text style={{ fontSize: 11, color: theme.text2 }}>
        Use author.name, author.badges, message.content, message.length, channel.name and
        flags.highlighted. Combine conditions with &amp;&amp;, || and !. Strings use double quotes;
        regex uses r"pattern" or ri"pattern".
      </Text>
      <Text style={{ fontSize: 11, color: theme.text2 }}>
        Arithmetic runs left to right. For example, 2 + 3 * 4 is 20. Parentheses control grouping.
      </Text>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Button
          label="Moderator example"
          onClick={() => onChange({ expression: 'author.badges contains "moderator"' })}
        />
        <Button
          label="Mention example"
          onClick={() => onChange({ expression: 'flags.highlighted || flags.reply' })}
        />
      </div>
      {compiled.error ? (
        <ErrorText>{compiled.error}</ErrorText>
      ) : (
        <>
          <Text
            testId={`filter-${filter.id}-preview`}
            style={{ fontSize: 12, color: theme.text2 }}
          >{`${matches.length} of ${samples.length} buffered messages match.`}</Text>
          {matches.slice(-3).map((message) => (
            <Text
              key={`${message.platform}:${message.channelId}:${message.id}`}
              style={{ fontSize: 11, color: theme.text2 }}
            >
              {truncateGraphemes(
                sanitizeDisplayText(`${message.author.displayName}: ${message.text}`),
                110,
              )}
            </Text>
          ))}
        </>
      )}
    </>
  )
}

function RuleItem({
  id,
  label,
  index,
  count,
  expanded,
  onEdit,
  onMove,
  onRemove,
  children,
}: {
  id: string
  label: string
  index: number
  count: number
  expanded: boolean
  onEdit: () => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  children: ReactNode
}) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        borderTopWidth: 1,
        borderColor: theme.border,
        paddingTop: 12,
        paddingBottom: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          gap: 6,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div
          testId={`rule-${id}-edit`}
          tabIndex={0}
          onClick={onEdit}
          onKeyDown={(event) => {
            if (event.key === 'enter' || event.key === 'space') {
              event.preventDefault()
              onEdit()
            }
          }}
          style={{
            flexGrow: 1,
            minWidth: 100,
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'row',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} color={theme.text2} />
          <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>
            {truncateGraphemes(sanitizeDisplayText(label), 60)}
          </Text>
        </div>
        <Button label="Earlier" disabled={index === 0} onClick={() => onMove(-1)} />
        <Button label="Later" disabled={index === count - 1} onClick={() => onMove(1)} />
        <Button testId={`rule-${id}-delete`} label="Delete" onClick={onRemove} />
      </div>
      {expanded ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>{children}</div>
      ) : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <Text style={{ fontSize: 11, color: theme.text2 }}>{label}</Text>
      {children}
    </div>
  )
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  const theme = useTheme()
  return (
    <div
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'enter' || event.key === 'space') {
          event.preventDefault()
          onChange(!value)
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Text style={{ fontSize: 12, color: theme.text }}>{label}</Text>
      <Switch checked={value} onChange={onChange} small />
    </div>
  )
}

function ErrorText({ children }: { children: ReactNode }) {
  const theme = useTheme()
  return <Text style={{ fontSize: 11, color: theme.dangerText }}>{children}</Text>
}

function Input({
  id,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
}) {
  const theme = useTheme()
  const focus = useTextInputFocusTracking()
  const props = {
    testId: id,
    value,
    placeholder,
    onChange: (event: { value?: string }) => onChange(event.value ?? ''),
    ...focus,
    theme: { caret: accent.primary },
    style: {
      width: '100%',
      minWidth: 0,
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 6,
      color: theme.text,
      fontSize: 12,
      padding: 8,
    },
  }
  return multiline ? (
    <textarea {...props} style={{ ...props.style, minHeight: 70 }} />
  ) : (
    <input {...props} />
  )
}

function Choices<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
      {options.map((option) => (
        <Button
          key={option.value}
          label={option.label}
          primary={option.value === value}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  )
}

function Button({
  label,
  onClick,
  disabled = false,
  primary = false,
  testId,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  testId?: string
}) {
  const theme = useTheme()
  return (
    <div
      testId={testId}
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'enter' || event.key === 'space')) {
          event.preventDefault()
          onClick()
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 5,
        paddingBottom: 5,
        paddingLeft: 9,
        paddingRight: 9,
        borderRadius: 6,
        backgroundColor: primary ? accent.tint20 : theme.fill,
        borderWidth: 1,
        borderColor: primary ? theme.link : theme.hairline,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
        hover: disabled ? {} : { backgroundColor: theme.fillHover },
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: primary ? 600 : 500,
          color: primary ? theme.link : theme.text,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Text>
    </div>
  )
}
