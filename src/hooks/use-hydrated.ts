"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** `true` somente após a hidratação no navegador (dados locais já disponíveis). */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
