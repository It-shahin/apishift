export type Value = null | boolean | number | string | Value[] | { [key: string]: Value }
export type Obj = { [key: string]: Value }
export type Severity = 'breaking' | 'potential' | 'non-breaking' | 'unsupported'
export interface Finding {
  id: string
  severity: Severity
  rule: string
  operation: string
  location: string
  before: Value
  after: Value
  explanation: string
  action: string
}
export interface Parameter { name: string; in: string; required: boolean; schema: Obj; raw: Obj }
export interface Body { required: boolean; content: Map<string, Obj> }
export interface Operation {
  key: string
  parameters: Map<string, Parameter>
  body?: Body
  responses: Map<string, Map<string, Obj>>
}
export interface Coverage { operation: string; location: string; keyword: string }
export interface Specification { title: string; version: string; operations: Map<string, Operation>; coverage: Coverage[] }
export interface Report {
  formatVersion: 1
  baseline: { title: string; version: string; operations: number }
  proposed: { title: string; version: string; operations: number }
  counts: Record<Severity, number>
  findings: Finding[]
  complete: boolean
}
export const LIMITS = { bytes: 1_048_576, nodes: 30_000, depth: 64, operations: 2_000, steps: 100_000, findings: 5_000, timeout: 8_000 } as const
