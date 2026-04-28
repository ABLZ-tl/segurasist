/**
 * S4-06 — Matching engine del chatbot KB.
 *
 * Algoritmo (puro, in-memory; sin tocar BD):
 *
 *   1) `tokenize(text)`: lowercase → strip acentos (NFD + eliminar diacríticos)
 *      → split por whitespace + signos de puntuación → filtra stop-words ES
 *      cortas y tokens ≤2 chars.
 *
 *   2) Para cada KbEntry candidate (filtrada a `enabled=true` por el caller):
 *
 *        score = matched_keywords + (synonym_hits * SYNONYM_WEIGHT)
 *
 *      donde `matched_keywords` es la cardinalidad del intersect entre
 *      tokens del mensaje y `entry.keywords` (canonicalizadas igual que el
 *      mensaje), y `synonym_hits` cuenta sinónimos del JSON `entry.synonyms`
 *      que aparecen en el mensaje (cada sinónimo cuenta 1 vez por keyword
 *      canónica, sin doble-conteo).
 *
 *   3) Si `score >= MIN_SCORE` el match es válido. Empate → mayor `priority`
 *      (mayor primero). Empate sostenido → mayor score, fallback orden de
 *      llegada.
 *
 *   4) Si nada supera el threshold devolvemos `null` y el caller (`KbService`)
 *      escala/responde fallback.
 *
 * El algoritmo NO usa similitud fuzzy de strings (Levenshtein) por costo en
 * runtime con KBs de cientos de entries por tenant. La defensa contra typos
 * la implementa el admin agregando keywords + sinónimos. Sprint 5+ podemos
 * agregar pg_trgm si UX lo amerita.
 */
import { Injectable } from '@nestjs/common';

/**
 * Threshold mínimo de score para considerar un match válido. Calibrado contra
 * el seed inicial: una pregunta del usuario con ≥1 keyword o ≥1 sinónimo
 * dispara match. Subir a 2 si vemos demasiados falsos positivos en QA.
 */
export const MIN_SCORE = 1;
/** Peso de un sinónimo respecto a una keyword directa. */
export const SYNONYM_WEIGHT = 1;

/**
 * Stop-words en español MX que NO aportan al matching. Lista breve; la
 * estrategia es no agresiva — el matcher confía en que las keywords reales
 * de la KB son distintivas y los stop-words solo agregan ruido (e.g. "el",
 * "de", "que" reaparecen en cualquier mensaje y empatarían entries).
 */
const ES_STOP_WORDS = new Set([
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'de',
  'del',
  'al',
  'a',
  'en',
  'y',
  'o',
  'u',
  'que',
  'qué',
  'mi',
  'mis',
  'tu',
  'tus',
  'su',
  'sus',
  'me',
  'te',
  'se',
  'es',
  'son',
  'fue',
  'ser',
  'esta',
  'este',
  'esto',
  'ese',
  'esa',
  'eso',
  'por',
  'para',
  'con',
  'sin',
  'lo',
  'le',
  'les',
  'no',
  'si',
  'sí',
  'como',
  'cómo',
  'cuando',
  'cuándo',
  'donde',
  'dónde',
]);

export interface KbEntryForMatcher {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string[];
  synonyms: Record<string, string[]>;
  priority: number;
  enabled: boolean;
}

export interface MatchResult {
  entry: KbEntryForMatcher;
  score: number;
  matchedKeywords: string[];
  matchedSynonyms: string[];
}

@Injectable()
export class KbMatcherService {
  /**
   * Convierte `text` a un set de tokens canónicos (lowercase, sin acentos,
   * sin stop-words, ≥3 chars). Idempotente: tokenize(tokenize(x).join(' '))
   * devuelve el mismo set.
   *
   * Exportado para que el KbService canonicalice keywords antes de comparar
   * (no asumir que el admin las escribió "limpias").
   */
  tokenize(text: string): string[] {
    if (!text) return [];
    const normalized = text
      .normalize('NFD')
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[̀-ͯ]/g, '') // strip diacríticos
      .toLowerCase();
    // Split por cualquier non-letter (espacios, puntuación, dígitos).
    const tokens = normalized.split(/[^a-zñ]+/u).filter((t) => t.length >= 3);
    return tokens.filter((t) => !ES_STOP_WORDS.has(t));
  }

  /**
   * Devuelve la mejor entry contra `message` (o null si nada llega al
   * threshold). `entries` debe venir filtrado por `enabled=true`.
   *
   * Empates resueltos por (1) priority desc, (2) score desc, (3) orden de
   * llegada en el array. Determinístico para el mismo input.
   */
  findBestMatch(message: string, entries: KbEntryForMatcher[]): MatchResult | null {
    const messageTokens = new Set(this.tokenize(message));
    if (messageTokens.size === 0) return null;

    let best: MatchResult | null = null;
    for (const entry of entries) {
      const result = this.scoreEntry(messageTokens, entry);
      if (result.score < MIN_SCORE) continue;
      if (best === null) {
        best = result;
        continue;
      }
      // Tie-break: priority desc, luego score desc, luego deja al primero.
      if (entry.priority > best.entry.priority) {
        best = result;
      } else if (entry.priority === best.entry.priority && result.score > best.score) {
        best = result;
      }
    }
    return best;
  }

  /**
   * Computa el score de una entry contra el set de tokens del mensaje.
   * Exportado para tests unit que quieran inspeccionar el detalle del match
   * sin pasar por `findBestMatch`.
   */
  scoreEntry(messageTokens: Set<string>, entry: KbEntryForMatcher): MatchResult {
    const matchedKeywords: string[] = [];
    const matchedSynonyms: string[] = [];

    for (const rawKw of entry.keywords) {
      const canonical = this.tokenize(rawKw)[0];
      if (!canonical) continue;
      if (messageTokens.has(canonical)) {
        matchedKeywords.push(canonical);
        continue;
      }
      // Sinónimos para esta keyword (clave canonicalizada con el mismo
      // pipeline para que los lookups matcheen sin importar acentos).
      const synKey = canonical;
      const syns = entry.synonyms?.[synKey] ?? entry.synonyms?.[rawKw] ?? [];
      for (const syn of syns) {
        const synCanonical = this.tokenize(syn)[0];
        if (synCanonical && messageTokens.has(synCanonical)) {
          matchedSynonyms.push(synCanonical);
          break; // un hit por keyword canónica
        }
      }
    }

    const score = matchedKeywords.length + matchedSynonyms.length * SYNONYM_WEIGHT;
    return { entry, score, matchedKeywords, matchedSynonyms };
  }
}
