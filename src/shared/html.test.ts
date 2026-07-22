/**
 * @vitest-environment jsdom
 *
 * Sanitização e leitura do HTML das notas.
 *
 * É a única fronteira do app onde um defeito é perigoso: o conteúdo volta
 * para a tela por `dangerouslySetInnerHTML`, então o que a allowlist deixar
 * passar será executado.
 */

import { describe, expect, test } from "vitest";

import {
  countWords,
  formatSize,
  sanitizeNoteContent,
  splitByHeadings,
  toPlainText
} from "./html";

describe("sanitizeNoteContent", () => {
  test("remove script inteiro, inclusive o conteúdo", () => {
    const result = sanitizeNoteContent('<p>ok</p><script>alert("x")</script>');

    expect(result).toBe("<p>ok</p>");
    expect(result).not.toContain("alert");
  });

  test("remove iframe, object, embed, style, meta e link", () => {
    const result = sanitizeNoteContent(
      '<iframe src="x"></iframe><object></object><embed><style>p{}</style><meta><link>'
    );

    expect(result).toBe("");
  });

  test("alcança script escondido dentro de tag desconhecida", () => {
    const result = sanitizeNoteContent("<custom-tag><script>roubar()</script>texto</custom-tag>");

    expect(result).not.toContain("script");
    expect(result).not.toContain("roubar");
    expect(result).toContain("texto");
  });

  test("desembrulha tag fora da allowlist preservando o conteúdo", () => {
    expect(sanitizeNoteContent("<marquee><b>importante</b></marquee>")).toBe("<b>importante</b>");
  });

  test("descarta manipuladores de evento", () => {
    const result = sanitizeNoteContent('<p onclick="roubar()" onerror="x">texto</p>');

    expect(result).toBe("<p>texto</p>");
    expect(result).not.toContain("onclick");
  });

  test("descarta atributos de estilo e classe", () => {
    expect(sanitizeNoteContent('<p class="a" style="color:red" id="b">t</p>')).toBe("<p>t</p>");
  });

  describe("links", () => {
    test("mantém esquemas seguros", () => {
      for (const href of ["https://exemplo.com", "http://exemplo.com", "mailto:a@b.c", "tel:+55", "#secao"]) {
        expect(sanitizeNoteContent(`<a href="${href}">l</a>`)).toContain(`href="${href}"`);
      }
    });

    test("remove href com javascript: e data:", () => {
      expect(sanitizeNoteContent('<a href="javascript:alert(1)">l</a>')).toBe("<a>l</a>");
      expect(sanitizeNoteContent('<a href="data:text/html,<script>">l</a>')).not.toContain("href");
    });

    test("target _blank ganha rel de segurança", () => {
      const result = sanitizeNoteContent('<a href="https://x.com" target="_blank">l</a>');

      expect(result).toContain('rel="noopener noreferrer"');
    });
  });

  describe("imagens", () => {
    test("remove o src e mantém apenas a referência ao asset", () => {
      const result = sanitizeNoteContent(
        '<img src="https://externo/x.png" data-image-id="img-1" alt="foto">'
      );

      expect(result).not.toContain("src");
      expect(result).toContain('data-image-id="img-1"');
      expect(result).toContain('alt="foto"');
    });

    test("descarta imagem sem asset local", () => {
      expect(sanitizeNoteContent('<img src="https://externo/x.png">')).toBe("");
    });
  });

  test("aceita valores que não são string", () => {
    expect(sanitizeNoteContent(null)).toBe("");
    expect(sanitizeNoteContent(42)).toBe("");
  });
});

describe("toPlainText", () => {
  test("separa blocos com espaço em vez de colar as palavras", () => {
    expect(toPlainText("<p>um</p><p>dois</p>")).toBe("um dois");
  });

  test("colapsa espaços em excesso", () => {
    expect(toPlainText("<p>  muito    espaço </p>")).toBe("muito espaço");
  });

  test("string vazia devolve vazio", () => {
    expect(toPlainText("")).toBe("");
  });
});

describe("countWords e formatSize", () => {
  test("conta palavras do texto visível", () => {
    expect(countWords("<h2>Uma ideia</h2><p>com três palavras</p>")).toBe(5);
  });

  test("nota vazia tem zero palavras", () => {
    expect(countWords("<p></p>")).toBe(0);
  });

  test("formata bytes e kilobytes", () => {
    expect(formatSize("abc")).toBe("3 B");
    expect(formatSize("x".repeat(2048))).toBe("2.0 KB");
  });
});

describe("splitByHeadings", () => {
  const conteudo =
    "<p>preâmbulo</p><h2>Primeira</h2><p>corpo um</p><h2>Segunda</h2><ul><li>corpo dois</li></ul>";

  test("divide nas seções de nível H2", () => {
    const sections = splitByHeadings(conteudo);

    expect(sections.map((section) => section.title)).toEqual(["Primeira", "Segunda"]);
  });

  test("o texto antes do primeiro título não vira seção", () => {
    const sections = splitByHeadings(conteudo);

    expect(sections.some((section) => section.html.includes("preâmbulo"))).toBe(false);
  });

  test("cada seção leva o próprio corpo", () => {
    const [primeira, segunda] = splitByHeadings(conteudo);

    expect(primeira!.html).toContain("corpo um");
    expect(segunda!.html).toContain("corpo dois");
    expect(primeira!.html).not.toContain("corpo dois");
  });

  test("descarta seção sem corpo", () => {
    const sections = splitByHeadings("<h2>Só o título</h2><h2>Com corpo</h2><p>texto</p>");

    expect(sections.map((section) => section.title)).toEqual(["Com corpo"]);
  });

  test("nota de uma ideia só não produz divisão", () => {
    expect(splitByHeadings("<p>uma ideia sem títulos</p>")).toEqual([]);
  });
});
