// @vitest-environment jsdom
//
// Accessibility harness. This is a *smoke test* that proves the
// axe-core + Testing Library pipeline works and enforces "no serious/critical
// WCAG violations". Extend it to render real feature components as they
// stabilize (import them and run `runAxe` on the rendered container).
import { render, cleanup } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, it } from "vitest";

afterEach(cleanup);

async function runAxe(container: Element) {
  const results = await axe.run(container as unknown as HTMLElement);
  return results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );
}

it("accessible fragment has no serious/critical axe violations", async () => {
  const { container } = render(
    <main>
      <h1>Hyperzettel</h1>
      <label htmlFor="q">Buscar notas</label>
      <input id="q" name="q" />
      <button type="button">Nova nota</button>
    </main>
  );
  expect(await runAxe(container)).toEqual([]);
});
