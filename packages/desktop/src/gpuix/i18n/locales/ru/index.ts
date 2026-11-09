import { en } from '../en'
import { ruActivities } from './activities'
import { ruApp } from './app'
import { ruChat } from './chat'
import { ruChatMessages } from './chatMessages'
import { ruCommands } from './commands'
import { ruCommon } from './common'
import { ruComposer } from './composer'
import { ruMisc } from './misc'
import { ruNotices } from './notices'
import { ruObsRemote } from './obsRemote'
import { ruPlugins } from './plugins'
import { ruRuntime } from './runtime'
import { ruSettings } from './settings'
import { ruSettingsEditors } from './settingsEditors'
import { ruUserCard } from './userCard'

export const ru: Record<keyof typeof en, string> = {
  ...ruCommon,
  ...ruSettings,
  ...ruApp,
  ...ruChat,
  ...ruChatMessages,
  ...ruComposer,
  ...ruSettingsEditors,
  ...ruUserCard,
  ...ruActivities,
  ...ruObsRemote,
  ...ruPlugins,
  ...ruNotices,
  ...ruCommands,
  ...ruRuntime,
  ...ruMisc,
}
