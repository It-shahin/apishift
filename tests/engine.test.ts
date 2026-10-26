import { describe, expect, it } from 'vitest'
import { compareText } from '../src/engine/compare'
import { parse } from '../src/engine/parse'
import { jsonReport, markdownReport } from '../src/engine/report'
import type { Obj } from '../src/engine/types'

const spec = (schema: Obj = { type: 'string' }, direction = 'request', extra: Obj = {}) => JSON.stringify({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: { '/users': { post: { ...(direction === 'request' ? { requestBody: { content: { 'application/json': { schema } } } } : {}), responses: { '200': { description: 'OK', ...(direction === 'response' ? { content: { 'application/json': { schema } } } : {}) } }, ...extra } } } })
const changes = (a: Obj, b: Obj, direction = 'request') => compareText(spec(a, direction), spec(b, direction)).findings
describe('consumer-facing schema semantics', () => {
  it('does not flag identical simple contracts', () => expect(compareText(spec(), spec()).findings).toEqual([]))
  it.each(['request', 'response'])('checks incompatible types: %s', direction => expect(changes({ type: 'string' }, { type: 'integer' }, direction)[0].severity).toBe('breaking'))
  it.each([['request', 'number', 'integer', 'breaking'], ['request', 'integer', 'number', 'non-breaking'], ['response', 'number', 'integer', 'non-breaking'], ['response', 'integer', 'number', 'breaking']])('number subset %s %s → %s', (direction, a, b, severity) => expect(changes({ type: a }, { type: b }, direction)[0].severity).toBe(severity))
  it.each([['request', false, true, 'non-breaking'], ['request', true, false, 'breaking'], ['response', false, true, 'breaking'], ['response', true, false, 'non-breaking']])('nullable %s %s → %s', (direction, a, b, severity) => expect(compareText(spec({ type: 'string', nullable: a }, direction as string).replace('3.1.0', '3.0.3'), spec({ type: 'string', nullable: b }, direction as string).replace('3.1.0', '3.0.3')).findings[0].severity).toBe(severity))
  it('handles 3.1 null union', () => expect(changes({ type: 'string' }, { type: ['string', 'null'] })[0].severity).toBe('non-breaking'))
  it.each([['request', 'breaking'], ['response', 'non-breaking']])('enum narrowing %s', (direction, severity) => expect(changes({ type: 'string', enum: ['a', 'b'] }, { type: 'string', enum: ['a'] }, direction)[0].severity).toBe(severity))
  it.each([['request', 'non-breaking'], ['response', 'breaking']])('enum widening %s', (direction, severity) => expect(changes({ enum: ['a'] }, {}, direction)[0].severity).toBe(severity))
  it('ignores enum order', () => expect(changes({ enum: ['a', 'b'] }, { enum: ['b', 'a'] }).every(f => f.severity === 'non-breaking')).toBe(true))
  it.each(['minimum', 'minLength', 'minItems'])('tightened %s request bound', key => expect(changes({ [key]: 1 }, { [key]: 2 })[0].severity).toBe('breaking'))
  it.each(['maximum', 'maxLength', 'maxItems'])('tightened %s request bound', key => expect(changes({ [key]: 2 }, { [key]: 1 })[0].severity).toBe('breaking'))
  it('response widening bound breaks', () => expect(changes({ maximum: 2 }, { maximum: 3 }, 'response')[0].severity).toBe('breaking'))
  it('new required request property breaks', () => expect(changes({ type: 'object' }, { type: 'object', required: ['email'], properties: { email: { type: 'string' } } }).some(f => f.severity === 'breaking')).toBe(true))
  it('new typed optional request property is conservative about previously allowed additional values', () => expect(changes({ type: 'object' }, { type: 'object', properties: { email: { type: 'string' } } }).every(f => f.severity === 'potential')).toBe(true))
  it('new unconstrained optional request property is safe', () => expect(changes({ type: 'object' }, { type: 'object', properties: { email: {} } }).every(f => f.severity === 'non-breaking')).toBe(true))
  it('readOnly required request properties do not invent breaking certainty', () => expect(changes({ type: 'object' }, { type: 'object', required: ['id'], properties: { id: { type: 'string', readOnly: true } } }).some(f => f.severity === 'breaking')).toBe(false))
  it('3.1 nullable is unsupported instead of interpreted as 3.0', () => expect(changes({ type: 'string' }, { type: 'string', nullable: true })[0].severity).toBe('unsupported'))
  it('literal slash keys and nested properties have distinct IDs', () => {
    const a = { properties: { 'x/properties/y': { type: 'string' }, x: { properties: { y: { type: 'string' } } } } }
    const b = { properties: { 'x/properties/y': { type: 'integer' }, x: { properties: { y: { type: 'integer' } } } } }
    const findings = changes(a, b)
    expect(findings).toHaveLength(2)
    expect(new Set(findings.map(f => f.id)).size).toBe(2)
  })
  it('lost guaranteed response property breaks', () => expect(changes({ type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, { type: 'object' }, 'response').some(f => f.rule === 'Property removed' && f.severity === 'breaking')).toBe(true))
  it('lost optional response property is uncertain', () => expect(changes({ properties: { id: { type: 'string' } } }, {}, 'response')[0].severity).toBe('potential'))
  it('nested array item property type is checked', () => expect(changes({ type: 'array', items: { properties: { id: { type: 'string' } } } }, { type: 'array', items: { properties: { id: { type: 'integer' } } } })[0].location).toContain('/items/properties/id'))
  it.each(['allOf', 'oneOf', 'anyOf', 'not', 'if', 'pattern', 'format', 'additionalProperties', 'readOnly', 'writeOnly', 'unevaluatedProperties'])('reports unchanged unsupported %s', key => { const value = ['allOf', 'oneOf', 'anyOf'].includes(key) ? [{}] : ['pattern', 'format'].includes(key) ? 'test' : ['readOnly', 'writeOnly'].includes(key) ? true : {}; expect(changes({ [key]: value }, { [key]: value })[0].severity).toBe('unsupported') })
  it('does not infer certainty at a composition node', () => expect(changes({ oneOf: [{ type: 'string' }], type: 'string' }, { oneOf: [{ type: 'number' }], type: 'number' }).every(f => f.severity === 'unsupported')).toBe(true))
})
describe('operations and parameters', () => {
  const empty = JSON.stringify({ openapi: '3.0.3', info: { title: 'T', version: '1' }, paths: {} })
  it('operation removal breaks', () => expect(compareText(spec(), empty).counts.breaking).toBe(1))
  it('operation addition is safe', () => expect(compareText(empty, spec()).counts['non-breaking']).toBe(1))
  const parameter = (required = false, location = 'query') => ({ name: 'limit', in: location, required, schema: { type: 'integer' } })
  it('new required parameter breaks', () => expect(compareText(spec(), spec({}, 'request', { parameters: [parameter(true)] })).findings.some(f => f.rule === 'Parameter added' && f.severity === 'breaking')).toBe(true))
  it('optional parameter addition is safe', () => expect(compareText(spec({}, 'request'), spec({}, 'request', { parameters: [parameter()] })).counts.breaking).toBe(0))
  it('parameter requiredness breaks', () => expect(compareText(spec({}, 'request', { parameters: [parameter()] }), spec({}, 'request', { parameters: [parameter(true)] })).counts.breaking).toBe(1))
  it('location changes are removal and addition', () => expect(compareText(spec({}, 'request', { parameters: [parameter()] }), spec({}, 'request', { parameters: [parameter(true, 'header')] })).findings.map(f => f.rule)).toEqual(expect.arrayContaining(['Parameter removed', 'Parameter added'])))
  it('path-level parameter overridden by operation', () => {
    const raw = JSON.parse(spec())
    raw.paths['/users'].parameters = [parameter(true)]
    raw.paths['/users'].post.parameters = [parameter(false)]
    expect(parse(JSON.stringify(raw)).operations.get('POST /users')?.parameters.get('query:limit')?.required).toBe(false)
  })
  it('body requiredness breaks', () => expect(compareText(spec(), spec({}, 'request', { requestBody: { required: true, content: { 'application/json': { schema: { type: 'string' } } } } })).findings.some(f => f.rule === 'Request body requiredness changed' && f.severity === 'breaking')).toBe(true))
  it('removed media type breaks', () => expect(compareText(spec(), spec({}, 'request', { requestBody: { content: { 'text/plain': { schema: {} } } } })).findings.some(f => f.rule === 'Media type removed')).toBe(true))
  it('response removal breaks', () => expect(compareText(spec(), spec({}, 'request', { responses: { '204': { description: 'Done' } } })).findings.some(f => f.rule === 'Response removed')).toBe(true))
  it('security coverage is never silently clean', () => expect(compareText(spec({}, 'request', { security: [] }), spec({}, 'request', { security: [] })).complete).toBe(false))
})
describe('parser security and validation', () => {
  it.each(['2.0', '3.2.0', '3.0', '4.0.0'])('rejects unsupported version %s', version => expect(() => parse(spec().replace('3.1.0', version))).toThrow('Supported versions'))
  it.each(['', '{', 'a: 1\na: 2', '!!js/function x', 'a: &a [*a]', 'null', '[]'])('rejects malformed input %s', input => expect(() => parse(input)).toThrow())
  it('supports YAML', () => expect(parse('openapi: 3.0.3\ninfo:\n  title: Test\n  version: "1"\npaths: {}').operations.size).toBe(0))
  it('rejects large input', () => expect(() => parse(' '.repeat(1_048_577))).toThrow('1 MiB'))
  it('rejects prototype keys', () => expect(() => parse(spec().replace('"type":"string"', '"__proto__":{}'))).toThrow('Unsafe'))
  it('rejects deep nesting', () => expect(() => parse(JSON.stringify({ a: Array.from({ length: 70 }).reduce<unknown>(v => ({ a: v }), {}) }))).toThrow('nesting'))
  it.each<Obj>([{ type: 'weird' }, { required: 'id' }, { nullable: 'yes' }, { enum: [] }, { minLength: -1 }, { minimum: 10, maximum: 1 }, { properties: [] }])('rejects invalid schema %j', schema => expect(() => parse(spec(schema))).toThrow())
  it('rejects missing responses', () => expect(() => parse(spec({}, 'request', { responses: null }))).toThrow())
  it('rejects duplicate parameters', () => expect(() => parse(spec({}, 'request', { parameters: [{ name: 'q', in: 'query', schema: {} }, { name: 'q', in: 'query', schema: {} }] }))).toThrow('duplicate'))
  it('resolves escaped local references', () => {
    const raw = JSON.parse(spec({ $ref: '#/components/schemas/A~1B~0C' }))
    raw.components = { schemas: { 'A/B~C': { type: 'integer' } } }
    expect(parse(JSON.stringify(raw)).operations.get('POST /users')?.body?.content.get('application/json')).toEqual({ type: 'integer' })
  })
  it.each(['https://example.com/a.json', 'other.yaml#/A', '#/missing', '#/bad~3'])('rejects unsafe/unresolved ref %s', ref => expect(() => parse(spec({ $ref: ref }))).toThrow())
  it('detects circular references', () => {
    const raw = JSON.parse(spec({ $ref: '#/components/schemas/A' }))
    raw.components = { schemas: { A: { properties: { next: { $ref: '#/components/schemas/A' } } } } }
    expect(() => parse(JSON.stringify(raw))).toThrow('Circular')
  })
  it('rejects semantic reference siblings', () => expect(() => parse(spec({ $ref: '#/info', type: 'string' }))).toThrow('siblings'))
  it('labels errors by input', () => expect(() => compareText(spec(), 'oops')).toThrow('Proposed:'))
})
describe('deterministic safe reports', () => {
  it('stable findings and exports', () => { const a = compareText(spec({ type: 'string' }), spec({ type: 'number' })); expect(jsonReport(a)).toBe(jsonReport(compareText(spec({ type: 'string' }), spec({ type: 'number' })))); expect(new Set(a.findings.map(f => f.id)).size).toBe(a.findings.length) })
  it('escapes injected HTML and links in Markdown', () => { const r = compareText(spec(), spec({ type: 'number' })); r.baseline.title = '<img src=x> [x](https://bad.test)'; expect(markdownReport(r)).not.toContain('<img'); expect(markdownReport(r)).toContain('\\[x\\]') })
})
