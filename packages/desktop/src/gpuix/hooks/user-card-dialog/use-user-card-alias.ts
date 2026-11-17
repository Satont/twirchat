import { useBackend } from '@gpuix/backend/context'
import { errorText } from '@gpuix/components/user-card/format'
import { aliasesLoadedStore, aliasesStore, showNotice } from '@gpuix/state/app'
import { useStore, useStoreSelector } from '@gpuix/state/create-store'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { useCallback, useEffect, useState } from 'react'

interface UseUserCardAliasOptions {
  target: UserCardTarget
  /** Opening snapshot, only used until the alias list has loaded once. */
  currentAlias?: string
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

/**
 * The alias list is the single source of truth once it has loaded, so saving or
 * removing an alias updates the header and the Notes tab from the same store.
 */
export function useUserCardAliasValue(
  target: UserCardTarget,
  currentAlias?: string,
): string | undefined {
  const loaded = useStore(aliasesLoadedStore)
  const stored = useStoreSelector(
    aliasesStore,
    (aliases) =>
      aliases.find(
        (alias) =>
          alias.platform === target.platform && alias.platformUserId === target.platformUserId,
      )?.alias,
  )
  if (!loaded) return currentAlias ?? target.currentAlias
  return stored
}

export function useUserCardAlias({
  target,
  currentAlias,
}: UseUserCardAliasOptions): UseUserCardAliasReturn {
  const backend = useBackend()
  const effectiveAlias = useUserCardAliasValue(target, currentAlias)
  const [aliasValue, setAliasValue] = useState(effectiveAlias ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setAliasValue(effectiveAlias ?? '')
  }, [effectiveAlias])

  const refreshAliases = useCallback(async (): Promise<void> => {
    aliasesStore.set(await backend.api.getUserAliases())
    aliasesLoadedStore.set(true)
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
    } catch (cause) {
      const message = errorText(cause)
      setSaveError(message)
      showNotice('error', message)
    } finally {
      setIsSaving(false)
    }
  }, [aliasValue, target.platform, target.platformUserId, backend, refreshAliases])

  const handleRemoveAlias = useCallback(async (): Promise<void> => {
    setIsSaving(true)
    setSaveError(null)
    try {
      await backend.api.removeUserAlias({
        platform: target.platform,
        platformUserId: target.platformUserId,
      })
      await refreshAliases()
    } catch (cause) {
      const message = errorText(cause)
      setSaveError(message)
      showNotice('error', message)
    } finally {
      setIsSaving(false)
    }
  }, [target.platform, target.platformUserId, backend, refreshAliases])

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
