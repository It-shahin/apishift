/** Canonical JSON for comparisons and deterministic exports. */
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
/** JSON Pointer token escaping prevents collisions between literal / keys and nested locations. */
export const token = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1')
