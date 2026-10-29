ALTER TABLE "ReportEvidence" ADD COLUMN "commentId" TEXT;
CREATE INDEX "ReportEvidence_commentId_idx" ON "ReportEvidence"("commentId");
ALTER TABLE "ReportEvidence" ADD CONSTRAINT "ReportEvidence_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "ReportComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
