/**
 * Watched channel tab content — recursive split layout (port of
 * WatchedChannelsView.vue + SplitNode.vue + PanelNode.vue).
 *
 * GPUIX deltas:
 * - splitpanes → flex rows/columns with proportional flexGrow; dividers are
 *   4px pointer-capture drag handles that adjust neighbors' flex values
 *   (deltas are in pixels applied at ~8px per flex point — GPUI exposes no
 *   element bounds, so the gesture corrects itself visually).
 * - HTML5 panel drag-and-drop re-docking is not possible (no cross-element
 *   hit testing while captured) — use the ⋮ menu / hotkeys instead.
 */

import { useEffect, useRef, useState } from 'react'
import type { LayoutNode, PanelNode, SplitNode } from '@twirchat/shared/types'

import { useBackend } from '../backend/context'
import { useStore } from '../state/create-store'
import { tabChannelNamesStore, watchedChannelsStore } from '../state/app'
import {
  allPanels,
  assignChannel,
  layoutRevisionStore,
  layoutStore,
  loadLayout,
  removePanel,
  splitPanel,
  updateSplitFlexes,
} from '../state/layout'
import { useTheme } from '../theme-context'
import { Text } from './ui/Text'
import { ChatView } from './ChatView'
import { AddChannelForm } from './AddChannelForm'

/** Rough px per flex point when dragging dividers (self-correcting by eye). */
const PX_PER_FLEX = 8
const MIN_FLEX = 5

export function WatchedView({ tabId }: { tabId: string }) {
  const backend = useBackend()
  const theme = useTheme()
  const layouts = useStore(layoutStore)
  const layoutRevision = useStore(layoutRevisionStore)
  const watchedChannels = useStore(watchedChannelsStore)

  const state = layouts.get(tabId)

  useEffect(() => {
    void loadLayout(backend, tabId)
  }, [backend, tabId])

  // Publish the tab's channel names for the tab bar label.
  const layout = state?.layout ?? null
  useEffect(() => {
    if (!layout) return
    const names = allPanels(layout)
      .filter((p) => p.content.type === 'watched')
      .map((p) => {
        const ch = watchedChannels.find(
          (c) => c.id === (p.content as { type: 'watched'; channelId: string }).channelId,
        )
        return ch?.displayName ?? null
      })
      .filter((n): n is string => n !== null)
    if (names.length > 0) {
      tabChannelNamesStore.set((current) => new Map(current).set(tabId, names))
    }
  }, [layout, watchedChannels, tabId])

  if (!state || state.isLoading) {
    return (
      <Centered>
        <Text style={{ color: theme.text2, fontSize: 13 }}>Loading layout...</Text>
      </Centered>
    )
  }
  if (state.error) {
    return (
      <Centered>
        <Text style={{ color: '#ef4444', fontSize: 13 }}>Error: {state.error}</Text>
      </Centered>
    )
  }
  if (!layout) {
    return (
      <Centered>
        <Text style={{ color: theme.text2, fontSize: 13 }}>No layout available</Text>
      </Centered>
    )
  }

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* Keyed by the layout revision: a full remount of the pane tree after
          split/remove/assign works around GPUI occasionally not painting a
          freshly mounted subtree inside an already painted tree. */}
      <SplitNodeView key={`${tabId}:${layoutRevision}`} node={layout.root} tabId={tabId} />
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
      }}
    >
      {children}
    </div>
  )
}

// ── Split node (recursive) ───────────────────────────────────────────────────

function SplitNodeView({ node, tabId }: { node: LayoutNode; tabId: string }) {
  if (node.type === 'panel') {
    return <PanelView panel={node} tabId={tabId} />
  }
  return <SplitContainer split={node} tabId={tabId} />
}

