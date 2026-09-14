"use client";

import { useSyncExternalStore } from "react";
import { demoProfileStore } from "@/lib/student/demo-profile";

export function useDemoProfile() {
  return useSyncExternalStore(
    demoProfileStore.subscribe,
    demoProfileStore.getSnapshot,
    demoProfileStore.getServerSnapshot,
  );
}
