export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** Return the smallest single replacement that transforms before into after. */
export function minimalTextChange(before: string, after: string): TextChange | null {
  if (before === after) return null;
  const maxPrefix = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix++;

  const maxSuffix = Math.min(before.length - prefix, after.length - prefix);
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }

  return {
    from: prefix,
    to: before.length - suffix,
    insert: after.slice(prefix, after.length - suffix),
  };
}
