import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, Logo } from './components/Icon'
import { LIMITS } from './engine/types'
import type { Finding, Report, Severity } from './engine/types'
import { samples } from './samples'
import './App.css'

const labels: Record<Severity, string> = { breaking: 'Breaking', potential: 'Potentially breaking', 'non-breaking': 'Non-breaking', unsupported: 'Unsupported' }
const severities = Object.keys(labels) as Severity[]
type Input = { text: string; name: string }
const blank = (): [Input, Input] => [{ text: '', name: '' }, { text: '', name: '' }]
const pretty = (value: unknown) => value === null ? 'Not specified' : JSON.stringify(value, null, 2)

function SpecInput({ index, input, update, error }: { index: number; input: Input; update: (input: Input) => void; error: (message: string) => void }) {
  const [mode, setMode] = useState<'file' | 'paste'>('file')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const generation = useRef({ value: 0 })
  useEffect(() => { const token = generation.current; token.value++; return () => { token.value++ } }, [input])
  const label = index === 0 ? 'Baseline' : 'Proposed'
  async function load(file?: File) {
    if (!file) return
    const id = ++generation.current.value
    if (file.size > LIMITS.bytes) { error(`${label}: file exceeds 1 MiB. Choose a smaller specification.`); return }
    try {
      const text = await file.text()
      if (id === generation.current.value) update({ text, name: file.name })
    } catch { if (id === generation.current.value) error(`${label}: file could not be read. Try selecting it again.`) }
  }
  return <section className={`input-card ${dragging ? 'dragging' : ''}`} aria-labelledby={`input-heading-${index}`}>
    <div className="input-top"><h3 id={`input-heading-${index}`}><span className={`version-dot ${index ? 'proposed' : ''}`} />{label.toUpperCase()} <span className="muted">/ {index ? 'what’s next' : 'what’s live'}</span></h3><span className="input-number">0{index + 1}</span></div>
    <div className="input-tabs" aria-label={`${label} input method`}><button className={mode === 'file' ? 'active' : ''} aria-pressed={mode === 'file'} onClick={() => setMode('file')}><Icon name="upload" size={14} />Upload file</button><button className={mode === 'paste' ? 'active' : ''} aria-pressed={mode === 'paste'} onClick={() => setMode('paste')}><Icon name="code" size={15} />Paste specification</button></div>
    {mode === 'file' ? <div className="dropzone" onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void load(event.dataTransfer.files[0]) }}>
      <span className={`upload-glyph ${input.text ? 'loaded' : ''}`}><Icon name={input.text ? 'check' : 'upload'} size={23} /></span>
      <button className="file-trigger" onClick={() => fileRef.current?.click()}>{input.text ? input.name || 'Pasted specification' : 'Choose a specification'}<span>{input.text ? 'Click to replace, or drop another file' : 'or drag and drop it here'}</span></button>
      <span className="file-hint">JSON or YAML <span>·</span> up to 1 MiB</span>
    </div> : <div className="paste-wrap"><label className="sr-only" htmlFor={`spec-${index}`}>{label} specification</label><textarea id={`spec-${index}`} name={`spec-${index}`} value={input.text} spellCheck={false} autoComplete="off" placeholder={'openapi: 3.0.3\ninfo:\n  title: Your API\n  version: 1.0.0\npaths: {}\n# Paste your specification…'} onChange={event => update({ text: event.target.value, name: '' })} /><span className="paste-size">{new TextEncoder().encode(input.text).length.toLocaleString()} bytes / 1 MiB</span></div>}
    <input ref={fileRef} hidden type="file" aria-label={`Upload ${label.toLowerCase()} specification`} accept=".json,.yaml,.yml,application/json,text/yaml" onChange={event => { void load(event.target.files?.[0]); event.target.value = '' }} />
    <div className="input-bottom"><span className={input.text ? 'ready' : ''}><span className="tiny-dot" />{input.text ? 'Ready to validate' : 'No specification selected'}</span><span>OpenAPI 3.0 / 3.1</span></div>
  </section>
}

