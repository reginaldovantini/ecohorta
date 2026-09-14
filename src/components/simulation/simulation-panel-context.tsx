"use client";

import { createContext, useContext } from "react";

export interface SimulationPanelApi {
  open: () => void;
}

export const SimulationPanelContext = createContext<SimulationPanelApi | null>(null);

/** `null` fora da simulação: o selo vira apenas um rótulo. */
export function useSimulationPanel() {
  return useContext(SimulationPanelContext);
}
