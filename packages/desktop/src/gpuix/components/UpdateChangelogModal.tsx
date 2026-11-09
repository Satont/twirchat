import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { useRef } from 'react'

import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { usePopupHotkeys, scrollPopupPage } from '../hooks/use-popup-hotkeys'
import { useT, type MessageKey } from '../i18n'
import { formatReleaseDate, parseReleaseNotes, type ReleaseNoteKind } from '../release-notes'
import { type Theme } from '../theme'
import { useTheme } from '../theme-context'
import { Badge } from './ui/Badge'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { Text } from './ui/Text'

const SECTION_GAP = 20
const ITEM_GAP = 8
const BADGE_WIDTH = 40

const kindLabelKeys: Record<ReleaseNoteKind, MessageKey> = {
  new: 'app.changelog.kind.new',
  improved: 'app.changelog.kind.improved',
  fixed: 'app.changelog.kind.fixed',
  removed: 'app.changelog.kind.removed',
  docs: 'app.changelog.kind.docs',
  other: 'app.changelog.kind.other',
}

const badgeLabelKeys: Record<ReleaseNoteKind, MessageKey> = {
  new: 'app.changelog.badge.new',
  improved: 'app.changelog.badge.improved',
  fixed: 'app.changelog.badge.fixed',
  removed: 'app.changelog.badge.removed',
  docs: 'app.changelog.badge.docs',
  other: 'app.changelog.badge.other',
}

interface KindPalette {
  background: string
  text: string
}

const darkKindPalettes: Record<Exclude<ReleaseNoteKind, 'other'>, KindPalette> = {
  new: { background: 'rgba(34, 197, 94, 0.18)', text: '#86efac' },
  improved: { background: 'rgba(59, 130, 246, 0.18)', text: '#93c5fd' },
  fixed: { background: 'rgba(245, 158, 11, 0.18)', text: '#fcd34d' },
  removed: { background: 'rgba(239, 68, 68, 0.18)', text: '#fca5a5' },
  docs: { background: 'rgba(167, 139, 250, 0.18)', text: '#c4b5fd' },
}

const lightKindPalettes: Record<Exclude<ReleaseNoteKind, 'other'>, KindPalette> = {
  new: { background: 'rgba(22, 163, 74, 0.12)', text: '#15803d' },
  improved: { background: 'rgba(37, 99, 235, 0.12)', text: '#1d4ed8' },
  fixed: { background: 'rgba(234, 88, 12, 0.12)', text: '#c2410c' },
  removed: { background: 'rgba(220, 38, 38, 0.12)', text: '#b91c1c' },
  docs: { background: 'rgba(124, 58, 237, 0.12)', text: '#6d28d9' },
}

function kindPalette(kind: ReleaseNoteKind, theme: Theme): KindPalette {
  if (kind === 'other') return { background: theme.fill, text: theme.text2 }
  return theme.isLight ? lightKindPalettes[kind] : darkKindPalettes[kind]
}

