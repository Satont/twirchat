export function deleteOldestEntry<K, V>(collection: Map<K, V> | Set<K>): void {
  const first = collection.keys().next()
  if (!first.done) collection.delete(first.value)
}
