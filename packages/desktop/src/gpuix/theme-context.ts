import type { AppSettings } from '@twirchat/shared/types'
import { createContext, useContext } from 'react'

import { darkTheme, fontFamily, lightTheme, type Theme } from './theme'

export const ThemeContext = createContext<Theme>(darkTheme)
export const FontContext = createContext<string | undefined>('Inter')

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

export function useFont(): string | undefined {
  return useContext(FontContext)
}

export function resolveTheme(settings: AppSettings | null): Theme {
  return settings?.theme === 'light' ? lightTheme : darkTheme
}

export function resolveFont(settings: AppSettings | null): string | undefined {
  return fontFamily(settings?.fontFamily ?? 'inter')
}
