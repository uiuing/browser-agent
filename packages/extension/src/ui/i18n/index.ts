import { zhCN, type Dict } from './zh-CN';
import { enUS } from './en-US';
import type { Locale } from '../../storage/types';

const DICTS: Record<Locale, Dict> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

type Path = string;

function resolve(obj: unknown, path: Path): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object')
      return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

export function createTranslator(locale: Locale) {
  const dict = DICTS[locale] ?? zhCN;
  return function t(
    path: Path,
    vars?: Record<string, string | number>,
  ): string {
    let value = resolve(dict, path);
    if (value === undefined) value = resolve(zhCN, path);
    if (typeof value !== 'string') return path;
    if (vars) {
      return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) =>
        String(vars[k] ?? ''),
      );
    }
    return value;
  };
}

export type { Dict, Locale };
