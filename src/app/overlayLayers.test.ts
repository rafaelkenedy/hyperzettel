/*
 * Guarda de dependência, não de componente.
 *
 * O relume-ui arrasta duas árvores de Radix: o Dialog pinava
 * `react-dismissable-layer` em 1.1.3 e o resto (menu, select, popover) em
 * 1.1.16. Como os pins são exatos, o npm não deduplicava e cada cópia
 * guardava seu próprio `originalBodyPointerEvents` em escopo de módulo, além
 * de um Set de camadas em contexto React próprio. O guard de aninhamento
 * (`layersWithOutsidePointerEventsDisabled.size === 0`) só enxergava a
 * própria cópia, então um overlay que abrisse outro de árvore diferente
 * restaurava o valor errado e deixava o <body> com `pointer-events: none` —
 * o app inteiro parava de responder a cliques.
 *
 * O `overrides` do package.json unifica a versão. Este teste falha se um
 * install futuro reintroduzir a segunda cópia, que é o jeito silencioso de
 * o bug voltar.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const RADIX_DIR = join(process.cwd(), "node_modules", "@radix-ui");

/** Primitivos cujo estado de camada precisa ser compartilhado entre overlays. */
const SHARED_LAYER_PACKAGES = [
  "react-dismissable-layer",
  "react-focus-guards"
];

function nestedCopiesOf(packageName: string): string[] {
  if (!existsSync(RADIX_DIR)) return [];

  return readdirSync(RADIX_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) =>
      existsSync(join(RADIX_DIR, entry.name, "node_modules", "@radix-ui", packageName))
    )
    .map((entry) => `@radix-ui/${entry.name}`);
}

describe("camadas de overlay do Radix", () => {
  test.each(SHARED_LAYER_PACKAGES)(
    "%s existe em uma única instância",
    (packageName) => {
      expect(
        existsSync(join(RADIX_DIR, packageName)),
        `@radix-ui/${packageName} deveria estar no topo de node_modules`
      ).toBe(true);

      /*
       * Uma cópia aninhada significa duas instâncias de módulo em runtime:
       * o estado de `pointer-events` do <body> deixa de ser coordenado.
       */
      expect(
        nestedCopiesOf(packageName),
        `cópias aninhadas de @radix-ui/${packageName} reintroduzem o travamento ` +
          `de cliques; confira o "overrides" do package.json`
      ).toEqual([]);
    }
  );
});
