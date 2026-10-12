"use client";

import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { ArrowLeft, Cake, Check, GraduationCap, Smile, Sparkles, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/users/avatar";
import { useProfile } from "@/hooks/use-profile";
import { profileStore } from "@/lib/student/profile-store";
import { ageOn } from "@/lib/users/age";
import { AVATARS, DEFAULT_AVATAR_ID, type AvatarId } from "@/lib/users/avatars";
import {
  GRADE_PHASE_LABEL,
  GRADE_PHASES,
  nicknameSchema,
  ROLE_LABEL,
  SELF_DECLARED_ROLES,
  SEX_LABEL,
  SEXES,
  type GradePhase,
  type SelfDeclaredRole,
  type Sex,
} from "@/lib/users/types";
import { cn } from "@/lib/utils/cn";

/*
 * PRIMEIRO ACESSO — uma pergunta por tela.
 *
 * A pessoa acabou de entrar com o Google e ainda não viu nada da plataforma.
 * Um formulário único com seis campos pediria que ela decidisse tudo antes de
 * entender onde se meteu; e num celular de 360 px viraria rolagem.
 *
 * Então é uma pergunta de cada vez, com a resposta avançando sozinha quando ela
 * é um toque (sexo, função, ano) e um botão quando exige digitar. O avatar fica
 * por último de propósito: é a parte divertida, e serve de recompensa.
 *
 * A ESCOLA não é perguntada aqui. Ela vem de ler o QR de um captador — é assim
 * que alguém entra numa escola, e perguntar agora seria pedir uma informação
 * que a pessoa ainda não tem como provar.
 */

const inputClass =
  "h-14 w-full rounded-control bg-white/[0.05] px-4 text-lg text-mist-50 outline-none ring-1 ring-inset ring-white/10 transition-shadow placeholder:text-mist-500 focus:ring-2 focus:ring-aqua-400";

type Step = "nome" | "sexo" | "nascimento" | "funcao" | "ano" | "avatar";

/** Idades plausíveis na escola. Fora disso é quase sempre erro de digitação. */
const MIN_AGE = 5;
const MAX_AGE = 100;

/** A data serve; a idade só confere se faz sentido. `ageOn` recusa data futura. */
function ageOrNull(birthDate: string): number | null {
  try {
    return ageOn(birthDate);
  } catch {
    return null;
  }
}

export function OnboardingFlow() {
  const router = useRouter();
  const profile = useProfile();

  const [name, setName] = useState("");
  const [sex, setSex] = useState<Sex | null>(null);
  const [birthDate, setBirthDate] = useState("");
  const [role, setRole] = useState<SelfDeclaredRole | null>(null);
  const [gradePhase, setGradePhase] = useState<GradePhase | null>(null);
  const [avatarId, setAvatarId] = useState<AvatarId>(DEFAULT_AVATAR_ID);

  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void profileStore.refresh();
  }, []);
  useEffect(() => {
    if (profile.status === "signed-out") router.replace("/entrar");
    else if (profile.status === "ready" && profile.identity !== null) router.replace("/");
  }, [profile.status, profile.identity, router]);

  // A etapa do ano/série só existe para estudante: o caminho muda com a resposta.
  const steps = useMemo<Step[]>(
    () => ["nome", "sexo", "nascimento", "funcao", ...(role === "student" ? (["ano"] as const) : []), "avatar"],
    [role],
  );
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;

  const nameResult = nicknameSchema.safeParse(name);
  const age = birthDate ? ageOrNull(birthDate) : null;
  const birthOk = age !== null && age >= MIN_AGE && age <= MAX_AGE;

  const go = (delta: number) => {
    setError(null);
    setDirection(delta);
    setStepIndex((index) => Math.max(0, Math.min(steps.length - 1, index + delta)));
  };

  /** Resposta de um toque: registra e já avança. */
  const choose = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setTimeout(() => go(1), 140);
  };

  const finish = async () => {
    if (!nameResult.success || !sex || !birthOk || !role) return;
    if (role === "student" && !gradePhase) return;
    setSaving(true);
    setError(null);
    const result = await profileStore.completeOnboarding({
      name: nameResult.data,
      sex,
      birthDate,
      role,
      gradePhase: role === "student" ? gradePhase : null,
      avatarId,
    });
    setSaving(false);
    // Deu certo: o perfil ganha identidade e o efeito lá em cima leva para a Home.
    if (!result.ok) setError(result.message);
  };

  return (
    <MotionConfig reducedMotion="user">
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-safe pt-safe">
        <header className="flex h-16 items-center gap-3">
          {stepIndex > 0 ? (
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Voltar"
              className="grid size-10 place-items-center rounded-full bg-white/[0.06] text-mist-300 active:scale-95"
            >
              <ArrowLeft className="size-5" />
            </button>
          ) : (
            <span className="size-10" />
          )}
          <div className="flex flex-1 justify-center gap-1.5" aria-label={`Etapa ${stepIndex + 1} de ${steps.length}`}>
            {steps.map((item, index) => (
              <span
                key={item}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  index === stepIndex ? "w-6 bg-leaf-400" : index < stepIndex ? "w-1.5 bg-leaf-400/60" : "w-1.5 bg-white/15",
                )}
              />
            ))}
          </div>
          <span className="size-10" />
        </header>

        <div className="relative flex-1">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.section
              key={step}
              custom={direction}
              initial={{ opacity: 0, x: direction * 28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -28 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="flex h-full flex-col pb-8 pt-2"
            >
              {step === "nome" && (
                <Question icon={<UserRound className="size-6" aria-hidden />} title="Como quer ser chamado?" hint="Pode ser seu primeiro nome ou um apelido. É o que aparece no ranking e no mural.">
                  <input
                    className={inputClass}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ex.: Rê"
                    maxLength={20}
                    autoFocus
                    autoComplete="off"
                    enterKeyHint="next"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && nameResult.success) go(1);
                    }}
                  />
                  <Button variant="leaf" size="lg" className="mt-5 w-full" disabled={!nameResult.success} onClick={() => go(1)}>
                    Continuar
                  </Button>
                </Question>
              )}

              {step === "sexo" && (
                <Question icon={<Smile className="size-6" aria-hidden />} title="Qual é o seu sexo?" hint="Usamos só para os indicadores do projeto. Não aparece para outras pessoas.">
                  <Options
                    options={SEXES.map((value) => ({ value, label: SEX_LABEL[value] }))}
                    selected={sex}
                    onSelect={choose(setSex)}
                  />
                </Question>
              )}

              {step === "nascimento" && (
                <Question icon={<Cake className="size-6" aria-hidden />} title="Quando você nasceu?" hint="Guardamos a data, nunca a idade — e ela não aparece para ninguém.">
                  <input
                    className={inputClass}
                    value={birthDate}
                    onChange={(event) => setBirthDate(event.target.value)}
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    autoFocus
                  />
                  {birthDate && !birthOk && (
                    <p className="mt-2 text-sm text-ember-400">Confira a data: o ano parece errado.</p>
                  )}
                  <Button variant="leaf" size="lg" className="mt-5 w-full" disabled={!birthOk} onClick={() => go(1)}>
                    Continuar
                  </Button>
                </Question>
              )}

              {step === "funcao" && (
                <Question icon={<GraduationCap className="size-6" aria-hidden />} title="O que você faz na escola?" hint="Isso define o que aparece para você no aplicativo.">
                  <Options
                    options={SELF_DECLARED_ROLES.map((value) => ({ value, label: ROLE_LABEL[value] }))}
                    selected={role}
                    onSelect={choose((value: SelfDeclaredRole) => {
                      setRole(value);
                      if (value !== "student") setGradePhase(null);
                    })}
                  />
                </Question>
              )}

              {step === "ano" && (
                <Question icon={<GraduationCap className="size-6" aria-hidden />} title="Qual ano você cursa?" hint="Seu ano/série nesta escola.">
                  <Options
                    options={GRADE_PHASES.map((value) => ({ value, label: GRADE_PHASE_LABEL[value] }))}
                    selected={gradePhase}
                    onSelect={choose(setGradePhase)}
                    columns={2}
                  />
                </Question>
              )}

              {step === "avatar" && (
                <Question icon={<Sparkles className="size-6" aria-hidden />} title={`Escolha seu avatar, ${nameResult.success ? nameResult.data : "você"}!`} hint="É a sua cara na plataforma. Dá para trocar depois, no perfil.">
                  <div className="grid grid-cols-4 gap-3">
                    {AVATARS.map((avatar) => (
                      <button
                        key={avatar.id}
                        type="button"
                        onClick={() => setAvatarId(avatar.id)}
                        aria-pressed={avatarId === avatar.id}
                        aria-label={avatar.label}
                        className={cn(
                          "grid aspect-square place-items-center rounded-2xl transition-all active:scale-95",
                          avatarId === avatar.id ? "bg-leaf-400/20 ring-2 ring-leaf-400" : "bg-white/[0.05] ring-1 ring-inset ring-white/10",
                        )}
                      >
                        <Avatar avatarId={avatar.id} className="size-12" />
                      </button>
                    ))}
                  </div>

                  {error && (
                    <p role="alert" className="mt-4 text-sm text-alert-400">
                      {error}
                    </p>
                  )}

                  <Button variant="leaf" size="lg" className="mt-6 w-full" disabled={saving} onClick={finish} icon={<Check className="size-5" aria-hidden />}>
                    {saving ? "Salvando…" : "Começar"}
                  </Button>
                  <p className="mt-3 text-center text-xs leading-relaxed text-mist-500">
                    Para fazer missões, leia o QR Code de um captador da sua escola.
                  </p>
                </Question>
              )}
            </motion.section>
          </AnimatePresence>
        </div>
      </main>
    </MotionConfig>
  );
}

