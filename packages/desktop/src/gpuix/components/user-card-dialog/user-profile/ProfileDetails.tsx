import { useActionToast } from '@gpuix/components/action-toast'
import { Icon } from '@gpuix/components/ui/Icon'
import { Text } from '@gpuix/components/ui/Text'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import { useT } from '@gpuix/i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'
import { withAlpha } from '@gpuix/theme'
import { useTheme } from '@gpuix/theme-context'
import { useMemo, memo } from 'react'

import { getSkeletonColors } from '../metadata-section/skeleton-colors'
import { userCardWellColor } from '../utils'
import { SKELETON_ROWS } from './constants'
import { ProfileInfoRow } from './ProfileInfoRow'
import type { ProfileDetailsProps, ProfileEntry } from './types'

export const ProfileDetails = memo(function ProfileDetails({
  profile,
  loading,
  error,
  copyText,
  compact = false,
}: ProfileDetailsProps) {
  const theme = useTheme()
  const { t, language } = useT()
  const { showToast } = useActionToast()

  const entries = useMemo<ProfileEntry[]>(() => {
    const result: ProfileEntry[] = []

    if (profile) {
      const streamStatus = profile.live
        ? true
        : profile.errors.some((item) => item.section === 'live')
          ? undefined
          : false

      const liveValue =
        streamStatus !== false ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              flexGrow: 1,
              minWidth: 0,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                lineHeight: 18,
                color: theme.text,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flexGrow: 1,
                minWidth: 0,
              }}
            >
              {profile.live?.title ?? ''}
            </Text>
            {profile.live?.viewers && (
              <Text
                style={{
                  fontSize: 12,
                  lineHeight: 18,
                  color: theme.text,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {t('userCard.profile.viewers.other', { count: profile.live.viewers })}
              </Text>
            )}
          </div>
        ) : (
          t('userCard.profile.offline')
        )

      result.push({
        icon: 'eye',
        label: t('userCard.profile.live'),
        value: liveValue,
        color: streamStatus === false ? 'red' : 'green',
      })

      if (profile.followers !== undefined)
        result.push({
          icon: 'users',
          label: t('userCard.profile.followers'),
          value: profile.followers.toLocaleString(language),
        })
      if (profile.lastLive)
        result.push({
          icon: 'calendar',
          label: t('userCard.profile.lastLive'),
          value: new Date(profile.lastLive).toLocaleString(language),
        })
      if (profile.pronouns)
        result.push({
          icon: 'smile',
          label: t('userCard.profile.pronouns'),
          value: profile.pronouns,
        })
      const chatColor = profile.color
      if (chatColor)
        result.push({
          icon: 'chat',
          label: t('userCard.profile.chatColor'),
          value: (
            <Tooltip delayDuration={200} style={{ width: 28, height: 28, flexShrink: 0 }}>
              <TooltipTrigger asChild>
                <div
                  onClick={(event) =>
                    runUiTask(
                      copyText(chatColor).then(() =>
                        showToast(t('userCard.feedback.copied'), event),
                      ),
                    )
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    flexShrink: 0,
                    cursor: 'pointer',
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    backgroundColor: theme.fill,
                    hover: { backgroundColor: theme.fillHover },
                  }}
                >
                  <Icon name="copy" size={14} color={theme.text} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} style={{ padding: 6, borderRadius: 6 }}>
                <Text style={{ fontSize: 12, color: theme.text }}>
                  {t('userCard.profile.copyColor')}
                </Text>
              </TooltipContent>
            </Tooltip>
          ),
          color: chatColor,
        })

      if (profile.broadcasterType)
        result.push({
          icon: 'monitor',
          label: t('userCard.profile.broadcaster'),
          value: profile.broadcasterType,
        })
      if (profile.roles) {
        const roles = Object.entries(profile.roles)
          .filter(([, enabled]) => enabled)
          .map(([name]) => name.toUpperCase())
          .join(', ')
        result.push({
          icon: 'star',
          label: t('userCard.profile.roles'),
          value: roles || t('userCard.profile.noRole'),
        })
      }
    }

    return result
  }, [profile, t, language, theme, copyText, showToast])

  if (loading) {
    const skel = getSkeletonColors(theme)
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          marginTop: compact ? 6 : 12,
          borderWidth: 1,
          borderColor: theme.hairline,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: userCardWellColor(theme),
        }}
      >
        {SKELETON_ROWS.map((skeleton, index) => (
          <div
            key={skeleton.label}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingTop: 9,
              paddingBottom: 9,
              paddingLeft: 12,
              paddingRight: 12,
              borderTopWidth: index === 0 ? 0 : 1,
              borderColor: theme.hairline,
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                flexShrink: 0,
                borderRadius: 3,
                backgroundColor: skel.iconBg,
              }}
            />
            <div
              style={{
                width: 104,
                flexShrink: 0,
                height: 11,
                borderRadius: 2,
                backgroundColor: skel.labelBar,
              }}
            />
            {skeleton.hasColor ? (
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  flexShrink: 0,
                  backgroundColor: skel.labelBar,
                  borderWidth: 1,
                  borderColor: withAlpha('#ffffff', 0.25),
                }}
              />
            ) : null}
            <div
              style={{
                flexGrow: 1,
                minWidth: 0,
                height: 12,
                borderRadius: 2,
                backgroundColor: skel.valueBar,
              }}
            />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return <Text style={{ fontSize: 12, color: theme.dangerText }}>{error}</Text>
  }

  if (entries.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderWidth: 1,
        borderColor: theme.hairline,
        borderRadius: 12,
        marginTop: compact ? 6 : 12,
        overflow: 'hidden',
        backgroundColor: userCardWellColor(theme),
      }}
    >
      {entries.map((entry: ProfileEntry, index: number) => (
        <ProfileInfoRow key={entry.label} entry={entry} first={index === 0} />
      ))}
    </div>
  )
})
