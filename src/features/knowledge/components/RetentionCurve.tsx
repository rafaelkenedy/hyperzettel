/**
 * Curva de retenção média ao longo do tempo, desenhada em SVG.
 *
 * Reconstrói cada ponto a partir do histórico de revisões, então o passado
 * muda quando uma revisão nova é registrada.
 */

import { useMemo } from "react";

import { useKnowledge } from "@/app/providers/KnowledgeProvider";
import { dateLabel, percent } from "../lib/format";

export type CurveRange = 30 | 90 | "all";

const BOUNDS = { left: 34, right: 300, top: 20, bottom: 130 };

export function RetentionCurve({ range }: { range: CurveRange }) {
  const knowledge = useKnowledge();
  const points = useMemo(() => knowledge.curve(range), [knowledge, range]);
  const visible = points.filter(
    (point): point is { at: string; value: number } => Number.isFinite(point.value)
  );

  if (!visible.length) {
    return (
      <p className="px-1 py-12 text-center text-xs text-text-secondary">
        Ainda não há histórico suficiente para desenhar a curva.
      </p>
    );
  }

  const coordinates = visible.map((point, index) => ({
    ...point,
    x:
      BOUNDS.left +
      (visible.length === 1 ? 0 : index / (visible.length - 1)) * (BOUNDS.right - BOUNDS.left),
    y: BOUNDS.bottom - point.value * (BOUNDS.bottom - BOUNDS.top)
  }));

  const path = coordinates
    .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
  const last = coordinates[coordinates.length - 1]!;
  const first = visible[0]!;
  const delta = last.value - first.value;
  const direction =
    Math.abs(delta) < 0.01
      ? "permaneceu estável"
      : delta > 0
        ? `subiu ${Math.round(delta * 100)} pontos`
        : `caiu ${Math.round(Math.abs(delta) * 100)} pontos`;

  return (
    <div>
      <svg
        viewBox="0 0 320 150"
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Curva de retenção"
      >
        <defs>
          <linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f6fd0" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#2f6fd0" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.5, 1].map((tick) => {
          const y = BOUNDS.bottom - tick * (BOUNDS.bottom - BOUNDS.top);
          return (
            <g key={tick}>
              <line
                x1={BOUNDS.left}
                y1={y}
                x2={BOUNDS.right}
                y2={y}
                stroke="#e6e5e1"
                strokeWidth="1"
              />
              <text x={6} y={y + 3} fontSize="8" fill="#8a8781">
                {Math.round(tick * 100)}%
              </text>
            </g>
          );
        })}

        <path
          d={`${path} L${BOUNDS.right},${BOUNDS.bottom} L${BOUNDS.left},${BOUNDS.bottom} Z`}
          fill="url(#curve-fill)"
        />
        <path d={path} fill="none" stroke="#2f6fd0" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx={last.x} cy={last.y} r="3.2" fill="#2f6fd0" />

        <text x={BOUNDS.left} y={146} fontSize="8" fill="#8a8781">
          {dateLabel(first.at)}
        </text>
        <text x={BOUNDS.right} y={146} fontSize="8" fill="#8a8781" textAnchor="end">
          {dateLabel(last.at)}
        </text>
      </svg>

      <p className="mt-2 text-2xs leading-relaxed text-text-tertiary">
        O índice atual é <strong className="font-semibold">{percent(last.value)}</strong> e{" "}
        {direction} no período. É uma estimativa baseada em datas e revisões, não uma medição
        clínica da memória.
      </p>
    </div>
  );
}
