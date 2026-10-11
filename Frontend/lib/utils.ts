import { type ClassValue } from "clsx"; 
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn helper: รวม className ให้สะอาด (รองรับ Tailwind override) */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
