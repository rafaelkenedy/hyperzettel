/** Formata atalhos de acordo com o sistema exibido pelo navegador/Tauri. */
export function formatShortcut(
  key: string,
  platform = typeof navigator === "undefined" ? "" : navigator.userAgent
): string {
  const isApple = /Macintosh|Mac OS|iPhone|iPad|iPod/i.test(platform);
  if (!isApple) return `Ctrl+${key}`;

  return `⌘${key.replace("Shift+", "⇧").replace("Alt+", "⌥")}`;
}
