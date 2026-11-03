/** Retain literal fixture discriminants and tuple positions without a type assertion. */
export function literal<const T>(value: T): T {
  return value
}

export function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Expected a fixture result to exist.')
  return value
}

export function fetchUrl(value: string | URL | Request): string {
  return value instanceof Request ? value.url : value.toString()
}

export function textBody(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a serialized JSON request body.')
  return value
}
