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
  compact = false,
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
            alignItems: compact ? 'center' : undefined,
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
              flexDirection: compact ? 'column' : 'row',
              flexWrap: compact ? undefined : 'wrap',
              justifyContent: compact ? 'center' : 'flex-end',
              alignItems: compact ? 'center' : undefined,
              flexGrow: 1,
              flexShrink: 1,
              flexBasis: compact ? 0 : 200,
              alignSelf: compact ? 'stretch' : undefined,
              minWidth: 0,
              gap: 8,
            }}
          >
            <GhostButton
              icon="externalLink"
              justify="center"
              style={{
                alignSelf: compact ? 'stretch' : undefined,
                flexGrow: compact ? 1 : undefined,
                flexBasis: compact ? 0 : undefined,
              }}
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
              justify="center"
              style={{
                alignSelf: compact ? 'stretch' : undefined,
                flexGrow: compact ? 1 : undefined,
                flexBasis: compact ? 0 : undefined,
              }}
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
        flexDirection: compact ? 'column' : 'row',
        alignItems: compact ? 'center' : 'flex-start',
        justifyContent: compact ? 'center' : 'space-between',
        flexWrap: compact ? undefined : 'wrap',
        width: compact ? undefined : '100%',
        alignSelf: compact ? 'stretch' : undefined,
        gap: 10,
        marginLeft: 3,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: compact ? 'column' : 'row',
          flexWrap: compact ? undefined : 'wrap',
          justifyContent: compact ? 'center' : undefined,
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
