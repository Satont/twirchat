import { useBackend } from '@gpuix/backend/context'
import { errorText } from '@gpuix/components/user-card/format'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import type { UserCardMetadataResponse } from '@twirchat/shared/protocol'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ModerationPlatform } from '../../../services/moderation/types'

interface UseUserCardMetadataOptions {
  target: UserCardTarget
  moderationPlatform: ModerationPlatform | undefined
}

interface UseUserCardMetadataReturn {
  supportedByCard: boolean
  metadata: UserCardMetadataResponse | null
  metadataLoading: boolean
  metadataError: string | null
  reloadMetadata: () => Promise<boolean>
  refreshMetadata: () => Promise<boolean>
}

export function useUserCardMetadata({
  target,
  moderationPlatform,
}: UseUserCardMetadataOptions): UseUserCardMetadataReturn {
  const backend = useBackend()
  const supportedByCard = moderationPlatform !== undefined

  const [metadata, setMetadata] = useState<UserCardMetadataResponse | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const metadataGenerationRef = useRef(0)

  const reloadMetadata = useCallback(async (): Promise<boolean> => {
    const platform = moderationPlatform
    if (!platform) {
      setMetadata(null)
      setMetadataError(null)
      setMetadataLoading(false)
      return false
    }

    const generation = metadataGenerationRef.current + 1
    metadataGenerationRef.current = generation
    setMetadataLoading(true)
    setMetadataError(null)

    try {
      const response = await backend.api.getUserCardMetadata({
        platform,
        platformUserId: target.platformUserId,
        username: target.username,
        channelId: target.channelId,
        channelSlug: target.channelSlug,
      })
      if (generation !== metadataGenerationRef.current) return false
      setMetadata(response)
      return true
    } catch (loadError) {
      if (generation !== metadataGenerationRef.current) return false
      setMetadata(null)
      setMetadataError(errorText(loadError))
      return false
    } finally {
      if (generation === metadataGenerationRef.current) {
        setMetadataLoading(false)
      }
    }
  }, [
    backend,
    moderationPlatform,
    target.platformUserId,
    target.username,
    target.channelId,
    target.channelSlug,
  ])

  // Reset + load on mount / when the target changes
  useEffect(() => {
    metadataGenerationRef.current += 1
    setMetadata(null)
    setMetadataError(null)
    setMetadataLoading(false)
    if (supportedByCard) runUiTask(reloadMetadata())
  }, [reloadMetadata, supportedByCard])

  const refreshMetadata = reloadMetadata

  return {
    supportedByCard,
    metadata,
    metadataLoading,
    metadataError,
    reloadMetadata,
    refreshMetadata,
  }
}
