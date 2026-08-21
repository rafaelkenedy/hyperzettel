/**
 * @vitest-environment jsdom
 *
 * O campo de motivo é editado no painel enquanto o valor que chega de volta
 * já passou pela normalização do domínio. Estes testes travam a fronteira
 * entre "o que a pessoa digitou" e "o que o store guarda".
 */

import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { createNoteRecord, normalizeConnections, type Relation } from "@/domain/notes";
import { RelationRow } from "./RelationRow";

const outra = createNoteRecord({ id: "b", title: "Outra nota" });

function makeRelation(reason: string): Relation {
  return { note: outra, direction: "outgoing", reason, incomingReason: "" };
}

/** Reproduz o caminho real: o que sai do input volta normalizado pelo domínio. */
function Harness({ onStore }: { onStore?: (value: string) => void } = {}) {
  const [stored, setStored] = useState("");
  const normalized = normalizeConnections([{ id: "b", reason: stored }])[0]?.reason ?? "";

  return (
    <RelationRow
      relation={makeRelation(normalized)}
      onOpen={() => {}}
      onRemove={() => {}}
      onReason={(value) => {
        setStored(value);
        onStore?.(value);
      }}
    />
  );
}

// Sem arquivo de setup global, a limpeza entre testes é explícita.
afterEach(cleanup);

const valorDoCampo = () =>
  (screen.getByLabelText("Motivo da conexão com Outra nota") as HTMLInputElement).value;

describe("RelationRow", () => {
  /** Uma tecla por vez: é a digitação real que o valor normalizado atropelava. */
  function digitar(campo: HTMLElement, texto: string) {
    let acumulado = "";
    for (const tecla of texto) {
      acumulado += tecla;
      fireEvent.change(campo, { target: { value: acumulado } });
    }
  }

  test("permite digitar espaço no meio do motivo", () => {
    render(<Harness />);
    const campo = screen.getByLabelText("Motivo da conexão com Outra nota");

    digitar(campo, "porque explica a causa");

    expect(valorDoCampo()).toBe("porque explica a causa");
  });

  test("o espaço final sobrevive enquanto a pessoa digita", () => {
    const onStore = vi.fn();
    render(<Harness onStore={onStore} />);
    const campo = screen.getByLabelText("Motivo da conexão com Outra nota");

    digitar(campo, "porque ");

    // O store recebe o texto cru; aparar é decisão da persistência, não da digitação.
    expect(valorDoCampo()).toBe("porque ");
    expect(onStore).toHaveBeenLastCalledWith("porque ");
  });

  test("um valor externo diferente substitui o que está no campo", () => {
    const { rerender } = render(
      <RelationRow
        relation={makeRelation("motivo antigo")}
        onOpen={() => {}}
        onRemove={() => {}}
        onReason={() => {}}
      />
    );

    rerender(
      <RelationRow
        relation={makeRelation("veio do vault")}
        onOpen={() => {}}
        onRemove={() => {}}
        onReason={() => {}}
      />
    );

    expect(valorDoCampo()).toBe("veio do vault");
  });
});
