import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge de classes Tailwind no padrão shadcn: `clsx` resolve condicionais e
 * `tailwind-merge` desconflita utilitários que colidem (ex: dois `px-*`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
