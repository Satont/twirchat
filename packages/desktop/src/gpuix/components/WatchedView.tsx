import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
/**
 * Watched channel tab content — recursive split layout (port of
 * WatchedChannelsView.vue + SplitNode.vue + PanelNode.vue).
 *
 * Dividers and pane docking use the last painted native element bounds.
 * Captured pointer events continue outside the original drag handle.
 */
import type { LayoutNode, PanelNode, SplitNode } from '@twirchat/shared/types'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { parseHotkeyChoice } from '../hotkey-bindings'
import { dockSideAt, resizedPair, type DockSide } from '../layout-operations'
import { useHotkeyContext, useHotkeyRoute } from '../state/action-bindings'
import { setActivePane, activePaneByWindowStore } from '../state/active-pane'
import { showNotice, tabChannelNamesStore, watchedChannelsStore } from '../state/app'
import { focusComposerForPane } from '../state/composer-focus'
import { useStore, useStoreSelector } from '../state/create-store'
import { useDesktopWindows } from '../state/desktop-windows'
import {
  allPanels,
  assignChannel,
  layoutRevisionStore,
  layoutStore,
  loadLayout,
  removePanel,
  splitPanel,
  updateSplitFlexes,
  dockLayoutPanel,
  registerLayoutPanelFocus,
  rememberLayoutPanelFocus,
  focusLayoutPanel,
} from '../state/layout'
import { useWindowScope } from '../state/window-scope'
import { useTheme } from '../theme-context'
import { AddChannelForm } from './AddChannelForm'
import { ChatView } from './ChatView'
import { AppStatusIcon } from './ui/AppStatusIcon'
import { Icon } from './ui/Icon'
import { Text } from './ui/Text'

interface DockPreview {
  sourceId: string
  targetId: string
  side: DockSide
}
interface PaneDragContextValue {
  elements: Map<string, number>
  preview: DockPreview | null
  move(sourceId: string, x: number, y: number): void
  finish(): void
  cancel(): void
}
const PaneDragContext = createContext<PaneDragContextValue | null>(null)

const GoToPlatformsContext = createContext<(() => void) | undefined>(undefined)