function Question({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <>
      <span className="grid size-12 place-items-center rounded-2xl bg-leaf-400/15 text-leaf-300">{icon}</span>
      <h1 className="mt-4 font-display text-[1.6rem] font-bold leading-tight tracking-tight text-mist-50">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-mist-400">{hint}</p>
      <div className="mt-7">{children}</div>
    </>
  );
}

/** Lista de escolhas de um toque. Resposta curta, alvo grande, sem botão extra. */
function Options<T extends string>({
  options,
  selected,
  onSelect,
  columns = 1,
}: {
  options: readonly { value: T; label: string }[];
  selected: T | null;
  onSelect: (value: T) => void;
  columns?: 1 | 2;
}) {
  return (
    <div className={cn("grid gap-2.5", columns === 2 && "grid-cols-2")}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onSelect(option.value)}
          aria-pressed={selected === option.value}
          className={cn(
            "flex h-14 items-center justify-between rounded-control px-5 text-left text-base font-semibold transition-all active:scale-[0.98]",
            selected === option.value
              ? "bg-leaf-400 text-abyss-950"
              : "bg-white/[0.05] text-mist-100 ring-1 ring-inset ring-white/10",
          )}
        >
          {option.label}
          {selected === option.value && <Check className="size-5" aria-hidden />}
        </button>
      ))}
    </div>
  );
}
