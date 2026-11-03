export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key in source) {
    const value = source[key]
    if (value === undefined || value === null) continue
    const targetValue = result[key]
    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      Object.assign(result, { [key]: deepMerge(targetValue, value) })
    } else {
      Object.assign(result, { [key]: value })
    }
  }
  return result
}
