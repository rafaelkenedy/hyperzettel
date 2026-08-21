/**
 * @vitest-environment jsdom
 *
 * Envelope do arquivo de nota: round-trip Note <-> documento HTML
 * auto-contido. É a fronteira que garante que nenhum campo se perde ao gravar
 * a nota como arquivo e ao lê-la de volta.
 */

import { describe, expect, test } from "vitest";

import { createNoteRecord, type Note } from "@/domain/notes";
import {
  adoptHtmlDocumentAsNote,
  noteFileName,
  parseHtmlDocumentToNote,
  serializeNoteToHtmlDocument
} from "./noteDocument";

function makeNote(over: Partial<Parameters<typeof createNoteRecord>[0]> = {}): Note {
  return createNoteRecord({
    id: "note-1",
    title: "Minha Ideia",
    content: "<p>corpo</p><h2>Seção</h2><p>texto</p>",
    folder: "projects",
    kind: "permanent",
    template: "concept",
    status: "saved",
    recallPrompt: "Como esta ideia funciona sem consultar a nota?",
    connections: [{ id: "note-2", reason: "porque sim" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...over
  });
}

describe("serializeNoteToHtmlDocument / parseHtmlDocumentToNote", () => {
  test("round-trip preserva todos os campos", () => {
    const parsed = parseHtmlDocumentToNote(serializeNoteToHtmlDocument(makeNote()));

    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe("note-1");
    expect(parsed!.title).toBe("Minha Ideia");
    expect(parsed!.folder).toBe("projects");
    expect(parsed!.kind).toBe("permanent");
    expect(parsed!.template).toBe("concept");
    expect(parsed!.status).toBe("saved");
    expect(parsed!.recallPrompt).toBe("Como esta ideia funciona sem consultar a nota?");
    expect(parsed!.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed!.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(parsed!.connections).toEqual([{ id: "note-2", reason: "porque sim" }]);
    expect(parsed!.content).toContain("<h2>Seção</h2>");
  });

  test("documento é auto-contido (doctype + head + style)", () => {
    const html = serializeNoteToHtmlDocument(makeNote());

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="hz:id" content="note-1">');
    expect(html).toContain(
      '<meta name="hz:recallPrompt" content="Como esta ideia funciona sem consultar a nota?">'
    );
    expect(html).toContain('<meta name="hz:connection" content="note-2|porque sim">');
    expect(html).toContain("<style>");
  });

  test("lista conexões no corpo legível sem incorporá-las ao conteúdo da nota", () => {
    const html = serializeNoteToHtmlDocument(
      makeNote({
        connections: [
          { id: "note-2", reason: "Explica <causa> & efeito." },
          { id: "note-3", reason: "" }
        ]
      })
    );
    const parsed = parseHtmlDocumentToNote(html)!;

    expect(html).toContain('<aside class="hz-connections"');
    // Sem contexto da coleção, o arquivo mostra só o que ele próprio sabe.
    expect(html).toContain("Esta nota cita");
    expect(html).toContain("note-2");
    expect(html).toContain("Explica &lt;causa&gt; &amp; efeito.");
    expect(html).toContain("note-3");
    expect(parsed.connections).toEqual([
      { id: "note-2", reason: "Explica <causa> & efeito." },
      { id: "note-3", reason: "" }
    ]);
    expect(parsed.content).not.toContain("hz-connections");
    expect(parsed.content).not.toContain("Explica");
  });

  test("renderiza backlink com âncora, título e o motivo da outra nota", () => {
    const html = serializeNoteToHtmlDocument(makeNote({ connections: [] }), [
      {
        id: "note-9",
        title: "Quem cita",
        fileName: "20260726-194530--quem-cita--note9.html",
        direction: "incoming",
        reason: "",
        incomingReason: "porque sustenta a ideia"
      }
    ]);

    expect(html).toContain("<h3>Citada por</h3>");
    expect(html).toContain(
      '<a href="20260726-194530--quem-cita--note9.html" title="note-9">Quem cita</a>'
    );
    // Dentro do grupo "Citada por" o motivo já é, por definição, o da outra.
    expect(html).toContain(
      '<p class="hz-connection-reason">porque sustenta a ideia</p>'
    );
  });

  test("agrupa por direção em vez de repetir o rótulo em cada item", () => {
    const html = serializeNoteToHtmlDocument(
      makeNote({ connections: [{ id: "note-2", reason: "" }] }),
      [
        {
          id: "note-2",
          title: "Citada A",
          fileName: "a.html",
          direction: "outgoing",
          reason: "",
          incomingReason: ""
        },
        {
          id: "note-3",
          title: "Citada B",
          fileName: "b.html",
          direction: "outgoing",
          reason: "",
          incomingReason: ""
        },
        {
          id: "note-4",
          title: "Quem cita",
          fileName: "c.html",
          direction: "incoming",
          reason: "",
          incomingReason: ""
        }
      ]
    );

    expect(html.match(/Esta nota cita/g)).toHaveLength(1);
    expect(html.match(/Citada por/g)).toHaveLength(1);
    expect(html.match(/<ul>/g)).toHaveLength(2);
    // O id sai da linha e vira o `title` da âncora.
    expect(html).not.toContain('<p class="hz-connection-id">');
    expect(html).toContain('title="note-2"');
  });

  test("só a relação mútua precisa dizer de quem é cada motivo", () => {
    const html = serializeNoteToHtmlDocument(
      makeNote({ connections: [{ id: "note-9", reason: "meu" }] }),
      [
        {
          id: "note-9",
          title: "Outra",
          fileName: "outra.html",
          direction: "mutual",
          reason: "meu",
          incomingReason: "dela"
        }
      ]
    );

    expect(html).toContain("Motivo desta nota: meu");
    expect(html).toContain("Motivo da outra nota: dela");
  });

  test("o backlink é apresentação: não vira meta nem conteúdo da nota", () => {
    const html = serializeNoteToHtmlDocument(makeNote({ connections: [] }), [
      {
        id: "note-9",
        title: "Quem cita",
        fileName: "outra.html",
        direction: "incoming",
        reason: "",
        incomingReason: "motivo alheio"
      }
    ]);
    const parsed = parseHtmlDocumentToNote(html)!;

    // A aresta continua tendo dono único: o arquivo de quem declarou a saída.
    expect(html).not.toContain('name="hz:connection"');
    expect(parsed.connections).toEqual([]);
    expect(parsed.content).not.toContain("Quem cita");
    expect(parsed.content).not.toContain("motivo alheio");
  });

  test("mostra os dois motivos de uma relação mútua", () => {
    const html = serializeNoteToHtmlDocument(
      makeNote({ connections: [{ id: "note-9", reason: "meu motivo" }] }),
      [
        {
          id: "note-9",
          title: "Outra",
          fileName: "outra.html",
          direction: "mutual",
          reason: "meu motivo",
          incomingReason: "motivo dela"
        }
      ]
    );

    expect(html).toContain("Conexão mútua");
    expect(html).toContain("meu motivo");
    expect(html).toContain("Motivo da outra nota: motivo dela");
  });

  test("relação sem arquivo conhecido vira texto, não âncora quebrada", () => {
    const html = serializeNoteToHtmlDocument(makeNote({ connections: [] }), [
      {
        id: "note-9",
        title: "Sem arquivo",
        fileName: "",
        direction: "incoming",
        reason: "",
        incomingReason: ""
      }
    ]);

    expect(html).toContain("Sem arquivo");
    expect(html).not.toContain("<a href");
  });

  test("escapa título e nome de arquivo do relacionado", () => {
    const html = serializeNoteToHtmlDocument(makeNote({ connections: [] }), [
      {
        id: "note-9",
        title: 'Título <b>"x"</b>',
        fileName: 'a"onmouseover="x.html',
        direction: "incoming",
        reason: "",
        incomingReason: ""
      }
    ]);

    expect(html).toContain("Título &lt;b&gt;");
    expect(html).not.toContain('onmouseover="x');
  });

  test("não renderiza uma seção vazia quando a nota não tem conexões", () => {
    const html = serializeNoteToHtmlDocument(makeNote({ connections: [] }));

    expect(html).not.toContain('<aside class="hz-connections"');
  });

  test("título com caracteres especiais é escapado e volta íntegro", () => {
    const html = serializeNoteToHtmlDocument(makeNote({ title: 'A <b> & "x"' }));

    expect(html).toContain("&lt;b&gt;");
    expect(parseHtmlDocumentToNote(html)!.title).toBe('A <b> & "x"');
  });

  test("arquivos antigos sem pergunta usam o fallback vazio", () => {
    const html = serializeNoteToHtmlDocument(makeNote({ recallPrompt: "" }));

    expect(html).not.toContain('name="hz:recallPrompt"');
    expect(parseHtmlDocumentToNote(html)!.recallPrompt).toBe("");
  });

  test("imagem base64 sobrevive ao round-trip", () => {
    const img = "data:image/webp;base64,UklGRhoAAABXRUJQ";
    const note = makeNote({ content: `<p><img src="${img}" alt="f"></p>` });

    expect(parseHtmlDocumentToNote(serializeNoteToHtmlDocument(note))!.content).toContain(img);
  });

  test("conexão sem motivo faz round-trip", () => {
    const note = makeNote({ connections: [{ id: "note-9", reason: "" }] });

    expect(parseHtmlDocumentToNote(serializeNoteToHtmlDocument(note))!.connections).toEqual([
      { id: "note-9", reason: "" }
    ]);
  });

  test("motivo com barra vertical não corrompe o split", () => {
    const note = makeNote({ connections: [{ id: "note-3", reason: "a | b | c" }] });

    expect(parseHtmlDocumentToNote(serializeNoteToHtmlDocument(note))!.connections).toEqual([
      { id: "note-3", reason: "a | b | c" }
    ]);
  });

  test("documento sem id retorna null", () => {
    expect(
      parseHtmlDocumentToNote("<!doctype html><html><head></head><body></body></html>")
    ).toBeNull();
    expect(parseHtmlDocumentToNote("")).toBeNull();
  });
});

describe("adoptHtmlDocumentAsNote", () => {
  test("adota HTML comum como captura salva e preserva conteúdo seguro", () => {
    const adopted = adoptHtmlDocumentAsNote(
      '<!doctype html><html><head><title>Nota manual</title></head><body><p>Ideia <strong>útil</strong>.</p><script>roubar()</script></body></html>',
      { id: "adopted-1", now: "2026-07-26T20:00:00.000Z" }
    );

    expect(adopted).toMatchObject({
      id: "adopted-1",
      title: "Nota manual",
      folder: "inbox",
      kind: "fleeting",
      template: "blank",
      status: "saved",
      createdAt: "2026-07-26T20:00:00.000Z"
    });
    expect(adopted!.content).toContain("<strong>útil</strong>");
    expect(adopted!.content).not.toContain("script");
  });

  test("não adota documento vazio nem documento que já declara hz:id", () => {
    expect(adoptHtmlDocumentAsNote("")).toBeNull();
    expect(
      adoptHtmlDocumentAsNote(
        '<html><head><meta name="hz:id" content="existente"></head><body><p>x</p></body></html>'
      )
    ).toBeNull();
  });
});

describe("noteFileName", () => {
  test("combina timestamp UTC, título legível e oito caracteres do id", () => {
    expect(
      noteFileName({
        id: "a1b2c3d4-e5f6-4789-abcd-0123456789ab",
        title: "Relações semânticas locais",
        createdAt: "2026-07-26T19:45:30.000Z"
      })
    ).toBe("20260726-194530--relacoes-semanticas-locais--a1b2c3d4.html");
  });

  test("usa valores seguros quando título, data ou id não ajudam", () => {
    expect(
      noteFileName({
        id: "---",
        title: "!!!",
        createdAt: "data inválida"
      })
    ).toBe("00000000-000000--sem-titulo--note.html");
  });
});

describe("conexão para nota excluída", () => {
  const orfa = makeNote({
    connections: [{ id: "note-sumiu", reason: "apontava para algo" }]
  });

  test("com contexto da coleção, o destino inexistente sai da seção visível", () => {
    const html = serializeNoteToHtmlDocument(orfa, []);

    expect(html).not.toContain('<aside class="hz-connections"');
    // A declaração da pessoa continua no head: só a projeção some.
    expect(html).toContain('<meta name="hz:connection" content="note-sumiu|apontava para algo">');
    expect(parseHtmlDocumentToNote(html)!.connections).toEqual([
      { id: "note-sumiu", reason: "apontava para algo" }
    ]);
  });

  test("sem contexto, o arquivo continua mostrando o que ele próprio declara", () => {
    expect(serializeNoteToHtmlDocument(orfa)).toContain("note-sumiu");
  });
});

describe("estilo embutido por blocos", () => {
  const styleOf = (html: string) => (html.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1];

  test("uma nota de texto puro não carrega regras de código, tabela ou imagem", () => {
    const style = styleOf(
      serializeNoteToHtmlDocument(makeNote({ content: "<p>só texto</p>", connections: [] }), [])
    );

    expect(style).toContain(".hz-title");
    expect(style).not.toContain("hljs");
    expect(style).not.toContain(".hz-prose pre");
    expect(style).not.toContain(".hz-prose table");
    expect(style).not.toContain(".hz-prose img");
    expect(style).not.toContain(".hz-connections");
  });

  test("um bloco sem linguagem não arrasta a paleta de tokens", () => {
    const style = styleOf(
      serializeNoteToHtmlDocument(
        makeNote({ content: "<pre><code>texto\n</code></pre>", connections: [] }),
        []
      )
    );

    expect(style).toContain(".hz-prose pre");
    // A paleta é o maior bloco do estilo; sem token colorido, é peso morto.
    expect(style).not.toContain("hljs");
  });

  test("cada recurso usado traz a sua regra", () => {
    const style = styleOf(
      serializeNoteToHtmlDocument(
        makeNote({
          content:
            '<p><mark>x</mark></p><table><tr><td>c</td></tr></table><hr>' +
            '<blockquote>q</blockquote>' +
            '<pre class="language-rust"><code><span class="hljs-keyword">fn</span></code></pre>',
          connections: []
        }),
        []
      )
    );

    expect(style).toContain(".hz-prose mark");
    expect(style).toContain(".hz-prose table");
    expect(style).toContain(".hz-prose hr");
    expect(style).toContain(".hz-prose blockquote");
    expect(style).toContain(".hljs-keyword");
  });

  test("as regras de conexões acompanham a seção", () => {
    const semSecao = styleOf(serializeNoteToHtmlDocument(makeNote({ connections: [] }), []));
    const comSecao = styleOf(
      serializeNoteToHtmlDocument(makeNote({ connections: [] }), [
        {
          id: "note-9",
          title: "Outra",
          fileName: "outra.html",
          direction: "incoming",
          reason: "",
          incomingReason: ""
        }
      ])
    );

    expect(semSecao).not.toContain(".hz-connections");
    expect(comSecao).toContain(".hz-connections");
    // O id só é estilizado quando falta arquivo para virar âncora.
    expect(comSecao).not.toContain(".hz-connection-id");
  });

  test("a nota mais simples possível fica bem menor que a mais rica", () => {
    const simples = styleOf(
      serializeNoteToHtmlDocument(makeNote({ content: "<p>a</p>", connections: [] }), [])
    );
    const rica = styleOf(
      serializeNoteToHtmlDocument(
        makeNote({
          content:
            '<p><mark>a</mark><img src="data:image/png;base64,iVBORw0KGgo=" alt="i"></p>' +
            '<pre class="language-rust"><code><span class="hljs-keyword">fn</span></code></pre>' +
            "<table><tr><td>c</td></tr></table><hr><blockquote>q</blockquote>",
          connections: []
        }),
        [
          {
            id: "note-9",
            title: "Outra",
            fileName: "",
            direction: "incoming",
            reason: "",
            incomingReason: ""
          }
        ]
      )
    );

    expect(simples.length).toBeLessThan(rica.length / 3);
  });
});

describe("formatação do corpo no arquivo", () => {
  const bodyOf = (html: string) =>
    (html.match(/<article class="hz-prose">([\s\S]*?)<\/article>/) || ["", ""])[1];

  test("cada bloco de primeiro nível ocupa uma linha", () => {
    const html = serializeNoteToHtmlDocument(
      makeNote({ content: "<p>um</p><h2>dois</h2><p>três</p>", connections: [] })
    );

    expect(bodyOf(html)).toBe(
      "\n      <p>um</p>\n      <h2>dois</h2>\n      <p>três</p>\n    "
    );
  });

  test("itens de lista também ganham linha própria", () => {
    const html = serializeNoteToHtmlDocument(
      makeNote({ content: "<ul><li>a</li><li>b</li></ul>", connections: [] })
    );

    expect(bodyOf(html)).toContain("<ul>\n        <li>a</li>\n        <li>b</li>\n      </ul>");
  });

  test("o interior de um bloco de código não é tocado", () => {
    const codigo = "<pre><code>linha 1\n  indentada\n</code></pre>";
    const html = serializeNoteToHtmlDocument(makeNote({ content: codigo, connections: [] }));

    expect(html).toContain("<pre><code>linha 1\n  indentada\n</code></pre>");
    expect(parseHtmlDocumentToNote(html)!.content).toBe(codigo);
  });

  test("conteúdo inline não ganha quebra: um espaço a mais mudaria o texto", () => {
    const inline = "<p>um <em>trecho</em> assim</p>";
    const html = serializeNoteToHtmlDocument(makeNote({ content: inline, connections: [] }));

    expect(html).toContain(`      ${inline}`);
    expect(parseHtmlDocumentToNote(html)!.content).toBe(inline);
  });

  test("round-trip devolve o conteúdo sem a indentação do arquivo", () => {
    const content = "<p>um</p><ul><li>a</li></ul><h2>fim</h2>";
    const parsed = parseHtmlDocumentToNote(
      serializeNoteToHtmlDocument(makeNote({ content, connections: [] }))
    )!;

    expect(parsed.content).toBe(content);
  });

  test("serializar é idempotente: reabrir e regravar não muda um byte", () => {
    const note = makeNote({
      content: '<p>um</p><ul><li>a</li></ul><pre><code>x\n</code></pre><table><tr><td>c</td></tr></table>'
    });
    const primeira = serializeNoteToHtmlDocument(note);
    const segunda = serializeNoteToHtmlDocument(parseHtmlDocumentToNote(primeira)!);

    expect(segunda).toBe(primeira);
  });

  test("nota vazia não cria linha em branco no artigo", () => {
    const html = serializeNoteToHtmlDocument(makeNote({ content: "", connections: [] }));

    expect(html).toContain('<article class="hz-prose"></article>');
  });
});
