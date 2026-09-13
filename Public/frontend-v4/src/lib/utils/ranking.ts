/**
 * Competition ("standard") ranking.
 *
 * Given items already SORTED by amount descending, assign ranks where equal
 * amounts share a rank and the next distinct amount skips positions — i.e.
 * 1, 1, 3, 4, 4, 6, ... (NOT dense 1,2,3). Only ranks 1..maxTopRank are
 * considered "Top N" and get the special visual treatment; everyone else has
 * no rank number, no medal, no badge.
 *
 * This is pure and deterministic so it can be unit-tested and re-runs
 * automatically whenever the underlying contribution data changes.
 */

export const TOP_RANK_LIMIT = 5;

export interface Ranked<T> {
  item: T;
  /** 1-based competition rank (always present, even outside the top N). */
  rank: number;
  /** True only when rank <= maxTopRank (gets crown / gold / badge). */
  isTop: boolean;
}

export function competitionRank<T>(
  sortedDesc: T[],
  getAmount: (item: T) => number,
  maxTopRank: number = TOP_RANK_LIMIT
): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  let lastAmount: number | null = null;
  let lastRank = 0;

  sortedDesc.forEach((item, index) => {
    const amount = getAmount(item);
    let rank: number;
    if (lastAmount !== null && amount === lastAmount) {
      // Tie: share the previous rank.
      rank = lastRank;
    } else {
      // New distinct amount: rank is the 1-based position (skips ties above).
      rank = index + 1;
      lastAmount = amount;
      lastRank = rank;
    }
    out.push({ item, rank, isTop: rank <= maxTopRank });
  });

  return out;
}
