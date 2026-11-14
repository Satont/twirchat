import { useTheme } from '@desktop/gpuix/theme-context'

import { useBackend } from '../../backend/context'
import { runUiTask } from '../../hooks/run-ui-task'
import { useT } from '../../i18n'
import { Icon } from '../ui'
import { ACTIONS_PADDING, ACTIONS_PADDING_TOP } from './constants'

interface ChangelogActionsProps {
  version: string
  onClose: () => void
}

export function ChangelogActions({ version, onClose }: ChangelogActionsProps) {
  const { t } = useT()
  const backend = useBackend()
  const theme = useTheme()

  const handleGitHubClick = () => {
    runUiTask(
      backend.api.openExternalUrl({
        url: `https://github.com/Satont/twirchat/releases/tag/v${version}`,
      }),
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 8,
        padding: ACTIONS_PADDING,
        paddingTop: ACTIONS_PADDING_TOP,
        flexShrink: 0,
        borderTopWidth: 1,
        borderColor: theme.hairline,
      }}
    >
      <div
        testId="update-changelog-github"
        onClick={handleGitHubClick}
        style={{
          backgroundColor: 'transparent',
          borderRadius: 12,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 16,
          paddingRight: 16,
          cursor: 'pointer',
          borderWidth: 1,
          borderColor: theme.hairline,
          hover: { backgroundColor: theme.fillHover },
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            color: 'lightgray',
            gap: 4,
          }}
        >
          {t('app.changelog.viewOnGitHub')}
          <Icon size={14} name="externalLink" color="lightgray" />
        </div>
      </div>
      <div
        testId="update-changelog-continue"
        onClick={onClose}
        style={{
          display: 'flex',
          justifyContent: 'center',
          backgroundColor: theme.accent.deep,
          borderRadius: 12,
          paddingTop: 6,
          paddingBottom: 8,
          paddingLeft: 15,
          paddingRight: 10,
          cursor: 'pointer',
          hover: { opacity: 0.9 },
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            flexDirection: 'row',
            fontWeight: 800,
            alignItems: 'center',
            color: 'lightgray',
            gap: 4,
          }}
        >
          {t('common.close')}
          <Icon size={14} name="check" color="lightgray" />
        </div>
      </div>
    </div>
  )
}
