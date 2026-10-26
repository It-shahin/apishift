import { compareText } from './engine/compare'
self.onmessage = (event: MessageEvent<{ baseline: string; proposed: string }>) => {
  try { self.postMessage({ report: compareText(event.data.baseline, event.data.proposed) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Comparison failed. Check the input documents.' }) }
}
