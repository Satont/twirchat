import { createContext, useContext } from 'react'

import type { DesktopWindowDescriptor } from '../../services/window-session'
import type { UserCardTarget } from '../../views/main/utils/chatCommands'

export interface DesktopWindows {
  descriptor: DesktopWindowDescriptor
  pinned: boolean
  setPinned(pinned: boolean): void
  openChat(sourceTabId: string, sourcePanelId?: string, overlay?: boolean): Promise<string>
  openUser(target: UserCardTarget): Promise<string>
  openObsRemote(): Promise<string>
  close(): Promise<void>
  quit(): Promise<void>
  toggleOverlayInertia(target: 'this' | 'thisOrAll' | 'all'): Promise<void>
}
export const DesktopWindowsContext = createContext<DesktopWindows | null>(null)
export const useDesktopWindows = (): DesktopWindows | null => useContext(DesktopWindowsContext)
