import { isAlias, parseDocument, visit } from 'yaml'
import { LIMITS } from './types'
import type { Body, Coverage, Obj, Operation, Parameter, Specification, Value } from './types'
import { token } from './stable'

export function object(value: unknown, at: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${at}: expected an object.`)
  return value as Obj
}
const own = (o: Obj, k: string) => Object.hasOwn(o, k)
const methods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])
const annotations = new Set(['title', 'description', 'example', 'examples', 'default', 'deprecated', 'externalDocs', '$comment'])
const supported = new Set(['type', 'nullable', 'properties', 'required', 'items', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'])
const types = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])

export function parse(text: string): Specification {
  if (new TextEncoder().encode(text).length > LIMITS.bytes) throw new Error('Specification exceeds the 1 MiB limit.')
  if (!text.trim()) throw new Error('Add a specification before comparing.')
  const doc = parseDocument(text, { schema: 'core', uniqueKeys: true, strict: true })
  // Do not echo parser snippets: errors should not copy specification contents into logs.
  if (doc.errors.length || doc.warnings.length) throw new Error('Invalid JSON or YAML. Check syntax, duplicate keys and tags.')
  visit(doc, (_key, node) => { if (isAlias(node)) throw new Error('YAML aliases are not supported. Expand anchors before comparing.') })
  const root = object(doc.toJS({ maxAliasCount: 0 }), 'Document')
  let nodes = 0
  function guard(value: unknown, depth = 0): void {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) throw new Error('Document exceeds node or nesting limits.')
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite numbers are not supported.')
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe object key in document.')
        guard(child, depth + 1)
      }
    }
  }
  guard(root)
  if (typeof root.openapi !== 'string' || !/^3\.(0|1)\.\d+$/.test(root.openapi)) throw new Error('Supported versions: OpenAPI 3.0.x and 3.1.x. Swagger 2.0 and OpenAPI 3.2 are not supported.')
  const is30 = root.openapi.startsWith('3.0')
  const info = object(root.info, 'info')
  if (typeof info.title !== 'string' || typeof info.version !== 'string') throw new Error('info.title and info.version must be strings.')
  let steps = 0
  function resolve(value: Value, trail: Set<string> = new Set(), depth = 0): Value {
    if (++steps > LIMITS.steps || depth > LIMITS.depth) throw new Error('Reference expansion exceeds processing limits.')
    if (Array.isArray(value)) return value.map(v => resolve(v, trail, depth + 1))
    if (value && typeof value === 'object') {
      if (own(value, '$ref')) {
        if (typeof value.$ref !== 'string' || !value.$ref.startsWith('#/')) throw new Error('Only same-document #/ references are supported. External references are never fetched.')
        if (Object.keys(value).some(k => k !== '$ref' && k !== 'description' && k !== 'summary')) throw new Error('Reference siblings are not supported. Inline this schema instead.')
        const ref = value.$ref
        let pointer: string
        try { pointer = decodeURIComponent(ref.slice(2)) } catch { throw new Error('Invalid URI encoding in reference.') }
        if (/~(?![01])/u.test(pointer)) throw new Error('Invalid JSON Pointer escape.')
        if (trail.has(pointer)) throw new Error('Circular local reference detected. Recursive schemas are not supported.')
        let target: Value = root
        for (const part of pointer.split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))) {
          if (!target || typeof target !== 'object' || !Object.hasOwn(target, part)) throw new Error('Unresolved local reference.')
          target = (target as Obj)[part]
        }
        return resolve(target, new Set([...trail, pointer]), depth + 1)
      }
      const result: Obj = Object.create(null) as Obj
      for (const [key, child] of Object.entries(value)) result[key] = resolve(child, trail, depth + 1)
      return result
    }
    return value
  }
  const expanded = object(resolve(root), 'Document')
  const coverage: Coverage[] = []
  const mark = (operation: string, location: string, keyword: string) => { coverage.push({ operation, location, keyword }) }
  function extras(o: Obj, allowed: string[], op: string, at: string) {
    for (const k of Object.keys(o)) if (!allowed.includes(k) && !annotations.has(k) && !k.startsWith('x-')) mark(op, at, k)
  }
  function bool(o: Obj, key: string, at: string) {
    if (own(o, key) && typeof o[key] !== 'boolean') throw new Error(`${at}.${key}: expected a boolean.`)
    return o[key] === true
  }
  function schema(value: Value | undefined, op: string, at: string): Obj {
    if (value === undefined) return {}
    if (typeof value === 'boolean') { if (is30) throw new Error(`${at}: boolean schemas require OpenAPI 3.1.`); mark(op, at, 'boolean schema'); return { $unsupported: true } }
    const s = object(value, at)
    for (const k of Object.keys(s)) if (!supported.has(k) && !annotations.has(k) && !k.startsWith('x-')) mark(op, at, k)
    if (s.type !== undefined) {
      const ts = Array.isArray(s.type) ? s.type : [s.type]
      if (!ts.length || ts.some(t => typeof t !== 'string' || !types.has(t)) || (is30 && (Array.isArray(s.type) || s.type === 'null'))) throw new Error(`${at}: invalid schema type for this OpenAPI version.`)
    }
    bool(s, 'nullable', at)
    if (!is30 && s.nullable !== undefined) { mark(op, at, 'nullable in OpenAPI 3.1'); s.$unsupported = true }
    if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some(x => typeof x !== 'string') || new Set(s.required).size !== s.required.length)) throw new Error(`${at}.required: expected unique property names.`)
    if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length)) throw new Error(`${at}.enum: expected a non-empty array.`)
    for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
      if (s[key] !== undefined && (typeof s[key] !== 'number' || (key.includes('Length') || key.includes('Items')) && (!Number.isInteger(s[key]) || (s[key] as number) < 0))) throw new Error(`${at}.${key}: invalid constraint.`)
    }
    for (const [lo, hi] of [['minimum', 'maximum'], ['minLength', 'maxLength'], ['minItems', 'maxItems']]) if (typeof s[lo] === 'number' && typeof s[hi] === 'number' && s[lo] > s[hi]) throw new Error(`${at}: contradictory bounds.`)
    if (s.properties !== undefined) for (const [key, child] of Object.entries(object(s.properties, `${at}.properties`))) (s.properties as Obj)[key] = schema(child, op, `${at}/properties/${token(key)}`)
    if (s.items !== undefined) s.items = schema(s.items, op, `${at}/items`)
    for (const key of ['allOf', 'oneOf', 'anyOf']) if (s[key] !== undefined) {
      if (!Array.isArray(s[key]) || !s[key].length) throw new Error(`${at}.${key}: expected a non-empty schema array.`)
      s[key].forEach((child, i) => schema(child, op, `${at}/${key}/${i}`))
    }
    for (const key of ['not', 'if', 'then', 'else', 'additionalProperties', 'unevaluatedProperties']) if (s[key] !== undefined) {
      if (typeof s[key] !== 'boolean') schema(s[key], op, `${at}/${key}`)
    }
    for (const key of ['readOnly', 'writeOnly', 'uniqueItems']) bool(s, key, at)
    for (const key of ['pattern', 'format']) if (s[key] !== undefined && typeof s[key] !== 'string') throw new Error(`${at}.${key}: expected a string.`)
    if (s.type === 'array' && s.items === undefined) { if (is30) throw new Error(`${at}: array schema requires items.`); mark(op, at, 'unconstrained array items') }
    return s
  }
  function content(value: Value | undefined, op: string, at: string): Map<string, Obj> {
    const result = new Map<string, Obj>()
    if (value === undefined) return result
    for (const [media, raw] of Object.entries(object(value, at))) {
      if (!media.includes('/')) throw new Error(`${at}: invalid media type.`)
      const m = object(raw, at)
      extras(m, ['schema'], op, `${at}/${token(media)}`)
      if (result.has(media.toLowerCase())) throw new Error(`${at}: duplicate normalized media type.`)
      result.set(media.toLowerCase(), schema(m.schema, op, `${at}/${token(media.toLowerCase())}`))
    }
    return result
  }
  function params(value: Value | undefined, op: string, at: string): Map<string, Parameter> {
    const result = new Map<string, Parameter>()
    if (value === undefined) return result
    if (!Array.isArray(value)) throw new Error(`${at}: expected a parameter array.`)
    for (const raw of value) {
      const p = object(raw, at)
      if (typeof p.name !== 'string' || !p.name || typeof p.in !== 'string' || !['path', 'query', 'header', 'cookie'].includes(p.in)) throw new Error(`${at}: invalid parameter name or location.`)
      const required = bool(p, 'required', at)
      if (p.in === 'path' && !required) throw new Error(`${at}: path parameters must be required.`)
      if ((p.schema === undefined) === (p.content === undefined)) throw new Error(`${at}: a parameter needs exactly one of schema or content.`)
      const name = p.in === 'header' ? p.name.toLowerCase() : p.name
      const key = `${p.in}:${name}`
      if (result.has(key)) throw new Error(`${at}: duplicate parameter identity.`)
      extras(p, ['name', 'in', 'required', 'schema'], op, `parameters/${token(key)}`)
      if (p.content !== undefined) { if (Object.keys(object(p.content, at)).length !== 1) throw new Error(`${at}: parameter content must contain one media type.`); content(p.content, op, `parameters/${key}/content`) }
      result.set(key, { name, in: p.in, required, schema: schema(p.schema, op, `parameters/${token(key)}/schema`), raw: p })
    }
    return result
  }
  extras(expanded, ['openapi', 'info', 'paths', 'components', 'tags'], 'DOCUMENT', '/')
  const paths = object(expanded.paths, 'paths')
  const operations = new Map<string, Operation>()
  for (const [path, raw] of Object.entries(paths)) {
    if (path.startsWith('x-')) continue
    if (!path.startsWith('/')) throw new Error('HTTP paths must begin with /.')
    const item = object(raw, `paths/${path}`)
    extras(item, [...methods, 'parameters', 'summary'], 'DOCUMENT', path)
    for (const [method, rawOperation] of Object.entries(item)) {
      if (!methods.has(method)) continue
      const key = `${method.toUpperCase()} ${path}`
      const o = object(rawOperation, key)
      extras(o, ['parameters', 'requestBody', 'responses', 'operationId', 'summary', 'tags'], key, '/')
      const parameters = params(item.parameters, key, 'path parameters')
      for (const [id, p] of params(o.parameters, key, 'operation parameters')) parameters.set(id, p)
      const placeholders = [...path.matchAll(/\{([^{}]+)\}/g)].map(m => m[1])
      if (placeholders.some(name => !parameters.has(`path:${name}`)) || [...parameters.values()].some(p => p.in === 'path' && !placeholders.includes(p.name))) throw new Error(`${key}: path template and parameters do not match.`)
      let body: Body | undefined
      if (o.requestBody !== undefined) {
        const b = object(o.requestBody, `${key} requestBody`)
        extras(b, ['required', 'content'], key, 'requestBody')
        if (b.content === undefined || !Object.keys(object(b.content, 'requestBody.content')).length) throw new Error('Request body requires non-empty content.')
        body = { required: bool(b, 'required', 'requestBody'), content: content(b.content, key, 'requestBody') }
      }
      const responses = new Map<string, Map<string, Obj>>()
      const responseObject = object(o.responses, `${key} responses`)
      if (!Object.keys(responseObject).length) throw new Error(`${key}: responses must not be empty.`)
      for (const [status, rawResponse] of Object.entries(responseObject)) {
        if (status.startsWith('x-')) continue
        if (!/^(default|[1-5](?:\d{2}|XX))$/.test(status)) throw new Error(`${key}: invalid response status.`)
        const r = object(rawResponse, `${key} response`)
        if (typeof r.description !== 'string') throw new Error(`${key}: response description is required.`)
        extras(r, ['content'], key, `responses/${status}`)
        responses.set(status, content(r.content, key, `responses/${status}`))
      }
      operations.set(key, { key, parameters, body, responses })
      if (operations.size > LIMITS.operations) throw new Error('Specification exceeds 2,000 operations.')
    }
  }
  return { title: info.title, version: info.version, operations, coverage }
}
