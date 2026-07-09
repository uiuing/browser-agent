import type { SemanticNode, PageSnapshot } from '../contracts/perception';
import type { SemanticFingerprint, GroundingResult } from '../contracts/grounding';

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(norm(a).split(' ').filter(Boolean));
  const tb = new Set(norm(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  ta.forEach(t => {
    if (tb.has(t)) hit++;
  });
  return hit / Math.max(ta.size, tb.size);
}

function pathSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const pa = a.split('>');
  const pb = b.split('>');
  let match = 0;
  const len = Math.min(pa.length, pb.length);
  for (let i = 1; i <= len; i++) {
    if (pa[pa.length - i] === pb[pb.length - i]) match++;
    else break;
  }
  return match / Math.max(pa.length, pb.length);
}

/**
 * Weighted match score of a fingerprint against a candidate node.
 * This is the core of "认得准": robust to re-render because we blend accessible
 * name, role, stable attributes, structural path, anchors, component type and
 * geometry rather than relying on a positional index (nanobrowser's fragile approach).
 */
export function scoreNode(fp: SemanticFingerprint, node: SemanticNode): number {
  let score = 0;
  let weight = 0;

  if (fp.name !== undefined) {
    weight += 3;
    const exact = norm(fp.name) === norm(node.name);
    score += exact ? 3 : 3 * tokenOverlap(fp.name, node.name);
  }
  if (fp.role !== undefined) {
    weight += 1.5;
    if (fp.role === node.role) score += 1.5;
  }
  if (fp.tag !== undefined) {
    weight += 0.5;
    if (fp.tag === node.tag) score += 0.5;
  }
  if (fp.componentType !== undefined) {
    weight += 1;
    if (fp.componentType === node.componentType) score += 1;
  }
  if (fp.attrs) {
    for (const [k, v] of Object.entries(fp.attrs)) {
      // strong identity signals
      const w = k === 'id' || k === 'name' || k === 'data-testid' ? 2.5 : 1;
      weight += w;
      if (node.attrs[k] !== undefined && norm(node.attrs[k]) === norm(v)) score += w;
      else if (node.attrs[k] !== undefined && tokenOverlap(node.attrs[k], v) > 0.5) score += w * 0.6;
    }
  }
  if (fp.path !== undefined) {
    weight += 1;
    score += pathSimilarity(fp.path, node.path);
  }
  if (fp.anchors && fp.anchors.length) {
    weight += 1;
    const best = Math.max(0, ...node.anchors.map(a => Math.max(...fp.anchors!.map(f => tokenOverlap(a, f)))));
    score += best;
  }
  if (fp.framePath !== undefined) {
    weight += 0.5;
    if (fp.framePath === node.framePath) score += 0.5;
  }

  if (weight === 0) return 0;
  return score / weight;
}

export function groundFingerprint(fp: SemanticFingerprint, snapshot: PageSnapshot): GroundingResult {
  const byId = new Map(snapshot.nodes.map(n => [n.id, n]));
  const scored = snapshot.nodes
    .map(node => ({ nodeId: node.id, score: Math.round(scoreNode(fp, node) * 1000) / 1000, name: node.name }))
    // Tie-break toward the more interactive node so a <label> never shadows its own
    // input when both share the accessible name.
    .sort((a, b) => b.score - a.score || (byId.get(b.nodeId)?.interactive ?? 0) - (byId.get(a.nodeId)?.interactive ?? 0));

  const top = scored[0];
  const second = scored[1];
  // require a minimum confidence and separation from runner-up to avoid ambiguous matches
  const confident = !!top && top.score >= 0.5 && (!second || top.score - second.score >= 0.03 || top.score >= 0.85);

  return {
    nodeId: confident ? top.nodeId : top && top.score >= 0.62 ? top.nodeId : null,
    confidence: top?.score ?? 0,
    candidates: scored.slice(0, 5),
  };
}
