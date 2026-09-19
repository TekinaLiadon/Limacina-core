export function lastById<T extends { id: number }>(items: readonly T[]): T | undefined {
  return items.toSorted((a, b) => a.id - b.id).at(-1);
}
