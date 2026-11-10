import type {
  Account,
  PanelNode,
  WatchedChannel,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'

import { panelWatchedSources } from '../../views/main/utils/layout-tree'
import {
  isPluginWatchedChannel,
  type DesktopWatchedChannel,
} from '../../watched-channels/plugin-channel-types'
import { resolveChatAccount } from '../chat-account'
import { allPanels, layoutStore, type LayoutState } from './layout'
import { liveLayoutTabIds } from './watched-subscriptions'

/** The account a pane chose for itself, if any. */
export function panelAccountId(
  panel: PanelNode | undefined,
  channelId?: string,
): string | undefined {
  if (panel?.content.type === 'watched') return panel.content.accountId
  if (panel?.content.type === 'feed')
    return panel.content.sources.find((source) => source.channelId === channelId)?.accountId
  return undefined
}

/** Panels of live tabs and detached windows that show `channelId`. */
export function panelsShowingChat(
  channelId: string,
  layouts: ReadonlyMap<string, LayoutState> = layoutStore.get(),
  tabIds: readonly string[] = liveLayoutTabIds(),
): Array<{ tabId: string; panel: PanelNode }> {
  return tabIds.flatMap((tabId) =>
    allPanels(layouts.get(tabId)?.layout ?? null)
      .filter((panel) =>
        panelWatchedSources(panel.content).some((source) => source.channelId === channelId),
      )
      .map((panel) => ({ tabId, panel })),
  )
}

/** The account a pane sends with: its own choice, else the chat's, else the platform default. */
export function resolvePaneAccount(
  channel: Pick<WatchedChannel, 'id' | 'platform' | 'accountId'>,
  panel: PanelNode | undefined,
  saved: readonly Account[],
  active: readonly Account[],
): Account | undefined {
  return resolveChatAccount(channel, saved, active, panelAccountId(panel, channel.id))
}

/**
 * Accounts other than the platform defaults that the panes of a tab send with, in pane order.
 * The tab shows them so a tab writing from another account is recognisable before it is opened.
 */
export function tabSenderAccounts(
  layout: WatchedChannelsLayout | null,
  channels: readonly DesktopWatchedChannel[],
  saved: readonly Account[],
  active: readonly Account[],
): Account[] {
  const result = new Map<string, Account>()
  for (const panel of allPanels(layout)) {
    for (const { channelId } of panelWatchedSources(panel.content)) {
      const channel = channels.find((candidate) => candidate.id === channelId)
      if (!channel || isPluginWatchedChannel(channel)) continue
      const account = resolvePaneAccount(channel, panel, saved, active)
      if (account && !active.some((candidate) => candidate.id === account.id))
        result.set(account.id, account)
    }
  }
  return [...result.values()]
}
