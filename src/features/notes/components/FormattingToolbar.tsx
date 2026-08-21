/**
 * Barra de formatação do editor.
 *
 * Opera sobre `document.execCommand`, que é depreciado mas continua sendo o
 * único caminho embutido para formatação em contentEditable sem trazer um
 * editor inteiro como dependência.
 */

import { Separator } from "@relume_io/relume-ui";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Highlighter,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Strikethrough,
  Table as TableIcon,
  Underline
} from "lucide-react";

import { IconAction } from "./IconAction";
import { CODE_LANGUAGES, PLAIN_LANGUAGE } from "../codeSyntax";

/** Tabela inicial 2 colunas × cabeçalho + 1 linha; o `<p>` final dá onde
 *  continuar escrevendo depois dela. As tags passam pela allowlist. */
const STARTER_TABLE =
  "<table><thead><tr><th>Título</th><th>Título</th></tr></thead>" +
  "<tbody><tr><td>Célula</td><td>Célula</td></tr></tbody></table><p><br></p>";

export function FormattingToolbar({
  onCommand,
  onInsertLink,
  onInsertImage,
  onToggleCodeBlock,
  onToggleHighlight,
  onCodeLanguageChange,
  codeLanguage = PLAIN_LANGUAGE,
  codeBlockActive = false,
  highlightActive = false
}: {
  onCommand: (command: string, value?: string) => void;
  onInsertLink: () => void;
  onInsertImage: () => void;
  onToggleCodeBlock: () => void;
  onToggleHighlight: () => void;
  onCodeLanguageChange: (language: string) => void;
  /** Linguagem do bloco onde o caret está. */
  codeLanguage?: string;
  /** O caret está dentro de um bloco: o botão volta a ser "sair do bloco". */
  codeBlockActive?: boolean;
  /** A seleção já está destacada: o botão volta a ser "remover destaque". */
  highlightActive?: boolean;
}) {
  const divider = <Separator orientation="vertical" className="mx-1 h-4 bg-border-primary" />;

  return (
    <div className="sticky top-0 z-10 -mx-1 mb-3 flex flex-wrap items-center gap-0.5 bg-background-primary/95 px-1 py-1 backdrop-blur">
      <IconAction icon={Pilcrow} label="Parágrafo" onClick={() => onCommand("formatBlock", "p")} />
      <IconAction icon={Heading1} label="Título 1" onClick={() => onCommand("formatBlock", "h1")} />
      <IconAction icon={Heading2} label="Título 2" onClick={() => onCommand("formatBlock", "h2")} />
      <IconAction icon={Heading3} label="Título 3" onClick={() => onCommand("formatBlock", "h3")} />
      <IconAction icon={Heading4} label="Título 4" onClick={() => onCommand("formatBlock", "h4")} />
      <IconAction icon={Heading5} label="Título 5" onClick={() => onCommand("formatBlock", "h5")} />
      <IconAction icon={Heading6} label="Título 6" onClick={() => onCommand("formatBlock", "h6")} />
      {divider}
      <IconAction icon={Bold} label="Negrito" onClick={() => onCommand("bold")} />
      <IconAction icon={Italic} label="Itálico" onClick={() => onCommand("italic")} />
      <IconAction icon={Underline} label="Sublinhado" onClick={() => onCommand("underline")} />
      <IconAction
        icon={Strikethrough}
        label="Tachado"
        onClick={() => onCommand("strikeThrough")}
      />
      <IconAction
        icon={Highlighter}
        label={highlightActive ? "Remover destaque" : "Destacar"}
        onClick={onToggleHighlight}
        active={highlightActive}
      />
      {divider}
      <IconAction
        icon={Quote}
        label="Citação"
        onClick={() => onCommand("formatBlock", "blockquote")}
      />
      <IconAction icon={List} label="Lista" onClick={() => onCommand("insertUnorderedList")} />
      <IconAction
        icon={ListOrdered}
        label="Lista numerada"
        onClick={() => onCommand("insertOrderedList")}
      />
      <IconAction
        icon={Code}
        label={codeBlockActive ? "Sair do bloco de código" : "Bloco de código"}
        onClick={onToggleCodeBlock}
        active={codeBlockActive}
      />
      <IconAction
        icon={TableIcon}
        label="Inserir tabela"
        onClick={() => onCommand("insertHTML", STARTER_TABLE)}
      />
      <IconAction
        icon={Minus}
        label="Linha divisória"
        onClick={() => onCommand("insertHorizontalRule")}
      />
      {divider}
      <IconAction
        icon={AlignLeft}
        label="Alinhar à esquerda"
        onClick={() => onCommand("justifyLeft")}
      />
      <IconAction icon={AlignCenter} label="Centralizar" onClick={() => onCommand("justifyCenter")} />
      <IconAction
        icon={AlignRight}
        label="Alinhar à direita"
        onClick={() => onCommand("justifyRight")}
      />
      {divider}
      <IconAction icon={LinkIcon} label="Inserir link" onClick={onInsertLink} />
      <IconAction icon={ImagePlus} label="Inserir imagem" onClick={onInsertImage} />

      {/* A escolha da linguagem só existe com o caret dentro de um bloco: fora
          dele não haveria a que aplicar. */}
      {codeBlockActive ? (
        <>
          {divider}
          <select
            aria-label="Linguagem do bloco de código"
            value={codeLanguage}
            onChange={(event) => onCodeLanguageChange(event.target.value)}
            className="h-8 rounded-md border border-border-primary bg-background-primary px-1.5 text-2xs text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-hz-accent"
          >
            {CODE_LANGUAGES.map((language) => (
              <option key={language.id} value={language.id}>
                {language.label}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  );
}
