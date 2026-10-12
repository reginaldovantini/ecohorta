"use client";

import { motion } from "motion/react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Cpu,
  Droplets,
  FileText,
  FlaskConical,
  Hammer,
  Ruler,
  ScanLine,
  Send,
  Sprout,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { EcoHortaLogo } from "@/components/brand/ecohorta-logo";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { UF_LIST } from "@/lib/server/school-registry";

/*
 * A PÁGINA QUE FAZ A REDE CRESCER.
 *
 * Ela fala com uma pessoa específica: um professor que ouviu falar do projeto e
 * está decidindo se vale o trabalho. Ele não quer um aplicativo — quer uma aula
 * que os estudantes lembrem, e não quer começar do zero.
 *
 * Por isso a ordem é a da objeção, não a do nosso orgulho: primeiro o problema
 * que ele já conhece (a água pingando no pátio), depois o que os estudantes
 * fazem com as próprias mãos, depois o que ele recebe pronto, e só então o
 * formulário. Falar da plataforma antes de falar da aula seria vender software
 * para quem precisa de projeto pedagógico.
 *
 * Nenhum número de impacto aparece. Enquanto a primeira escola ainda monta o
 * captador, "12.480 litros reaproveitados" seria mentira — e mentir para quem
 * estamos convidando para uma parceria é um jeito ruim de começar.
 */

const inputBase =
  "h-12 rounded-control bg-white/[0.05] px-4 text-base text-mist-50 outline-none ring-1 ring-inset ring-white/10 transition-shadow placeholder:text-mist-500 focus:ring-2 focus:ring-aqua-400";
const inputClass = `${inputBase} w-full`;

/** O que a escola recebe pronto. Cada item responde a um "mas eu não sei fazer". */
const RECEBE = [
  { icon: FileText, title: "Manual de construção", text: "Lista de materiais, corte do tubo, posição do sensor e da torneira, passo a passo." },
  { icon: Cpu, title: "Programa da placa", text: "Gerado pela plataforma para o seu captador. Você baixa e grava — sem escrever código." },
  { icon: ScanLine, title: "Adesivo com QR Code", text: "PDF pronto para a gráfica. É ele que libera as missões no tubo da sua escola." },
  { icon: Ruler, title: "Calibração guiada", text: "A plataforma conduz a medição com volumes conhecidos e diz quando ficou confiável." },
];

/** Onde cada disciplina entra. Conteúdo real, não etiqueta. */
const STEM = [
  {
    icon: FlaskConical,
    area: "Ciências",
    text: "Condensação, umidade relativa, ciclo da água — medidos no pátio da escola, não no livro.",
  },
  {
    icon: Cpu,
    area: "Tecnologia",
    text: "Sensor de distância, microcontrolador, telemetria. Os estudantes veem o dado sair do tubo e chegar na tela.",
  },
  {
    icon: Hammer,
    area: "Engenharia",
    text: "Projetar, cortar, vedar, instalar e consertar. O protótipo falha e é consertado por quem o construiu.",
  },
  {
    icon: Ruler,
    area: "Matemática",
    text: "Calibração por mínimos quadrados, erro, coeficiente de determinação. A régua do tubo é feita pela turma.",
  },
];

/** Os passos, do convite ao primeiro litro medido. */
const PASSOS = [
  { title: "Você se candidata", text: "Preenche o formulário aqui embaixo. Leva dois minutos." },
  { title: "Autorizamos o seu e-mail", text: "A sua escola entra na plataforma e você vira administrador dela." },
  { title: "Vocês constroem o captador", text: "Com o manual, em sala ou no contraturno. É a parte que os estudantes lembram." },
  { title: "A plataforma reconhece o tubo", text: "Você grava o programa, conecta à rede da escola e calibra com água medida." },
  { title: "As missões começam", text: "O captador entra na rede, ganha o código da escola e os estudantes passam a cumprir missões." },
];

