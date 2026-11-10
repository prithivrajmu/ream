import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createNoteAutosave } from "./noteAutosave";

export function useAutosavedNote(contextId: string, savedValue: string, save: (value: string, expectedValue: string) => Promise<unknown>, ready = true) {
  const controller = useMemo(() => createNoteAutosave(contextId, window.localStorage, save, window.location.hash === "#/overlay" ? "overlay" : "main"), [contextId, save]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    if (ready) controller.sync(savedValue);
  }, [controller, ready, savedValue]);

  useEffect(() => {
    if (!ready) return;
    const flush = () => { void controller.flush().catch(() => undefined); };
    flush();
    window.addEventListener("pagehide", flush);
    window.addEventListener("blur", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("blur", flush);
      flush();
    };
  }, [controller, ready]);

  return { ...snapshot, change: controller.change, flush: controller.flush, resolveConflict: controller.resolveConflict, getSnapshot: controller.getSnapshot, sync: controller.sync };
}
