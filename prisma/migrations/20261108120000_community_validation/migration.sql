-- Community validation keeps one reversible choice per voter and report.
CREATE TYPE "ReportVoteDirection" AS ENUM ('UP', 'DOWN');
ALTER TABLE "ReportVote" ADD COLUMN "direction" "ReportVoteDirection" NOT NULL DEFAULT 'UP';
CREATE INDEX "ReportVote_reportId_direction_idx" ON "ReportVote"("reportId", "direction");
