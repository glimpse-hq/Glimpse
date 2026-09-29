// Splits text into words and whitespace keyed by character offset. Words not
// in `previousKeys` get a staggered delay so a burst of new words reveals in
// order instead of all at once.
interface ExpandedTextSegment {
  key: number;
  text: string;
  isWhitespace: boolean;
  delay: number;
}

const WORD_SPREAD_WINDOW_S = 0.5;
const WORD_STAGGER_MIN_S = 0.03;
const WORD_STAGGER_MAX_S = 0.12;

export function getExpandedTextSegments(
  text: string,
  previousKeys: Set<number>,
): ExpandedTextSegment[] {
  let offset = 0;

  const segments = text
    .split(/(\s+)/)
    .filter((segment) => segment !== "")
    .map((segment) => {
      const key = offset;
      offset += segment.length;
      const isWhitespace = /^\s+$/.test(segment);
      return {
        key,
        text: segment,
        isWhitespace,
        isNew: !isWhitespace && !previousKeys.has(key),
      };
    });

  const newWordCount = segments.filter((s) => s.isNew).length;
  const stagger = Math.min(
    Math.max(WORD_SPREAD_WINDOW_S / newWordCount, WORD_STAGGER_MIN_S),
    WORD_STAGGER_MAX_S,
  );

  let newWordIndex = 0;
  return segments.map(({ key, text: segText, isWhitespace, isNew }) => ({
    key,
    text: segText,
    isWhitespace,
    delay: isNew ? newWordIndex++ * stagger : 0,
  }));
}