function FindingCard({ finding, initiallyOpen }: { finding: Finding; initiallyOpen: boolean }) {
  const [method, ...path] = finding.operation.split(' ')
  return <details className="finding" open={initiallyOpen || undefined}>
    <summary><span className={`severity-indicator ${finding.severity}`} aria-hidden="true" /><span className="finding-heading"><span className="finding-title">{finding.rule}</span><span className="finding-operation"><span className={`method method-${method.toLowerCase()}`}>{method}</span><code>{path.join(' ')}</code></span></span><span className={`badge ${finding.severity}`}>{labels[finding.severity]}</span><Icon name="chevron" size={16} /></summary>
    <div className="finding-body"><p>{finding.explanation}</p><div className="location"><span>LOCATION</span><code>{finding.location}</code></div><div className="diff-values"><div><h4><span className="diff-minus">−</span> BASELINE</h4><pre>{pretty(finding.before)}</pre></div><div><h4><span className="diff-plus">+</span> PROPOSED</h4><pre>{pretty(finding.after)}</pre></div></div><p className="suggestion"><Icon name="arrow" size={15} /><span><strong>Suggested action</strong> {finding.action}</span></p></div>
  </details>
}

function Results({ report }: { report: Report }) {
  const [severity, setSeverity] = useState<Severity | 'all'>('all')
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState<'operation' | 'severity'>('operation')
  const [page, setPage] = useState(1)
  const [exportStatus, setExportStatus] = useState('')
  const filtered = useMemo(() => report.findings.filter(f => (severity === 'all' || f.severity === severity) && `${f.operation} ${f.rule} ${f.location} ${f.explanation}`.toLowerCase().includes(search.toLowerCase())), [report, severity, search])
  const grouped = useMemo(() => {
    const groups = new Map<string, Finding[]>()
    for (const f of filtered.slice((page - 1) * 50, page * 50)) { const key = group === 'operation' ? f.operation : labels[f.severity]; groups.set(key, [...(groups.get(key) ?? []), f]) }
    return [...groups]
  }, [filtered, group, page])
  async function download(format: 'json' | 'md') {
    try {
      const { jsonReport, markdownReport } = await import('./engine/report')
      const blob = new Blob([format === 'json' ? jsonReport(report) : markdownReport(report)], { type: format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `apishift-report.${format}`; a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
      setExportStatus(`${format === 'json' ? 'JSON' : 'Markdown'} report downloaded.`)
    } catch { setExportStatus('Export failed. Please try again.') }
  }
  return <section className="results" aria-labelledby="results-heading">
    <div className="section-title"><div><span className="eyebrow">02 / THE REVIEW</span><h2 id="results-heading">Understand the impact<span className="accent-dot">.</span></h2><p>{report.baseline.version} <span aria-hidden="true">→</span> {report.proposed.version} <span className="separator">/</span> {report.findings.length} findings across {report.proposed.operations} proposed operations</p></div><div className="export-buttons"><button className="button secondary small" onClick={() => void download('json')}><Icon name="download" size={15} />JSON</button><button className="button secondary small" onClick={() => void download('md')}><Icon name="download" size={15} />Markdown</button></div></div>
    <div className="summary-grid">{severities.map(s => <button key={s} className={`summary-card ${s} ${severity === s ? 'selected' : ''}`} aria-pressed={severity === s} onClick={() => { setSeverity(severity === s ? 'all' : s); setPage(1) }}><span><span className={`severity-indicator ${s}`} />{labels[s]}</span><strong>{report.counts[s].toLocaleString()}</strong><span className="summary-caption">{s === 'breaking' ? 'Requires attention' : s === 'potential' ? 'Review with your team' : s === 'non-breaking' ? 'Compatible changes' : 'Manual review needed'}<Icon name="arrow" size={15} /></span></button>)}</div>
    <div className={`coverage-note ${!report.complete ? 'incomplete' : ''}`}><Icon name={!report.complete ? 'alert' : 'shield'} size={16} /><span>{!report.complete ? 'Analysis has coverage gaps. Unsupported findings require manual review.' : 'Supported-rule analysis finished. This is not a full compatibility certification.'} <a href="#coverage">See coverage</a></span></div>
    <div className="explorer"><div className="explorer-toolbar"><div className="search-field"><Icon name="search" size={16} /><input aria-label="Search findings" type="search" name="search" autoComplete="off" placeholder="Search paths, properties, or changes…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} /></div><label className="filter-select"><span>Severity</span><select aria-label="Filter severity" value={severity} onChange={e => { setSeverity(e.target.value as Severity | 'all'); setPage(1) }}><option value="all">All severities</option>{severities.map(s => <option key={s} value={s}>{labels[s]}</option>)}</select></label><label className="filter-select"><span>Group by</span><select aria-label="Group findings" value={group} onChange={e => { setGroup(e.target.value as 'operation' | 'severity'); setPage(1) }}><option value="operation">Operation</option><option value="severity">Severity</option></select></label></div>
      <div className="findings-count" role="status">{filtered.length} of {report.findings.length} findings{severity !== 'all' || search ? <button onClick={() => { setSeverity('all'); setSearch(''); setPage(1) }}>Clear filters</button> : null}</div>
      {grouped.length ? grouped.map(([name, list], i) => <section className="finding-group" key={name} aria-label={name}><div className="group-title"><Icon name="layers" size={14} /><h3>{name}</h3><span>{list.length}</span></div>{list.map((f, j) => <FindingCard key={f.id} finding={f} initiallyOpen={i === 0 && j === 0} />)}</section>) : <div className="empty-state"><Icon name={report.findings.length ? 'search' : 'check'} size={28} /><h3>{report.findings.length ? 'No findings match these filters' : 'No changes detected in the supported rules'}</h3><p>{report.findings.length ? 'Try a different search or clear your severity filter.' : 'Review coverage limitations before treating this as a release decision.'}</p></div>}
      {filtered.length > 50 ? <div className="pagination"><button className="button secondary small" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} of {Math.ceil(filtered.length / 50)}</span><button className="button secondary small" disabled={page * 50 >= filtered.length} onClick={() => setPage(p => p + 1)}>Next</button></div> : null}
    </div><span role="status" className="sr-only">{exportStatus}</span>
  </section>
}

function App() {
  const [inputs, setInputs] = useState<[Input, Input]>(blank)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [example, setExample] = useState(false)
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [undo, setUndo] = useState<[Input, Input] | null>(null)
  const worker = useRef<Worker | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const errorRef = useRef<HTMLDivElement>(null)
  const sequence = useRef(0)
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#151916' : '#fafbf8') }, [dark])
  useEffect(() => () => { worker.current?.terminate(); window.clearTimeout(timer.current) }, [])
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])
  useEffect(() => {
    if (!inputs.some(i => i.text) || example) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [inputs, example])
  function invalidate() { sequence.current++; worker.current?.terminate(); worker.current = null; window.clearTimeout(timer.current); setBusy(false); setReport(null); setError('') }
  function update(index: number, input: Input) { invalidate(); setExample(false); setUndo(null); setInputs(previous => index === 0 ? [input, previous[1]] : [previous[0], input]) }
  function run(values = inputs) {
    invalidate()
    if (!values[0].text.trim() || !values[1].text.trim()) { setError('Add both baseline and proposed specifications, or load the working example.'); return }
    if (values.some(v => new TextEncoder().encode(v.text).length > LIMITS.bytes)) { setError('Each specification must be at most 1 MiB. Reduce the input size and try again.'); return }
    setBusy(true)
    const id = sequence.current
    try {
      const w = new Worker(new URL('./compare.worker.ts', import.meta.url), { type: 'module' }); worker.current = w
      const finish = () => { w.terminate(); worker.current = null; window.clearTimeout(timer.current); setBusy(false) }
      w.onmessage = (event: MessageEvent<{ report?: Report; error?: string }>) => {
        if (id !== sequence.current) return
        finish()
        if (event.data.error) setError(event.data.error)
        else if (event.data.report) setReport(event.data.report)
      }
      w.onerror = event => { event.preventDefault(); if (id !== sequence.current) return; finish(); setError('The analysis worker could not complete. Check the documents or try a smaller specification.') }
      timer.current = window.setTimeout(() => { finish(); setError('Analysis exceeded the 8-second processing limit. Split the specifications and try again.') }, LIMITS.timeout)
      w.postMessage({ baseline: values[0].text, proposed: values[1].text })
    } catch { setBusy(false); setError('Your browser could not start a Web Worker. Use a current browser and serve this app over HTTP or HTTPS.') }
  }
  function demo() { const values: [Input, Input] = [{ text: samples[0], name: 'orbit-v1.yaml' }, { text: samples[1], name: 'orbit-v2.yaml' }]; setInputs(values); setExample(true); setUndo(null); run(values); window.location.assign('#compare') }
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><div className="header-inner"><Logo /><nav aria-label="Main navigation"><a href="#compare">Workspace</a><a href="#how-it-works">How it works</a><a href="#coverage">Coverage</a></nav><div className="header-actions"><span className="local-badge"><span className="tiny-dot" />100% local</span><button className="theme-button" aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`} onClick={() => setDark(v => !v)}><Icon name={dark ? 'sun' : 'moon'} size={18} /></button></div></div></header>
    <main id="main">
      <section className="hero section-container" id="home"><div className="hero-copy"><div className="release-tag"><span className="tiny-dot" />THE OPENAPI CHANGE REVIEW TOOL<span className="version-tag">v0.1</span></div><h1>Your API changed.<br />Know <span className="hero-highlight">what breaks.</span></h1><p className="hero-description">Catch breaking API changes before they reach production. Compare two OpenAPI specs and turn a noisy diff into a clear next step.</p><div className="hero-actions"><a className="button primary" href="#compare">Compare specifications<Icon name="arrow" /></a><button className="button text-button" onClick={demo}>Try a real example<Icon name="arrow" size={16} /></button></div><div className="hero-trust"><span><Icon name="shield" size={15} />Your specs stay on your device</span><span className="trust-divider" /><span>No account. No API keys.</span></div></div><div className="hero-visual" aria-label="Example of a breaking parameter change"><div className="visual-top"><span><span className="tiny-dot" />CONTRACT REVIEW</span><span>v1.0 <span className="muted">→</span> v2.0</span></div><div className="visual-operation"><span className="method method-get">GET</span><code>/projects</code><span className="visual-file">openapi.yaml</span></div><div className="code-window"><div><span className="line-no">18</span><span className="code-key">parameters:</span></div><div><span className="line-no">19</span><span>  - <span className="code-key">name:</span> limit</span></div><div><span className="line-no">20</span><span>    <span className="code-key">in:</span> query</span></div><div className="removed-line"><span className="line-no">−</span><span>    required: false</span></div><div className="added-line"><span className="line-no">+</span><span>    required: true</span><span className="code-cursor" /></div><div><span className="line-no">22</span><span>    <span className="code-key">schema:</span></span></div><div><span className="line-no">23</span><span>      <span className="code-key">type:</span> integer</span></div></div><div className="visual-insight"><span className="insight-icon"><Icon name="alert" size={20} /></span><div><div className="insight-heading">Small edit. Breaking change.<span className="badge breaking">Breaking</span></div><p>Existing requests without <code>limit</code> may fail.<br />Keep it optional, or version the endpoint.</p></div></div><div className="visual-bottom"><span><Icon name="shield" size={13} />Analyzed locally</span><span>Less noise. More signal.</span></div></div></section>
      <div className="capability-strip"><div className="section-container"><span><Icon name="code" />OpenAPI 3.0 & 3.1</span><span><Icon name="layers" />JSON & YAML</span><span><Icon name="shield" />Browser-only by design</span><span><Icon name="download" />Shareable reports</span></div></div>
      <section className="workspace section-container" id="compare" aria-labelledby="workspace-heading"><div className="section-title"><div><span className="eyebrow">01 / THE COMPARISON</span><h2 id="workspace-heading">Two specs. A clearer release<span className="accent-dot">.</span></h2><p>Start with what’s live. Compare it to what’s next.</p></div><button className="example-button" onClick={demo}><Icon name="code" size={17} />Load example<Icon name="arrow" size={15} /></button></div>
      {example ? <div className="example-banner"><span><Icon name="code" size={16} /><strong>Example mode</strong> Orbit Projects API · v1.0.0 → v2.0.0</span><span>Real specs. Real analysis.</span></div> : null}
      <div className="input-grid">{inputs.map((input, index) => <SpecInput key={index} index={index} input={input} update={value => update(index, value)} error={message => { invalidate(); setError(message) }} />)}<button className="swap-button" aria-label="Swap baseline and proposed" title="Swap baseline and proposed" onClick={() => { invalidate(); setInputs(([a, b]) => [b, a]); setExample(false) }}><Icon name="swap" size={17} /></button></div>
      <div className="compare-actions"><p><Icon name="shield" size={16} />Private by default. Nothing leaves this tab.</p><div><button className="button text-button" onClick={() => { invalidate(); setUndo(inputs.some(i => i.text) ? inputs : null); setInputs(blank()); setExample(false) }}><Icon name="reset" size={15} />Reset</button><button className="button primary" disabled={busy} onClick={() => run()}>{busy ? 'Analyzing locally…' : 'Compare specifications'}<Icon name={busy ? 'layers' : 'arrow'} size={17} /></button></div></div>
      {undo ? <div className="undo-banner" role="status">Specifications cleared.<button onClick={() => { setInputs(undo); setUndo(null) }}>Undo reset</button></div> : null}
      {error ? <div className="error-banner" role="alert" tabIndex={-1} ref={errorRef}><Icon name="alert" /><div><strong>Couldn’t complete the comparison</strong><p>{error}</p><span>Fix the input and compare again. No partial report was generated.</span></div></div> : null}
      <div role="status" className="sr-only">{busy ? 'Comparing specifications in your browser.' : report ? `Comparison complete. ${report.counts.breaking} breaking findings. ${report.counts.unsupported} unsupported findings.` : ''}</div>
      {report ? <Results report={report} /> : !busy && !error ? <div className="initial-state"><span className="initial-icon"><Icon name="layers" size={25} /></span><div><h3>Your next release, with fewer surprises.</h3><p>Add your specifications above, or <button onClick={demo}>take the example for a spin <span aria-hidden="true">↗</span></button></p></div><span className="initial-label">AWAITING SPECS</span></div> : busy ? <div className="initial-state"><Icon name="layers" size={25} /><div><h3>Reviewing your contract…</h3><p>Parsing, resolving local references, and comparing supported rules.</p></div></div> : null}
      </section>
      <section className="how-section section-container" id="how-it-works"><div className="section-title"><div><span className="eyebrow">A SMALL CHECK. A BETTER RELEASE.</span><h2>Built for the moment before merge.</h2></div><p className="section-aside">A focused contract review.<br />Without another service in your stack.</p></div><div className="how-grid">{[{ n: '01', title: 'Bring your contracts', text: 'Drop in JSON or YAML. Use your current API as the baseline and your next version as the proposal.', icon: 'upload' as const }, { n: '02', title: 'See the consumer impact', text: 'Review breaking changes, compatibility risks, and explicit gaps in analysis. Every finding has a next step.', icon: 'layers' as const }, { n: '03', title: 'Take the review with you', text: 'Export deterministic Markdown for a pull request, or JSON for your own tooling. Your data stays yours.', icon: 'download' as const }].map(item => <article key={item.n}><div className="how-icon"><Icon name={item.icon} size={22} /><span>{item.n}</span></div><h3>{item.title}</h3><p>{item.text}</p></article>)}</div></section>
      <section className="coverage-section section-container" id="coverage"><div className="coverage-intro"><span className="eyebrow">HONEST BY DESIGN</span><h2>Clear findings.<br />Clear boundaries.</h2><p>APIShift checks a carefully defined subset of consumer compatibility. It never turns uncertainty into a green light.</p><a href="/architecture.md" className="inline-link">Read the engine contract<Icon name="arrow" size={15} /></a></div><div className="coverage-details"><details open><summary>What APIShift checks<Icon name="chevron" size={16} /></summary><p>Removed operations, parameters and requiredness, request media types, response contracts, nested object and array schemas, types, enum values and basic bounds. OpenAPI 3.0.x and 3.1.x only.</p></details><details><summary>What needs manual review<Icon name="chevron" size={16} /></summary><p>Compositions (allOf, oneOf, anyOf), formats, patterns, additionalProperties, readOnly/writeOnly, authentication, servers, callbacks and advanced JSON Schema semantics are unsupported. Circular and external references are rejected. This is not a full OpenAPI validator or a release certification.</p></details><details><summary>How your specifications stay private<Icon name="chevron" size={16} /></summary><p>Parsing and comparison run in an isolated browser worker. No accounts, analytics, remote storage or API requests. Inputs stay in tab memory and disappear when you close or reload it. Downloads happen only when you choose to export. Each input is limited to 1 MiB, with bounded traversal and an 8-second timeout.</p></details></div></section>
    </main><footer className="site-footer section-container"><div><Logo /><span>Ship changes. Not surprises.</span></div><p>Built for developers. Runs in your browser.</p><a href="#home">Back to top ↑</a></footer>
  </>
}
export default App
