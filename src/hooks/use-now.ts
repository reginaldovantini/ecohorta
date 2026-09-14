"use client";

import { useSyncExternalStore } from "react";

const subscribers = new Map<number, (onChange: () => void) => () => void>();

function getSubscriber(intervalMs: number) {
  let subscribe = subscribers.get(intervalMs);
  if (!subscribe) {
    subscribe = (onChange) => {
      const id = window.setInterval(onChange, intervalMs);
      return () => window.clearInterval(id);
    };
    subscribers.set(intervalMs, subscribe);
  }
  return subscribe;
}

/** Instante atual (ms) arredondado ao intervalo. `null` no servidor, evitando divergência na hidratação. */
export function useNow(intervalMs = 1000): number | null {
  return useSyncExternalStore(
    getSubscriber(intervalMs),
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => null,
  );
}

/** Hora local (0–23) para saudações. `null` no servidor. */
export function useHour(): number | null {
  const now = useNow(60_000);
  return now === null ? null : new Date(now).getHours();
}
