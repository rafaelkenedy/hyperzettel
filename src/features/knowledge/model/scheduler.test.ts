/**
 * Verificação do SM-2 contra o comportamento descrito por Woźniak.
 *
 * Roda com `npm test`.
 */

import { expect, test } from "vitest";

import { SM2, initialSchedule, nextEaseFactor, schedule } from "./scheduler";

test("as duas primeiras repetições usam intervalos fixos", () => {
  let state = initialSchedule(3);

  state = schedule(state, 4);
  expect(state.repetitions).toBe(1);
  expect(state.intervalDays, "primeira repetição vale 1 dia").toBe(1);

  state = schedule(state, 4);
  expect(state.repetitions).toBe(2);
  expect(state.intervalDays, "segunda repetição vale 6 dias").toBe(6);
});

test("a partir da terceira, o intervalo é o anterior vezes o fator", () => {
  let state = initialSchedule(3);
  state = schedule(state, 4);
  state = schedule(state, 4);

  // Qualidade 4 mantém o fator em 2.5, então 6 * 2.5 = 15.
  state = schedule(state, 4);
  expect(state.easeFactor).toBe(2.5);
  expect(state.intervalDays).toBe(15);

  // 15 * 2.5 = 37.5, arredondado para 38.
  state = schedule(state, 4);
  expect(state.intervalDays).toBe(38);
});

test("qualidade 5 aumenta o fator e 3 reduz", () => {
  expect(nextEaseFactor(2.5, 5)).toBe(2.6);
  expect(nextEaseFactor(2.5, 4)).toBe(2.5);
  expect(nextEaseFactor(2.5, 3), "qualidade 3 deve reduzir o fator").toBeLessThan(2.5);
});

test("o fator nunca cai abaixo do piso", () => {
  let ease = SM2.initialEase;
  for (let attempt = 0; attempt < 20; attempt += 1) ease = nextEaseFactor(ease, 3);
  expect(ease).toBe(SM2.minEase);
});

test("falhar reinicia as repetições mas preserva a dificuldade acumulada", () => {
  let state = initialSchedule(3);
  state = schedule(state, 4);
  state = schedule(state, 4);
  state = schedule(state, 4);
  const easeAntes = state.easeFactor;

  state = schedule(state, 1);
  expect(state.repetitions, "a escada recomeça").toBe(0);
  expect(state.intervalDays).toBe(1);
  expect(state.easeFactor < easeAntes, "o item continua carregando o quanto ele é difícil").toBe(true);
});

test("o intervalo respeita o teto", () => {
  let state = { easeFactor: 2.5, repetitions: 10, intervalDays: SM2.maxInterval };
  state = schedule(state, 5);
  expect(state.intervalDays).toBe(SM2.maxInterval);
});
