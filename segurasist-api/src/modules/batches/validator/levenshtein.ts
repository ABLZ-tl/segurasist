/**
 * Distancia de Levenshtein (edit distance) clásica con DP O(n*m).
 *
 * Para los catálogos de SegurAsist (≤50 paquetes por tenant, strings ≤60 chars)
 * esto es ampliamente suficiente — comparar 10k filas × 50 paquetes da 500k
 * comparaciones de strings cortos, < 50ms en máquinas devs.
 *
 * Si en futuro se necesita escalar a catálogos >1k entradas, considerar:
 *   - BK-tree para búsqueda top-k en O(log n).
 *   - Algoritmo Damerau-Levenshtein si los typos por transposición (`Premiun`)
 *     deben tener distancia 1 en lugar de 2 (acá nos sirve la métrica clásica
 *     porque el threshold ≤2 ya cubre transposiciones cortas).
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Usamos un único array (`prev`) y vamos rotando — O(min(n,m)) memoria.
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = prev[j]! + 1;
      const ins = curr[j - 1]! + 1;
      const sub = prev[j - 1]! + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[n]!;
}

/**
 * Devuelve los `topK` candidatos del catálogo `candidates` ordenados por
 * distancia de Levenshtein ascendente respecto a `needle`. Empates por
 * orden alfabético. Comparación case-insensitive con normalización NFD.
 *
 * @returns Array de candidatos originales (sin normalizar).
 */
export function topKByLevenshtein(needle: string, candidates: readonly string[], topK = 3): string[] {
  const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const target = norm(needle);
  const scored = candidates.map((c) => ({
    candidate: c,
    distance: levenshtein(norm(c), target),
  }));
  scored.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.candidate.localeCompare(b.candidate);
  });
  return scored.slice(0, topK).map((s) => s.candidate);
}
