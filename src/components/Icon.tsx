export type IconName = 'arrow' | 'upload' | 'swap' | 'reset' | 'shield' | 'code' | 'check' | 'search' | 'download' | 'sun' | 'moon' | 'chevron' | 'alert' | 'layers'
const paths: Record<IconName, string> = {
  arrow: 'M4 12h15m-6-6 6 6-6 6', upload: 'M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4', swap: 'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4', reset: 'M4 10a8 8 0 1 1 1 8M4 4v6h6', shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6', code: 'm8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18', check: 'm5 12 4 4L19 6', search: 'm16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4', sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0', moon: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z', chevron: 'm9 5 7 7-7 7', alert: 'm12 3 10 18H2L12 3Zm0 6v5m0 3v1', layers: 'm12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
}
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
export function Logo() {
  return <a className="brand" href="#home" aria-label="APIShift home"><svg width="31" height="31" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect width="32" height="32" rx="8" fill="currentColor" /><path d="m7 11 5-5 5 5M12 6v17m13-2-5 5-5-5m5 5V9" stroke="var(--surface)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg><span>API<span className="brand-light">Shift</span><span className="brand-dot">.</span></span></a>
}
