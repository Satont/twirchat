import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { sanitizeDisplayText, truncateGraphemes } from '../../views/shared/utils/display-text'
import { useBackend } from '../backend/context'
import { compileFilterExpression } from '../filter-expression'
import { runUiTask } from '../hooks/run-ui-task'
import { useT } from '../i18n'
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
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { Icon } from './ui/Icon'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

type Section = 'highlights' | 'ignores' | 'filters'

export function ChatRulesSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const { t, language } = useT()
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
    // Validation errors are translated: recompute them when the UI language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, language])
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
  const save = async (): Promise<boolean> => {
    if (!validation.value) return false
    const requestedAt = editRevision.current
    try {
      await chatRulesPreferences.save(backend.api, validation.value)
      const current = requestedAt === editRevision.current
      if (current) setDirty(false)
      setSaveError(null)
      return current
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  return (
    <div testId="chat-rules-settings" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Text style={{ fontSize: 12, color: theme.text2 }}>{t('chatRulesSettings.intro')}</Text>
      {!persisted.loaded ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>{t('chatRulesSettings.loading')}</Text>
      ) : (
        <>
          <Choices
            value={section}
            options={[
              {
                value: 'highlights',
                label: t('chatRulesSettings.tab.highlights', { count: draft.highlights.length }),
              },
              {
                value: 'ignores',
                label: t('chatRulesSettings.tab.ignores', { count: draft.ignores.length }),
              },
              {
                value: 'filters',
                label: t('chatRulesSettings.tab.filters', { count: draft.filters.length }),
              },
            ]}
            onChange={(value) => {
              setSection(value)
              setEditingId(null)
            }}
          />
          {section === 'filters' ? (
            <Toggle
              label={t('chatRulesSettings.applyOwn')}
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
                label={t('chatRulesSettings.highlightOwn')}
                value={draft.highlightOwnMessages}
                onChange={(value) =>
                  change((next) => {
                    next.highlightOwnMessages = value
                  })
                }
              />
              <Toggle
                label={t('chatRulesSettings.highlightReplies')}
                value={draft.highlightReplies}
                onChange={(value) =>
                  change((next) => {
                    next.highlightReplies = value
                  })
                }
              />
              <Toggle
                label={t('chatRulesSettings.platformHighlights')}
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
                ? t('chatRulesSettings.allFiltersMatch')
                : t('chatRulesSettings.rulesOrder')}
            </Text>
            <Button
              testId={`chat-rules-add-${section}`}
              label={
                section === 'highlights'
                  ? t('chatRulesSettings.add.highlight')
                  : section === 'ignores'
                    ? t('chatRulesSettings.add.ignore')
                    : t('chatRulesSettings.add.filter')
              }
              onClick={add}
              disabled={draft[section].length >= 1000}
            />
          </div>
          {draft[section].length === 0 ? (
            <Text style={{ fontSize: 12, color: theme.text2, paddingTop: 4, paddingBottom: 8 }}>
              {section === 'highlights'
                ? t('chatRulesSettings.empty.highlights')
                : section === 'ignores'
                  ? t('chatRulesSettings.empty.ignores')
                  : t('chatRulesSettings.empty.filters')}
            </Text>
          ) : null}
          {section === 'highlights'
            ? draft.highlights.map((rule, index) => (
                <RuleItem
                  key={rule.id}
                  id={rule.id}
                  label={rule.name || rule.pattern || t('chatRulesSettings.newHighlight')}
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
                    label={
                      rule.name || rule.pattern || rule.userId || t('chatRulesSettings.newIgnore')
                    }
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
                    label={filter.name || t('chatRulesSettings.newFilter')}
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
            <Text style={{ fontSize: 11, color: theme.text2 }}>
              {t('chatRulesSettings.preview', {
                count: samples.length,
                highlighted: preview.highlighted,
                hidden: preview.hidden,
                replaced: preview.replaced,
              })}
            </Text>
          ) : null}
          <SettingsFooter
            sectionId="rules"
            dirty={dirty}
            saving={persisted.saving}
            error={validation.error ?? saveError ?? persisted.error ?? undefined}
            errorTestId="chat-rules-error"
            disabled={!persisted.loaded || Boolean(validation.error)}
            saveTestId="chat-rules-save"
            onSave={save}
            onDiscard={() => {
              setDraft(structuredClone(persisted.value))
              setDirty(false)
              setSaveError(null)
            }}
          >
            {persisted.error && !dirty ? (
              <Button
                label={t('chatRulesSettings.retry')}
                onClick={() => void chatRulesPreferences.load(backend.api)}
              />
            ) : null}
          </SettingsFooter>
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
  const { t } = useT()
  return (
    <>
      <Field label={t('chatRulesSettings.ruleName')}>
        <Input
          id={`rule-${rule.id}-name`}
          value={rule.name ?? ''}
          onChange={(name) => onChange({ name })}
        />
      </Field>
      <Field label={t('chatRulesSettings.matchAgainst')}>
        <Choices
          value={rule.target}
          options={[
            { value: 'message', label: t('chatRulesSettings.target.message') },
            { value: 'user', label: t('chatRulesSettings.target.user') },
            { value: 'badge', label: t('chatRulesSettings.target.badge') },
            { value: 'filter', label: t('chatRulesSettings.target.filter') },
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
            label={t('chatRulesSettings.enabled')}
            value={rule.enabled}
            onChange={(enabled) => onChange({ enabled })}
          />
          <Field label={t('chatRulesSettings.filterExpression')}>
            <Input
              id={`rule-${rule.id}-pattern`}
              value={rule.pattern}
              onChange={(pattern) => onChange({ pattern })}
              multiline
            />
          </Field>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
            {[
              [t('chatRulesSettings.chip.firstMessage'), 'flags.first_message'],
              [t('chatRulesSettings.chip.subscription'), 'flags.sub_message'],
              [t('chatRulesSettings.chip.reward'), 'flags.reward_message'],
              [t('chatRulesSettings.chip.whisper'), 'flags.whisper'],
              [t('chatRulesSettings.chip.announcement'), 'flags.announcement'],
              [t('chatRulesSettings.chip.restricted'), 'flags.restricted'],
              [t('chatRulesSettings.chip.watchStreak'), 'flags.watch_streak'],
              [t('chatRulesSettings.chip.follow'), 'flags.follow_message'],
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
      <Field label={t('chatRulesSettings.highlightColor')}>
        <Input
          id={`rule-${rule.id}-color`}
          value={rule.color}
          onChange={(color) => onChange({ color })}
          placeholder="#a78bfa"
        />
      </Field>
      <Toggle
        label={t('chatRulesSettings.mentions')}
        value={rule.mentions}
        onChange={(mentions) => onChange({ mentions })}
      />
      <Toggle
        label={t('chatRulesSettings.sound')}
        value={rule.sound}
        onChange={(sound) => onChange({ sound })}
      />
      <Toggle
        label={t('chatRulesSettings.flash')}
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
  const { t } = useT()
  return (
    <>
      <Field label={t('chatRulesSettings.ruleName')}>
        <Input
          id={`rule-${rule.id}-name`}
          value={rule.name ?? ''}
          onChange={(name) => onChange({ name })}
        />
      </Field>
      <PatternEditor rule={rule} onChange={onChange} />
      <Field label={t('chatRulesSettings.matchAgainst')}>
        <Choices
          value={rule.target}
          options={[
            { value: 'message', label: t('chatRulesSettings.target.message') },
            { value: 'user', label: t('chatRulesSettings.target.user') },
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
      <Field label={t('chatRulesSettings.platform')}>
        <Choices
          value={rule.platform ?? 'all'}
          options={[
            { value: 'all', label: t('chatRulesSettings.platform.all') },
            { value: 'twitch', label: 'Twitch' },
            { value: 'kick', label: 'Kick' },
            { value: 'youtube', label: 'YouTube' },
            { value: 'vkplay', label: 'VK Play Live' },
          ]}
          onChange={(platform) => onChange({ platform: platform === 'all' ? undefined : platform })}
        />
      </Field>
      {rule.target === 'user' ? (
        <Field label={t('chatRulesSettings.exactUserId')}>
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
      <Field label={t('chatRulesSettings.action')}>
        <Choices
          value={rule.action ?? (rule.replacement !== undefined ? 'replace' : 'hide')}
          options={[
            { value: 'hide', label: t('chatRulesSettings.action.hide') },
            ...(rule.target === 'message'
              ? ([{ value: 'replace', label: t('chatRulesSettings.action.replace') }] satisfies {
                  value: NonNullable<IgnoreRule['action']>
                  label: string
                }[])
              : []),
            { value: 'suppress-highlights', label: t('chatRulesSettings.action.suppress') },
          ]}
          onChange={(action) =>
            onChange({ action, replacement: action === 'replace' ? '' : undefined })
          }
        />
      </Field>
      {(rule.action ?? (rule.replacement !== undefined ? 'replace' : 'hide')) === 'replace' ? (
        <Field label={t('chatRulesSettings.replacement')}>
          <Input
            id={`rule-${rule.id}-replacement`}
            value={rule.replacement ?? ''}
            onChange={(replacement) => onChange({ replacement })}
          />
        </Field>
      ) : rule.action !== 'suppress-highlights' ? (
        <Toggle
          label={t('chatRulesSettings.placeholder')}
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
  const { t, language } = useT()
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
    // Validation errors are translated: recompute them when the UI language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule, language])
  return (
    <>
      <Toggle
        label={t('chatRulesSettings.enabled')}
        value={rule.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />
      <Field label={rule.regex ? t('chatRulesSettings.regex') : t('chatRulesSettings.phrase')}>
        <Input
          id={`rule-${rule.id}-pattern`}
          value={rule.pattern}
          onChange={(pattern) => onChange({ pattern })}
          placeholder={
            rule.regex
              ? t('chatRulesSettings.patternPlaceholderRegex')
              : t('chatRulesSettings.patternPlaceholder')
          }
        />
      </Field>
      <Choices
        value={rule.regex ? 'regex' : 'literal'}
        options={[
          { value: 'literal', label: t('chatRulesSettings.literalText') },
          { value: 'regex', label: t('chatRulesSettings.regex') },
        ]}
        onChange={(mode) => onChange({ regex: mode === 'regex' })}
      />
      <Toggle
        label={t('chatRulesSettings.caseSensitive')}
        value={rule.caseSensitive}
        onChange={(caseSensitive) => onChange({ caseSensitive })}
      />
      <Toggle
        label={t('chatRulesSettings.wholeWords')}
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
  const { t } = useT()
  const compiled = useMemo(() => compileFilterExpression(filter.expression), [filter.expression])
  const matches = useMemo(
    () => samples.filter((message) => compiled.matches(message)),
    [samples, compiled],
  )
  return (
    <>
      <Field label={t('chatRulesSettings.filterName')}>
        <Input
          id={`filter-${filter.id}-name`}
          value={filter.name}
          onChange={(name) => onChange({ name })}
          placeholder={t('chatRulesSettings.filterNamePlaceholder')}
        />
      </Field>
      <Field label={t('chatRulesSettings.filterExpression')}>
        <Input
          id={`filter-${filter.id}-expression`}
          value={filter.expression}
          onChange={(expression) => onChange({ expression })}
          placeholder={'author.badges contains "moderator"'}
          multiline
        />
      </Field>
      <Text style={{ fontSize: 11, color: theme.text2 }}>{t('chatRulesSettings.filterHelp')}</Text>
      <Text style={{ fontSize: 11, color: theme.text2 }}>
        {t('chatRulesSettings.filterArithmetic')}
      </Text>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Button
          label={t('chatRulesSettings.moderatorExample')}
          onClick={() => onChange({ expression: 'author.badges contains "moderator"' })}
        />
        <Button
          label={t('chatRulesSettings.mentionExample')}
          onClick={() => onChange({ expression: 'flags.highlighted || flags.reply' })}
        />
      </div>
      {compiled.error ? (
        <ErrorText>{compiled.error}</ErrorText>
      ) : (
        <>
          <Text testId={`filter-${filter.id}-preview`} style={{ fontSize: 12, color: theme.text2 }}>
            {t('chatRulesSettings.matchSummary', {
              matched: matches.length,
              total: samples.length,
            })}
          </Text>
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
  const { t } = useT()
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
        <Button
          label={t('chatRulesSettings.earlier')}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        />
        <Button
          label={t('chatRulesSettings.later')}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        />
        <Button
          testId={`rule-${id}-delete`}
          label={t('chatRulesSettings.delete')}
          onClick={onRemove}
        />
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
    theme: { caret: theme.accent.primary },
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
        backgroundColor: primary ? theme.accent.tint20 : theme.fill,
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
