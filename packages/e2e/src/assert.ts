export interface CaseResult {
  name: string;
  ok: boolean;
  detail: string;
}

export class Reporter {
  results: CaseResult[] = [];
  private group = '';

  section(name: string): void {
    this.group = name;
    console.log(`\n\x1b[1m▸ ${name}\x1b[0m`);
  }

  check(name: string, ok: boolean, detail = ''): boolean {
    const full = this.group ? `${this.group} › ${name}` : name;
    this.results.push({ name: full, ok, detail });
    const icon = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`  ${icon} ${name}${detail ? ` \x1b[90m— ${detail}\x1b[0m` : ''}`);
    return ok;
  }

  get passed(): number {
    return this.results.filter(r => r.ok).length;
  }
  get failed(): number {
    return this.results.filter(r => !r.ok).length;
  }

  summary(): boolean {
    const total = this.results.length;
    const allOk = this.failed === 0;
    console.log(
      `\n\x1b[1m${allOk ? '\x1b[32m' : '\x1b[31m'}${this.passed}/${total} checks passed\x1b[0m`,
    );
    if (!allOk) {
      console.log('\x1b[31mFailed:\x1b[0m');
      this.results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.name} ${r.detail}`));
    }
    return allOk;
  }
}
