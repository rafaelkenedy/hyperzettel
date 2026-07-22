/** Peças pequenas e repetidas do painel do mapa. */

import { FOLDER_LABELS, type FolderId } from "@/domain/notes";
import type { RetentionLevel } from "../model/retention";
import { LEVEL_LABEL } from "../lib/format";
import { PALETTE } from "../lib/graphRenderer";

export function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border-primary bg-background-secondary px-3 py-2">
      <p className="text-2xs leading-tight text-text-secondary">{label}</p>
      <p className="mt-0.5 text-lg font-bold leading-none tabular-nums">{value}</p>
    </div>
  );
}

export function PanelLabel({ children }: { children: string }) {
  return (
    <p className="mb-1.5 mt-4 text-2xs font-medium uppercase tracking-[0.08em] text-text-secondary first:mt-0">
      {children}
    </p>
  );
}

/**
 * Legenda das cores e traços do grafo.
 *
 * Puxa os valores direto da paleta do renderizador: sem isso a legenda e o
 * desenho divergiriam na primeira vez que alguém mudasse uma cor.
 */
export function Legend() {
  const folders = Object.keys(FOLDER_LABELS) as FolderId[];
  const levels: RetentionLevel[] = ["strong", "medium", "weak"];
  const dash: Record<RetentionLevel, string | undefined> = {
    strong: undefined,
    medium: "6 4",
    weak: "0.1 4"
  };

  return (
    <>
      <PanelLabel>Pastas</PanelLabel>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {folders.map((folder) => (
          <li key={folder} className="flex items-center gap-1.5 text-2xs text-text-tertiary">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ background: PALETTE.nodes[folder] ?? PALETTE.nodeDefault }}
            />
            <span className="truncate">{FOLDER_LABELS[folder]}</span>
          </li>
        ))}
      </ul>

      <PanelLabel>Força da conexão</PanelLabel>
      <ul className="flex flex-col gap-1">
        {levels.map((level) => (
          <li key={level} className="flex items-center gap-2 text-2xs text-text-tertiary">
            <svg width="26" height="6" aria-hidden className="shrink-0">
              <line
                x1="0"
                y1="3"
                x2="26"
                y2="3"
                stroke={PALETTE.edges[level]}
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={dash[level]}
              />
            </svg>
            {LEVEL_LABEL[level]}
          </li>
        ))}
      </ul>
    </>
  );
}
