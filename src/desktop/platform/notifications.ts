import type { ActivityItemDto } from '../../shared/contracts/activity-view.js';

/**
 * Desktop notices for activity that needs the user, through the web Notification API (no Tauri plugin wired).
 * Never throws: where the webview has no Notification or the permission is denied, it simply does nothing.
 */
const notified = new Set<string>();
let primed = false;

/** Notifies the items needing attention that were not notified before, only while the window is not focused. */
export async function notifyAttention(
  items: ActivityItemDto[],
  { windowFocused }: { windowFocused: boolean },
): Promise<number> {
  try {
    const fresh = items.filter(item => item.needsAttention && !notified.has(item.id));
    for (const item of fresh) notified.add(item.id);
    // The first load only records what already existed: the user sees it in the inbox, it is not news.
    if (!primed) {
      primed = true;
      return 0;
    }
    if (!fresh.length || windowFocused) return 0;
    const api = (globalThis as { Notification?: typeof Notification }).Notification;
    if (!api) return 0;
    if (api.permission === 'default') await api.requestPermission();
    if (api.permission !== 'granted') return 0;
    const [first] = fresh;
    const title = fresh.length === 1 ? first!.title : `${fresh.length} cosas requieren tu atención`;
    const body =
      fresh.length === 1
        ? (first!.detail ?? 'Ábrelo en la bandeja de actividad.')
        : fresh
            .slice(0, 3)
            .map(item => item.title)
            .join('\n');
    new api(title, { body, tag: fresh.length === 1 ? first!.id : 'graphdev-attention' });
    return fresh.length;
  } catch {
    return 0;
  }
}

/** Asks for the permission after a user gesture (e.g. a button), so the first notice is not lost. */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const api = (globalThis as { Notification?: typeof Notification }).Notification;
    if (!api) return false;
    if (api.permission === 'default') await api.requestPermission();
    return api.permission === 'granted';
  } catch {
    return false;
  }
}

/** Tests only: forgets what was notified. */
export function resetNotifiedForTests(): void {
  notified.clear();
  primed = false;
}
