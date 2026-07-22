import { cn } from "@relume_io/relume-ui";

import { KIND_LABELS, type NoteKind } from "@/domain/notes";
import { KIND_TONE_CLASSES } from "../kindTones";

/**
 * Cada estágio tem uma tonalidade própria, mas todos mantêm a mesma forma e
 * luminosidade para a lista não virar uma coleção de etiquetas concorrentes.
 */
export function KindBadge({
  kind,
  size = "sm",
  className
}: {
  kind: NoteKind;
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded font-medium ring-1 ring-inset",
        size === "xs" ? "px-1.5 py-0.5 text-2xs" : "px-1.5 py-0.5 text-xs",
        KIND_TONE_CLASSES[kind],
        className
      )}
      title={`Estágio: ${KIND_LABELS[kind]}`}
    >
      {KIND_LABELS[kind]}
    </span>
  );
}
