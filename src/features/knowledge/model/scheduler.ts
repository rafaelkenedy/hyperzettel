/**
 * Algoritmo SM-2, de Piotr Woźniak (SuperMemo, 1987).
 *
 * Cada item guarda um fator de facilidade, quantas repetições bem-sucedidas
 * acumulou e o intervalo atual em dias. A cada revisão a pessoa avalia a
 * qualidade da lembrança de 0 a 5; o fator é ajustado e o próximo intervalo
 * sai do anterior multiplicado por ele.
 *
 * A linhagem é: Ebbinghaus (1885) mostra que o esquecimento é exponencial,
 * Mace (1932) propõe intervalos crescentes, Leitner (1972) transforma isso em
 * caixas e o SM-2 fecha a conta em software.
 *
 * Substitui os multiplicadores fixos que existiam antes aqui, que não vinham
 * de lugar nenhum.
 */

export const SM2 = Object.freeze({
  initialEase: 2.5,
  minEase: 1.3,
  /** Primeiras duas repetições são fixas no algoritmo original. */
  firstInterval: 1,
  secondInterval: 6,
  /** Abaixo disto a lembrança falhou e o item recomeça. */
  passingQuality: 3,
  maxInterval: 3650
});

/** 0 a 5, como no artigo original. A interface expõe quatro delas. */
export type Quality = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * As quatro respostas oferecidas, e o que cada uma significa aqui.
 *
 * A pergunta não é "lembrei do cartão", e sim se a ideia foi reconstruída —
 * o mesmo filtro que o método usa para promover uma nota a permanente.
 */
export const REVIEW_QUALITIES: Quality[] = [1, 3, 4, 5];

export const QUALITY_LABELS: Record<number, { label: string; hint: string }> = {
  1: { label: "Não lembrei", hint: "A ideia não veio. Recomeça a escada." },
  3: { label: "Com esforço", hint: "Reconstruí, mas custou." },
  4: { label: "Lembrei bem", hint: "Veio sem tropeços." },
  5: { label: "Imediato", hint: "Estava na ponta da língua." }
};

export interface ScheduleState {
  easeFactor: number;
  repetitions: number;
  intervalDays: number;
}

export function initialSchedule(intervalDays: number): ScheduleState {
  return {
    easeFactor: SM2.initialEase,
    repetitions: 0,
    intervalDays
  };
}

/**
 * Ajuste do fator de facilidade do SM-2:
 * `EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))`
 *
 * Qualidade 4 mantém o fator, 5 aumenta e abaixo disso reduz, com piso em 1.3
 * para nenhum item entrar em colapso de intervalo.
 */
export function nextEaseFactor(easeFactor: number, quality: Quality): number {
  const gap = 5 - quality;
  const adjusted = easeFactor + (0.1 - gap * (0.08 + gap * 0.02));
  return Math.max(SM2.minEase, Number(adjusted.toFixed(4)));
}

/**
 * Aplica uma revisão e devolve o novo estado.
 *
 * Falhar não zera o fator de facilidade, só as repetições: o item volta ao
 * início da escada de intervalos mas continua carregando o quanto ele é
 * difícil para esta pessoa.
 */
export function schedule(state: ScheduleState, quality: Quality): ScheduleState {
  const easeFactor = nextEaseFactor(state.easeFactor, quality);

  if (quality < SM2.passingQuality) {
    return { easeFactor, repetitions: 0, intervalDays: SM2.firstInterval };
  }

  const repetitions = state.repetitions + 1;
  const intervalDays =
    repetitions === 1
      ? SM2.firstInterval
      : repetitions === 2
        ? SM2.secondInterval
        : Math.round(state.intervalDays * easeFactor);

  return {
    easeFactor,
    repetitions,
    intervalDays: Math.min(SM2.maxInterval, Math.max(1, intervalDays))
  };
}

/** Prévia dos intervalos de cada resposta, para a interface mostrar o custo. */
export function previewIntervals(
  state: ScheduleState,
  qualities: Quality[]
): Record<number, number> {
  return Object.fromEntries(
    qualities.map((quality) => [quality, schedule(state, quality).intervalDays])
  );
}

export function dueDate(lastReviewedAt: string, intervalDays: number): string {
  return new Date(Date.parse(lastReviewedAt) + intervalDays * 86_400_000).toISOString();
}
