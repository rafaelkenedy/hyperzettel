/** Uma resposta possível a uma pergunta do fluxo. */

import { cn } from "@relume_io/relume-ui";
import type { LucideIcon } from "lucide-react";

export type ChoiceTone = "neutral" | "primary" | "danger";

const CARD_TONE: Record<ChoiceTone, string> = {
  primary: "border-hz-accent/40 bg-[#f4f6fd] hover:bg-[#e9edfa]",
  danger:
    "border-border-primary bg-background-primary hover:border-system-error-red/40 hover:bg-[#fdeef1]",
  neutral:
    "border-border-primary bg-background-primary hover:border-hz-accent/40 hover:bg-background-secondary"
};

const ICON_TONE: Record<ChoiceTone, string> = {
  primary: "bg-[#e9eefb] text-[#2f5aa8]",
  danger: "bg-[#fdeaee] text-[#a3324c]",
  neutral: "bg-background-tertiary text-text-secondary"
};

export function Choice({
  icon: Icon,
  title,
  hint,
  tone = "neutral",
  onClick
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  tone?: ChoiceTone;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
        CARD_TONE[tone]
      )}
    >
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", ICON_TONE[tone])}>
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold leading-snug">{title}</span>
        <span className="mt-0.5 block text-2xs leading-snug text-text-tertiary">{hint}</span>
      </span>
    </button>
  );
}
