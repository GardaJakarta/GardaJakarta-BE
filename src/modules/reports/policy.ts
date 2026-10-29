import type { IncidentReport, ReportStatus, UserRole } from "@prisma/client";

export type Viewer = { id: string; role: UserRole; policeUnitId: string | null };
export const transitions: Record<ReportStatus, ReportStatus[]> = {
  PENDING: ["VERIFIED", "CLARIFICATION", "REJECTED"],
  VERIFIED: ["IN_PROGRESS", "CLARIFICATION", "REJECTED"],
  IN_PROGRESS: ["RESOLVED", "CLARIFICATION"],
  CLARIFICATION: ["VERIFIED", "IN_PROGRESS", "REJECTED"],
  RESOLVED: [], REJECTED: [],
};
export function canManage(report: Pick<IncidentReport, "policeUnitId">, viewer: Viewer | null) {
  return viewer?.role === "POLISI" && Boolean(viewer.policeUnitId) && report.policeUnitId === viewer.policeUnitId;
}
export function canReadPrivate(report: Pick<IncidentReport, "reporterId" | "policeUnitId">, viewer: Viewer | null) {
  return Boolean(viewer && (viewer.id === report.reporterId || viewer.role === "ADMIN" || canManage(report, viewer)));
}
export function canRead(report: Pick<IncidentReport, "reporterId" | "policeUnitId" | "status">, viewer: Viewer | null) {
  return report.status !== "REJECTED" || canReadPrivate(report, viewer);
}
