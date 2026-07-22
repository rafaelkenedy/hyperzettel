/**
 * Modelos de nota. Porte de `data/config.js` do Hyperzettelkasten.
 *
 * Cada modelo carrega uma estrutura inicial de conteúdo, além do tipo e da
 * pasta sugeridos. É o que diferencia o tipo de uma simples etiqueta.
 */

import type { FolderId, NoteKind, TemplateId } from "@/domain/notes";

/**
 * Famílias de modelo. Existem para dar hierarquia: uma grade de dez cartões
 * iguais obriga a ler os dez, enquanto quatro grupos com propósito distinto
 * deixam a escolha ser feita por eliminação.
 */
export type TemplateGroup = "pensar" | "conduzir" | "registrar" | "ritmo";

export const TEMPLATE_GROUPS: Record<TemplateGroup, { label: string; hint: string }> =
  Object.freeze({
    pensar: { label: "Pensar", hint: "Ideias que ficam reutilizáveis" },
    conduzir: { label: "Conduzir", hint: "Trabalho com resultado ou rotina" },
    registrar: { label: "Registrar", hint: "O que aconteceu e por quê" },
    ritmo: { label: "Ritmo", hint: "Revisões periódicas" }
  });

export interface NoteTemplate {
  id: TemplateId;
  /** Estagio em que a nota nasce ao usar este modelo. */
  kind: NoteKind;
  name: string;
  description: string;
  group: TemplateGroup;
  folder: FolderId;
  content: string;
  /** Alguns modelos sugerem um título, como a nota diária com a data. */
  title?: () => string;
}

