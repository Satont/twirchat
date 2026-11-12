import { useBackend } from '@gpuix/backend/context'
import { errorText } from '@gpuix/components/user-card/format'
import { aliasesStore, showNotice } from '@gpuix/state/app'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { useCallback, useEffect, useState } from 'react'

interface UseUserCardAliasOptions {
  target: UserCardTarget
  currentAlias?: string
  onClose?: () => void
}

interface UseUserCardAliasReturn {
  aliasValue: string
  setAliasValue: (value: string) => void
  effectiveAlias: string | undefined
  isSaving: boolean
  saveError: string | null
  handleSaveAlias: () => Promise<void>
  handleRemoveAlias: () => Promise<void>
  refreshAliases: () => Promise<void>
}

export function useUserCardAlias({
  target,
  currentAlias,
  onClose,
}: UseUserCardAliasOptions): UseUserCardAliasReturn {
  const backend = useBackend()
  const effectiveAlias = currentAlias ?? target.currentAlias
  const [aliasValue, setAliasValue] = useState(effectiveAlias ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setAliasValue(effectiveAlias ?? '')
  }, [effectiveAlias])

  const refreshAliases = useCallback(async (): Promise<void> => {
    aliasesStore.set(await backend.api.getUserAliases())
  }, [backend])

  const handleSaveAlias = useCallback(async (): Promise<void> => {
    const value = aliasValue.trim()
    setIsSaving(true)
    setSaveError(null)
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
      onClose?.()
    } catch (cause) {
      const message = errorText(cause)
      setSaveError(message)
      showNotice('error', message)
    } finally {
      setIsSaving(false)
    }
  }, [aliasValue, target.platform, target.platformUserId, backend, refreshAliases, onClose])

  const handleRemoveAlias = useCallback(async (): Promise<void> => {
    setIsSaving(true)
    setSaveError(null)
    try {
      await backend.api.removeUserAlias({
        platform: target.platform,
        platformUserId: target.platformUserId,
      })
      await refreshAliases()
      setAliasValue('')
      onClose?.()
    } catch (cause) {
      const message = errorText(cause)
      setSaveError(message)
      showNotice('error', message)
    } finally {
      setIsSaving(false)
    }
  }, [target.platform, target.platformUserId, backend, refreshAliases, onClose])

  return {
    aliasValue,
    setAliasValue,
    effectiveAlias,
    isSaving,
    saveError,
    handleSaveAlias,
    handleRemoveAlias,
    refreshAliases,
  }
}
