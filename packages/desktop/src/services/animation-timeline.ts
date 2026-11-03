export function timelineValue(values: readonly number[], index: number): number {
  const value = values[index]
  if (value === undefined) throw new Error('Invalid animation timeline index.')
  return value
}
