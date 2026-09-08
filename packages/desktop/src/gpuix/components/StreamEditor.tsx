/**
 * Stream editor — port of StreamEditor.vue: shows the stream status of a
 * connected Twitch/Kick account and lets the user edit title + category.
 *
 * Status polling mirrors usePolling.ts semantics: an immediate first tick,
 * then a 60s interval, skipping ticks while the previous one is in flight.
 * The category dropdown is a GPUIX anchored overlay (paints above siblings).
 */

import { useEffect, useRef, useState } from 'react'
import type { CategorySearchResult } from '@twirchat/shared/protocol'

import { useBackend } from '../backend/context'
import { useOverlayClose } from '../state/overlays'
import { accent, withAlpha } from '../theme'
import { useTheme } from '../theme-context'
import { Icon } from './ui/Icon'
import { Text } from './ui/Text'
import { RemoteImage } from './ui/RemoteImage'

export interface StreamEditorProps {
  platform: 'twitch' | 'kick'
  /** The numeric broadcaster ID (Twitch) or channel slug (Kick) */
  channelId: string
}

export function StreamEditor({ platform, channelId }: StreamEditorProps) {
  const backend = useBackend()
  const theme = useTheme()

  // ── Stream status state ────────────────────────────────────────────────
  const [isLive, setIsLive] = useState(false)
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined)
  const [categoryName, setCategoryName] = useState<string | undefined>(undefined)
  const [viewerCount, setViewerCount] = useState<number | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // ── Edit state ─────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editCategoryId, setEditCategoryId] = useState<string | undefined>(undefined)
  const [editCategoryName, setEditCategoryName] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // ── Category search ────────────────────────────────────────────────────
  const [categoryQuery, setCategoryQuery] = useState('')
  const [categoryResults, setCategoryResults] = useState<CategorySearchResult[]>([])
  useOverlayClose(categoryResults.length > 0, () => setCategoryResults([]))
  const [searchLoading, setSearchLoading] = useState(false)
  const [focusedField, setFocusedField] = useState<'title' | 'category' | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Poll every 60 seconds (immediate first tick + overlap guard, like usePolling).
  useEffect(() => {
    let cancelled = false
    let running = false

    const tick = async () => {
      if (cancelled || running) return
      running = true
      setLoading(true)
      setLoadError(null)
      try {
        const s = await backend.api.getStreamStatus({ channelId, platform })
        if (cancelled) return
        setIsLive(s.isLive)
        setTitle(s.title)
        setCategoryId(s.categoryId)
        setCategoryName(s.categoryName)
        setViewerCount(s.viewerCount)
      } catch (error) {
        if (!cancelled) setLoadError(String(error))
      } finally {
        running = false
        if (!cancelled) setLoading(false)
      }
    }

    void tick()
    const timer = setInterval(() => void tick(), 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [backend, platform, channelId])

  // Clear pending debounce / success timers on unmount.
  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  function onCategoryInput(value: string) {
    setCategoryQuery(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!value.trim()) {
      setCategoryResults([])
      return
    }
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const res = await backend.api.searchCategories({ platform, query: value })
        setCategoryResults(res.categories)
      } catch {
        setCategoryResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 350)
  }

  function selectCategory(cat: CategorySearchResult) {
    setEditCategoryId(cat.id)
    setEditCategoryName(cat.name)
    setCategoryQuery(cat.name)
    setCategoryResults([])
  }

  // ── Edit / Save ────────────────────────────────────────────────────────

  function startEdit() {
    setEditTitle(title)
    setEditCategoryId(categoryId)
    setEditCategoryName(categoryName)
    setCategoryQuery(categoryName ?? '')
    setCategoryResults([])
    setSaveError(null)
    setSaveSuccess(false)
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      await backend.api.updateStream({
        categoryId: editCategoryId,
        channelId,
        platform,
        title: editTitle,
      })
      // Reflect changes locally immediately
      setTitle(editTitle)
      setCategoryId(editCategoryId)
      setCategoryName(editCategoryName)
      setSaveSuccess(true)
      saveTimer.current = setTimeout(() => {
        setSaveSuccess(false)
        setEditing(false)
      }, 1500)
    } catch (error) {
      setSaveError(String(error))
    } finally {
      setSaving(false)
    }
  }

  // ── Shared styles ──────────────────────────────────────────────────────

  const placeholderColor = withAlpha(theme.text2, 0.6)
  const inputStyle = (focused: boolean) => ({
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: focused ? accent.primary : theme.border,
    borderRadius: 7,
    color: theme.text,
    fontSize: 13,
    paddingTop: 7,
    paddingBottom: 7,
    paddingLeft: 10,
    paddingRight: 10,
  })
  const labelStyle = {
    fontSize: 11,
    fontWeight: 700,
    color: theme.text2,
    marginTop: 4,
  }

  return (
    <div
      style={{
        paddingTop: 12,
        paddingBottom: 14,
        paddingLeft: 20,
        paddingRight: 20,
        borderTopWidth: 1,
        borderColor: theme.border,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* Loading / error */}
      {loading && !title ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>Loading stream info…</Text>
      ) : loadError ? (
        <Text style={{ fontSize: 12, color: '#ef4444' }}>{loadError}</Text>
      ) : !editing ? (
        /* Status display (not editing) */
        <>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                paddingTop: 2,
                paddingBottom: 2,
                paddingLeft: 7,
                paddingRight: 7,
                borderRadius: 4,
                borderWidth: 1,
                ...(isLive
                  ? {
                      backgroundColor: 'rgba(239, 68, 68, 0.15)',
                      borderColor: 'rgba(239, 68, 68, 0.35)',
                    }
                  : { backgroundColor: theme.surface2, borderColor: theme.border }),
              }}
            >
              <Text
                style={{ fontSize: 10, fontWeight: 800, color: isLive ? '#ef4444' : theme.text2 }}
              >
                {isLive ? 'LIVE' : 'OFFLINE'}
              </Text>
            </div>
            {isLive && viewerCount !== undefined ? (
              <Text style={{ fontSize: 12, color: theme.text2 }}>
                {`${viewerCount.toLocaleString()} viewers`}
              </Text>
            ) : null}
            <div style={{ flexGrow: 1 }} />
            <div
              testId="stream-edit"
              onClick={startEdit}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                backgroundColor: accent.tint10,
                borderWidth: 1,
                borderColor: accent.tint20,
                borderRadius: 6,
                paddingTop: 3,
                paddingBottom: 3,
                paddingLeft: 10,
                paddingRight: 10,
                cursor: 'pointer',
                hover: { backgroundColor: accent.tint20 },
              }}
            >
              <Icon name="edit" size={14} color={accent.primary} />
              <Text style={{ fontSize: 12, fontWeight: 600, color: accent.primary }}>Edit</Text>
            </div>
          </div>
          {title ? (
            <Text
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: theme.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </Text>
          ) : null}
          {categoryName ? (
            <Text style={{ fontSize: 12, color: theme.text2 }}>{categoryName}</Text>
          ) : null}
        </>
      ) : (
        /* Edit form */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Text style={labelStyle}>{'Title'.toUpperCase()}</Text>
          <input
            value={editTitle}
            placeholder="Stream title…"
            onChange={(event) => setEditTitle((event.value ?? '').slice(0, 140))}
            onFocus={() => setFocusedField('title')}
            onBlur={() => setFocusedField((field) => (field === 'title' ? null : field))}
            theme={{ caret: accent.primary, textMuted: placeholderColor }}
            style={inputStyle(focusedField === 'title')}
          />

          <Text style={labelStyle}>{'Category / Game'.toUpperCase()}</Text>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <input
              value={categoryQuery}
              placeholder="Search categories…"
              onChange={(event) => onCategoryInput(event.value ?? '')}
              onFocus={() => setFocusedField('category')}
              onBlur={() => setFocusedField((field) => (field === 'category' ? null : field))}
              theme={{ caret: accent.primary, textMuted: placeholderColor }}
              style={inputStyle(focusedField === 'category')}
            />
            {!searchLoading && categoryResults.length > 0 ? (
              <anchored
                deferred
                side="bottom"
                align="start"
                gap={4}
                onMouseDownOutside={() => setCategoryResults([])}
                style={{
                  width: '100%',
                  maxHeight: 200,
                  overflowY: 'scroll',
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 8,
                  padding: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: {
                    offsetX: 0,
                    offsetY: 8,
                    blurRadius: 24,
                    spreadRadius: 0,
                    color: 'rgba(0, 0, 0, 0.4)',
                  },
                }}
              >
                {categoryResults.map((cat) => (
                  <div
                    key={cat.id}
                    onClick={() => selectCategory(cat)}
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      paddingTop: 7,
                      paddingBottom: 7,
                      paddingLeft: 10,
                      paddingRight: 10,
                      borderRadius: 6,
                      cursor: 'pointer',
                      hover: { backgroundColor: accent.tint12 },
                    }}
                  >
                    {cat.thumbnailUrl ? (
                      <RemoteImage
                        url={cat.thumbnailUrl}
                        objectFit="cover"
                        style={{ width: 26, height: 36, borderRadius: 3, flexShrink: 0 }}
                      />
                    ) : null}
                    <Text style={{ fontSize: 13, color: theme.text }}>{cat.name}</Text>
                  </div>
                ))}
              </anchored>
            ) : null}
          </div>
          {searchLoading ? (
            <Text style={{ fontSize: 12, color: theme.text2, paddingTop: 4, paddingLeft: 2 }}>
              Searching…
            </Text>
          ) : null}

          {saveError ? <Text style={{ fontSize: 12, color: '#ef4444' }}>{saveError}</Text> : null}

          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              gap: 8,
              justifyContent: 'flex-end',
              marginTop: 4,
            }}
          >
            <div
              testId="stream-cancel"
              onClick={saving ? undefined : () => setEditing(false)}
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 7,
                paddingTop: 6,
                paddingBottom: 6,
                paddingLeft: 16,
                paddingRight: 16,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.45 : 1,
                hover: saving ? undefined : { backgroundColor: 'rgba(255, 255, 255, 0.1)' },
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: 600, color: theme.text2 }}>Cancel</Text>
            </div>
            <div
              testId="stream-save"
              onClick={saving ? undefined : () => void save()}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                backgroundColor: accent.primary,
                borderRadius: 7,
                paddingTop: 6,
                paddingBottom: 6,
                paddingLeft: 16,
                paddingRight: 16,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.45 : 1,
                hover: saving ? undefined : { opacity: 0.88 },
              }}
            >
              {saveSuccess ? <Icon name="check" size={13} color="#ffffff" /> : null}
              <Text style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>
                {saveSuccess ? 'Saved!' : saving ? 'Saving…' : 'Save'}
              </Text>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
