import type { SourceSegment } from './types.js';

/**
 * Map a raw-document UTF-16 offset to its clean-text UTF-16 offset, or null
 * when the position sits strictly inside annotation syntax. Segment
 * boundaries are mappable from either neighboring segment.
 */
export function rawToClean(
  map: SourceSegment[],
  raw: number,
): number | null {
  for (const s of map) {
    if (raw >= s.raw && raw <= s.raw + s.length) {
      return s.clean + (raw - s.raw);
    }
  }
  return null;
}

/**
 * Map a raw offset to clean text, snapping positions inside annotation
 * syntax to the nearest clean offset in the given direction.
 */
export function snapRawToClean(
  map: SourceSegment[],
  raw: number,
  bias: 'left' | 'right',
): number {
  const exact = rawToClean(map, raw);
  if (exact !== null) return exact;
  if (bias === 'left') {
    let best = 0;
    for (const s of map) {
      if (s.raw + s.length <= raw) best = s.clean + s.length;
    }
    return best;
  }
  for (const s of map) {
    if (s.raw >= raw) return s.clean;
  }
  const last = map[map.length - 1];
  return last ? last.clean + last.length : 0;
}

/** Map a clean-text UTF-16 offset back to its raw-document offset. Every
 * clean position lies in some segment by construction. */
export function cleanToRaw(map: SourceSegment[], clean: number): number {
  for (const s of map) {
    if (clean >= s.clean && clean <= s.clean + s.length) {
      return s.raw + (clean - s.clean);
    }
  }
  const last = map[map.length - 1];
  return last ? last.raw + last.length : 0;
}
