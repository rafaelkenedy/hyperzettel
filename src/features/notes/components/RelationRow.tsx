/**
 * Uma linha por nota relacionada.
 *
 * Conexão é uma aresta sem direção, então a nota aparece uma vez só. A seta
 * diz de onde a relação partiu, e o motivo é editável pelo lado de cá - se a
 * conexão só existe do outro lado, escrever um motivo cria a volta.
 */

import { useEffect, useId, useState } from "react";
import { cn } from "@relume_io/relume-ui";
import { ArrowLeft, ArrowLeftRight, ArrowRight, X } from "lucide-react";

import type { Relation, RelationDirection } from "@/domain/notes";

const DIRECTION = {
  mutual: { icon: ArrowLeftRight, hint: "Vocês se citam nos dois sentidos." },
  outgoing: { icon: ArrowRight, hint: "Esta nota cita a outra." },
  incoming: { icon: ArrowLeft, hint: "A outra nota cita esta." }
} satisfies Record<RelationDirection, { icon: typeof ArrowRight; hint: string }>;

export function RelationRow({
  relation,
  onOpen,
  onReason,
  onRemove,
  autoFocusReason = false
}: {
  relation: Relation;
  onOpen: () => void;
  onReason: (value: string) => void;
  onRemove: () => void;
  autoFocusReason?: boolean;
}) {
  const { note, direction, reason, incomingReason } = relation;
  const { icon: DirectionIcon, hint } = DIRECTION[direction];
  const title = note.title || "Sem título";
  const reasonId = useId();

  /*
   * O motivo que chega em `relation` já passou por `normalizeConnections`, que
   * apara as pontas. Ligar o campo direto nele impedia digitar espaço: a tecla
   * entrava no store e o render seguinte devolvia o texto sem ela.
   *
   * Enquanto o texto de fora for só a versão aparada do que está sendo
   * digitado, o campo mantém o que a pessoa escreveu. Quando muda de verdade
   * — outra nota, recarga do vault — o valor externo prevalece.
   */
  const [typedReason, setTypedReason] = useState(reason);
  useEffect(() => {
    setTypedReason((current) => (current.trim() === reason ? current : reason));
  }, [reason]);

  return (
    <div className="group rounded-md border border-border-secondary bg-background-secondary p-1.5">
      <div className="flex items-center gap-1">
        <span className="grid size-8 shrink-0 place-items-center rounded-md" title={hint}>
          <DirectionIcon
            className="size-3.5 text-text-secondary"
            strokeWidth={2}
            aria-hidden="true"
          />
        </span>
        <span className="sr-only">{hint}</span>
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate rounded bg-hz-relation px-1.5 py-0.5 text-left text-xs text-hz-relation-ink hover:underline"
          title={title}
        >
          {title}
        </button>
        {/* Só dá para desfazer o que esta nota declarou. */}
        {direction === "incoming" ? null : (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remover conexão com ${title}`}
            title="Remover conexão"
            className="grid size-8 shrink-0 place-items-center rounded-md text-text-secondary opacity-70 transition-opacity hover:bg-hz-hover hover:text-text-primary focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hz-accent group-hover:opacity-100"
          >
            <X className="size-3.5" strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <label htmlFor={reasonId} className="shrink-0 text-xs font-medium text-text-secondary">
          {direction === "incoming" ? "Seu motivo" : "Motivo"}
        </label>
        <input
          id={reasonId}
          autoFocus={autoFocusReason}
          value={typedReason}
          onChange={(event) => {
            setTypedReason(event.target.value);
            onReason(event.target.value);
          }}
          placeholder={direction === "incoming" ? "Responder…" : "Por que se conectam?"}
          aria-label={`Motivo da conexão com ${title}`}
          className={cn(
            "min-h-7 min-w-0 flex-1 rounded-md border border-border-secondary bg-background-primary px-2 py-1 text-xs leading-snug outline-none",
            "placeholder:text-text-secondary hover:border-border-tertiary focus:border-hz-accent focus:ring-2 focus:ring-hz-accent/20",
            !typedReason && "italic"
          )}
        />
      </div>

      {/* O motivo da outra ponta é leitura: pertence a quem escreveu. */}
      {incomingReason ? (
        <p className="mt-0.5 truncate px-1.5 text-xs text-text-tertiary" title={incomingReason}>
          Motivo da outra nota: {incomingReason}
        </p>
      ) : null}
    </div>
  );
}
