import { useBackend } from '@gpuix/backend/context'
import { errorText } from '@gpuix/components/user-card/format'
import { aliasesStore, showNotice } from '@gpuix/state/app'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { useEffect, useState } from 'react'

interface UseUserCardAliasOptions {
  target: UserCardTarget
  currentAlias?: string
  onClose: () => void
}

export function useUserCardAlias({ target, currentAlias, onClose }: UseUserCardAliasOptions) {
  const backend = useBackend()
  const effectiveAlias = currentAlias ?? target.currentAlias
  const [aliasValue, setAliasValue] = useState(effectiveAlias ?? '')

  useEffect(() => {
    setAliasValue(effectiveAlias ?? '')
  }, [effectiveAlias, target.platform, target.platformUserId])

  async function refreshAliases(): Promise<void> {
    aliasesStore.set(await backend.api.getUserAliases())
  }

  async function handleSaveAlias(): Promise<void> {
    const value = aliasValue.trim()
    try {
      if (!value) {
        await backend.api.removeUserAlias({
          platform: target.platform,
          platformUserId: target.platformUserId,
        })
      } else {
        await backend.api.setUserAlias({
          platform: target.platform,
          platformUserId: target.platformUserId,
          alias: value,
        })
      }
      await refreshAliases()
    } catch (cause) {
      showNotice('error', errorText(cause))
      return
    }
    onClose()
  }

  async function handleRemoveAlias(): Promise<void> {
    try {
      await backend.api.removeUserAlias({
        platform: target.platform,
        platformUserId: target.platformUserId,
      })
      await refreshAliases()
    } catch (cause) {
      showNotice('error', errorText(cause))
      return
    }
    setAliasValue('')
    onClose()
  }

  return {
    aliasValue,
    setAliasValue,
    effectiveAlias,
    handleSaveAlias,
    handleRemoveAlias,
  }
}
