"use client";

import { MotionConfig } from "motion/react";
import { GraduationCap, ShieldCheck, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { useProfile } from "@/hooks/use-profile";
import { profileStore } from "@/lib/student/profile-store";
import { cn } from "@/lib/utils/cn";

type Mode = "student" | "staff";

const MODES: { id: Mode; label: string; icon: typeof GraduationCap }[] = [
  { id: "student", label: "Estudante", icon: GraduationCap },
  { id: "staff", label: "Equipe da escola", icon: Users },
];

const inputClass =
  "h-12 w-full rounded-control bg-white/[0.05] px-4 text-base text-mist-50 outline-none ring-1 ring-inset ring-white/10 transition-shadow placeholder:text-mist-500 focus:ring-2 focus:ring-aqua-400";

/** Estudante: código + PIN entregues pelo professor (sem e-mail). Equipe: e-mail + senha. */
export function LoginForm() {
  const router = useRouter();
  const profile = useProfile();
  const [mode, setMode] = useState<Mode>("student");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void profileStore.refresh();
  }, []);
  useEffect(() => {
    if (profile.status === "ready") router.replace(profile.identity ? "/" : "/boas-vindas");
  }, [profile.status, profile.identity, router]);

  const canSubmit =
    !submitting && (mode === "student" ? code.replace(/[^a-z0-9]/gi, "").length >= 6 && /^\d{6}$/.test(pin) : email.includes("@") && password.length > 0);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const result =
      mode === "student"
        ? await profileStore.signIn("/api/auth/student", { code, pin })
        : await profileStore.signIn("/api/auth/login", { email, password });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      setPin("");
      setPassword("");
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 pb-safe pt-safe">
        <div className="py-8">
          <p className="eyebrow text-leaf-300">EcoHorta Inteligente</p>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-mist-50">Entrar</h1>
          <p className="mt-2 text-[0.95rem] leading-relaxed text-mist-300">Use o acesso entregue pela sua escola.</p>

          <div role="tablist" aria-label="Tipo de acesso" className="mt-6 grid grid-cols-2 gap-1 rounded-2xl bg-white/[0.04] p-1">
            {MODES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => {
                  setMode(id);
                  setError(null);
                }}
                className={cn(
                  "flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors",
                  mode === id ? "bg-leaf-400/15 text-leaf-300 ring-1 ring-inset ring-leaf-400/40" : "text-mist-300",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4">
            {mode === "student" ? (
              <>
                <label className="block space-y-2">
                  <span className="text-sm font-semibold text-mist-100">Código de acesso</span>
                  <input
                    className={cn(inputClass, "uppercase tracking-widest")}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    autoComplete="username"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={12}
                    placeholder="Ex.: 6C-K3QX"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-semibold text-mist-100">PIN</span>
                  <input
                    className={cn(inputClass, "tracking-[0.4em]")}
                    value={pin}
                    onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    type="password"
                    inputMode="numeric"
                    autoComplete="current-password"
                    maxLength={6}
                    placeholder="••••••"
                  />
                </label>
                <p className="text-xs leading-relaxed text-mist-500">Esqueceu o PIN? Peça um novo ao professor responsável.</p>
              </>
            ) : (
              <>
                <label className="block space-y-2">
                  <span className="text-sm font-semibold text-mist-100">E-mail</span>
                  <input
                    className={inputClass}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-semibold text-mist-100">Senha</span>
                  <input
                    className={inputClass}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoComplete="current-password"
                  />
                </label>
                <p className="text-xs leading-relaxed text-mist-500">Professores, funcionários e administradores.</p>
              </>
            )}

            {error && (
              <p role="alert" className="text-sm text-ember-400">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" variant="leaf" className="w-full" disabled={!canSubmit}>
              {submitting ? "Entrando…" : "Entrar"}
            </Button>
          </form>

          <Surface className="mt-6 flex items-start gap-3 p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-aqua-300" aria-hidden />
            <p className="text-xs leading-relaxed text-mist-400">
              Estudantes não usam e-mail pessoal. Nome e data de nascimento ficam protegidos e nunca aparecem no ranking.
            </p>
          </Surface>
        </div>
      </main>
    </MotionConfig>
  );
}
