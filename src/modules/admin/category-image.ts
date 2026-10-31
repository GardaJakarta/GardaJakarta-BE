import type { ReportCategory } from "@prisma/client";

export function categoryJson(category: ReportCategory) {
  const { imageKey, ...item } = category;
  return { ...item, imageUrl: imageKey ? `/api/public/categories/${item.id}/image?v=${item.updatedAt.getTime()}` : null };
}
