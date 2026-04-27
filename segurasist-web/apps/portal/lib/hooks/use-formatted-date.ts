/**
 * Helpers de formato de fechas en español MX.
 *
 * Centralizados aquí para que las páginas del portal no repitan el patrón
 * `format(parseISO(iso), "...", { locale: es })` y para que el cambio de
 * locale (si llegara) sea un solo lugar.
 *
 * Por qué no es un hook (sin `use`): las funciones son puras y no requieren
 * acceso a contexto React. Mantienen el sufijo `use-formatted-date` solo por
 * convención del directorio `lib/hooks` (compatibilidad con el resto del
 * proyecto), pero exportan funciones planas — testeables en isolation.
 */

import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

/**
 * Formato largo: "5 de marzo de 2027". Usado en hero card de vigencia y
 * en subtitle de certificado.
 */
export function formatLongDate(iso: string): string {
  return format(parseISO(iso), "d 'de' MMMM 'de' yyyy", { locale: es });
}

/**
 * Formato corto: "5 mar 2027". Para listas densas.
 */
export function formatShortDate(iso: string): string {
  return format(parseISO(iso), "d 'de' MMM yyyy", { locale: es });
}

/**
 * Distancia humana: "hace 3 días", "hace 2 meses". Usado en `lastUsedAt`
 * de coberturas. `addSuffix: true` añade el "hace" automáticamente.
 */
export function formatRelativeDate(iso: string): string {
  return formatDistanceToNow(parseISO(iso), { locale: es, addSuffix: true });
}
