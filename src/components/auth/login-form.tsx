"use client";

import { MotionConfig, motion } from "motion/react";
import { AlertTriangle, Droplets, KeyRound, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { WelcomeInvite } from "./welcome-invite";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { useProfile } from "@/hooks/use-profile";
import { profileStore } from "@/lib/student/profile-store";

/*
 * ENTRAR — uma porta, e uma de serviço.
 *
 * A plataforma é de cadastro aberto: quem estuda ou trabalha na escola entra
 * sozinho com a conta Google, sem ninguém liberar nada. Não há código de acesso
 * para distribuir, nem senha para a secretaria guardar, nem fila de aprovação —
 * que era exatamente o que travava o projeto antes.
 *
 * A entrada por e-mail e senha continua existindo, discreta, porque contas de
 * ADMINISTRAÇÃO não nascem pelo Google: elas são criadas por script, e é por
 * elas que um captador é cadastrado. Quem é estudante nunca precisa dessa porta.
 */

const inputClass =
  "h-12 w-full rounded-control bg-white/[0.05] px-4 text-base text-mist-50 outline-none ring-1 ring-inset ring-white/10 transition-shadow placeholder:text-mist-500 focus:ring-2 focus:ring-aqua-400";

/*
 * Quem já começou não precisa ver o convite de novo.
 *
 * O cartão de visita existe para a primeira impressão. Para quem volta — sessão
 * expirada no meio da aula, celular trocado de mão — ele seria um toque a mais
 * entre a pessoa e a missão. Essa memória é só uma conveniência local: se o
 * navegador apagar, o pior que acontece é ver uma tela bonita outra vez.
 */
const SEEN_KEY = "ecohorta:convite-visto";

/*
 * O aplicativo instalado tem a própria memória de convite.
 *
 * Quem visitou o site antes de instalar já tocou em "Começar" uma vez. Se a
 * memória fosse uma só, o primeiro toque no ícone recém-instalado cairia direto
 * na tela de login — e a abertura do aplicativo, que é o momento em que a
 * pessoa mostra a EcoHorta para alguem, seria um formulário.
 *
 * Com chaves separadas, o app instalado dá as boas-vindas na primeira vez que é
 * aberto pelo ícone, e só na primeira.
 */
function chaveDoConvite(): string {
  const instalado =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return instalado ? `${SEEN_KEY}-app` : SEEN_KEY;
}

function conviteJaVisto(): boolean {
  try {
    return window.localStorage.getItem(chaveDoConvite()) === "1";
  } catch {
    return false;
  }
}

/** Nunca muda sozinho: a leitura acontece uma vez, na montagem. */
const semMudancas = () => () => {};

/** Recados de volta do Google. A pessoa não tem culpa de nenhum deles. */
const RETURN_ERRORS: Record<string, string> = {
  google: "A entrada pelo Google foi cancelada ou recusada. Tente de novo.",
  sem_codigo: "O Google não devolveu a autorização. Tente de novo.",
  sessao: "Não foi possível abrir a sessão. Tente de novo em instantes.",
};

export function LoginForm() {
  const router = useRouter();
  const profile = useProfile();
  const params = useSearchParams();
  // `null` no servidor: localStorage só existe no navegador, e decidir cedo demais
  // mostraria a tela errada por um instante.
  const jaVisto = useSyncExternalStore<boolean | null>(semMudancas, conviteJaVisto, () => null);
  const [convitePulado, setConvitePulado] = useState(false);
  const [withPassword, setWithPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnError = RETURN_ERRORS[params.get("erro") ?? ""] ?? null;

  useEffect(() => {
    void profileStore.refresh();
  }, []);
  useEffect(() => {
    // Com sessão aberta: quem ainda não completou o primeiro acesso vai completá-lo.
    if (profile.status === "ready") router.replace(profile.identity ? "/" : "/boas-vindas");
  }, [profile.status, profile.identity, router]);

  const entrarComGoogle = async () => {
    setSubmitting(true);
    setError(null);
    const result = await profileStore.startGoogleSignIn();
    // Dando certo, o navegador já saiu daqui: só chega nesta linha se falhou.
    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
    }
  };

  const entrarComSenha = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !email.includes("@") || password.length === 0) return;
    setSubmitting(true);
    setError(null);
    const result = await profileStore.signIn("/api/auth/login", { email, password });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      setPassword("");
    }
  };

  const aviso = error ?? returnError;

  if (jaVisto === null) return <main className="min-h-dvh" />;
  // Voltando com erro do Google, a pessoa quer resolver, não ser apresentada.
  if (!jaVisto && !convitePulado && returnError === null) {
    return (
      <WelcomeInvite
        onStart={() => {
          try {
            window.localStorage.setItem(chaveDoConvite(), "1");
          } catch {
            // Navegador sem armazenamento: o convite aparece de novo, e tudo bem.
          }
          setConvitePulado(true);
        }}
      />
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 pb-safe pt-safe">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          className="py-8"
        >
          <span className="grid size-14 place-items-center rounded-3xl bg-leaf-400/15 text-leaf-300">
            <Droplets className="size-7" aria-hidden />
          </span>

          <p className="eyebrow mt-5 text-leaf-300">EcoHorta Inteligente</p>
          <h1 className="mt-1.5 font-display text-3xl font-bold leading-tight text-mist-50">
            A água do ar-condicionado vira missão.
          </h1>
          <p className="mt-3 text-[0.95rem] leading-relaxed text-mist-300">
            Entre com sua conta Google para participar. Estudantes, professores e funcionários da escola.
          </p>

          {aviso && (
            <p role="alert" className="mt-5 flex items-start gap-2 rounded-2xl bg-alert-400/12 px-3.5 py-3 text-sm leading-relaxed text-mist-100">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-alert-400" aria-hidden />
              {aviso}
            </p>
          )}

          <Button
            size="lg"
            variant="secondary"
            onClick={entrarComGoogle}
            disabled={submitting}
            className="mt-7 w-full bg-white text-abyss-950 ring-0 hover:bg-white/90"
            icon={<GoogleMark />}
          >
            {submitting ? "Abrindo…" : "Entrar com Google"}
          </Button>

          <Surface className="mt-6 flex items-start gap-3 p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-aqua-300" aria-hidden />
            <p className="text-xs leading-relaxed text-mist-400">
              Do Google recebemos apenas o seu e-mail. Nome, data de nascimento e e-mail nunca aparecem para outras
              pessoas — no ranking e no mural você é o seu apelido e o seu avatar.
            </p>
          </Surface>

          {/*
            Porta de serviço. Fica fechada por padrão porque é de administração:
            quem é estudante nunca precisa dela, e vê-la só geraria dúvida.
          */}
          {withPassword ? (
            <form onSubmit={entrarComSenha} className="mt-6 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-mist-200">E-mail</span>
                <input
                  className={inputClass}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-mist-200">Senha</span>
                <input
                  className={inputClass}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                />
              </label>
              <p className="text-xs leading-relaxed text-mist-500">Contas de administração da plataforma.</p>
              <Button type="submit" variant="leaf" className="w-full" disabled={submitting || !email.includes("@") || !password}>
                {submitting ? "Entrando…" : "Entrar"}
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setWithPassword(true)}
              className="mx-auto mt-6 flex items-center gap-1.5 text-sm font-semibold text-mist-500 transition-colors hover:text-mist-300"
            >
              <KeyRound className="size-4" aria-hidden />
              Entrar com e-mail e senha
            </button>
          )}

          {/*
            A política de privacidade precisa estar alcançável ANTES de entrar: quem
            mais precisa dela é o responsável decidindo se autoriza o filho — e é
            daqui que o Google verifica o app.
          */}
          <p className="mt-8 text-center text-xs text-mist-500">
            Ao entrar, você concorda com os{" "}
            <Link href="/termos" className="font-semibold text-mist-400 underline-offset-2 hover:text-mist-100 hover:underline">
              Termos de uso
            </Link>{" "}
            e com a{" "}
            <Link href="/privacidade" className="font-semibold text-mist-400 underline-offset-2 hover:text-mist-100 hover:underline">
              Política de Privacidade
            </Link>
            .
          </p>
        </motion.div>
      </main>
    </MotionConfig>
  );
}

/** O "G" do Google, nas cores oficiais. Exigência da marca em botões de entrada. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18A13.2 13.2 0 0 1 11 24c0-1.45.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}
