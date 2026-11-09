import { activities } from './activities'
import { app } from './app'
import { chat } from './chat'
import { chatMessages } from './chatMessages'
import { commands } from './commands'
import { common } from './common'
import { composer } from './composer'
import { misc } from './misc'
import { notices } from './notices'
import { obsRemote } from './obsRemote'
import { plugins } from './plugins'
import { runtime } from './runtime'
import { settings } from './settings'
import { settingsEditors } from './settingsEditors'
import { userCard } from './userCard'

export const en = {
  ...common,
  ...settings,
  ...app,
  ...chat,
  ...chatMessages,
  ...composer,
  ...settingsEditors,
  ...userCard,
  ...activities,
  ...obsRemote,
  ...plugins,
  ...notices,
  ...commands,
  ...runtime,
  ...misc,
} satisfies Record<string, string>

export type MessageKey = keyof typeof en
