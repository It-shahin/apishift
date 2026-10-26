import { expect, it } from 'vitest'
import { parse } from '../src/engine/parse'
import { compareText } from '../src/engine/compare'

const document = (paths = {}, extra = {}) => JSON.stringify({ openapi: '3.1.0', info: { title: 'Limits', version: '1' }, paths, ...extra })
const operation = { responses: { '200': { description: 'OK' } } }

it('enforces the node budget before comparison', () => {
  expect(() => parse(document({}, { 'x-data': Array(30_001).fill(1) }))).toThrow('node or nesting limits')
})
it('enforces the operation budget without truncation', () => {
  expect(() => parse(document(Object.fromEntries(Array.from({ length: 2_001 }, (_, i) => [`/p${i}`, { get: operation }]))))).toThrow('2,000 operations')
})
it('bounds reference amplification', () => {
  const schemas: Record<string, unknown> = { A0: { type: 'string' } }
  for (let i = 1; i < 16; i++) schemas[`A${i}`] = { properties: { left: { $ref: `#/components/schemas/A${i - 1}` }, right: { $ref: `#/components/schemas/A${i - 1}` } } }
  expect(() => parse(document({}, { components: { schemas } }))).toThrow('processing limits')
})
it('escapes hostile property keys without modifying global prototypes', () => {
  expect(() => parse('{"openapi":"3.1.0","info":{"title":"T","version":"1"},"paths":{},"constructor":{"prototype":{"polluted":true}}}')).toThrow('Unsafe')
  expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
})
it('rejects malformed path parameter declarations', () => {
  expect(() => parse(document({ '/p/{id}': { get: operation } }))).toThrow('do not match')
})
it('does not collapse distinct trailing slash paths', () => {
  const r = compareText(document({ '/p': { get: operation } }), document({ '/p/': { get: operation } }))
  expect(new Set(r.findings.map(f => f.rule))).toEqual(new Set(['Operation removed', 'Operation added']))
})
it('normalizes header names without collapsing query parameter names', () => {
  const withParam = (name: string, location: string) => document({ '/p': { get: { ...operation, parameters: [{ name, in: location, schema: { type: 'string' } }] } } })
  expect(compareText(withParam('X-Key', 'header'), withParam('x-key', 'header')).findings).toHaveLength(0)
  expect(compareText(withParam('Key', 'query'), withParam('key', 'query')).findings).toHaveLength(2)
})
it('rejects overlapping media keys instead of silently overwriting', () => {
  const response = { description: 'OK', content: { 'application/json': { schema: {} }, 'Application/JSON': { schema: { type: 'string' } } } }
  expect(() => parse(document({ '/p': { get: { responses: { '200': response } } } }))).toThrow('duplicate normalized media type')
})
it('accepts valid nullable syntax only for the appropriate dialect', () => {
  const withType = (schema: unknown) => document({ '/p': { get: { responses: { '200': { description: 'OK', content: { 'application/json': { schema } } } } } } })
  expect(() => parse(withType({ type: ['string', 'null'] }).replace('3.1.0', '3.0.3'))).toThrow('invalid schema type')
  expect(() => parse(withType(false).replace('3.1.0', '3.0.3'))).toThrow('boolean schemas require')
  expect(compareText(withType(false), withType(true)).complete).toBe(false)
})
