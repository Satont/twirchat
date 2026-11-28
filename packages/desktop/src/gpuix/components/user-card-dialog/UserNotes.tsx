import { useBackend } from '@gpuix/backend-context'
import { useActionToast, type ActionClickEvent } from '@gpuix/components/action-toast'
import { ActionButton, FormInput } from '@gpuix/components/ui/Form'
import { Icon } from '@gpuix/components/ui/Icon'
import { Text } from '@gpuix/components/ui/Text'
import { formatNote, type NoteFormat } from '@gpuix/components/user-card/note-format'
import { parseNoteMarkdown } from '@gpuix/components/user-card/note-markdown'
import { useT } from '@gpuix/hooks/use-translation'
import { useUserCardAlias } from '@gpuix/hooks/user-card-dialog/use-user-card-alias'
import type { IconName } from '@gpuix/icons'
import { useTextInputFocusTracking } from '@gpuix/state/focus'
import { useTheme } from '@gpuix/theme-context'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { useEffect, useState } from 'react'

import { SectionHeader, UserCardPanel } from './UserCardUI'

export function UserNotes({
  target,
  currentAlias,
  onClose,
}: {
  target: UserCardTarget
  currentAlias?: string
  onClose?: () => void
}) {
  const backend = useBackend()
  const theme = useTheme()
  const { t } = useT()
  const { showToast } = useActionToast()
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState('')
  const { platform, platformUserId } = target
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    backend.api
      .getUserNotes({ platform, platformUserId })
      .then((value) => {
        if (active) {
          setText(value)
          setSaved(value)
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [backend, platform, platformUserId])
  async function save(event?: ActionClickEvent) {
    setSaving(true)
    setError('')
    const value = text
    try {
      await backend.api.setUserNotes({ ...target, text: value })
      setSaved(value)
      showToast(t('userCard.notes.saved'), event)
      return true
    } catch (cause) {
      setError(String(cause))
      showToast(String(cause), event)
      return false
    } finally {
      setSaving(false)
    }
  }

  const {
    aliasValue,
    setAliasValue,
    effectiveAlias,
    isSaving,
    saveError,
    handleSaveAlias,
    handleRemoveAlias,
  } = useUserCardAlias({ target, currentAlias, onClose })
  const aliasFocus = useTextInputFocusTracking()

  async function saveAlias(event?: ActionClickEvent) {
    if (await handleSaveAlias()) showToast(t('common.saved'), event)
  }

  async function removeAlias(event?: ActionClickEvent) {
    if (await handleRemoveAlias()) showToast(t('userCard.alias.removed'), event)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <UserCardPanel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Alias Section */}
          <div style={{ marginBottom: 8 }}>
            <SectionHeader
              icon="edit"
              title={t('userCard.alias.title')}
              hint={t('userCard.alias.hint')}
            />

            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <input
                autoFocus
                value={aliasValue}
                placeholder={target.displayName}
                onChange={(event) => setAliasValue(event.value ?? '')}
                onSubmit={() => void saveAlias().catch(() => {})}
                onKeyDown={(event) => {
                  if (event.key === 'escape') onClose?.()
                }}
                theme={{ caret: theme.link }}
                {...aliasFocus}
                style={{
                  flexGrow: 8,
                  flexBasis: 180,
                  minWidth: 0,
                  minHeight: 38,
                  paddingTop: 8,
                  paddingBottom: 8,
                  paddingLeft: 12,
                  paddingRight: 12,
                  backgroundColor: theme.surface2,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 10,
                  fontSize: 13,
                  lineHeight: 18,
                  color: theme.text,
                }}
              />
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: theme.accent.onDeep,
                  backgroundColor: theme.accent.primary,
                  gap: 4,
                  fontSize: 12,

                  paddingLeft: 12,
                  paddingRight: 12,
                  paddingTop: 4,
                  paddingBottom: 4,

                  borderRadius: 12,
                  hover: { opacity: 0.9 },
                }}
                onClick={(event) => void saveAlias(event).catch(() => {})}
              >
                <div style={{ marginTop: 4 }}>
                  <Icon name="check" size={12} color={theme.accent.onDeep} />
                </div>
                {t('common.save')}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 10,
                marginTop: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                {effectiveAlias && effectiveAlias.trim() ? (
                  <ActionButton
                    danger
                    onClick={(event) => void removeAlias(event).catch(() => {})}
                    disabled={isSaving}
                  >
                    {t('userCard.alias.remove')}
                  </ActionButton>
                ) : null}
              </div>
            </div>

            {saveError ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginTop: 10,
                  padding: 10,
                  backgroundColor: 'rgba(252, 165, 165, 0.1)',
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: theme.dangerText,
                }}
              >
                <Text style={{ fontSize: 12, color: theme.dangerText }}>{saveError}</Text>
                <ActionButton onClick={(event) => void saveAlias(event).catch(() => {})}>
                  {t('common.retry')}
                </ActionButton>
              </div>
            ) : null}
          </div>
        </div>
      </UserCardPanel>
      {/* Notes Section */}
      <UserCardPanel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHeader
            icon="pencil"
            title={t('userCard.notes.title')}
            hint={t('userCard.notes.hint')}
          />

          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                backgroundColor: theme.accent.tint20,
                padding: 6,
                borderRadius: 6,
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <ActionButton onClick={() => setPreview(!preview)}>
                {preview ? t('userCard.notes.edit') : t('userCard.notes.preview')}
              </ActionButton>
              <ActionButton
                primary
                disabled={loading || saving || text === saved}
                onClick={(event) => void save(event).catch(() => {})}
              >
                {saving ? t('common.saving') : t('userCard.notes.save')}
              </ActionButton>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              {loading ? (
                t('common.loading')
              ) : text === saved ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <div style={{ color: theme.accent.primary, fontSize: 14, fontWeight: 500 }}>
                    {t('common.saved')}
                  </div>
                  <div
                    style={{ display: 'flex', borderRadius: 999, padding: 6, background: 'green' }}
                  ></div>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <div style={{ color: theme.accent.primary, fontSize: 14, fontWeight: 500 }}>
                    {t('common.unsavedChanges')}
                  </div>
                  <div
                    style={{ display: 'flex', borderRadius: 999, padding: 6, background: 'red' }}
                  ></div>
                </div>
              )}
            </div>
          </div>
          {error ? <Text style={{ color: theme.dangerText, fontSize: 12 }}>{error}</Text> : null}
          {preview ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 12,
                backgroundColor: theme.surface2,
                borderWidth: 1,
                borderColor: theme.accent.tint20,
                borderRadius: 6,
              }}
            >
              {text ? (
                parseNoteMarkdown(text).map((line, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: 0,
                      minHeight: 16,
                      ...(line.kind === 'code' ? { backgroundColor: theme.fill, padding: 4 } : {}),
                    }}
                  >
                    {line.content.map((part, partIndex) => (
                      <Text
                        key={partIndex}
                        onClick={
                          part.url
                            ? () =>
                                void backend.api
                                  .openExternalUrl({ url: part.url! })
                                  .catch((cause: unknown) => setError(String(cause)))
                            : undefined
                        }
                        style={{
                          fontSize: line.kind === 'heading' ? 20 - (line.level ?? 1) : 13,
                          fontWeight:
                            line.kind === 'heading' || part.style === 'strong' ? 700 : 400,
                          color: part.url
                            ? theme.text
                            : line.kind === 'quote'
                              ? theme.text2
                              : theme.text,
                          ...(line.kind === 'code' || part.style === 'code'
                            ? { fontFamily: 'monospace' }
                            : {}),
                          ...(part.style === 'emphasis' ? { fontStyle: 'italic' } : {}),
                          ...(part.style === 'strike' ? { textDecoration: 'line-through' } : {}),
                        }}
                      >
                        {part.text}
                      </Text>
                    ))}
                  </div>
                ))
              ) : (
                <Text style={{ color: theme.text2, fontSize: 13 }}>
                  {t('userCard.notes.empty')}
                </Text>
              )}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(
                  [
                    ['bold', t('userCard.notes.format.bold'), 'bold'],
                    ['strike', t('userCard.notes.format.strike'), 'strike'],
                    ['list', t('userCard.notes.format.list'), 'list'],
                    ['quote', t('userCard.notes.format.quote'), 'quote'],
                    ['code', t('userCard.notes.format.code'), 'code'],
                  ] satisfies Array<[NoteFormat, string, IconName]>
                ).map(([format, label, icon]) => (
                  <ActionButton
                    key={format}
                    icon={icon}
                    onClick={() => setText((current) => formatNote(current, format))}
                  >
                    {label}
                  </ActionButton>
                ))}
              </div>
              <FormInput
                multiline
                value={text}
                onChange={setText}
                placeholder={t('userCard.notes.placeholder')}
                testId="user-notes-editor"
              />
            </>
          )}
        </div>
      </UserCardPanel>
    </div>
  )
}
