import { Text } from '@gpuix/components/ui/Text'
import { useT } from '@gpuix/i18n'
import { useTheme } from '@gpuix/theme-context'

interface HistoryRetryButtonProps {
  onClick: () => void
}

export function HistoryRetryButton({ onClick }: HistoryRetryButtonProps) {
  const theme = useTheme()
  const { t } = useT()
  return (
    <div
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'enter' || event.key === 'space') {
          event.preventDefault()
          onClick()
        }
      }}
      style={{
        borderRadius: 6,
        backgroundColor: theme.fill,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 10,
        cursor: 'pointer',
        hover: { backgroundColor: theme.fillHover },
      }}
    >
      <Text style={{ fontSize: 12, color: theme.text }}>{t('common.retry')}</Text>
    </div>
  )
}
