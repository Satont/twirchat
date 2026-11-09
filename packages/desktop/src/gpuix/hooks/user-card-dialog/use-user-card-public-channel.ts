import { useBackend } from '@gpuix/backend/context'
import { errorText } from '@gpuix/components/user-card/format'
import { useCallback, useState } from 'react'

interface UseUserCardPublicChannelOptions {
  channelUrl: string | undefined
}

export function useUserCardPublicChannel({ channelUrl }: UseUserCardPublicChannelOptions) {
  const backend = useBackend()
  const [openingPublicChannel, setOpeningPublicChannel] = useState(false)
  const [publicChannelError, setPublicChannelError] = useState<string | null>(null)

  const openPublicChannel = useCallback(async (): Promise<void> => {
    if (!channelUrl) return
    setOpeningPublicChannel(true)
    setPublicChannelError(null)
    try {
      await backend.api.openExternalUrl({ url: channelUrl })
    } catch (cause) {
      setPublicChannelError(errorText(cause))
    } finally {
      setOpeningPublicChannel(false)
    }
  }, [backend, channelUrl])

  return {
    openingPublicChannel,
    publicChannelError,
    openPublicChannel,
  }
}
