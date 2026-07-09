// Ambient chrome for code that runs inside page.evaluate against extension pages.
declare const chrome: {
  storage: { local: { get: (k?: string | string[]) => Promise<Record<string, any>>; set: (o: Record<string, any>) => Promise<void> } };
  runtime: { getURL: (p: string) => string };
  tabs: Record<string, unknown>;
  windows: { create: (opts: { url?: string; focused?: boolean }) => Promise<unknown> };
};
