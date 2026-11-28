import { ActionButton } from '@gpuix/components/ui/Form'
import { Icon } from '@gpuix/components/ui/Icon'
import { Text } from '@gpuix/components/ui/Text'
import { useT } from '@gpuix/hooks/use-translation'
import { useOverlayClose } from '@gpuix/state/overlays'
import { withAlpha } from '@gpuix/theme'
import { useTheme } from '@gpuix/theme-context'
import { useState } from 'react'

import { reasonMenuWidth } from './reason-menu-width'
import type { ReasonDropdownProps } from './types'

export function ReasonDropdown({ reasons, value, onSelect, disabled }: ReasonDropdownProps) {
  const theme = useTheme()
  const { t } = useT()
  const [open, setOpen] = useState(false)
  useOverlayClose(open, () => setOpen(false))

  const pick = (reason: string) => {
    onSelect(reason)
    setOpen(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <ActionButton
        icon="arrowDown"
        primary={open}
        disabled={disabled || reasons.length === 0}
        onClick={() => setOpen((current) => !current)}
      >
        {t('userCard.actions.reason')}
      </ActionButton>
      {open ? (
        <anchored deferred side="bottom" align="start" gap={6}>
          <div
            role="menu"
            onMouseDownOutside={() => setOpen(false)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: reasonMenuWidth(reasons),
              maxHeight: 260,
              overflowY: 'scroll',
              padding: 4,
              backgroundColor: theme.popover,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 7,
              boxShadow: {
                offsetX: 0,
                offsetY: 5,
                blurRadius: 18,
                spreadRadius: 0,
                color: '#00000060',
              },
            }}
          >
            {reasons.map((reason) => {
              const selected = reason === value
              const choose = () => pick(reason)
              return (
                <div
                  key={reason}
                  role="menuitemradio"
                  aria-checked={selected}
                  tabIndex={0}
                  onClick={choose}
                  onKeyDown={(event) => {
                    if (event.key === 'enter' || event.key === 'space') {
                      event.preventDefault()
                      choose()
                    }
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingTop: 5,
                    paddingBottom: 5,
                    paddingLeft: 8,
                    paddingRight: 8,
                    borderRadius: 4,
                    cursor: 'pointer',
                    backgroundColor: selected
                      ? withAlpha(theme.accent.primary, 0.14)
                      : 'transparent',
                    hover: { backgroundColor: theme.fillHover },
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      color: theme.text,
                      flexGrow: 1,
                      minWidth: 0,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {reason}
                  </Text>
                  {selected ? <Icon name="check" size={12} color={theme.accent.primary} /> : null}
                </div>
              )
            })}
          </div>
        </anchored>
      ) : null}
    </div>
  )
}
