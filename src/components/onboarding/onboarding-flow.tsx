"use client";

import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { ArrowLeft, BookOpen, Briefcase, Check, GraduationCap, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CollectorTank } from "@/components/collector/collector-tank";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Avatar } from "@/components/users/avatar";
import { demoProfileStore } from "@/lib/student/demo-profile";
import { AVATARS, DEFAULT_AVATAR_ID, type AvatarId } from "@/lib/users/avatars";
import { classesByLevel, SCHOOL } from "@/lib/users/school";
import {
  displayIdentitySchema,
  EDUCATION_LEVEL_LABEL,
  nicknameSchema,
  ROLE_LABEL,
  STAFF_SECTOR_LABEL,
  STAFF_SECTORS,
  type ParticipantRole,
  type StaffSector,
} from "@/lib/users/types";
import { cn } from "@/lib/utils/cn";

const STEPS = ["intro", "role", "identity", "details", "privacy"] as const;
type Step = (typeof STEPS)[number];

const ROLE_OPTIONS: { role: ParticipantRole; icon: typeof GraduationCap; description: string }[] = [
  { role: "student", icon: GraduationCap, description: "Participe das missões e acompanhe seu impacto." },
  { role: "teacher", icon: BookOpen, description: "Participe das missões e, em breve, acompanhe turmas." },
  { role: "staff", icon: Briefcase, description: "Participe das missões com a comunidade escolar." },
];

const inputClass =
  "h-12 w-full rounded-control bg-white/[0.05] px-4 text-base text-mist-50 outline-none ring-1 ring-inset ring-white/10 transition-shadow placeholder:text-mist-500 focus:ring-2 focus:ring-aqua-400";

