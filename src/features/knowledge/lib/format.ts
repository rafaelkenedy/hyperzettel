/** Formatações compartilhadas pelas telas de conhecimento. */

import type { RetentionLevel } from "../model/retention";

export const LEVEL_TONE: Record<RetentionLevel, string> = {
  strong: "bg-[#e3f5ec] text-[#1c6b45]",
  medium: "bg-[#e9eefb] text-[#2f5aa8]",
  weak: "bg-[#fdeaee] text-[#a3324c]"
};

export const LEVEL_LABEL: Record<RetentionLevel, string> = {
  strong: "Forte",
  medium: "Média",
  weak: "Fraca"
};

export function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(
    new Date(value)
  );
}

/** Resumo curto do vencimento, para caber numa linha de lista. */
export function dueSummary(dueAt: string | null): string {
  if (!dueAt) return "Nunca revisada";
  const days = Math.round((Date.parse(dueAt) - Date.now()) / 86_400_000);
  if (days < 0) return `Atrasada ${Math.abs(days)}d`;
  if (days === 0) return "Vence hoje";
  return `Em ${days}d`;
}

/** Versão longa, para o painel de propriedades. */
export function dueLabel(dueAt: string | null): string {
  if (!dueAt) return "Nunca revisada.";
  const days = Math.round((Date.parse(dueAt) - Date.now()) / 86_400_000);
  if (days < 0) return `Atrasada ${Math.abs(days)} ${Math.abs(days) === 1 ? "dia" : "dias"}.`;
  if (days === 0) return "Vence hoje.";
  return `Próxima revisão em ${days} ${days === 1 ? "dia" : "dias"}.`;
}

export function formatInterval(days: number): string {
  if (days < 1) return "hoje";
  if (days === 1) return "1 dia";
  if (days < 30) return `${Math.round(days)} dias`;
  if (days < 365) return `${Math.round(days / 30)} meses`;
  return `${(days / 365).toFixed(1)} anos`;
}
