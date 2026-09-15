"use client";

import { useSyncExternalStore } from "react";
import { profileStore } from "@/lib/student/profile-store";

export function useProfile() {
  return useSyncExternalStore(profileStore.subscribe, profileStore.getSnapshot, profileStore.getServerSnapshot);
}
