export type VoteDirection = "UP" | "DOWN";

export function communitySummary(upVoteCount: number, downVoteCount: number, voteDirection: VoteDirection | null = null) {
  const total = upVoteCount + downVoteCount;
  const communitySignal = total < 10 ? "NEUTRAL" : upVoteCount / total >= 0.8 ? "SUPPORTED" : downVoteCount / total >= 0.8 ? "QUESTIONED" : "NEUTRAL";
  return { upVoteCount, downVoteCount, voteCount: upVoteCount, communitySignal, voteDirection, hasVoted: voteDirection !== null };
}
