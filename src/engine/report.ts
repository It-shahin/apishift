import { stable } from './stable'
import type { Report } from './types'

// Escape punctuation and HTML, including newlines, so specification text cannot create links or HTML.
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_[\]{}()#+.!|~-]/g, '\\$&').replace(/\r?\n/g, ' ')
export const jsonReport = (report: Report) => JSON.stringify(JSON.parse(stable(report)), null, 2) + '\n'
export function markdownReport(report: Report): string {
  return ['# APIShift comparison report', '', `${escape(report.baseline.title)} → ${escape(report.proposed.title)}`, '', 'Consumer compatibility analysis of the supported subset only. Not a full compatibility certification.', '', `Breaking: ${report.counts.breaking} · Potentially breaking: ${report.counts.potential} · Non-breaking: ${report.counts['non-breaking']} · Unsupported: ${report.counts.unsupported}`, '', ...report.findings.flatMap(f => [`## ${escape(f.rule)}`, '', `Severity: ${f.severity}`, '', `Operation: ${escape(f.operation)}`, '', `Location: ${escape(f.location)}`, '', escape(f.explanation), '', `Before: ${escape(stable(f.before))}`, '', `After: ${escape(stable(f.after))}`, '', `Suggested action: ${escape(f.action)}`, ''])].join('\n')
}
