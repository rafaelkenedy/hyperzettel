import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  test: {
    /*
     * O ambiente padrão é Node porque o domínio é puro — testar regra de
     * negócio não deveria exigir um DOM. Os poucos módulos que tocam o DOM
     * (sanitização, divisão por seções) pedem jsdom com um comentário
     * `@vitest-environment jsdom` no topo do arquivo.
     */
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
