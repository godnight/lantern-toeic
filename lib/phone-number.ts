export const PHONE_NORMALIZATION_VERSION = 1 as const;

export type MainlandPhoneResult =
  | { ok: true; phone: string; version: typeof PHONE_NORMALIZATION_VERSION }
  | { ok: false; error: 'unsupported-country' | 'invalid-phone' };

/**
 * Format normalization only; this never establishes ownership or authenticates.
 * v1 supports mainland +86 exclusively. It deliberately has no carrier-prefix
 * whitelist, which would go stale and is not proof that a number is assigned.
 */
export function parseMainlandPhone(input: unknown): MainlandPhoneResult {
  if (typeof input !== 'string' || input.length > 64 || /[^+0-9 -]/.test(input)) {
    return { ok: false, error: 'invalid-phone' };
  }
  // Only ASCII spaces may be trimmed; Unicode digits/whitespace are not coerced.
  const source = input.replace(/^ +| +$/g, '');
  if (source.startsWith('+') && !source.startsWith('+86')) {
    return { ok: false, error: 'unsupported-country' };
  }
  // The +86 prefix stays intact. Separators are allowed only between digits or
  // after that prefix, never as a way to swallow another international code.
  if (!/^(?:\+86[ -]*)?1(?:[ -]*[0-9]){10}$/.test(source)) {
    return { ok: false, error: 'invalid-phone' };
  }
  const digits = source.replace(/[ -]/g, '').replace(/^\+86/, '');
  return { ok: true, phone: `+86${digits}`, version: PHONE_NORMALIZATION_VERSION };
}
