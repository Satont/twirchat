import type { LinearGradientBackground } from '@gpuix/react'

import { useT } from '../../hooks/use-translation'
import { formatReleaseDate } from '../../release-notes'
import { useTheme } from '../../theme-context'
import { Icon } from '../ui/Icon'
import { Text } from '../ui/Text'
import { HEADER_AVATAR_SIZE, HEADER_AVATAR_RADIUS, HEADER_PADDING } from './constants'
import { hexMix } from './utils'

interface ChangelogHeaderProps {
  version: string
  publishedAt: string
}

export function ChangelogHeader({ version, publishedAt }: ChangelogHeaderProps) {
  const { t } = useT()
  const theme = useTheme()

  const releaseDate = formatReleaseDate(publishedAt)
  const versionLabel = `v${version.replace(/^v/u, '')}`
  const headerGradient: LinearGradientBackground = {
    type: 'linear-gradient',
    angle: 135,
    stops: [
      { color: hexMix(theme.accent.primary, theme.dialog, 0.18), position: 0 },
      { color: theme.dialog, position: 1 },
    ],
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        padding: HEADER_PADDING,
        flexShrink: 0,
        borderTopLeftRadius: 13,
        borderTopRightRadius: 13,
        background: headerGradient,
        borderBottomWidth: 1,
        borderColor: theme.hairline,
      }}
    >
      <div
        style={{
          width: HEADER_AVATAR_SIZE,
          height: HEADER_AVATAR_SIZE,
          borderRadius: HEADER_AVATAR_RADIUS,
          backgroundColor: theme.accent.primary,
          borderWidth: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon name="sparkle" size={28} color={theme.accent.onPrimary} />
      </div>
      <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: 800, color: theme.text }}>
            {t('app.changelog.title')}
          </Text>
        </div>
        <Text testId="update-changelog-date" style={{ fontSize: 13, color: theme.text2 }}>
          {releaseDate ? (
            <div
              testId="update-changelog-version"
              style={{
                paddingTop: 3,
                paddingBottom: 3,
                paddingRight: 10,
                flexShrink: 0,
              }}
            >
              {t('app.changelog.released', { date: releaseDate, version: versionLabel })}
            </div>
          ) : (
            t('app.changelog.defaultGreet')
          )}
        </Text>
      </div>
    </div>
  )
}
