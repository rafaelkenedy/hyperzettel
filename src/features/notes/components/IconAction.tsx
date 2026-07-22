/** Botão de ícone com dica, usado no cabeçalho e na barra de formatação. */

import { Tooltip, TooltipContent, TooltipTrigger, cn } from "@relume_io/relume-ui";
import type { LucideIcon } from "lucide-react";

export function IconAction({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
  tone = "default",
  statusDot
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: "default" | "danger";
  statusDot?: "draft";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          // mousedown precisa ser cancelado para não perder a seleção do editor.
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClick}
          className={cn(
            "relative grid size-8 shrink-0 place-items-center rounded-md text-text-secondary transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hz-accent focus-visible:ring-offset-1 disabled:opacity-40",
            tone === "danger"
              ? "hover:bg-[#fcebed] hover:text-[#8f2942]"
              : "hover:bg-hz-hover hover:text-text-primary",
            active && "bg-hz-hover text-text-primary"
          )}
        >
          <Icon className="size-[15px]" strokeWidth={1.75} />
          {statusDot === "draft" ? (
            <span
              aria-hidden="true"
              className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-hz-draft ring-2 ring-background-primary"
            />
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
