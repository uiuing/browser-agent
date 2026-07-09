import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '../../extension/src/engine/page/inject-entry.ts');

let cached: string | null = null;

/** Bundle the page agent to a single IIFE string (window.__browserAgent). */
export async function buildAgentIIFE(): Promise<string> {
  if (cached) return cached;
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    write: false,
    logLevel: 'silent',
  });
  cached = result.outputFiles[0].text;
  return cached;
}
