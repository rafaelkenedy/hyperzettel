import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // `@/` evita caminhos relativos profundos e mantém os imports estáveis
    // quando um arquivo muda de pasta.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
