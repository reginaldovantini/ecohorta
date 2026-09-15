"use client";

import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { ArrowLeft, Check, Lock, ShieldCheck, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CollectorTank } from "@/components/collector/collector-tank";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Avatar } from "@/components/users/avatar";
import { useProfile } from "@/hooks/use-profile";
import { profileStore } from "@/lib/student/profile-store";
import { AVATARS, DEFAULT_AVATAR_ID, type AvatarId } from "@/lib/users/avatars";
import { nicknameSchema, ROLE_LABEL } from "@/lib/users/types";
import { cn } from "@/lib/utils/cn";

const STEPS = ["intro", "identity", "privacy"] as const;
type Step = (typeof STEPS)[number];

const inputClass =
  "h-12 w-full rounded-control bg-white/[0.05] px-4 text-base text-mist-50 outline-none ring-1 ring-inset ring-white/10 transition-shadow placeholder:text-mist-500 focus:ring-2 focus:ring-aqua-400";

/**
 * Primeiro acesso: o participante escolhe apelido e avatar.
 * Perfil, escola, turma e função já vêm do cadastro da escola (banco de dados).
 */
export function OnboardingFlow() {
  const router = useRouter();
  const profile = useProfile();
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [nickname, setNickname] = useState("");
  const [nicknameTouched, setNicknameTouched] = useState(false);
  const [avatarId, setAvatarId] = useState<AvatarId>(DEFAULT_AVATAR_ID);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void profileStore.refresh();
  }, []);
  useEffect(() => {
    if (profile.status === "signed-out") router.replace("/entrar");
    else if (profile.status === "ready" && profile.identity !== null) router.replace("/");
  }, [profile.status, profile.identity, router]);

  const step: Step = STEPS[stepIndex]!;
  const nicknameResult = nicknameSchema.safeParse(nickname);

  const canAdvance: Record<Step, boolean> = {
    intro: profile.status === "ready",
    identity: nicknameResult.success,
    privacy: nicknameResult.success && !saving,
  };

  const go = (delta: number) => {
    setDirection(delta);
    setStepIndex((index) => Math.min(STEPS.length - 1, Math.max(0, index + delta)));
  };

  const finish = async () => {
    if (!nicknameResult.success) return;
    setSaving(true);
    setError(null);
    const result = await profileStore.saveIdentity({ nickname: nicknameResult.data, avatarId });
    setSaving(false);
    // Sucesso: o perfil passa a ter identidade e o efeito acima leva à Home.
    if (!result.ok) setError(result.message);
  };

  const greetingName = nicknameResult.success ? nicknameResult.data : "…";

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
          <div className="flex flex-1 justify-center gap-1.5" aria-label={`Etapa ${stepIndex + 1} de ${STEPS.length}`}>
            {STEPS.map((item, index) => (
              <span
                key={item}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
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
              initial={{ opacity: 0, x: direction * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -40 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="pb-6"
            >
              {step === "intro" && (
                <div className="flex flex-col items-center pt-4 text-center">
                  <div className="h-60">
                    <CollectorTank ratio={0.62} urgency="normal" inflowActive dispensing={false} overflowing={false} />
                  </div>
                  <p className="eyebrow mt-6 text-leaf-300">EcoHorta Inteligente</p>
                  <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-mist-50">Conheça a EcoHorta</h1>
                  <p className="mt-3 max-w-xs text-[0.95rem] leading-relaxed text-mist-300">
                    A água do ar-condicionado pode ganhar uma nova função. Ela é captada, medida por um sensor e liberada
                    em missões reais na escola.
                  </p>
                  {profile.role && (
                    <p className="mt-5 rounded-full bg-white/[0.06] px-3 py-1.5 text-sm font-semibold text-mist-100 ring-1 ring-inset ring-white/10">
                      {ROLE_LABEL[profile.role]}
                      {profile.schoolName && ` · ${profile.schoolName}`}
                    </p>
                  )}
                </div>
              )}

              {step === "identity" && (
                <StepBody title="Como você quer aparecer?" subtitle="Seu apelido aparece na timeline e no ranking.">
                  <Surface className="flex items-center gap-3 p-4">
                    <Avatar avatarId={avatarId} />
                    <p className="min-w-0 truncate font-display text-xl font-bold text-mist-50">
                      Olá, {greetingName}! <span aria-hidden>🌱</span>
                    </p>
                  </Surface>

                  <label className="block space-y-2">
                    <span className="text-sm font-semibold text-mist-100">Apelido</span>
                    <input
                      className={inputClass}
                      value={nickname}
                      onChange={(event) => setNickname(event.target.value)}
                      onBlur={() => setNicknameTouched(true)}
                      maxLength={20}
                      autoComplete="off"
                      autoCapitalize="words"
                      placeholder="Ex.: Jhow"
                      aria-invalid={nicknameTouched && !nicknameResult.success}
                    />
                    <span className={cn("block text-xs", nicknameTouched && !nicknameResult.success ? "text-ember-400" : "text-mist-500")}>
                      {nicknameTouched && !nicknameResult.success
                        ? nicknameResult.error.issues[0]?.message
                        : "Não use seu nome completo."}
                    </span>
                  </label>

                  <div className="space-y-2">
                    <span className="text-sm font-semibold text-mist-100">Avatar</span>
                    <div role="radiogroup" aria-label="Avatar" className="grid grid-cols-4 gap-3">
                      {AVATARS.map((avatar) => (
                        <button
                          key={avatar.id}
                          type="button"
                          role="radio"
                          aria-checked={avatarId === avatar.id}
                          aria-label={avatar.label}
                          onClick={() => setAvatarId(avatar.id)}
                          className={cn(
                            "grid place-items-center rounded-2xl p-2 transition-all",
                            avatarId === avatar.id ? "bg-white/10 ring-2 ring-leaf-400" : "bg-white/[0.03] ring-1 ring-white/[0.06]",
                          )}
                        >
                          <Avatar avatarId={avatar.id} />
                        </button>
                      ))}
                    </div>
                  </div>
                </StepBody>
              )}

              {step === "privacy" && (
                <StepBody title="Seus dados" subtitle="Transparência sobre o que fica guardado.">
                  <Surface tone="leaf" className="space-y-3 p-4">
                    <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
                      <Users className="size-5 text-leaf-300" aria-hidden /> Visível na escola
                    </p>
                    <ul className="space-y-1.5 text-sm text-mist-300">
                      {["Apelido e avatar", "Turma ou função, definida pela escola", "XP e missões concluídas"].map((item) => (
                        <li key={item} className="flex items-center gap-2">
                          <Check className="size-4 text-leaf-400" aria-hidden /> {item}
                        </li>
                      ))}
                    </ul>
                  </Surface>
                  <Surface className="space-y-2 p-4">
                    <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
                      <Lock className="size-5 text-aqua-300" aria-hidden /> Protegido
                    </p>
                    <p className="text-sm leading-relaxed text-mist-300">
                      Nome, sobrenome e data de nascimento são cadastrados pela escola, ficam protegidos no banco de dados e
                      nunca aparecem no ranking ou na timeline.
                    </p>
                  </Surface>
                  <p className="flex items-start gap-2 text-xs leading-relaxed text-mist-500">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                    Seu XP e seu histórico ficam guardados na plataforma, não neste aparelho.
                  </p>
                </StepBody>
              )}
            </motion.section>
          </AnimatePresence>
        </div>

        <div className="sticky bottom-0 bg-linear-to-t from-abyss-900 via-abyss-900/95 to-transparent pb-5 pt-4">
          {error && (
            <p role="alert" className="mb-3 text-center text-sm text-ember-400">
              {error}
            </p>
          )}
          <Button
            size="lg"
            variant="leaf"
            className="w-full"
            disabled={!canAdvance[step]}
            onClick={() => (step === "privacy" ? void finish() : go(1))}
          >
            {step === "intro" ? "Começar" : step === "privacy" ? (saving ? "Salvando…" : "Entrar na EcoHorta") : "Continuar"}
          </Button>
        </div>
      </main>
    </MotionConfig>
  );
}

function StepBody({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="space-y-5 pt-2">
      <div>
        <h1 className="font-display text-[1.75rem] font-bold leading-tight text-mist-50">{title}</h1>
        <p className="mt-1 text-sm text-mist-400">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
