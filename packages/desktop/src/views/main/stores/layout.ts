import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { rpc } from '../main'
import type {
  LayoutNode,
  PanelNode,
  SplitNode,
  SplitDirection,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'

const MAX_PANELS = 8
const DEFAULT_FLEX = 100
const SAVE_DEBOUNCE_MS = 500

export const useLayoutStore = defineStore('layout', () => {
  const layout = ref<WatchedChannelsLayout | null>(null)
  const currentTabId = ref<string>('')
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const draggedPanelId = ref<string | null>(null)
  const dropTargetId = ref<string | null>(null)

  let saveTimeout: ReturnType<typeof setTimeout> | null = null

  const rootNode = computed(() => layout.value?.root ?? null)
  const isDragging = computed(() => draggedPanelId.value !== null)

  const allPanels = computed<PanelNode[]>(() => {
    if (!layout.value) return []
    const panels: PanelNode[] = []
    const traverse = (node: LayoutNode) => {
      if (node.type === 'panel') {
        panels.push(node)
      } else if (node.type === 'split' && node.children) {
        node.children.forEach(traverse)
      }
    }
    traverse(layout.value.root)
    return panels
  })

  const panelCount = computed(() => allPanels.value.length)
  const canAddPanel = computed(() => panelCount.value < MAX_PANELS)

  const getPanel = (id: string): PanelNode | null => {
    return allPanels.value.find((p) => p.id === id) ?? null
  }

  const loadLayout = async (tabId: string): Promise<void> => {
    currentTabId.value = tabId
    isLoading.value = true
    error.value = null
    try {
      const saved = await rpc.request.getWatchedChannelsLayout?.({ tabId })
      layout.value = (saved as WatchedChannelsLayout | null | undefined) ?? null
    } catch (e) {
      error.value = String(e)
      layout.value = null
    } finally {
      isLoading.value = false
    }
  }

  const saveLayout = async (): Promise<void> => {
    if (!layout.value || !currentTabId.value) return
    try {
      await rpc.request.setWatchedChannelsLayout?.({
        tabId: currentTabId.value,
        layout: layout.value,
      })
    } catch (e) {
      error.value = String(e)
    }
  }

  const debouncedSave = (): void => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => void saveLayout(), SAVE_DEBOUNCE_MS)
  }

  const splitPanel = async (panelId: string, direction: SplitDirection): Promise<void> => {
    if (!layout.value || !currentTabId.value) return
    try {
      await rpc.request.splitPanel?.({ tabId: currentTabId.value, panelId, direction })
      await loadLayout(currentTabId.value)
    } catch (e) {
      error.value = String(e)
    }
  }

  const removePanel = async (panelId: string): Promise<void> => {
    if (!layout.value || !currentTabId.value) return
    try {
      await rpc.request.removePanel?.({ tabId: currentTabId.value, panelId })
      await loadLayout(currentTabId.value)
    } catch (e) {
      error.value = String(e)
    }
  }

  const assignChannel = async (panelId: string, channelId: string | null): Promise<void> => {
    if (!layout.value || !currentTabId.value) return
    try {
      await rpc.request.assignChannelToPanel?.({
        tabId: currentTabId.value,
        panelId,
        channelId,
      })
      const panel = getPanel(panelId)
      if (panel) {
        panel.content = channelId ? { type: 'watched', channelId } : { type: 'empty' }
        await loadLayout(currentTabId.value)
      }
    } catch (e) {
      error.value = String(e)
    }
  }

  const updateFlex = async (nodeId: string, flex: number): Promise<void> => {
    if (!layout.value) return
    const updateNode = (node: LayoutNode): boolean => {
      if ('id' in node && node.id === nodeId) {
        node.flex = flex
        return true
      }
      if (node.type === 'split' && node.children) {
        for (const child of node.children) {
          if (updateNode(child)) return true
        }
      }
      return false
    }
    updateNode(layout.value.root)
    debouncedSave()
  }

  type ParentContext = { node: SplitNode; children: LayoutNode[] }

  const findParentOfNode = (root: LayoutNode, nodeId: string): ParentContext | null => {
    if (root.type === 'split') {
      for (let i = 0; i < root.children.length; i++) {
        const child = root.children[i]
        if (!child) continue
        if (child.id === nodeId) {
          return { node: root, children: root.children }
        }
        const found = findParentOfNode(child, nodeId)
        if (found) return found
      }
    }
    return null
  }

  const movePanel = (sourceId: string, targetId: string, position: 'before' | 'after'): boolean => {
    if (!layout.value || sourceId === targetId) return false

    const sourcePanel = getPanel(sourceId)
    const targetPanel = getPanel(targetId)
    if (!sourcePanel || !targetPanel) return false

    const sourceParent = findParentOfNode(layout.value.root, sourceId)
    const targetParent = findParentOfNode(layout.value.root, targetId)
    if (!sourceParent || !targetParent) return false

    const sourceIndex = sourceParent.children.findIndex((c) => c.id === sourceId)
    let targetIndex = targetParent.children.findIndex((c) => c.id === targetId)
    if (sourceIndex === -1 || targetIndex === -1) return false

    sourceParent.children.splice(sourceIndex, 1)

    if (sourceParent.node.id === targetParent.node.id && sourceIndex < targetIndex) {
      targetIndex--
    }

    if (sourceParent.children.length === 1 && sourceParent.node.id !== targetParent.node.id) {
      const onlyChild = sourceParent.children[0]
      if (onlyChild) {
        const grandparent = findParentOfNode(layout.value.root, sourceParent.node.id)
        if (grandparent) {
          const parentIndex = grandparent.children.findIndex((c) => c.id === sourceParent.node.id)
          if (parentIndex !== -1) {
            grandparent.children[parentIndex] = onlyChild
          }
        } else {
          layout.value.root = onlyChild
        }
      }
    }

    const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
    targetParent.children.splice(insertIndex, 0, sourcePanel)

    const flexPerChild = 100 / targetParent.children.length
    targetParent.children.forEach((child) => (child.flex = flexPerChild))

    layout.value = { ...layout.value }
    debouncedSave()
    return true
  }

  const dropPanel = (
    sourceId: string,
    targetId: string,
    direction: 'left' | 'right' | 'top' | 'bottom',
  ): boolean => {
    if (!layout.value || sourceId === targetId) return false

    const sourcePanel = getPanel(sourceId)
    if (!sourcePanel) return false

    const sourceParent = findParentOfNode(layout.value.root, sourceId)
    if (!sourceParent) return false

    const sourceIndex = sourceParent.children.findIndex((c) => c.id === sourceId)
    if (sourceIndex === -1) return false

    sourceParent.children.splice(sourceIndex, 1)

    if (sourceParent.children.length === 1) {
      const onlyChild = sourceParent.children[0]
      if (onlyChild) {
        const grandparent = findParentOfNode(layout.value.root, sourceParent.node.id)
        if (grandparent) {
          const parentIndex = grandparent.children.findIndex((c) => c.id === sourceParent.node.id)
          if (parentIndex !== -1) {
            grandparent.children[parentIndex] = onlyChild
          }
        } else {
          layout.value.root = onlyChild
        }
      }
    }

    const targetPanel = getPanel(targetId)
    if (!targetPanel) {
      void loadLayout(currentTabId.value)
      return false
    }

    const targetParent = findParentOfNode(layout.value.root, targetId)

    const splitDirection: SplitDirection =
      direction === 'left' || direction === 'right' ? 'vertical' : 'horizontal'
    const isAfter = direction === 'right' || direction === 'bottom'

    if (!targetParent) {
      // targetPanel is now the root (collapsed split) — create new root split
      targetPanel.flex = 50
      sourcePanel.flex = 50
      layout.value.root = {
        type: 'split',
        id: crypto.randomUUID(),
        direction: splitDirection,
        flex: 100,
        children: isAfter ? [targetPanel, sourcePanel] : [sourcePanel, targetPanel],
      }
    } else if (
      targetParent.node.type === 'split' &&
      targetParent.node.direction === splitDirection
    ) {
      const targetIndex = targetParent.children.findIndex((c) => c.id === targetId)
      if (targetIndex !== -1) {
        const insertIndex = isAfter ? targetIndex + 1 : targetIndex
        targetParent.children.splice(insertIndex, 0, sourcePanel)

        const flexPerChild = 100 / targetParent.children.length
        targetParent.children.forEach((child) => (child.flex = flexPerChild))
      }
    } else {
      const targetIndex = targetParent.children.findIndex((c) => c.id === targetId)
      if (targetIndex !== -1) {
        const newSplit: LayoutNode = {
          type: 'split',
          id: crypto.randomUUID(),
          direction: splitDirection,
          flex: targetPanel.flex,
          children: isAfter ? [targetPanel, sourcePanel] : [sourcePanel, targetPanel],
        }

        targetPanel.flex = 50
        sourcePanel.flex = 50

        targetParent.children[targetIndex] = newSplit
      }
    }

    layout.value = { ...layout.value }
    debouncedSave()
    return true
  }

  const startDrag = (panelId: string): boolean => {
    draggedPanelId.value = panelId
    return true
  }

  const endDrag = (): void => {
    draggedPanelId.value = null
    dropTargetId.value = null
  }

  const setDropTarget = (panelId: string | null): void => {
    dropTargetId.value = panelId
  }

  const applyPreset2x2 = (): void => {
    if (!layout.value) return
    layout.value.root = {
      type: 'split',
      id: crypto.randomUUID(),
      direction: 'vertical',
      flex: DEFAULT_FLEX,
      children: [
        {
          type: 'split',
          id: crypto.randomUUID(),
          direction: 'horizontal',
          flex: 50,
          children: [
            { type: 'panel', id: crypto.randomUUID(), content: { type: 'empty' }, flex: 50 },
            { type: 'panel', id: crypto.randomUUID(), content: { type: 'empty' }, flex: 50 },
          ],
        },
        {
          type: 'split',
          id: crypto.randomUUID(),
          direction: 'horizontal',
          flex: 50,
          children: [
            { type: 'panel', id: crypto.randomUUID(), content: { type: 'empty' }, flex: 50 },
            { type: 'panel', id: crypto.randomUUID(), content: { type: 'empty' }, flex: 50 },
          ],
        },
      ],
    }
    debouncedSave()
  }

  const applyPreset3Vertical = (): void => {
    if (!layout.value) return
    layout.value.root = {
      type: 'split',
      id: crypto.randomUUID(),
      direction: 'horizontal',
      flex: DEFAULT_FLEX,
      children: [
        { type: 'panel', id: crypto.randomUUID(), content: { type: 'empty' }, flex: 33.33 },
        { type: 'panel', id: crypto.randomUUID(), content: { type: 'empty' }, flex: 33.33 },
        { type: 'panel', id: crypto.randomUUID(), content: { type: 'empty' }, flex: 33.34 },
      ],
    }
    debouncedSave()
  }

  const applyPreset3Horizontal = (): void => {
    if (!layout.value) return
    layout.value.root = {
      type: 'split',
      id: crypto.randomUUID(),
      direction: 'vertical',
      flex: DEFAULT_FLEX,
      children: [
        { type: 'panel', id: crypto.randomUUID(), content: { type: 'empty' }, flex: 33.33 },
        { type: 'panel', id: crypto.randomUUID(), content: { type: 'empty' }, flex: 33.33 },
        { type: 'panel', id: crypto.randomUUID(), content: { type: 'empty' }, flex: 33.34 },
      ],
    }
    debouncedSave()
  }

  const resetLayout = (): void => {
    if (!currentTabId.value) return
    void loadLayout(currentTabId.value)
  }

  return {
    layout,
    currentTabId,
    isLoading,
    error,
    rootNode,
    allPanels,
    panelCount,
    canAddPanel,
    draggedPanelId,
    dropTargetId,
    isDragging,
    getPanel,
    loadLayout,
    saveLayout,
    splitPanel,
    removePanel,
    assignChannel,
    updateFlex,
    movePanel,
    dropPanel,
    startDrag,
    endDrag,
    setDropTarget,
    applyPreset2x2,
    applyPreset3Vertical,
    applyPreset3Horizontal,
    resetLayout,
  }
})
