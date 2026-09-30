/**
 * Fuzzy match for the Stories search box. Every whitespace-separated query
 * word must appear in the haystack either as a substring or as an ordered
 * subsequence of characters ("impl chld" finds "Implementation child").
 * Both sides are expected lowercased.
 */
export function fuzzyMatches(haystack: string, query: string): boolean {
  return query.split(/\s+/).filter(Boolean).every(
    (word) => haystack.includes(word) || isSubsequence(haystack, word),
  );
}

// ponytail: ordered subsequence only, no typo/transposition tolerance or
// ranking; swap in a scored matcher (e.g. fzf-style) if users ask for it.
function isSubsequence(haystack: string, word: string): boolean {
  let at = 0;
  for (const char of word) {
    at = haystack.indexOf(char, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}
