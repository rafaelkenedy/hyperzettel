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
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Strikethrough,
  Underline
} from "lucide-react";

import { IconAction } from "./IconAction";

export function FormattingToolbar({
  onCommand,
  onInsertLink,
  onInsertImage
}: {
  onCommand: (command: string, value?: string) => void;
  onInsertLink: () => void;
  onInsertImage: () => void;
}) {
  const divider = <Separator orientation="vertical" className="mx-1 h-4 bg-border-primary" />;

  return (
    <div className="sticky top-0 z-10 -mx-1 mb-3 flex flex-wrap items-center gap-0.5 bg-background-primary/95 px-1 py-1 backdrop-blur">
      <IconAction icon={Pilcrow} label="Parágrafo" onClick={() => onCommand("formatBlock", "p")} />
      <IconAction icon={Heading1} label="Título 1" onClick={() => onCommand("formatBlock", "h1")} />
      <IconAction icon={Heading2} label="Título 2" onClick={() => onCommand("formatBlock", "h2")} />
      <IconAction icon={Heading3} label="Título 3" onClick={() => onCommand("formatBlock", "h3")} />
      {divider}
      <IconAction icon={Bold} label="Negrito" onClick={() => onCommand("bold")} />
      <IconAction icon={Italic} label="Itálico" onClick={() => onCommand("italic")} />
      <IconAction icon={Underline} label="Sublinhado" onClick={() => onCommand("underline")} />
      <IconAction
        icon={Strikethrough}
        label="Tachado"
        onClick={() => onCommand("strikeThrough")}
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
    </div>
  );
}
