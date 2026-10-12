import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/*
 * PÁGINAS JURÍDICAS — públicas, fora do login, de propósito.
 *
 * Quem precisa ler a política de privacidade muitas vezes é quem ainda NÃO
 * entrou: o responsável que vai autorizar o filho, a direção da escola que vai
 * aprovar o projeto, o Google verificando o app. Uma política de privacidade
 * atrás de uma tela de login não cumpre a função de existir.
 *
 * Por isso elas ficam neste grupo de rotas, sem o StudentShell: sem barra
 * inferior, sem exigir sessão, legíveis num celular e imprimíveis num A4.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-prose px-4 pb-20 pt-6">
      <Link
        href="/entrar"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-mist-400 transition-colors hover:text-mist-100"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Voltar
      </Link>
      <article className="legal mt-5">{children}</article>
      <footer className="mt-12 border-t border-white/[0.06] pt-5 text-xs leading-relaxed text-mist-500">
        <p>
          EcoHorta Inteligente · EE Prof.ª Clarinda Mendes de Aquino · Projeto escolar do Samsung Solve for Tomorrow Brasil.
        </p>
        <p className="mt-2 flex gap-4">
          <Link href="/privacidade" className="font-semibold text-mist-400 hover:text-mist-100">
            Privacidade
          </Link>
          <Link href="/termos" className="font-semibold text-mist-400 hover:text-mist-100">
            Termos de uso
          </Link>
        </p>
      </footer>
    </div>
  );
}
