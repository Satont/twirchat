import { useTheme } from '../../theme-context'
import { Text } from './Text'

export interface ToggleGroupOption<T extends string> {
  readonly value: T
  readonly label: string
  readonly testId?: string
}

interface ToggleGroupProps<T extends string> {
  readonly label: string
  readonly options: readonly ToggleGroupOption<T>[]
  readonly value: T
  readonly onChange: (value: T) => void
}

/** Segmented toggle — .toggle-group / .toggle-btn (.active = accent tint). */
export function ToggleGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: ToggleGroupProps<T>) {
  const theme = useTheme()
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        maxWidth: '100%',
        minWidth: 0,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 8,
        overflow: 'hidden',
        flexShrink: 1,
      }}
    >
      {options.map((option, index) => {
        const active = option.value === value
        return (
          <div
            key={option.value}
            testId={option.testId}
            role="button"
            aria-label={option.label}
            aria-description={active ? 'Selected' : undefined}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'enter' || event.key === 'space') {
                event.preventDefault()
                onChange(option.value)
              }
            }}
            onClick={() => onChange(option.value)}
            style={{
              paddingTop: 5,
              paddingBottom: 5,
              paddingLeft: 12,
              paddingRight: 12,
              cursor: 'pointer',
              backgroundColor: active ? theme.accent.tint20 : undefined,
              borderLeftWidth: index === 0 ? 0 : 1,
              borderColor: theme.border,
              hover: { backgroundColor: active ? theme.accent.tint25 : theme.fillHover },
              focusVisible: { outlineWidth: 1, outlineColor: theme.link, outlineOffset: -2 },
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: active ? theme.accent.primary : theme.text2,
              }}
            >
              {option.label}
            </Text>
          </div>
        )
      })}
    </div>
  )
}
