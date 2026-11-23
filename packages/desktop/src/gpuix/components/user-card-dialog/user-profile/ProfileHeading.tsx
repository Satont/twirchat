import { useActionToast } from '@gpuix/components/action-toast'
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
  openAvatarUrl,
}: ProfileHeadingProps) {
  const theme = useTheme()
  const { t } = useT()
  const { showToast } = useActionToast()
  const skel = getSkeletonColors(theme)

  const renderNames = () => {
    if (loading) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
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
              paddingLeft: 10,
              height: 15,
              borderRadius: 3,
              backgroundColor: skel.valueBar,
            }}
          />
        </div>
      )
    } else {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              fontSize: 16,
              fontWeight: 800,
              color: theme.text,
            }}
          >
            {displayName}
          </div>
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
        </div>
      )
    }
  }

  const renderButtons = () => {
    return (
      <>
        {showCopyAvatar ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              flexGrow: 1,
              flexShrink: 0,
              gap: 8,
            }}
          >
            <GhostButton
              icon="externalLink"
              onClick={(event) =>
                runUiTask(
                  openAvatarUrl().then(() => showToast(t('userCard.feedback.opened'), event)),
                )
              }
            >
              {t('userCard.picture.openFull')}
            </GhostButton>
            <GhostButton
              icon="copy"
              onClick={(event) =>
                runUiTask(
                  copyAvatarUrl().then(() => showToast(t('userCard.feedback.copied'), event)),
                )
              }
            >
              {t('userCard.profile.copyAvatar')}
            </GhostButton>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        width: '100%',
        gap: 10,
        marginLeft: 3,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 10,
          minWidth: 0,
          paddingLeft: 4,
        }}
      >
        {renderNames()}
      </div>
      {renderButtons()}
    </div>
  )
})
