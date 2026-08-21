import relume from "@relume_io/relume-tailwind";

/**
 * O preset do Relume entrega tipografia, espaçamento e sombras.
 * Aqui apenas re-tintamos os tokens semânticos dele (border-primary,
 * background-secondary, text-secondary...) para a paleta clara e quente
 * do Hyperzettel. Assim todo componente Relume já nasce no visual certo,
 * sem precisar sobrescrever classe por classe.
 */
export default {
  presets: [relume],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@relume_io/relume-ui/dist/**/*.{js,mjs}"
  ],
  /**
   * O preset declara `container.screens` em porcentagem, o que gera
   * `@media (min-width: 100%)` e quebra a minificação de CSS. O shell usa
   * layout de painéis, nunca `.container`, então o plugin sai fora.
   */
  corePlugins: {
    container: false
  },
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: "#ffffff",
          primary: "#ffffff",
          secondary: "#f6f6f4",
          tertiary: "#efeeeb",
          alternative: "#1c1b19"
        },
        border: {
          DEFAULT: "#e6e5e1",
          primary: "#e6e5e1",
          secondary: "#efeeeb",
          tertiary: "#d5d3ce",
          alternative: "#ffffff"
        },
        text: {
          DEFAULT: "#1c1b19",
          primary: "#1c1b19",
          // Ambos mantêm contraste AA até sobre `background-tertiary`.
          secondary: "#625f5a",
          tertiary: "#6f6c66",
          alternative: "#ffffff"
        },
        link: {
          DEFAULT: "#2f6fd0",
          primary: "#2f6fd0",
          secondary: "#6b6862"
        },
        // Paleta própria do app: acentos de seleção, relações e tipos.
        hz: {
          canvas: "#ffffff",
          rail: "#f7f7f5",
          hover: "#eeede9",
          "nav-active": "#e5e3de",
          "nav-active-bar": "#34312d",
          active: "#e8f4ec",
          "active-bar": "#3fa06a",
          accent: "#2f6fd0",
          relation: "#efecfd",
          "relation-ink": "#6a4fd0",
          "kind-fleeting": "#f1f0ec",
          "kind-fleeting-ink": "#57534e",
          "kind-fleeting-ring": "#d9d6ce",
          "kind-source": "#eaf2ff",
          "kind-source-ink": "#315f9d",
          "kind-source-ring": "#cadcf5",
          "kind-permanent": "#e6f3ec",
          "kind-permanent-ink": "#2d6b4f",
          "kind-permanent-ring": "#c5e1d1",
          "kind-structure": "#efecfd",
          "kind-structure-ink": "#654fc4",
          "kind-structure-ring": "#d8d0f5",
          "kind-reference": "#e7f3f5",
          "kind-reference-ink": "#276a72",
          "kind-reference-ring": "#c5e0e4",
          "chip-ink": "#6b6862",
          draft: "#8a5a12",
          // Destaque do editor: mantém contraste AA com `text-primary`.
          highlight: "#fbeaa6",
          // Bloco de código: painel escuro, como um visualizador de código.
          // O par tem contraste ~13:1.
          code: "#1f1e1b",
          "code-ink": "#eceae5"
        }
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "sans-serif"
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"]
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1.45" }]
      },
      boxShadow: {
        panel: "0 1px 2px rgba(28, 27, 25, 0.04)",
        pop: "0 12px 32px -8px rgba(28, 27, 25, 0.18)"
      }
    }
  }
};