export function PartnershipScreen() {
  return (
    <main className="relative mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-safe pt-safe">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-linear-to-b from-leaf-900/35 to-transparent" />

      <header className="pt-6">
        <EcoHortaLogo />
      </header>

      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 28 }}
        className="py-8"
      >
        <p className="eyebrow text-leaf-300">Convite a professores</p>
        <h1 className="mt-2 font-display text-[2.15rem] font-bold leading-[1.08] tracking-tight text-mist-50">
          A sua escola joga água fora
          <br />
          <span className="text-leaf-300">todos os dias.</span>
        </h1>
        <span aria-hidden className="mt-4 block h-1 w-12 rounded-full bg-leaf-400" />
        <p className="mt-4 text-[0.98rem] leading-relaxed text-mist-300">
          Cada aparelho de ar-condicionado ligado produz água limpa, hora após hora, e ela escorre para o ralo. A EcoHorta
          transforma esse desperdício numa aula: os estudantes constroem o captador, medem a água e a devolvem para a
          horta — e cada litro conta.
        </p>
      </motion.section>

      <Section title="Por que isso é uma aula, e não um aparelho">
        <p className="text-[0.92rem] leading-relaxed text-mist-300">
          O captador não se rega sozinho e não deve mesmo. A plataforma mede a água e abre a torneira quando um estudante
          está na frente do tubo — a missão só conclui pelo volume que o sensor viu sair. Sem estudante, nada acontece.
        </p>
        <p className="mt-3 text-[0.92rem] leading-relaxed text-mist-300">
          É essa diferença que faz o projeto ser STEM de verdade: quem calibra o tubo é a turma, com água, régua e
          matemática.
        </p>

        <ul className="mt-5 space-y-3">
          {STEM.map(({ icon: Icon, area, text }) => (
            <li key={area} className="flex gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-2xl bg-leaf-400/12 text-leaf-300">
                <Icon className="size-[1.05rem]" aria-hidden />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm font-semibold text-mist-100">{area}</p>
                <p className="text-xs leading-relaxed text-mist-400">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="O que a sua escola recebe">
        <ul className="space-y-2.5">
          {RECEBE.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <Surface className="flex gap-3 p-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-2xl bg-aqua-400/12 text-aqua-300">
                  <Icon className="size-[1.05rem]" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-mist-100">{title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-mist-400">{text}</p>
                </div>
              </Surface>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-mist-500">
          Tudo sem custo de plataforma. O que a escola coloca é o tubo, a placa, o sensor — e um professor disposto a
          conduzir.
        </p>
      </Section>

      <Section title="Como funciona, do convite ao primeiro litro">
        <ol className="space-y-3.5">
          {PASSOS.map((passo, index) => (
            <li key={passo.title} className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-leaf-400 text-xs font-bold text-abyss-950">
                {index + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm font-semibold text-mist-100">{passo.title}</p>
                <p className="text-xs leading-relaxed text-mist-400">{passo.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="O que construímos juntos">
        <Surface tone="leaf" className="space-y-3 p-5">
          <p className="flex items-start gap-2.5 text-[0.92rem] leading-relaxed text-mist-200">
            <Sprout className="mt-0.5 size-4 shrink-0 text-leaf-300" aria-hidden />
            Cada escola que entra soma ao placar da rede. O impacto deixa de ser o de um tubo e passa a ser o de um
            conjunto de escolas medindo a mesma coisa, do mesmo jeito.
          </p>
          <p className="flex items-start gap-2.5 text-[0.92rem] leading-relaxed text-mist-200">
            <Users className="mt-0.5 size-4 shrink-0 text-leaf-300" aria-hidden />
            E o que a sua turma aprender melhora o manual da próxima escola. É assim que um protótipo vira método.
          </p>
        </Surface>
      </Section>

      <PartnershipForm />

      <footer className="pb-8 pt-2 text-center text-[0.72rem] leading-relaxed text-mist-500">
        <p>EcoHorta Inteligente · EE Prof.ª Clarinda Mendes de Aquino</p>
        <p className="mt-2">
          <Link href="/entrar" className="font-semibold text-mist-400 underline-offset-2 hover:text-mist-200 hover:underline">
            Já sou parceiro, quero entrar
          </Link>
          <span className="mx-2 text-mist-600" aria-hidden>
            ·
          </span>
          <Link href="/privacidade" className="font-semibold text-mist-400 underline-offset-2 hover:text-mist-200 hover:underline">
            Privacidade
          </Link>
        </p>
      </footer>
    </main>
  );
}

/*
 * Seção sem animação de entrada, de propósito.
 *
 * A versão anterior aparecia ao rolar (`whileInView`), e o conteúdo ficava
 * invisível até lá. Numa página feita para convencer — que alguém pode imprimir,
 * mandar para a direção ou abrir num navegador que não dispara o observador —
 * texto que depende de rolagem para existir é risco sem retorno.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-white/[0.06] py-7">
      <h2 className="mb-4 font-display text-[1.25rem] font-bold leading-snug text-mist-50">{title}</h2>
      {children}
    </section>
  );
}

/*
 * O formulário.
 *
 * Pede o mínimo para a decisão existir: quem é, onde ensina, e como falar com a
 * pessoa. O e-mail é o do Google porque é por ele que a autorização é concedida
 * — e isso está escrito ali, para ninguém digitar o e-mail institucional que
 * não usa para entrar.
 */
function PartnershipForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [message, setMessage] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valido =
    name.trim().length >= 2 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) &&
    schoolName.trim().length >= 3 &&
    city.trim().length >= 2 &&
    state.length === 2;

  const enviar = async () => {
    if (!valido || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const response = await fetch("/api/parceria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          jobTitle: jobTitle.trim() || null,
          schoolName: schoolName.trim(),
          city: city.trim(),
          state,
          message: message.trim() || null,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setErro(body.error ?? "Não foi possível enviar. Tente novamente.");
        return;
      }
      setEnviado(true);
    } catch {
      setErro("Sem conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <section id="parceria" className="border-t border-white/[0.06] py-8">
        <Surface tone="leaf" className="space-y-3 p-6 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-leaf-400/20 text-leaf-300">
            <Check className="size-7" aria-hidden />
          </span>
          <h2 className="font-display text-xl font-bold text-mist-50">Pedido recebido</h2>
          <p className="text-sm leading-relaxed text-mist-300">
            Vamos analisar e autorizar o seu e-mail. Quando isso acontecer, é só entrar com a sua conta Google: a sua
            escola já vai estar lá, e a área de captadores aparece no seu perfil.
          </p>
          <Link
            href="/entrar"
            className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-control bg-white/[0.07] font-semibold text-mist-50 ring-1 ring-inset ring-white/10"
          >
            Ir para a entrada
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Surface>
      </section>
    );
  }

  return (
    <section id="parceria" className="border-t border-white/[0.06] py-8">
      <h2 className="font-display text-[1.35rem] font-bold leading-snug text-mist-50">
        Quero construir um captador na <span className="text-leaf-300">minha escola</span>
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-mist-400">
        Preencha e a gente responde. Sem custo e sem compromisso de prazo — o ritmo é o da sua turma.
      </p>

      <div className="mt-5 space-y-3">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" autoComplete="name" />
        <input
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Seu e-mail do Google"
          type="email"
          inputMode="email"
          autoComplete="email"
        />
        <p className="-mt-1 px-1 text-xs leading-relaxed text-mist-500">
          Precisa ser a conta Google com que você vai entrar na plataforma: é por ela que a autorização é concedida.
        </p>
        <input
          className={inputClass}
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="Sua função na escola (opcional)"
        />
        <input className={inputClass} value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="Nome da escola" />
        <div className="flex gap-2">
          <input
            className={`${inputBase} min-w-0 flex-1`}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Município"
          />
          <select
            className={`${inputBase} w-[5.5rem] shrink-0`}
            value={state}
            onChange={(e) => setState(e.target.value)}
            aria-label="Estado"
          >
            <option value="">UF</option>
            {UF_LIST.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className={`${inputClass} h-24 py-3`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Conte um pouco da sua escola (opcional)"
          maxLength={600}
        />

        {erro && (
          <p role="alert" className="rounded-2xl bg-alert-400/12 px-3.5 py-3 text-sm leading-relaxed text-mist-100">
            {erro}
          </p>
        )}

        <Button
          size="lg"
          variant="leaf"
          className="w-full"
          onClick={() => void enviar()}
          disabled={!valido || enviando}
          icon={<Send className="size-5" aria-hidden />}
        >
          {enviando ? "Enviando…" : "Quero ser parceiro"}
        </Button>

        <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-mist-500">
          <BookOpen className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Usamos estes dados só para responder ao seu pedido e criar a sua escola na plataforma.{" "}
          <Link href="/privacidade" className="font-semibold text-mist-400 underline">
            Política de Privacidade
          </Link>
        </p>
      </div>
    </section>
  );
}

/** Ícone reutilizado pela tela de entrada ao convidar para a parceria. */
export const PartnershipIcon = Droplets;
