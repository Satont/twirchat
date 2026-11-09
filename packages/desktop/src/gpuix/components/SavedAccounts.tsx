import type { StyleDesc } from '@gpuix/react'
import type { Account, Platform } from '@twirchat/shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useBackend, useBackendEvent } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT } from '../i18n'
import { accountsStore } from '../state/app'
import { useStore } from '../state/create-store'
import { useOverlayClose } from '../state/overlays'
import { useTheme } from '../theme-context'
import { ActionButton, FormError } from './ui/Form'
import { Icon } from './ui/Icon'
import { Text } from './ui/Text'

const platforms: Platform[] = ['twitch', 'youtube', 'kick']
const platformName = (platform: Platform) =>
  platform === 'youtube' ? 'YouTube' : platform === 'twitch' ? 'Twitch' : 'Kick'

/** Saved credentials and the currently active identity are deliberately separate. */
export function SavedAccounts() {
  const backend = useBackend()
  const theme = useTheme()
  const { t } = useT()
  const active = useStore(accountsStore)
  const [saved, setSaved] = useState<Account[]>([])
  const [busy, setBusy] = useState<Platform | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<Platform | null>(null)
  const lifetime = useRef({ generation: 0, mounted: true }).current
  const reload = useCallback(async (): Promise<void> => {
    const request = ++lifetime.generation
    const [all, selected] = await Promise.all([
      backend.api.getSavedAccounts(),
      backend.api.getAccounts(),
    ])
    if (lifetime.mounted && lifetime.generation === request) {
      setSaved(all)
      accountsStore.set(selected)
      setLoading(false)
    }
  }, [backend, lifetime])
  useEffect(() => {
    lifetime.mounted = true
    void reload().catch((cause) => {
      if (lifetime.mounted) {
        setError(String(cause))
        setLoading(false)
      }
    })
    return () => {
      lifetime.mounted = false
      lifetime.generation++
    }
  }, [reload, lifetime])
  useBackendEvent('accounts_changed', () => {
    void reload().catch((cause) => {
      if (lifetime.mounted) setError(String(cause))
    })
  })
  useBackendEvent('auth_success', () => {
    setCopied(null)
    void reload().catch((cause) => {
      if (lifetime.mounted) setError(String(cause))
    })
  })
  async function run(platform: Platform, action: () => Promise<void>): Promise<void> {
    if (busy) return
    setBusy(platform)
    setError('')
    try {
      await action()
    } catch (cause) {
      if (lifetime.mounted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      try {
        await reload()
      } catch (cause) {
        if (lifetime.mounted) setError(String(cause))
      }
      if (lifetime.mounted) setBusy(null)
    }
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 20,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 12,
        backgroundColor: theme.surface,
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: 700, color: theme.text }}>
        {t('app.accounts.title')}
      </Text>
      <Text style={{ fontSize: 12, color: theme.text2 }}>{t('app.accounts.description')}</Text>
      <FormError>{error}</FormError>
      {loading ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>{t('app.accounts.loading')}</Text>
      ) : null}
      {platforms.map((platform) => {
        const selected = active.find((account) => account.platform === platform)
        const accounts = saved.filter((account) => account.platform === platform)
        return (
          <div
            key={platform}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              paddingTop: 10,
              borderTopWidth: 1,
              borderColor: theme.border,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: 700, color: theme.text, flexGrow: 1 }}>
                {`${platformName(platform)} · ${selected ? `@${selected.username}` : t('app.accounts.anonymous')}`}
              </Text>
              <ActionButton
                disabled={!!busy || !selected}
                onClick={() =>
                  void run(platform, () =>
                    backend.api.setActiveAccount({ platform, accountId: null }),
                  )
                }
              >
                {t('app.accounts.useAnonymously')}
              </ActionButton>
              <AddAccountButton
                platform={platform}
                disabled={!!busy}
                onOpen={() => {
                  setCopied(null)
                  runUiTask(run(platform, () => backend.api.authStart({ platform })))
                }}
                onCopyLink={() => {
                  setCopied(null)
                  runUiTask(
                    run(platform, async () => {
                      const { url } = await backend.api.authLink({ platform })
                      await backend.api.copyText({ text: url })
                      if (lifetime.mounted) setCopied(platform)
                    }),
                  )
                }}
              />
            </div>
            {copied === platform ? (
              <Text style={{ fontSize: 12, color: theme.text2 }}>
                {t('app.accounts.linkCopied', { platform: platformName(platform) })}
              </Text>
            ) : null}
            {accounts.map((account) => (
              <div
                key={account.id}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Text style={{ fontSize: 13, color: theme.text, flexGrow: 1 }}>
                  {`${account.displayName} · @${account.username}`}
                </Text>
                <ActionButton
                  primary={selected?.id === account.id}
                  disabled={!!busy || selected?.id === account.id}
                  onClick={() =>
                    void run(platform, () =>
                      backend.api.setActiveAccount({ platform, accountId: account.id }),
                    )
                  }
                >
                  {selected?.id === account.id
                    ? t('app.accounts.active')
                    : busy === platform
                      ? t('app.accounts.switching')
                      : t('app.accounts.switch')}
                </ActionButton>
                <ActionButton
                  disabled={!!busy}
                  onClick={() =>
                    void run(platform, () => backend.api.forgetAccount({ accountId: account.id }))
                  }
                >
                  {t('app.accounts.forget')}
                </ActionButton>
              </div>
            ))}
            {!accounts.length ? (
              <Text style={{ fontSize: 12, color: theme.text2 }}>
                {t('app.accounts.none', { platform: platformName(platform) })}
              </Text>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

interface AddAccountButtonProps {
  platform: Platform
  disabled: boolean
  onOpen: () => void
  onCopyLink: () => void
}

/** Opens sign-in in the default browser; the arrow also offers the link for another browser. */
function AddAccountButton({ platform, disabled, onOpen, onCopyLink }: AddAccountButtonProps) {
  const theme = useTheme()
  const { t } = useT()
  const [open, setOpen] = useState(false)
  // The mousedown that dismisses the menu ends in a click on the arrow; ignore that click.
  const dismissedAt = useRef(0)
  useOverlayClose(open, () => setOpen(false))
  const choose = (action: () => void) => {
    setOpen(false)
    action()
  }
  const segment: StyleDesc = {
    paddingTop: 6,
    paddingBottom: 6,
    cursor: disabled ? 'default' : 'pointer',
    hover: disabled ? {} : { backgroundColor: theme.fillHover },
  }
  const item = (label: string, detail: string, action: () => void, testId: string) => (
    <div
      role="menuitem"
      testId={testId}
      tabIndex={0}
      autoFocus={testId.endsWith('-open')}
      onClick={() => choose(action)}
      onKeyDown={(event) => {
        if (event.key === 'enter' || event.key === 'space') {
          event.preventDefault()
          choose(action)
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 4,
        cursor: 'pointer',
        hover: { backgroundColor: theme.fillHover },
      }}
    >
      <Text style={{ fontSize: 12, color: theme.text }}>{label}</Text>
      <Text style={{ fontSize: 11, color: theme.text2 }}>{detail}</Text>
    </div>
  )
  return (
    <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          borderRadius: 6,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.fill,
          overflow: 'hidden',
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <div
          testId={`add-account-${platform}`}
          tabIndex={disabled ? undefined : 0}
          onClick={() => {
            if (!disabled) onOpen()
          }}
          onKeyDown={(event) => {
            if (!disabled && (event.key === 'enter' || event.key === 'space')) {
              event.preventDefault()
              onOpen()
            }
          }}
          style={{ ...segment, paddingLeft: 10, paddingRight: 10 }}
        >
          <Text style={{ fontSize: 12, color: theme.text }}>{t('app.accounts.add')}</Text>
        </div>
        <div
          testId={`add-account-${platform}-more`}
          role="button"
          aria-label={t('app.accounts.moreWays')}
          tabIndex={disabled ? undefined : 0}
          onClick={() => {
            if (disabled || Date.now() - dismissedAt.current < 250) return
            setOpen((value) => !value)
          }}
          onKeyDown={(event) => {
            if (!disabled && (event.key === 'enter' || event.key === 'space')) {
              event.preventDefault()
              setOpen((value) => !value)
            }
          }}
          style={{
            ...segment,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 6,
            paddingRight: 6,
            borderLeftWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Icon name="chevronDown" size={12} color={theme.text2} />
        </div>
      </div>
      {open && !disabled ? (
        <anchored deferred side="bottom" align="end" gap={4}>
          <div
            role="menu"
            testId={`add-account-${platform}-menu`}
            onMouseDownOutside={() => {
              dismissedAt.current = Date.now()
              setOpen(false)
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              minWidth: 240,
              padding: 4,
              backgroundColor: theme.popover,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 7,
              boxShadow: {
                offsetX: 0,
                offsetY: 5,
                blurRadius: 18,
                spreadRadius: 0,
                color: '#00000060',
              },
            }}
          >
            {item(
              t('app.accounts.openInBrowser'),
              t('app.accounts.openInBrowserDetail'),
              onOpen,
              `add-account-${platform}-open`,
            )}
            {item(
              t('app.accounts.copyLink'),
              t('app.accounts.copyLinkDetail'),
              onCopyLink,
              `add-account-${platform}-copy`,
            )}
          </div>
        </anchored>
      ) : null}
    </div>
  )
}
