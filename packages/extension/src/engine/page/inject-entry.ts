import { installGlobalAgent } from './page-agent';

/**
 * Entry bundled to an IIFE and injected into pages by bench + e2e. It exposes the
 * exact same page agent the extension content script uses, so the benchmarked engine
 * is byte-for-byte the shipped engine.
 */
installGlobalAgent('');
