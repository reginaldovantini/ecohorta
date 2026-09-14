"use client";

import { useEffect } from "react";

/**
 * Registra o service worker só em produção: no desenvolvimento o cache
 * atrapalharia o recarregamento das telas.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
  }, []);
  return null;
}