/** Cadastro simples no aparelho: somente dados de exibição. */
export function OnboardingFlow() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [role, setRole] = useState<ParticipantRole | null>(null);
  const [nickname, setNickname] = useState("");
  const [nicknameTouched, setNicknameTouched] = useState(false);
  const [avatarId, setAvatarId] = useState<AvatarId>(DEFAULT_AVATAR_ID);
  const [classId, setClassId] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [sector, setSector] = useState<StaffSector | null>(null);

  const step: Step = STEPS[stepIndex]!;
  const nicknameResult = nicknameSchema.safeParse(nickname);
  const identity = displayIdentitySchema.safeParse(
    role === "student"
      ? { role, nickname, avatarId, classId }
      : role === "teacher"
        ? { role, nickname, avatarId, jobTitle }
        : { role, nickname, avatarId, jobTitle, sector },
  );

  const canAdvance: Record<Step, boolean> = {
    intro: true,
    role: role !== null,
    identity: nicknameResult.success,
    details: identity.success,
    privacy: identity.success,
  };

  const go = (delta: number) => {
    setDirection(delta);
    setStepIndex((index) => Math.min(STEPS.length - 1, Math.max(0, index + delta)));
  };

  const finish = () => {
    if (!identity.success) return;
    demoProfileStore.setIdentity(identity.data);
    router.replace("/");
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
                  <div className="mt-6 flex gap-2">
                    {["Descubra", "Participe", "Reutilize"].map((word) => (
                      <span key={word} className="rounded-full bg-white/[0.06] px-3 py-1.5 text-sm font-semibold text-mist-100 ring-1 ring-inset ring-white/10">
                        {word}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {step === "role" && (
                <StepBody title="Como você participa da escola?" subtitle={SCHOOL.name}>
                  <div role="radiogroup" aria-label="Perfil" className="space-y-3">
                    {ROLE_OPTIONS.map(({ role: option, icon: Icon, description }) => (
                      <ChoiceCard key={option} selected={role === option} onSelect={() => setRole(option)}>
                        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-leaf-400/15 text-leaf-300">
                          <Icon className="size-6" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-display font-semibold text-mist-50">{ROLE_LABEL[option]}</span>
                          <span className="block text-sm text-mist-400">{description}</span>
                        </span>
                      </ChoiceCard>
                    ))}
                  </div>
                </StepBody>
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

              {step === "details" && role === "student" && (
                <StepBody title="Qual é a sua turma?" subtitle="Lista de exemplo. A lista oficial vem do cadastro da escola.">
                  {classesByLevel().map(([level, classes]) => (
                    <div key={level} className="space-y-2">
                      <p className="eyebrow">{EDUCATION_LEVEL_LABEL[level]}</p>
                      <div role="radiogroup" aria-label={EDUCATION_LEVEL_LABEL[level]} className="grid grid-cols-2 gap-2">
                        {classes.map((schoolClass) => (
                          <ChoiceChip key={schoolClass.id} selected={classId === schoolClass.id} onSelect={() => setClassId(schoolClass.id)}>
                            {schoolClass.name}
                          </ChoiceChip>
                        ))}
                      </div>
                    </div>
                  ))}
                </StepBody>
              )}

              {step === "details" && role !== "student" && (
                <StepBody title="Qual é a sua função?" subtitle="Ajuda a organizar a participação da comunidade escolar.">
                  {role === "staff" && (
                    <div className="space-y-2">
                      <p className="eyebrow">Setor</p>
                      <div role="radiogroup" aria-label="Setor" className="grid grid-cols-2 gap-2">
                        {STAFF_SECTORS.map((option) => (
                          <ChoiceChip key={option} selected={sector === option} onSelect={() => setSector(option)}>
                            {STAFF_SECTOR_LABEL[option]}
                          </ChoiceChip>
                        ))}
                      </div>
                    </div>
                  )}
                  <label className="block space-y-2">
                    <span className="text-sm font-semibold text-mist-100">Função</span>
                    <input
                      className={inputClass}
                      value={jobTitle}
                      onChange={(event) => setJobTitle(event.target.value)}
                      maxLength={40}
                      placeholder={role === "teacher" ? "Ex.: Professor de Ciências" : "Ex.: Técnica de laboratório"}
                    />
                  </label>
                </StepBody>
              )}

              {step === "privacy" && (
                <StepBody title="Seus dados" subtitle="Transparência sobre o que fica guardado.">
                  <Surface tone="leaf" className="space-y-3 p-4">
                    <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
                      <Smartphone className="size-5 text-leaf-300" aria-hidden /> Neste aparelho
                    </p>
                    <ul className="space-y-1.5 text-sm text-mist-300">
                      {["Apelido e avatar", "Perfil (estudante, professor ou funcionário)", "Turma ou função", "XP e histórico de missões"].map((item) => (
                        <li key={item} className="flex items-center gap-2">
                          <Check className="size-4 text-leaf-400" aria-hidden /> {item}
                        </li>
                      ))}
                    </ul>
                  </Surface>
                  <Surface className="space-y-2 p-4">
                    <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
                      <Lock className="size-5 text-aqua-300" aria-hidden /> Na conta oficial da escola (em breve)
                    </p>
                    <p className="text-sm leading-relaxed text-mist-300">
                      Nome, sobrenome e data de nascimento. Ficam protegidos, servem para indicadores autorizados e nunca
                      aparecem no ranking ou na timeline.
                    </p>
                  </Surface>
                  <p className="flex items-start gap-2 text-xs leading-relaxed text-mist-500">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                    Enquanto o login oficial não está ativo, este é um perfil de demonstração deste aparelho.
                  </p>
                </StepBody>
              )}
            </motion.section>
          </AnimatePresence>
        </div>

        <div className="sticky bottom-0 bg-linear-to-t from-abyss-900 via-abyss-900/95 to-transparent pb-5 pt-4">
          <Button
            size="lg"
            variant="leaf"
            className="w-full"
            disabled={!canAdvance[step]}
            onClick={() => (step === "privacy" ? finish() : go(1))}
          >
            {step === "intro" ? "Começar" : step === "privacy" ? "Entrar na EcoHorta" : "Continuar"}
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

function ChoiceCard({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-4 rounded-card border p-4 text-left transition-colors active:scale-[0.99]",
        selected ? "border-leaf-400/60 bg-leaf-400/10" : "border-white/[0.07] bg-abyss-800/80",
      )}
    >
      {children}
      <span
        aria-hidden
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full ring-1 ring-inset",
          selected ? "bg-leaf-400 text-abyss-950 ring-leaf-400" : "ring-white/20",
        )}
      >
        {selected && <Check className="size-4" strokeWidth={3} />}
      </span>
    </button>
  );
}

function ChoiceChip({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "h-12 rounded-control px-3 text-sm font-semibold transition-colors",
        selected ? "bg-leaf-400/15 text-leaf-300 ring-2 ring-inset ring-leaf-400/60" : "bg-white/[0.04] text-mist-200 ring-1 ring-inset ring-white/[0.08]",
      )}
    >
      {children}
    </button>
  );
}
