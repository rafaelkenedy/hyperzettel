/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { NavigationProvider, useNavigation } from "./NavigationProvider";

function Harness() {
  const navigation = useNavigation();
  return (
    <div>
      <span data-testid="view">{navigation.view}</span>
      <span data-testid="tab">{navigation.mapTab}</span>
      <span data-testid="target">{navigation.reviewTargetId ?? ""}</span>
      <button type="button" onClick={() => navigation.setView("note")}>
        Abrir nota
      </button>
      <button type="button" onClick={() => navigation.openReview("note-42")}>
        Revisar atual
      </button>
      <button type="button" onClick={navigation.clearReviewTarget}>
        Consumir alvo
      </button>
      <button type="button" onClick={() => navigation.toggleMap()}>
        Fechar mapa
      </button>
    </div>
  );
}

afterEach(cleanup);

test("leva a nota atual ao mapa e preserva a tela de retorno", () => {
  render(
    <NavigationProvider>
      <Harness />
    </NavigationProvider>
  );

  fireEvent.click(screen.getByRole("button", { name: "Abrir nota" }));
  fireEvent.click(screen.getByRole("button", { name: "Revisar atual" }));

  expect(screen.getByTestId("view").textContent).toBe("map");
  expect(screen.getByTestId("tab").textContent).toBe("review");
  expect(screen.getByTestId("target").textContent).toBe("note-42");

  fireEvent.click(screen.getByRole("button", { name: "Consumir alvo" }));
  expect(screen.getByTestId("target").textContent).toBe("");

  fireEvent.click(screen.getByRole("button", { name: "Fechar mapa" }));
  expect(screen.getByTestId("view").textContent).toBe("note");
});
