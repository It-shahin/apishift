# APIShift architecture and compatibility contract

## Milestone plan

1. Establish the supported subset and safety boundaries.
2. Implement a pure, deterministic parser/normalizer/comparator and rule tests.
3. Build the browser worker, original brand, landing page and comparison workspace.
4. Verify real browser workflows, accessibility, responsive layouts and security.
5. Prepare CI, public documentation and static deployment configuration.

## Compatibility semantics

Compatibility is from the perspective of an existing API consumer. A proposed API must accept previously accepted requests and preserve previously promised response values. Request narrowing and response widening can break consumers. Findings are evidence, never certification of full OpenAPI compatibility.

Only OpenAPI 3.0.x and 3.1.x are accepted. Parsing includes structural checks for the analyzed subset, not complete OpenAPI conformance validation. Invalid analyzed structures fail the entire comparison. Unsupported constructs produce explicit coverage findings even when unchanged.

The engine uses exact case-sensitive HTTP paths (trailing slashes are significant), lowercase HTTP method keys, inherited path parameters overridden by operation parameters, and parameter identity by location/name (header names are case-insensitive). Path-template renames are conservatively treated as removed/added operations.

## Boundaries

All input remains in memory. No analytics, storage, remote reference fetching or backend. YAML uses the core schema with aliases disabled. Documents are limited to 1 MiB each, 30,000 nodes, 64 levels of nesting, 2,000 operations, 100,000 comparison steps and 5,000 findings. A dedicated module worker is terminated after 8 seconds or on input changes, reset, swap or unmount. Results never silently truncate.

Same-document JSON Pointer references are resolved using own-property access, URI decoding and JSON Pointer escaping. Missing and circular references fail clearly. External references fail without network access. Reference siblings are rejected rather than merged incorrectly. Prototype-sensitive keys are rejected throughout input.

## Layers

- `src/engine`: parsing, typed normalization, comparison, deterministic report serialization; no React or browser APIs.
- `src/compare.worker.ts`: isolated entry point; returns structured results or a safe error.
- `src/App.tsx`: controlled inputs, worker lifecycle, filters, grouping and export.
- `src/samples.ts`: bundled realistic demonstration; no network required.
- `tests`: engine regressions and browser workflows.

## Detection rules

| Rule | Meaning |
| --- | --- |
| Operation removed / added | Removed is breaking; added is non-breaking. |
| Parameter added | Required is breaking; optional is non-breaking. |
| Parameter removed | Potentially breaking: server handling of old parameters is unknown. |
| Parameter requiredness | Becoming required is breaking; becoming optional is non-breaking. |
| Parameter location | Reported as removal/addition using location/name identity. |
| Request body | Becoming required or losing an accepted media type is breaking. Removing a body is potentially breaking. |
| Response status/media | Removed is breaking; added is potentially breaking (new possible output). |
| Types/nullability | Request allowed-type narrowing or response widening is breaking. Integer is a subset of number. Other direction is non-breaking. |
| Enums | Request value removal or response value addition is breaking; inverse is non-breaking. |
| Required properties | Newly required request fields and lost required response guarantees are breaking. |
| Property presence | Removed request properties are potentially breaking; removed guaranteed response properties are breaking. Optional response removal is potentially breaking. A newly typed optional request property is potentially breaking because it constrains previously allowed additional values; a new unconstrained optional property is non-breaking. |
| Bounds | Request tightening / response loosening of numeric, length and item bounds is breaking; inverse is non-breaking. |
| Nested objects/arrays | Same directionality applies recursively to properties and items. |
| Complex or unknown schema keywords | Unsupported coverage finding; no compatibility certainty for compositions, conditionals, patterns, formats, additionalProperties, readOnly/writeOnly or other unimplemented constraints. |
| Security, servers, callbacks, links, headers, encoding, serialization | Explicit unsupported coverage findings when present. |

Reports sort by operation, location, rule and severity. IDs are derived from the complete operation/location/rule tuple (URI-encoded, collision-free), not timestamps or array indexes. Markdown renders all untrusted strings as escaped text. JSON uses recursively sorted keys. No generated timestamps are included.

## Deliberate limitations

No full JSON Schema satisfiability, remote files, recursive models, discriminator semantics, content negotiation, authentication compatibility, server routing, runtime behavior, callbacks/webhooks or complete OpenAPI validation. Complex schema nodes are reported unsupported and skipped. The roadmap is to extend tested semantics, not infer compatibility heuristically.

OpenAPI 3.1 `nullable` is reported unsupported (use a `null` type union). `readOnly`/`writeOnly` requiredness changes are potentially breaking until direction-specific annotations are implemented. Constraints are checked independently, so findings are conservative rather than a proof of schema set inclusion. The required document subset includes `info.title`, `info.version`, and `paths`. Unused components are bounded and reference-resolved but not fully schema-validated. Example objects containing `$ref` are conservatively subject to the same reference restrictions.
