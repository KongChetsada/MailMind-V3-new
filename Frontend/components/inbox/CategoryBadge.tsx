import { CATEGORY_META } from "@/lib/labels";
import type { EmailCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function CategoryBadge({ category, className }: { category: EmailCategory | null; className?: string }) {
  if (!category) return null;
  const { short, icon: Icon, badge } = CATEGORY_META[category];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-bold", badge, className)}>
      <Icon className="h-3 w-3" />
      {short}
    </span>
  );
}
