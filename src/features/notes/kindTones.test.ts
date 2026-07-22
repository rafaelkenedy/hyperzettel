import { describe, expect, test } from "vitest";

import { KIND_LABELS, type NoteKind } from "@/domain/notes";
import { KIND_TONE_CLASSES } from "./kindTones";

describe("KIND_TONE_CLASSES", () => {
  test("oferece uma apresentação diferente para cada estágio", () => {
    const kinds = Object.keys(KIND_LABELS) as NoteKind[];
    const tones = kinds.map((kind) => KIND_TONE_CLASSES[kind]);

    expect(new Set(tones).size).toBe(kinds.length);
  });

  test("não reutiliza os tokens reservados às relações", () => {
    Object.values(KIND_TONE_CLASSES).forEach((tone) => {
      expect(tone).not.toContain("hz-relation");
    });
  });
});