function SplitContainer({ split, tabId }: { split: SplitNode; tabId: string }) {
  const backend = useBackend()
  const horizontal = split.direction === 'horizontal' // rows stacked vertically
  const [flexes, setFlexes] = useState<number[]>(() => split.children.map((c) => c.flex))

  // Keep local flexes in sync when the layout reloads (split/assign/etc.).
  const childrenKey = split.children.map((c) => `${c.id}:${c.flex}`).join('|')
  useEffect(() => {
    setFlexes(split.children.map((c) => c.flex))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childrenKey])

  const persist = (next: number[]) => updateSplitFlexes(backend, tabId, split.id, next)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: horizontal ? 'column' : 'row',
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {split.children.flatMap((child, index) => {
        const pieces: React.ReactNode[] = [
          <div
            key={child.id}
            style={{
              flexGrow: flexes[index] ?? child.flex,
              flexShrink: 1,
              flexBasis: 0,
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <SplitNodeView node={child} tabId={tabId} />
          </div>,
        ]
        if (index < split.children.length - 1) {
          pieces.push(
            <Divider
              key={`divider-${child.id}`}
              horizontal={horizontal}
              onDrag={(deltaPx) => {
                setFlexes((current) => {
                  const next = [...current]
                  const left = next[index] ?? 50
                  const right = next[index + 1] ?? 50
                  const pair = left + right
                  const delta = deltaPx / PX_PER_FLEX
                  const newLeft = Math.min(pair - MIN_FLEX, Math.max(MIN_FLEX, left + delta))
                  next[index] = newLeft
                  next[index + 1] = pair - newLeft
                  return next
                })
              }}
              onDragEnd={() => persist(flexes)}
            />,
          )
        }
        return pieces
      })}
    </div>
  )
}

function Divider({
  horizontal,
  onDrag,
  onDragEnd,
}: {
  /** true = divider between vertically stacked rows (drag moves in Y). */
  horizontal: boolean
  onDrag: (deltaPx: number) => void
  onDragEnd: () => void
}) {
  const theme = useTheme()
  const [active, setActive] = useState(false)
  const dragState = useRef<{ lastPos: number } | null>(null)
  const hoverColor = '#a78bfa'

  return (
    <div
      onMouseDown={(event) => {
        if (event.button !== 0) return
        dragState.current = { lastPos: horizontal ? (event.y ?? 0) : (event.x ?? 0) }
        setActive(true)
      }}
      onMouseMove={(event) => {
        if (!dragState.current) return
        const pos = horizontal ? (event.y ?? 0) : (event.x ?? 0)
        const delta = pos - dragState.current.lastPos
        dragState.current.lastPos = pos
        if (delta !== 0) onDrag(delta)
      }}
      onMouseUp={() => {
        if (!dragState.current) return
        dragState.current = null
        setActive(false)
        onDragEnd()
      }}
      style={{
        width: horizontal ? '100%' : 4,
        height: horizontal ? 4 : '100%',
        flexShrink: 0,
        backgroundColor: active ? hoverColor : theme.border,
        cursor: horizontal ? 'row-resize' : 'col-resize',
        hover: { backgroundColor: hoverColor },
      }}
    />
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

function PanelView({ panel, tabId }: { panel: PanelNode; tabId: string }) {
  const backend = useBackend()
  const theme = useTheme()
  const watchedChannels = useStore(watchedChannelsStore)
  const [showAddForm, setShowAddForm] = useState(false)

  const isMain = panel.content.type === 'main'
  const channelId = panel.content.type === 'watched' ? panel.content.channelId : null
  const watchedChannel = channelId
    ? (watchedChannels.find((ch) => ch.id === channelId) ?? null)
    : null

  const showForm = panel.content.type === 'empty' || showAddForm

  return (
    <div
      tabIndex={0}
      onKeyDown={(event) => {
        if (!event.modifiers?.ctrl) return
        if (event.key === 'h') {
          void splitPanel(
            backend,
            tabId,
            panel.id,
            event.modifiers.shift ? 'vertical' : 'horizontal',
          )
        } else if (event.key === 'w' && !isMain) {
          void removePanel(backend, tabId, panel.id)
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: theme.bg,
        borderWidth: 1,
        borderColor: theme.border,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          flexGrow: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        {showForm ? (
          <div
            style={{
              flexGrow: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
          >
            <div style={{ maxWidth: 260, width: '100%' }}>
              <AddChannelForm
                cancelable={panel.content.type === 'watched' && showAddForm}
                onConfirm={(platform, slug) => {
                  void (async () => {
                    try {
                      const existing = watchedChannels.find(
                        (ch) => ch.platform === platform && ch.channelSlug === slug,
                      )
                      const channel =
                        existing ??
                        (await backend.api.addWatchedChannel({ platform, channelSlug: slug }))
                      await assignChannel(backend, tabId, panel.id, channel.id)
                      setShowAddForm(false)
                    } catch (error) {
                      console.error('[panel] add-and-assign failed:', error)
                    }
                  })()
                }}
                onCancel={() => setShowAddForm(false)}
              />
            </div>
          </div>
        ) : isMain ? (
          <ChatView isMain />
        ) : watchedChannel ? (
          <ChatView
            watchedChannel={watchedChannel}
            onSplitRight={() => void splitPanel(backend, tabId, panel.id, 'vertical')}
            onChangeChannel={() => setShowAddForm(true)}
            onClosePanel={() => void removePanel(backend, tabId, panel.id)}
          />
        ) : null}
      </div>
    </div>
  )
}
