import type { Language } from '@twirchat/shared/types'

export type { Language }

/** Values substituted into `{placeholder}` tokens. */
export type TranslationParams = Record<string, string | number | boolean | undefined | null>

/** Flat key/value dictionary shared by every locale. */
export type Dictionary = Record<string, string>

/**
 * Keys ending in `.one`, `.few`, `.many` or `.other` are plural forms selected
 * by `tPlural`; the suffix is never rendered.
 */
export type PluralKey = string
