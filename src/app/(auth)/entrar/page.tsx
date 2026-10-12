import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Entrar" };

/*
 * O formulário lê `?erro=` da URL, para contar o que deu errado na volta do
 * Google. Ler a query string obriga o Next a esperar o navegador, então ele vem
 * embrulhado em Suspense — sem isso a página não pode ser gerada estaticamente.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <LoginForm />
    </Suspense>
  );
}
