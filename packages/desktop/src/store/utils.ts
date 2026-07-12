// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Record<string,any> required: concrete
// types like ChatLayout/AppSettings lack index signatures so Record<string,unknown> is too strict
export function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key of Object.keys(source) as (keyof T)[]) {
    const value = source[key]
    if (value === undefined || value === null) {
      continue
    }

    const targetValue = result[key]
    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        value as Partial<Record<string, unknown>>,
      ) as T[keyof T]
      continue
    }

    result[key] = value as T[keyof T]
  }

  return result
}
