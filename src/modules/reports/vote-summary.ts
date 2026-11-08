import { prisma } from "../../prisma.js";
import { communitySummary } from "./community.js";

export async function withVoteSummaries<T extends { id: string }>(reports: T[]) {
  const counts = reports.length ? await prisma.reportVote.groupBy({ by: ["reportId", "direction"], where: { reportId: { in: reports.map(({ id }) => id) } }, orderBy: [{ direction: "asc" }], _count: { _all: true } }) : [];
  const totals = new Map<string, { UP: number; DOWN: number }>();
  for (const count of counts) {
    const row = totals.get(count.reportId) ?? { UP: 0, DOWN: 0 };
    row[count.direction] = count._count._all;
    totals.set(count.reportId, row);
  }
  return reports.map((report) => ({ ...report, community: communitySummary(totals.get(report.id)?.UP ?? 0, totals.get(report.id)?.DOWN ?? 0) }));
}

export async function getVoteSummary(reportId: string, voterId?: string) {
  const [counts, vote] = await prisma.$transaction([
    prisma.reportVote.groupBy({ by: ["direction"], where: { reportId }, orderBy: [{ direction: "asc" }], _count: { _all: true } }),
    prisma.reportVote.findFirst({ where: { reportId, voterId: voterId ?? "" }, select: { direction: true } }),
  ]);
  return communitySummary(counts.find((row) => row.direction === "UP")?._count._all ?? 0, counts.find((row) => row.direction === "DOWN")?._count._all ?? 0, vote?.direction ?? null);
}
