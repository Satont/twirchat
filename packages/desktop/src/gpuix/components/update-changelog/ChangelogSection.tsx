import { useTheme } from '@desktop/gpuix/theme-context'

import { useT } from '../../i18n'
import type { ReleaseNoteKind } from '../../release-notes'
import { Icon } from '../ui'
import { Text } from '../ui/Text'
import { ChangelogItem } from './ChangelogItem'
import { ITEM_GAP } from './constants'
import { getKindPalette } from './palettes'
import type { ChangelogItem as ChangelogItemType } from './types'
import { kindLabelKeys, kindIcons } from './types'

interface ChangelogSectionProps {
  kind: ReleaseNoteKind
  items: ChangelogItemType[]
}

export function ChangelogSection({ kind, items }: ChangelogSectionProps) {
  const { t } = useT()
  const theme = useTheme()

  const palette = getKindPalette(kind, theme)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ITEM_GAP }}>
      <Text
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: theme.text,
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
          flexWrap: 'wrap',
          paddingLeft: 3,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            fontWeight: 700,
          }}
        >
          <div style={{ marginTop: 2 }}>
            <Icon name={kindIcons[kind]} size={14} color={palette.text} />
          </div>
          {t(kindLabelKeys[kind])}
        </div>
      </Text>
      {items.map((item, index) => (
        <ChangelogItem key={index} item={item} theme={theme} />
      ))}
    </div>
  )
}
