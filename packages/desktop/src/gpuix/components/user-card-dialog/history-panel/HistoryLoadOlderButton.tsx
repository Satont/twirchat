import { Text } from '@gpuix/components/ui/Text'
import { useT } from '@gpuix/i18n'
import { useTheme } from '@gpuix/theme-context'

import type { HistoryLoadOlderButtonProps } from './types'

export function HistoryLoadOlderButton({ canLoad, loading, onClick }: HistoryLoadOlderButtonProps) {
  const theme = useTheme()
  const { t } = useT()
  const interactive = canLoad && !loading

  return (
    <div
      tabIndex={interactive ? 0 : -1}
      onClick={interactive ? onClick : undefined}
      onKeyDown={(event) => {
        if (!interactive) return
        if (event.key === 'enter' || event.key === 'space') {
          event.preventDefault()
          onClick()
        }
      }}
      style={{
        minHeight: 32,
        display: 'flex',
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 8,
        paddingLeft: 12,
        paddingRight: 12,
        borderBottomWidth: 1,
        borderColor: theme.divider,
        cursor: interactive ? 'pointer' : 'default',
        hover: interactive ? { backgroundColor: theme.rowHover } : {},
      }}
    >
      <Text style={{ fontSize: 11, color: theme.text2 }}>
        {loading ? t('userCard.history.loadingOlder') : t('userCard.history.loadOlder')}
      </Text>
    </div>
  )
}