export const TEMPLATES: readonly NoteTemplate[] = Object.freeze([
  {
    id: "blank",
    kind: "fleeting",
    group: "pensar",
    name: "Nota em branco",
    description: "Comece sem estrutura predefinida.",
    folder: "inbox",
    content: `<h2>Ideia principal</h2><p>Escreva aqui. Termine conectando esta nota a outra ideia ou definindo uma próxima ação.</p>`
  },
  {
    id: "project",
    kind: "structure",
    group: "conduzir",
    name: "Painel de projeto",
    description: "Resultado, marcos, ações e progresso.",
    folder: "projects",
    content: `<h2>Resultado desejado</h2><p>Como será possível reconhecer que este projeto terminou?</p><h2>Contexto</h2><p>Por que este projeto existe e por que importa agora?</p><h2>Próxima ação</h2><ul><li>Defina a menor ação física e observável.</li></ul><h2>Marcos</h2><ul><li>Primeiro marco</li><li>Segundo marco</li><li>Entrega ou encerramento</li></ul><h2>Registro de progresso</h2><p>Adicione atualizações datadas.</p><h2>Critério de arquivamento</h2><p>Registre a entrega final e as pendências transferidas.</p>`
  },
  {
    id: "area",
    kind: "structure",
    group: "conduzir",
    name: "Painel de área",
    description: "Responsabilidade contínua, rotinas e padrões.",
    folder: "areas",
    content: `<h2>Propósito</h2><p>Qual responsabilidade contínua esta área representa?</p><h2>Padrão desejado</h2><p>Descreva o estado que deseja manter.</p><h2>Rotinas</h2><ul><li>Rotina periódica</li><li>Verificação de qualidade</li></ul><h2>Indicadores</h2><p>O que mostra que esta área está saudável?</p><h2>Projetos ativos</h2><p>Conecte os projetos que sustentam esta área.</p>`
  },
  {
    id: "concept",
    kind: "permanent",
    group: "pensar",
    name: "Nota de conceito",
    description: "Uma ideia explicada de forma atômica e reutilizável.",
    folder: "resources",
    content: `<h2>Em uma frase</h2><p>Explique a ideia central sem depender de outras notas.</p><h2>Problema que resolve</h2><p>Em que situação este conceito é útil?</p><h2>Como funciona</h2><p>Desenvolva a explicação em suas próprias palavras.</p><h2>Exemplo</h2><p>Mostre um caso concreto.</p><h2>Limites e comparações</h2><p>Quando a ideia não se aplica?</p><h2>Pergunta em aberto</h2><ul><li>O que ainda precisa ser entendido ou testado?</li></ul>`
  },
  {
    id: "reference",
    kind: "source",
    group: "pensar",
    name: "Nota de referência",
    description: "Síntese de livro, artigo, vídeo ou outra fonte.",
    folder: "resources",
    content: `<h2>Fonte</h2><ul><li>Autor ou organização:</li><li>Título:</li><li>URL ou localização:</li><li>Data de acesso:</li></ul><h2>Por que guardar</h2><p>Por que esta fonte pode ser útil novamente?</p><h2>Síntese</h2><p>Resuma as ideias relevantes em suas palavras.</p><h2>Evidências e detalhes</h2><ul><li>Evidência:</li><li>Dado ou exemplo:</li><li>Limitação da fonte:</li></ul><h2>Ideias extraídas</h2><p>Crie notas de conceito para ideias reutilizáveis.</p>`
  },
  {
    id: "session",
    kind: "fleeting",
    group: "registrar",
    name: "Sessão de trabalho",
    description: "Objetivo, tentativas, resultado e continuação.",
    folder: "projects",
    content: `<h2>Objetivo da sessão</h2><p>O que deve estar diferente ao final?</p><h2>Estado inicial</h2><ul><li>O que já existe:</li><li>Principal dúvida ou bloqueio:</li></ul><h2>Registro</h2><p>Anote tentativas, observações e resultados.</p><h2>Decisões</h2><p>Decisão e motivo.</p><h2>Resultado</h2><p>O que foi produzido, aprendido ou descartado?</p><h2>Próxima ação</h2><ul><li>Defina uma continuação concreta.</li></ul>`
  },
  {
    id: "decision",
    kind: "permanent",
    group: "registrar",
    name: "Registro de decisão",
    description: "Alternativas, escolha, motivo e consequências.",
    folder: "projects",
    content: `<h2>Contexto</h2><p>Qual situação exige uma decisão?</p><h2>Restrições</h2><ul><li>Restrição:</li><li>Hipótese:</li></ul><h2>Alternativas consideradas</h2><ol><li>Alternativa A — benefícios, custos e riscos.</li><li>Alternativa B — benefícios, custos e riscos.</li></ol><h2>Decisão</h2><p>Registre claramente o que foi escolhido.</p><h2>Motivo</h2><p>Por que esta alternativa é adequada agora?</p><h2>Consequências esperadas</h2><ul><li>Consequência positiva:</li><li>Custo ou risco aceito:</li></ul><h2>Revisão</h2><p>Quando e sob quais sinais esta decisão deve ser revista?</p>`
  },
  {
    id: "meeting",
    kind: "fleeting",
    group: "registrar",
    name: "Nota de reunião",
    description: "Pauta, decisões, responsáveis e ações.",
    folder: "projects",
    content: `<h2>Informações</h2><ul><li>Data:</li><li>Participantes:</li><li>Objetivo:</li></ul><h2>Pauta</h2><ol><li>Tema principal</li><li>Tema secundário</li></ol><h2>Notas</h2><p>Argumentos, informações e dúvidas relevantes.</p><h2>Decisões</h2><p>Decisão, responsável e motivo.</p><h2>Ações</h2><ul><li>Ação — responsável — prazo</li></ul><h2>Questões abertas</h2><ul><li>Questão que ainda precisa de resposta.</li></ul>`
  },
  {
    id: "daily",
    kind: "fleeting",
    group: "ritmo",
    name: "Nota diária",
    description: "Foco, registro, aprendizados e próximas ações.",
    folder: "journal",
    // Formato ISO curto (sv-SE gera AAAA-MM-DD), como no original.
    title: () => new Date().toLocaleDateString("sv-SE"),
    content: `<h2>Foco</h2><ul><li>Prioridade principal do dia.</li></ul><h2>Registro</h2><p>Eventos, observações e atividades relevantes.</p><h2>Notas criadas ou alteradas</h2><p>Conecte as notas trabalhadas hoje.</p><h2>Aprendizados</h2><p>Ideia que vale lembrar ou desenvolver.</p><h2>Próximas ações</h2><ul><li>Próxima ação concreta.</li></ul><h2>Encerramento</h2><p>O que avançou e o que deve ser retomado?</p>`
  },
  {
    id: "weekly",
    kind: "fleeting",
    group: "ritmo",
    name: "Revisão semanal",
    description: "Progresso, pendências, conexões e planejamento.",
    folder: "journal",
    content: `<h2>O que avançou</h2><p>Resultados, entregas e aprendizados relevantes.</p><h2>Projetos</h2><p>Projeto — estado — próxima ação.</p><h2>Áreas</h2><p>Qual área precisa de atenção?</p><h2>Caixa de entrada</h2><ul><li>Processar capturas e decidir o destino.</li></ul><h2>Conexões novas</h2><p>Quais notas passaram a se relacionar?</p><h2>Próxima semana</h2><ul><li>Resultado principal:</li><li>Primeira ação:</li></ul><h2>Limpeza</h2><ul><li>Arquivar projetos concluídos.</li><li>Remover referências sem utilidade.</li><li>Confirmar a próxima ação de cada projeto.</li></ul>`
  }
]);

export function findTemplate(id: TemplateId): NoteTemplate {
  return TEMPLATES.find((template) => template.id === id) ?? TEMPLATES[0];
}
