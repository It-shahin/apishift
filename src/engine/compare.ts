import { parse } from './parse'
import { LIMITS } from './types'
import type { Finding, Obj, Report, Severity, Specification, Value } from './types'

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
const equal = (a: unknown, b: unknown) => stable(a) === stable(b)
const names = <T>(a: Map<string, T>, b: Map<string, T>) => [...new Set([...a.keys(), ...b.keys()])].sort()
const props = (s: Obj) => (s.properties ?? {}) as Record<string, Obj>
const required = (s: Obj) => new Set((s.required ?? []) as string[])
const supported = new Set(['type', 'nullable', 'properties', 'required', 'items', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'title', 'description', 'example', 'examples', 'default', 'deprecated', 'externalDocs', '$comment'])
const uncertain = (s: Obj) => Object.keys(s).some(k => !supported.has(k) && !k.startsWith('x-'))
function allowedTypes(s: Obj): Set<string> {
  const ts = s.type === undefined ? ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'] : Array.isArray(s.type) ? s.type as string[] : [s.type as string]
  const result = new Set(ts)
  if (result.has('number')) result.add('integer')
  if (s.nullable === true && s.type !== undefined) result.add('null')
  return result
}

export function compare(baseline: Specification, proposed: Specification): Report {
  const findings = new Map<string, Finding>()
  let steps = 0
  function add(severity: Severity, rule: string, operation: string, location: string, before: Value | undefined, after: Value | undefined, explanation: string, action = 'Review affected consumers and update or version the contract before release.') {
    const id = [operation, location, rule].map(encodeURIComponent).join('|')
    findings.set(id, { id, severity, rule, operation, location, before: before ?? null, after: after ?? null, explanation, action })
    if (findings.size > LIMITS.findings) throw new Error('Comparison exceeds 5,000 findings. Split the specifications into smaller files.')
  }
  for (const c of [...baseline.coverage, ...proposed.coverage]) add('unsupported', `Unsupported: ${c.keyword}`, c.operation, c.location, undefined, undefined, `Analysis does not cover ${c.keyword}. Compatibility at this location is uncertain, even if unchanged.`, 'Inspect this construct manually; consult the supported-rule documentation.')
  function schema(a: Obj, b: Obj, direction: 'request' | 'response', op: string, at: string, depth = 0) {
    if (++steps > LIMITS.steps || depth > LIMITS.depth) throw new Error('Schema comparison exceeds processing limits.')
    if (uncertain(a) || uncertain(b)) return
    const req = direction === 'request'
    const emit = (breaking: boolean, rule: string, before: Value | undefined, after: Value | undefined, explanation: string) => add(breaking ? 'breaking' : 'non-breaking', rule, op, at, before, after, explanation, breaking ? undefined : 'Confirm the implementation matches the updated contract.')
    const ta = allowedTypes(a), tb = allowedTypes(b)
    if (!equal([...ta].sort(), [...tb].sort())) {
      const bad = req ? [...ta].some(t => !tb.has(t)) : [...tb].some(t => !ta.has(t))
      emit(bad, 'Allowed types changed', [...ta].sort(), [...tb].sort(), req ? 'Existing request values must remain accepted; narrowing allowed types can reject callers.' : 'Consumers rely on the original response types; new possible types can break parsing.')
    }
    if (!equal(Array.isArray(a.enum) ? a.enum.map(stable).sort() : a.enum, Array.isArray(b.enum) ? b.enum.map(stable).sort() : b.enum)) {
      const ea = a.enum as Value[] | undefined, eb = b.enum as Value[] | undefined
      const subset = (x: Value[] | undefined, y: Value[] | undefined) => !y || !!x && x.every(v => y.some(w => equal(v, w)))
      emit(!(req ? subset(ea, eb) : subset(eb, ea)), 'Enum values changed', a.enum, b.enum, req ? 'Previously allowed request enum values must remain accepted.' : 'New possible response enum values may not be understood by existing consumers.')
    }
    for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
      if (equal(a[key], b[key])) continue
      const lower = key.startsWith('min')
      const av = typeof a[key] === 'number' ? a[key] : lower ? -Infinity : Infinity
      const bv = typeof b[key] === 'number' ? b[key] : lower ? -Infinity : Infinity
      const narrowing = lower ? bv > av : bv < av
      emit(req ? narrowing : !narrowing, `${key} changed`, a[key], b[key], `${direction === 'request' ? 'Accepted request' : 'Possible response'} range changed. Request tightening and response loosening can break consumers.`)
    }
    const ra = required(a), rb = required(b)
    for (const name of [...new Set([...ra, ...rb])].sort()) {
      if (ra.has(name) === rb.has(name)) continue
      add(req ? rb.has(name) ? 'breaking' : 'non-breaking' : ra.has(name) ? 'breaking' : 'non-breaking', 'Property requiredness changed', op, `${at}/properties/${name}/required`, ra.has(name), rb.has(name), req ? 'Making a request property required rejects callers that omit it.' : 'Removing a required response guarantee means consumers can no longer rely on this property.')
    }
    const pa = props(a), pb = props(b)
    for (const name of [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort()) {
      const aa = pa[name], bb = pb[name], location = `${at}/properties/${name}`
      if (!bb) add(req ? 'potential' : ra.has(name) ? 'breaking' : 'potential', 'Property removed', op, location, aa, undefined, req ? 'The documented request property was removed. Handling of existing callers is unknown.' : 'Consumers may read this response property; required properties were guaranteed.')
      else if (!aa) add(req ? rb.has(name) ? 'breaking' : 'non-breaking' : 'potential', 'Property added', op, location, undefined, bb, req ? 'New required request properties reject existing callers; optional properties do not.' : 'A newly specified response property may affect strict decoders or previously unconstrained values.')
      else schema(aa, bb, direction, op, location, depth + 1)
    }
    if (a.items !== undefined || b.items !== undefined) schema((a.items ?? {}) as Obj, (b.items ?? {}) as Obj, direction, op, `${at}/items`, depth + 1)
  }
  function media(a: Map<string, Obj>, b: Map<string, Obj>, direction: 'request' | 'response', op: string, at: string) {
    for (const key of names(a, b)) {
      const aa = a.get(key), bb = b.get(key)
      if (!bb) add('breaking', 'Media type removed', op, `${at}/${key}`, key, undefined, `The ${direction} media type is no longer supported.`)
      else if (!aa) add(direction === 'request' ? 'non-breaking' : 'potential', 'Media type added', op, `${at}/${key}`, undefined, key, `A new ${direction} representation is documented.`)
      else schema(aa, bb, direction, op, `${at}/${key}`)
    }
  }
  for (const key of names(baseline.operations, proposed.operations)) {
    const a = baseline.operations.get(key), b = proposed.operations.get(key)
    if (!b) { add('breaking', 'Operation removed', key, '/', key, undefined, 'Existing callers can no longer use this operation.', 'Keep the operation available or introduce a versioned migration.'); continue }
    if (!a) { add('non-breaking', 'Operation added', key, '/', undefined, key, 'A new operation is available without removing existing operations.', 'Document the new operation for consumers.'); continue }
    for (const id of names(a.parameters, b.parameters)) {
      const aa = a.parameters.get(id), bb = b.parameters.get(id), at = `parameters/${id}`
      if (!bb) add('potential', 'Parameter removed', key, at, aa?.raw, undefined, 'Existing clients may still send this parameter. Its runtime handling is unknown.')
      else if (!aa) add(bb.required ? 'breaking' : 'non-breaking', 'Parameter added', key, at, undefined, bb.raw, bb.required ? 'Existing callers do not supply this newly required parameter.' : 'Callers may omit this new optional parameter.')
      else {
        if (aa.required !== bb.required) add(bb.required ? 'breaking' : 'non-breaking', 'Parameter requiredness changed', key, `${at}/required`, aa.required, bb.required, 'Making a parameter required rejects requests that previously omitted it.')
        schema(aa.schema, bb.schema, 'request', key, `${at}/schema`)
      }
    }
    if ((a.body?.required ?? false) !== (b.body?.required ?? false)) add(b.body?.required ? 'breaking' : 'non-breaking', 'Request body requiredness changed', key, 'requestBody/required', a.body?.required ?? false, b.body?.required ?? false, 'A required request body cannot be omitted by existing callers.')
    if (a.body && !b.body) add('potential', 'Request body removed', key, 'requestBody', true, false, 'Existing clients may still send a body; runtime handling is unknown.')
    else media(a.body?.content ?? new Map(), b.body?.content ?? new Map(), 'request', key, 'requestBody')
    for (const status of names(a.responses, b.responses)) {
      const aa = a.responses.get(status), bb = b.responses.get(status)
      if (!bb) add('breaking', 'Response removed', key, `responses/${status}`, status, undefined, 'The response contract expected by existing callers is no longer documented.')
      else if (!aa) add('potential', 'Response added', key, `responses/${status}`, undefined, status, 'Existing callers may not handle this new response status.')
      else media(aa, bb, 'response', key, `responses/${status}`)
    }
  }
  const sorted = [...findings.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const counts: Report['counts'] = { breaking: 0, potential: 0, 'non-breaking': 0, unsupported: 0 }
  for (const f of sorted) counts[f.severity]++
  const summary = (s: Specification) => ({ title: s.title, version: s.version, operations: s.operations.size })
  return { formatVersion: 1, baseline: summary(baseline), proposed: summary(proposed), counts, findings: sorted, complete: !counts.unsupported }
}
export function compareText(baseline: string, proposed: string): Report {
  let a: Specification, b: Specification
  try { a = parse(baseline) } catch (error) { throw new Error(`Baseline: ${error instanceof Error ? error.message : 'Invalid document.'}`, { cause: error }) }
  try { b = parse(proposed) } catch (error) { throw new Error(`Proposed: ${error instanceof Error ? error.message : 'Invalid document.'}`, { cause: error }) }
  return compare(a, b)
}