export function UpdateChangelogModal({
  version,
  releaseNotes,
  publishedAt,
  onClose,
}: {
  version: string
  releaseNotes: string
  publishedAt: string
  onClose: () => void
}) {
  const theme = useTheme()
  const backend = useBackend()
  const { t } = useT()
  const renderer = useGpuixRequired()
  const viewportRef = useRef<PublicInstance | null>(null)

  const popupContextId = usePopupHotkeys('update-changelog', {
    delete: onClose,
    scrollPage: ([direction]) => scrollPopupPage(renderer, viewportRef, direction ?? 'down'),
  })

  const sections = parseReleaseNotes(releaseNotes)
  const releaseDate = formatReleaseDate(publishedAt)
  const versionLabel = `v${version.replace(/^v/u, '')}`

  return (
    <Modal hotkeyContextId={popupContextId} width={720} onClose={onClose}>
      <div
        testId="update-changelog"
        tabIndex={-1}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 16,
            padding: 24,
            flexShrink: 0,
            borderTopLeftRadius: 13,
            borderTopRightRadius: 13,
            background: {
              type: 'linear-gradient',
              angle: 135,
              stops: [
                { color: hexMix(theme.accent.primary, theme.dialog, 0.18), position: 0 },
                { color: theme.dialog, position: 1 },
              ],
            },
            borderBottomWidth: 1,
            borderColor: theme.hairline,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              backgroundColor: theme.accent.primary,
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
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: 700, color: theme.text }}>
                {t('app.changelog.title')}
              </Text>
              <div
                testId="update-changelog-version"
                style={{
                  borderRadius: 999,
                  paddingTop: 3,
                  paddingBottom: 3,
                  paddingLeft: 10,
                  paddingRight: 10,
                  backgroundColor: theme.accent.tint15,
                  borderWidth: 1,
                  borderColor: theme.accent.tint25,
                  flexShrink: 0,
                }}
              >
                <Badge>{versionLabel}</Badge>
              </div>
            </div>
            <Text
              testId="update-changelog-date"
              style={{ fontSize: 13, color: theme.text2, marginTop: 4 }}
            >
              {releaseDate
                ? t('app.changelog.released', { date: releaseDate })
                : t('app.changelog.defaultGreet')}
            </Text>
          </div>
        </div>

        <div
          ref={viewportRef}
          testId="update-changelog-content"
          style={{
            flexGrow: 1,
            flexShrink: 1,
            minHeight: 0,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: SECTION_GAP,
            overflowY: 'scroll',
            scrollbarColor: theme.scrollbar,
            scrollbarWidth: 4,
          }}
        >
          {sections.map((section) => {
            const palette = kindPalette(section.kind, theme)
            return (
              <div
                key={section.kind}
                style={{ display: 'flex', flexDirection: 'column', gap: ITEM_GAP }}
              >
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: palette.text,
                    textTransform: 'uppercase',
                    letterSpacing: '0.6px',
                    paddingLeft: 3,
                  }}
                >
                  {t(kindLabelKeys[section.kind])}
                </Text>
                {section.items.map((item) => (
                  <div
                    key={item}
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingTop: 6,
                      paddingBottom: 8,
                      borderWidth: 1,
                      borderColor: theme.hairline,
                      borderRadius: 8,
                      backgroundColor: theme.fill,
                    }}
                  >
                    <div
                      style={{
                        width: BADGE_WIDTH,
                        flexShrink: 0,
                        display: 'flex',
                        justifyContent: 'center',
                        paddingTop: 3,
                      }}
                    >
                      <Badge
                        backgroundColor={palette.background}
                        color={palette.text}
                        size="sm"
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          letterSpacing: '0.6px',
                          textTransform: 'uppercase',
                        }}
                      >
                        {t(badgeLabelKeys[section.kind])}
                      </Badge>
                    </div>
                    <Text
                      style={{
                        fontSize: 13,
                        color: theme.text,
                        lineHeight: 19,
                        flexGrow: 1,
                        minWidth: 0,
                      }}
                    >
                      {item}
                    </Text>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'flex-end',
            gap: 10,
            padding: 16,
            paddingTop: 8,
            flexShrink: 0,
            borderTopWidth: 1,
            borderColor: theme.hairline,
          }}
        >
          <div
            testId="update-changelog-github"
            onClick={() =>
              runUiTask(
                backend.api.openExternalUrl({
                  url: `https://github.com/Satont/twirchat/releases/tag/v${version}`,
                }),
              )
            }
            style={{
              backgroundColor: 'transparent',
              borderRadius: 6,
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
            <Text style={{ fontSize: 13, fontWeight: 500, color: theme.text }}>
              {t('app.changelog.viewOnGitHub')}
            </Text>
          </div>
          <div
            testId="update-changelog-continue"
            onClick={onClose}
            style={{
              backgroundColor: theme.accent.deep,
              borderRadius: 6,
              paddingTop: 8,
              paddingBottom: 8,
              paddingLeft: 20,
              paddingRight: 20,
              cursor: 'pointer',
              hover: { opacity: 0.9 },
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: 500, color: theme.accent.onDeep }}>
              {t('common.close')}
            </Text>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function hexMix(color: string, base: string, ratio: number): string {
  const c1 = parseInt(color.replace('#', ''), 16)
  const c2 = parseInt(base.replace('#', ''), 16)
  const r = Math.round(((c1 >> 16) & 0xff) * ratio + ((c2 >> 16) & 0xff) * (1 - ratio))
  const g = Math.round(((c1 >> 8) & 0xff) * ratio + ((c2 >> 8) & 0xff) * (1 - ratio))
  const b = Math.round((c1 & 0xff) * ratio + (c2 & 0xff) * (1 - ratio))
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}
