import { Button } from "@relume_io/relume-ui";
import { Pause, Play, RefreshCw } from "lucide-react";

import { useKnowledgeRelations } from "./KnowledgeRelationsProvider";

export function RelationSettings() {
  const relations = useKnowledgeRelations();
  if (
    relations.status.type === "ready" ||
    relations.status.type === "loading-model" ||
    relations.status.type === "idle"
  ) {
    return null;
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      {relations.status.type === "indexing" ? (
        <Button
          variant="secondary"
          size="sm"
          className="h-8 gap-1.5 border-border-primary bg-background-primary px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-hz-accent"
          onClick={relations.pause}
        >
          <Pause className="size-3.5" />
          Pausar análise
        </Button>
      ) : null}
      {relations.status.type === "error" ? (
        <Button
          variant="secondary"
          size="sm"
          className="h-8 gap-1.5 border-border-primary bg-background-primary px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-hz-accent"
          onClick={() => void relations.retry()}
        >
          <RefreshCw className="size-3.5" />
          Tentar novamente
        </Button>
      ) : relations.status.type === "paused" ? (
        <Button
          variant="secondary"
          size="sm"
          className="h-8 gap-1.5 border-border-primary bg-background-primary px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-hz-accent"
          onClick={() => void relations.resume()}
        >
          <Play className="size-3.5" />
          Continuar análise
        </Button>
      ) : null}
    </div>
  );
}
