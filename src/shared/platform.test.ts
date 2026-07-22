import { describe, expect, test } from "vitest";

import { formatShortcut } from "./platform";

describe("formatShortcut", () => {
  test("usa Ctrl no Windows", () => {
    expect(formatShortcut("K", "Windows NT 10.0")).toBe("Ctrl+K");
    expect(formatShortcut("Shift+K", "Windows NT 10.0")).toBe("Ctrl+Shift+K");
  });

  test("usa símbolos nativos no macOS", () => {
    expect(formatShortcut("K", "Macintosh; Intel Mac OS X")).toBe("⌘K");
    expect(formatShortcut("Shift+K", "Macintosh; Intel Mac OS X")).toBe("⌘⇧K");
  });
});
