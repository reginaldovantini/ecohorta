import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "Sem conexão" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center pt-safe pb-safe">
      <span className="grid size-16 place-items-center rounded-full bg-ember-400/15 text-ember-400 ring-1 ring-inset ring-ember-400/30">
        <WifiOff className="size-8" aria-hidden />
      </span>
      <h1 className="mt-6 font-display text-2xl font-bold text-mist-50">Sem conexão</h1>
      <p className="mt-2 text-sm leading-relaxed text-mist-300">
        Os dados do captador e a liberação de água dependem da internet. Nenhuma ação física acontece offline.
      </p>
      {/* Recarga completa de propósito: sem conexão, a navegação do lado do cliente falharia. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="mt-8 inline-flex h-12 items-center rounded-control bg-linear-to-b from-leaf-300 to-leaf-500 px-6 font-semibold text-abyss-950"
      >
        Tentar novamente
      </a>
    </main>
  );
}
