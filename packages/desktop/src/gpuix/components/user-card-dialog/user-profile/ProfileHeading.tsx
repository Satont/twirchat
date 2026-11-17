import { Text } from '@gpuix/components/ui/Text'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import { useT } from '@gpuix/i18n'
import { useTheme } from '@gpuix/theme-context'
import { memo } from 'react'

import { getSkeletonColors } from '../metadata-section/skeleton-colors'
import { GhostButton } from '../UserCardUI'
import type { ProfileHeadingProps } from './types'

export const ProfileHeading = memo(function ProfileHeading({
  displayName,
  login,
  loading,
  showCopyAvatar,
  copyAvatarUrl,
}: ProfileHeadingProps) {
  const theme = useTheme()
  const { t } = useT()
  const skel = getSkeletonColors(theme)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
        marginLeft: 3,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
          paddingLeft: 4,
        }}
      >
        {loading ? (
          <>
            <div
              style={{
                width: 160,
                height: 20,
                borderRadius: 4,
                backgroundColor: skel.labelBar,
              }}
            />
            <div
              style={{
                width: 100,
                height: 15,
                borderRadius: 3,
                backgroundColor: skel.valueBar,
              }}
            />
          </>
        ) : (
          <>
            <Text style={{ fontSize: 16, fontWeight: 800, color: theme.text }}>{displayName}</Text>
            {login ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  fontSize: 13,
                  color: theme.text2,
                }}
              >
                <div>@</div>
                <div>{login}</div>
              </div>
            ) : null}
          </>
        )}
      </div>
      {showCopyAvatar ? (
        <GhostButton icon="copy" onClick={() => runUiTask(copyAvatarUrl())}>
          {t('userCard.profile.copyAvatar')}
        </GhostButton>
      ) : null}
    </div>
  )
})
