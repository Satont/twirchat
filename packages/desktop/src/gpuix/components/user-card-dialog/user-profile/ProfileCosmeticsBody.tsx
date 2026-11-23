import { useActionToast } from '@gpuix/components/action-toast'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import { useT } from '@gpuix/i18n'
import { useTheme } from '@gpuix/theme-context'
import { memo } from 'react'

import { GhostButton } from '../UserCardUI'
import { BadgeInventory } from './BadgeInventory'
import { PaintPreview } from './PaintPreview'
import type { ProfileCosmeticsBodyProps } from './types'

export const ProfileCosmeticsBody = memo(function ProfileCosmeticsBody({
  cosmetics,
  paintImage,
  badgesEnabled,
  paintsEnabled,
  openSevenTvProfile,
}: ProfileCosmeticsBodyProps) {
  const theme = useTheme()
  const { t } = useT()
  const { showToast } = useActionToast()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        marginTop: 16,
        paddingTop: 14,
        borderTopWidth: 1,
        borderColor: theme.hairline,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            minWidth: 0,
          }}
        >
          {paintsEnabled ? <PaintPreview paintImage={paintImage} /> : null}
          {badgesEnabled ? (
            <BadgeInventory badges={cosmetics.badges} inventoryBadges={cosmetics.inventoryBadges} />
          ) : null}
          <GhostButton
            icon="externalLink"
            onClick={(event) =>
              runUiTask(
                openSevenTvProfile().then(() => showToast(t('userCard.feedback.opened'), event)),
              )
            }
          >
            {t('userCard.profile.openSevenTv')}
          </GhostButton>
        </div>
      </div>
    </div>
  )
})
