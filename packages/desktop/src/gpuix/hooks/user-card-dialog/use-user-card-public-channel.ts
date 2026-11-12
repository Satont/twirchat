import { useBackend } from '@gpuix/backend/context'
import { errorText } from '@gpuix/components/user-card/format'
import { useCallback, useState } from 'react'

interface UseUserCardPublicChannelOptions {
  channelUrl: string | undefined
}

interface UseUserCardPublicChannelReturn {
  isOpening: boolean
  openError: string | null
  openPublicChannel: () => Promise<void>
}

export function useUserCardPublicChannel({
  channelUrl,
}: UseUserCardPublicChannelOptions): UseUserCardPublicChannelReturn {
  const backend = useBackend()
  const [isOpening, setIsOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

  const openPublicChannel = useCallback(async (): Promise<void> => {
    if (!channelUrl) return
    setIsOpening(true)
    setOpenError(null)
    try {
      await backend.api.openExternalUrl({ url: channelUrl })
    } catch (cause) {
      setOpenError(errorText(cause))
    } finally {
      setIsOpening(false)
    }
  }, [backend, channelUrl])

  return {
    isOpening,
    openError,
    openPublicChannel,
  }
}
