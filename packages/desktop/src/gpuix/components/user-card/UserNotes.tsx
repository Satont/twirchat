import { useEffect, useState } from 'react'

import type { UserCardTarget } from '../../../views/main/utils/chatCommands'
import { useBackend } from '../../backend/context'
import { useTheme } from '../../theme-context'
import { ActionButton, FormInput } from '../ui/Form'
import { Text } from '../ui/Text'
import { parseNoteMarkdown } from './note-markdown'

/** Native Markdown preview: paragraphs, headings, lists, quotes and fenced code. */
export function UserNotes({ target }: { target: UserCardTarget }) {
  const backend = useBackend()
  const theme = useTheme()
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
  async function save() {
    setSaving(true)
    setError('')
    const value = text
    try {
      await backend.api.setUserNotes({ ...target, text: value })
      setSaved(value)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Text style={{ fontSize: 13, color: theme.text2 }}>
        Private notes saved on this device. Supports Markdown headings, lists, quotes and code
        blocks.
      </Text>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
        <ActionButton onClick={() => setPreview(!preview)}>
          {preview ? 'Edit notes' : 'Preview'}
        </ActionButton>
        <ActionButton
          primary
          disabled={loading || saving || text === saved}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save notes'}
        </ActionButton>
        <Text style={{ fontSize: 12, color: theme.text2 }}>
          {loading ? 'Loading…' : text === saved ? 'Saved' : 'Unsaved changes'}
        </Text>
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
                      fontWeight: line.kind === 'heading' || part.style === 'strong' ? 700 : 400,
                      color: part.url
                        ? theme.text
                        : line.kind === 'quote'
                          ? theme.text2
                          : theme.text,
                      ...(line.kind === 'code' || part.style === 'code'
                        ? { fontFamily: 'monospace' }
                        : {}),
                      ...(part.style === 'emphasis' ? { fontStyle: 'italic' } : {}),
                    }}
                  >
                    {part.text}
                  </Text>
                ))}
              </div>
            ))
          ) : (
            <Text style={{ color: theme.text2, fontSize: 13 }}>No notes yet.</Text>
          )}
        </div>
      ) : (
        <FormInput
          multiline
          value={text}
          onChange={setText}
          placeholder="Write a private note…"
          testId="user-notes-editor"
        />
      )}
    </div>
  )
}