export function WatchedView({
  tabId,
  onGoToPlatforms,
}: {
  tabId: string
  onGoToPlatforms?: () => void
}) {
  const backend = useBackend()
  const theme = useTheme()
  const layouts = useStore(layoutStore)
  const layoutRevision = useStore(layoutRevisionStore)
  const watchedChannels = useStore(watchedChannelsStore)
  const renderer = useGpuixRequired()
  const elements = useMemo(() => new Map<string, number>(), [])
  const [preview, setPreview] = useState<DockPreview | null>(null)
  const previewRef = useRef<DockPreview | null>(null)
  const dragContext: PaneDragContextValue = {
    elements,
    preview,
    move(sourceId, x, y) {
      let next: DockPreview | null = null
      for (const [targetId, elementId] of elements) {
        if (targetId === sourceId) continue
        const bounds = renderer.getElementBounds?.(elementId)
        if (
          bounds &&
          x >= bounds.x &&
          y >= bounds.y &&
          x < bounds.x + bounds.width &&
          y < bounds.y + bounds.height
        ) {
          next = { sourceId, targetId, side: dockSideAt(bounds, x, y) }
          break
        }
      }
      if (
        next?.targetId === previewRef.current?.targetId &&
        next?.side === previewRef.current?.side
      )
        return
      previewRef.current = next
      setPreview(next)
    },
    finish() {
      const drop = previewRef.current
      previewRef.current = null
      setPreview(null)
      if (drop)
        void dockLayoutPanel(backend, tabId, drop.sourceId, drop.targetId, drop.side).catch(
          (error) => showNotice('error', String(error)),
        )
    },
    cancel() {
      previewRef.current = null
      setPreview(null)
    },
  }

  const state = layouts.get(tabId)

  useEffect(() => {
    runUiTask(loadLayout(backend, tabId))
  }, [backend, tabId])

  // Publish the tab's channel names for the tab bar label.
  const layout = state?.layout ?? null
  useEffect(() => {
    if (!layout) return
    const names = allPanels(layout)
      .filter((p) => p.content.type === 'watched')
      .map((p) => {
        const ch = watchedChannels.find(
          (c) => p.content.type === 'watched' && c.id === p.content.channelId,
        )
        return ch?.displayName ?? null
      })
      .filter((n): n is string => n !== null)
    if (names.length > 0) {
      tabChannelNamesStore.modify((current) => new Map(current).set(tabId, names))
    }
  }, [layout, watchedChannels, tabId])

  if (!state || (state.isLoading && !layout)) {
    return (
      <Centered>
        <Text style={{ color: theme.text2, fontSize: 13 }}>Loading layout...</Text>
      </Centered>
    )
  }
  if (state.error && !layout) {
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
    <GoToPlatformsContext.Provider value={onGoToPlatforms}>
      <PaneDragContext.Provider value={dragContext}>
        <div
          style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {state.error ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexDirection: 'row',
                gap: 8,
                padding: 8,
                backgroundColor: theme.surface,
              }}
            >
              <Text style={{ fontSize: 12, color: theme.dangerText, flexGrow: 1 }}>
                {state.error}
              </Text>
              <Text
                onClick={() =>
                  void loadLayout(backend, tabId).catch((error) =>
                    showNotice('error', String(error)),
                  )
                }
                style={{ fontSize: 12, color: theme.link, cursor: 'pointer' }}
              >
                Retry layout
              </Text>
            </div>
          ) : null}
          {/* Keyed by the layout revision: a full remount of the pane tree after
          split/remove/assign works around GPUI occasionally not painting a
          freshly mounted subtree inside an already painted tree. */}
          <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <SplitNodeView key={`${tabId}:${layoutRevision}`} node={layout.root} tabId={tabId} />
          </div>
        </div>
      </PaneDragContext.Provider>
    </GoToPlatformsContext.Provider>
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
  const flexesRef = useRef(flexes)
  const renderer = useGpuixRequired()
  const childElements = useRef(new Map<string, number>())
  const drag = useRef<{ start: number[]; pixels: number } | null>(null)

  // Keep local flexes in sync when the layout reloads (split/assign/etc.).
  const childrenKey = split.children.map((c) => `${c.id}:${c.flex}`).join('|')
  useEffect(() => {
    const next = split.children.map((c) => c.flex)
    flexesRef.current = next
    setFlexes(next)
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
            ref={(element) => {
              if (element) childElements.current.set(child.id, element.id)
              else childElements.current.delete(child.id)
            }}
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
              onDragStart={() => {
                const firstId = childElements.current.get(child.id)
                const secondId = childElements.current.get(split.children[index + 1]!.id)
                const first = firstId === undefined ? null : renderer.getElementBounds?.(firstId)
                const second = secondId === undefined ? null : renderer.getElementBounds?.(secondId)
                drag.current = {
                  start: [...flexesRef.current],
                  pixels:
                    first && second
                      ? horizontal
                        ? first.height + second.height
                        : first.width + second.width
                      : 0,
                }
              }}
              onDrag={(deltaPx) => {
                if (!drag.current) return
                const next = resizedPair(drag.current.start, index, deltaPx, drag.current.pixels)
                flexesRef.current = next
                setFlexes(next)
              }}
              onDragEnd={() => {
                drag.current = null
                persist(flexesRef.current)
              }}
              onDragCancel={() => {
                if (drag.current) {
                  flexesRef.current = drag.current.start
                  setFlexes(drag.current.start)
                }
                drag.current = null
              }}
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
  onDragStart,
  onDrag,
  onDragEnd,
  onDragCancel,
}: {
  /** true = divider between vertically stacked rows (drag moves in Y). */
  horizontal: boolean
  onDragStart: () => void
  onDrag: (deltaPx: number) => void
  onDragEnd: () => void
  onDragCancel: () => void
}) {
  const theme = useTheme()
  const [active, setActive] = useState(false)
  const dragState = useRef<{ startPos: number } | null>(null)
  const hoverColor = '#a78bfa'

  return (
    <div
      testId="pane-divider"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'escape' && dragState.current) {
          dragState.current = null
          setActive(false)
          onDragCancel()
          event.preventDefault()
          return
        }
        const previous = horizontal ? 'up' : 'left'
        const next = horizontal ? 'down' : 'right'
        if (event.key === previous || event.key === next) {
          event.preventDefault()
          onDragStart()
          onDrag((event.key === previous ? -1 : 1) * (event.modifiers?.shift ? 1 : 10))
          onDragEnd()
        }
      }}
      onMouseDown={(event) => {
        if (event.button !== 0) return
        dragState.current = { startPos: horizontal ? (event.y ?? 0) : (event.x ?? 0) }
        onDragStart()
        setActive(true)
      }}
      onMouseMove={(event) => {
        if (!dragState.current) return
        const pos = horizontal ? (event.y ?? 0) : (event.x ?? 0)
        const delta = pos - dragState.current.startPos
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
  const docking = useContext(PaneDragContext)
  const renderer = useGpuixRequired()
  const scope = useWindowScope()
  const goToPlatforms = useContext(GoToPlatformsContext)
  const windows = useDesktopWindows()
  const activePane = useStoreSelector(activePaneByWindowStore, (entries) => entries.get(scope))
  const currentLayout = useStoreSelector(layoutStore, (entries) => entries.get(tabId)?.layout)
  const chooserInput = useRef<PublicInstance | null>(null)
  const paneElement = useRef<number | null>(null)
  useEffect(
    () =>
      registerLayoutPanelFocus(
        tabId,
        panel.id,
        () => {
          if (!focusComposerForPane(tabId, panel.id, scope)) {
            const element = chooserInput.current?.id ?? paneElement.current
            if (element !== null) renderer.focusElement?.(element)
          }
          setActivePane({ tabId, paneId: `${tabId}:${panel.id}` }, scope)
        },
        scope,
      ),
    [tabId, panel.id, renderer, scope],
  )
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const registerPane = (element: PublicInstance | null) => {
    paneElement.current = element?.id ?? null
    if (element) docking?.elements.set(panel.id, element.id)
    else docking?.elements.delete(panel.id)
  }
  const dropSide = docking?.preview?.targetId === panel.id ? docking.preview.side : null
  const dropBounds =
    dropSide && paneElement.current !== null
      ? renderer.getElementBounds?.(paneElement.current)
      : null

  const isMain = panel.content.type === 'main'
  const isEmpty = panel.content.type === 'empty'
  const channelId = panel.content.type === 'watched' ? panel.content.channelId : null
  const watchedChannel = channelId
    ? (watchedChannels.find((ch) => ch.id === channelId) ?? null)
    : null

  const showForm = isEmpty || showAddForm
  const paneIdentity = `${tabId}:${panel.id}`
  const chooserId = `chooser:${paneIdentity}`
  const activatePane = () => {
    setActivePane({ tabId, paneId: paneIdentity }, scope)
    rememberLayoutPanelFocus(tabId, panel.id, scope)
  }
  const panels = allPanels(currentLayout ?? null)
  const standalone = windows?.descriptor.kind === 'chat' || windows?.descriptor.kind === 'overlay'
  const permanentHome = tabId === 'home' && panels.length === 1 && !standalone
  const closePane = async () => {
    if (
      windows &&
      (windows.descriptor.kind === 'chat' || windows.descriptor.kind === 'overlay') &&
      panels.length === 1
    )
      await windows.close()
    else if (!permanentHome) await removePanel(backend, tabId, panel.id)
  }
  const chooserActive =
    showForm && activePane?.tabId === tabId && activePane.paneId === paneIdentity
  const knownActive =
    activePane?.tabId === tabId &&
    panels.some((candidate) => `${tabId}:${candidate.id}` === activePane.paneId)
  const autoFocusChooser = chooserActive || (!knownActive && panels[0]?.id === panel.id)
  useHotkeyContext({
    id: chooserId,
    category: 'split',
    handlers: showForm
      ? {
          delete: permanentHome ? null : closePane,
          changeChannel: () => {
            setShowAddForm(true)
            if (chooserInput.current) renderer.focusElement?.(chooserInput.current.id)
          },
          focus: (args) => {
            focusLayoutPanel(
              backend,
              tabId,
              panel.id,
              parseHotkeyChoice(args[0], ['left', 'right', 'up', 'above', 'down', 'below']),
              scope,
            )
          },
          popupOverlay: windows ? () => windows.openChat(tabId, panel.id, true) : null,
        }
      : {},
  })
  useHotkeyRoute([chooserId, 'window'], chooserActive)

  const canDock = panels.length > 1
  const showAppStatus =
    !!windows && windows.descriptor.kind !== 'main' && panels[0]?.id === panel.id
  const dragGrip = canDock ? (
    <div
      testId={`pane-drag-${panel.id}`}
      tabIndex={0}
      aria-label="Drag to move this chat pane"
      onKeyDown={(event) => {
        if (event.key === 'escape') {
          dragStart.current = null
          docking?.cancel()
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onMouseDown={(event) => {
        if (event.button === 0) dragStart.current = { x: event.x ?? 0, y: event.y ?? 0 }
      }}
      onMouseMove={(event) => {
        const start = dragStart.current
        if (start && Math.hypot((event.x ?? 0) - start.x, (event.y ?? 0) - start.y) >= 5)
          docking?.move(panel.id, event.x ?? 0, event.y ?? 0)
      }}
      onMouseUp={() => {
        if (dragStart.current) {
          dragStart.current = null
          docking?.finish()
        }
      }}
      style={{
        height: 24,
        width: 18,
        borderRadius: 4,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'move',
        userSelect: 'none',
        hover: { backgroundColor: theme.fillHover },
        focusVisible: { outlineWidth: 1, outlineColor: theme.link, outlineOffset: 0 },
      }}
    >
      <Icon name="grip" size={12} color={theme.text2} />
    </div>
  ) : null
  const headerLeading =
    showAppStatus || canDock ? (
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2,
          flexShrink: 0,
        }}
      >
        {showAppStatus ? <AppStatusIcon compact size={18} /> : null}
        {dragGrip}
      </div>
    ) : null

  return (
    <div
      ref={registerPane}
      testId={`pane-${panel.id}`}
      onMouseDown={() => {
        setActivePane({ tabId, paneId: `${tabId}:${panel.id}` }, scope)
        rememberLayoutPanelFocus(tabId, panel.id, scope)
      }}
      onFocus={() => {
        setActivePane({ tabId, paneId: `${tabId}:${panel.id}` }, scope)
        rememberLayoutPanelFocus(tabId, panel.id, scope)
      }}
      tabIndex={0}
      onKeyDown={(event) => {
        if (!event.modifiers?.ctrl) return
        if (event.key === 'h') {
          runUiTask(
            splitPanel(
              backend,
              tabId,
              panel.id,
              event.modifiers.shift ? 'vertical' : 'horizontal',
              scope,
            ),
          )
        } else if (event.key === 'w' && !isMain) {
          runUiTask(closePane())
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
      {(showForm || (!isMain && !watchedChannel)) && headerLeading ? (
        <div style={{ position: 'absolute', top: 6, right: 6 }}>{headerLeading}</div>
      ) : null}
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
                inputRef={chooserInput}
                onFocus={activatePane}
                autoFocus={autoFocusChooser}
                cancelable={isEmpty || showAddForm}
                onConfirm={(platform, slug) => {
                  runUiTask(
                    (async () => {
                      try {
                        const existing = watchedChannels.find(
                          (ch) => ch.platform === platform && ch.channelSlug === slug,
                        )
                        const channel =
                          existing ??
                          (await backend.api.addWatchedChannel({ platform, channelSlug: slug }))
                        if (!existing)
                          watchedChannelsStore.set(await backend.api.getWatchedChannels())
                        await assignChannel(backend, tabId, panel.id, channel.id)
                        setShowAddForm(false)
                      } catch (error) {
                        showNotice('error', `Could not assign channel: ${String(error)}`)
                      }
                    })(),
                  )
                }}
                onCancel={() => {
                  // An empty pane has no channel to fall back to — cancel removes it.
                  if (isEmpty) runUiTask(closePane())
                  else setShowAddForm(false)
                }}
              />
            </div>
          </div>
        ) : isMain ? (
          <ChatView
            headerLeading={headerLeading}
            isMain
            layoutTabId={tabId}
            layoutPanelId={panel.id}
            onChangeChannel={() => setShowAddForm(true)}
            paneId={`${tabId}:${panel.id}`}
            onGoToPlatforms={goToPlatforms}
            onSplitRight={() => void splitPanel(backend, tabId, panel.id, 'vertical', scope)}
            onClosePanel={() => void closePane()}
          />
        ) : watchedChannel ? (
          <ChatView
            headerLeading={headerLeading}
            layoutTabId={tabId}
            layoutPanelId={panel.id}
            paneId={`${tabId}:${panel.id}`}
            watchedChannel={watchedChannel}
            onSplitRight={() => void splitPanel(backend, tabId, panel.id, 'vertical', scope)}
            onChangeChannel={() => setShowAddForm(true)}
            onClosePanel={() => void closePane()}
          />
        ) : null}
      </div>
      {dropSide ? (
        <div
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            borderWidth: 2,
            borderColor: '#a78bfa',
            backgroundColor: '#a78bfa30',
            left: dropSide === 'right' ? (dropBounds?.width ?? 0) / 2 : 0,
            right: dropSide === 'left' ? (dropBounds?.width ?? 0) / 2 : 0,
            top: dropSide === 'bottom' ? (dropBounds?.height ?? 0) / 2 : 0,
            bottom: dropSide === 'top' ? (dropBounds?.height ?? 0) / 2 : 0,
          }}
        />
      ) : null}
    </div>
  )
}
