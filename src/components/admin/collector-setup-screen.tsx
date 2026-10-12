"use client";

import { motion } from "motion/react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Lock,
  MapPin,
  Palette,
  Radio,
  Ruler,
  School,
  Sparkles,
  Terminal,
  Wifi,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ScreenHeader } from "@/components/student/screen-header";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { useNow } from "@/hooks/use-now";
import { describeSilence } from "@/lib/collector/offline-estimate";
import type { SetupStep, SetupStepId } from "@/lib/collector/setup-journey";
import { createSetupApiSource, type SetupSource } from "@/lib/iot/setup-source";
import type { CollectorSetupView, FirmwarePackage } from "@/lib/server/collector-setup-service";
import { StickerLink } from "./collector-sticker-card";

/*
 * A TELA DE QUEM ESTÁ CONSTRUINDO UM CAPTADOR.
 *
 * Quem chega aqui tem um tubo de PVC, uma placa e nenhuma certeza. A tela
 * responde uma pergunta por vez — "o que eu faço agora?" — e mostra o caminho
 * inteiro, para a pessoa saber onde está e quanto falta.
 *
 * Uma etapa acesa, as feitas em verde e discretas, as seguintes trancadas com o
 * motivo escrito. Nada de abrir tudo ao mesmo tempo: um celular de 360 px com
 * seis painéis abertos é a mesma coisa que nenhuma orientação.
 *
 * A tela se atualiza sozinha porque a etapa da conexão não tem botão: ela acende
 * no segundo em que o ESP32 fala, e quem está instalando tem as duas mãos
 * ocupadas.
 */

const ICONS: Record<SetupStepId, typeof School> = {
  cadastro: School,
  montagem: Ruler,
  personalizacao: Palette,
  firmware: Terminal,
  conexao: Wifi,
  calibracao: Sparkles,
};

export function CollectorSetupScreen({ code }: { code: string }) {
  const source = useMemo(() => createSetupApiSource(code), [code]);
  useEffect(() => source.start(), [source]);
  const state = useSyncExternalStore(source.subscribe, source.getState, source.getServerState);
  const { view } = state;

  if (state.error) {
    return (
      <div className="space-y-5 pt-6">
        <ScreenHeader eyebrow="Construção" title={code} isSimulation={false} />
        <Surface tone="alert" className="p-5 text-sm leading-relaxed text-mist-100">
          {state.error}
        </Surface>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="space-y-3 pt-6" aria-busy="true" aria-label="Carregando">
        <Skeleton className="h-20 w-full rounded-card" />
        <Skeleton className="h-28 w-full rounded-card" />
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    );
  }

  const { journey } = view;
  const local = [view.school.city, view.school.state].filter(Boolean).join(" · ");

  return (
    <div className="space-y-5 pt-6">
      <ScreenHeader
        eyebrow={journey.live ? "Captador da rede" : "Em construção"}
        title={view.code}
        subtitle={`${view.location} · ${view.school.name}${local ? ` (${local})` : ""}`}
        isSimulation={false}
        isReal={journey.live}
      />

      {journey.live ? <LiveCard view={view} /> : <NowCard view={view} />}

      <ol className="space-y-3">
        {journey.steps.map((step) => (
          <li key={step.id}>
            <StepCard step={step} view={view} source={source} state={state} />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** O cartão que responde "o que eu faço agora?". Sempre o primeiro da tela. */
function NowCard({ view }: { view: CollectorSetupView }) {
  const { completed, total } = view.journey;
  return (
    <Surface tone="aqua" className="space-y-3 p-5">
      <p className="eyebrow">O que fazer agora</p>
      <p className="font-display text-xl font-bold leading-snug text-mist-50">{view.nextAction}</p>
      <ProgressBar value={completed / total} tone="aqua" label={`${completed} de ${total} etapas concluídas`} />
      <p className="text-xs text-mist-400">
        Etapa {Math.min(completed + 1, total)} de {total} · o captador entra na rede da escola quando for calibrado.
      </p>
    </Surface>
  );
}

/** Chegada: o tubo virou captador e ganhou o número da escola. */
function LiveCard({ view }: { view: CollectorSetupView }) {
  return (
    <Surface tone="leaf" className="space-y-2 p-5">
      <p className="eyebrow">Na rede de sustentabilidade</p>
      <p className="font-display text-xl font-bold leading-snug text-mist-50">
        {view.code} está ativo e aparece nas missões da escola.
      </p>
      {view.protoCode && <p className="text-sm text-mist-300">Durante a construção, este captador foi o {view.protoCode}.</p>}
    </Surface>
  );
}

interface PanelProps {
  view: CollectorSetupView;
  source: SetupSource;
  state: { busy: boolean; firmware: FirmwarePackage | null; firmwareWarning: string | null };
}

function StepCard({ step, view, source, state }: PanelProps & { step: SetupStep }) {
  const Icon = ICONS[step.id];
  const atual = step.state === "current";
  const feita = step.state === "done";

  return (
    <Surface tone={atual ? "raised" : "default"} className={atual ? "space-y-4 p-5" : "space-y-2 p-4"} aria-current={atual ? "step" : undefined}>
      <div className="flex items-start gap-3">
        <span
          className={
            feita
              ? "grid size-10 shrink-0 place-items-center rounded-2xl bg-leaf-400/15 text-leaf-300"
              : atual
                ? "grid size-10 shrink-0 place-items-center rounded-2xl bg-aqua-400/15 text-aqua-300"
                : "grid size-10 shrink-0 place-items-center rounded-2xl bg-white/[0.05] text-mist-500"
          }
        >
          {feita ? (
            <Check className="size-5" aria-hidden />
          ) : step.state === "locked" ? (
            <Lock className="size-4" aria-hidden />
          ) : (
            <Icon className="size-5" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className={feita || atual ? "font-display font-semibold text-mist-50" : "font-display font-semibold text-mist-400"}>{step.title}</p>
          {atual && <p className="mt-1 text-sm leading-relaxed text-mist-300">{step.summary}</p>}
          {step.state === "locked" && <p className="mt-1 text-sm leading-relaxed text-mist-500">{step.blockedBy}</p>}
        </div>
        {feita && <Chip tone="leaf">Feita</Chip>}
      </div>

      {atual && <StepPanel step={step.id} view={view} source={source} state={state} />}
    </Surface>
  );
}

/** O conteúdo da etapa acesa. Cada etapa tem a sua ferramenta, e só ela aparece. */
function StepPanel({ step, view, source, state }: PanelProps & { step: SetupStepId }) {
  switch (step) {
    case "cadastro":
      return null;
    case "montagem":
    case "personalizacao":
      return <ManualStepPanel step={step} view={view} source={source} state={state} />;
    case "firmware":
      return <FirmwarePanel view={view} source={source} state={state} />;
    case "conexao":
      return <ConnectionPanel view={view} />;
    case "calibracao":
      return <CalibrationPanel view={view} />;
  }
}

function ManualStepPanel({ step, view, source, state }: PanelProps & { step: "montagem" | "personalizacao" }) {
  const materiais = view.resources.filter((item) => item.step === step);

  return (
    <div className="space-y-3">
      {materiais.map((material) => (
        <div key={material.id} className="rounded-2xl bg-white/[0.04] p-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-mist-100">
            <FileText className="size-4 text-aqua-300" aria-hidden />
            {material.title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-mist-400">{material.description}</p>
          {material.href ? (
            <motion.a
              href={material.href}
              target="_blank"
              rel="noreferrer"
              whileTap={{ scale: 0.97 }}
              className="mt-3 flex h-11 items-center justify-center gap-2 rounded-control bg-white/[0.07] text-sm font-semibold text-mist-50 ring-1 ring-inset ring-white/10"
            >
              <Download className="size-4" aria-hidden />
              Baixar PDF
            </motion.a>
          ) : (
            <p className="mt-3 rounded-xl bg-sun-400/10 px-3 py-2 text-xs leading-relaxed text-sun-300">{material.pending}</p>
          )}
        </div>
      ))}

      {step === "personalizacao" && (
        <div className="rounded-2xl bg-white/[0.04] p-3.5">
          <p className="text-sm font-semibold text-mist-100">Adesivo com o QR deste captador</p>
          <p className="mt-1 text-xs leading-relaxed text-mist-400">
            Sem ele colado no tubo, ninguém valida este captador nem faz missão nele.
          </p>
          <div className="mt-3">
            <StickerLink code={view.code} />
          </div>
        </div>
      )}

      <Button
        variant="leaf"
        onClick={() => void source.markStep(step, true)}
        disabled={state.busy}
        className="w-full"
        icon={<Check className="size-5" aria-hidden />}
      >
        {step === "montagem" ? "Montei o captador" : "Personalizei o captador"}
      </Button>
      <p className="text-xs leading-relaxed text-mist-500">
        Esta etapa é você que marca: a plataforma não tem como ver um tubo montado. As próximas ela confere sozinha.
      </p>
    </div>
  );
}

function FirmwarePanel({ source, state }: PanelProps) {
  const pacote = state.firmware;

  const gerar = async (confirmReplacement: boolean) => {
    const antes = state.firmware;
    const result = await source.issueFirmware(confirmReplacement);
    if (!result.ok) return;
    const gerado = source.getState().firmware;
    if (gerado && gerado !== antes) baixar(gerado.fileName, gerado.content);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-mist-300">
        A plataforma gera o arquivo <code className="text-aqua-300">secrets.h</code> com a identidade deste captador. A senha do Wi-Fi da
        escola não vai nele: a própria placa pergunta a rede, na etapa seguinte.
      </p>

      {state.firmwareWarning && (
        <div className="space-y-3 rounded-2xl bg-alert-400/12 p-3.5">
          <p className="flex items-start gap-2 text-sm leading-relaxed text-mist-100">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-alert-400" aria-hidden />
            {state.firmwareWarning}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={source.dismissFirmwareWarning} className="flex-1">
              Deixar como está
            </Button>
            <Button variant="danger" size="sm" onClick={() => void gerar(true)} disabled={state.busy} className="flex-1">
              Gerar mesmo assim
            </Button>
          </div>
        </div>
      )}

      <Button
        variant="primary"
        onClick={() => void gerar(false)}
        disabled={state.busy}
        className="w-full"
        icon={<Download className="size-5" aria-hidden />}
      >
        {state.busy ? "Gerando…" : pacote ? "Baixar de novo (gera outro token)" : "Baixar o programa desta placa"}
      </Button>

      {pacote && (
        <>
          <p className="rounded-2xl bg-sun-400/10 px-3 py-2.5 text-xs leading-relaxed text-sun-300">
            O arquivo baixou. Ele contém o token desta placa: não compartilhe e não versione. Se perder, gere outro — e a placa precisará ser
            regravada.
          </p>
          <FlashingSteps guide={pacote.guide} />
        </>
      )}
    </div>
  );
}

/** O passo a passo da gravação. Aparece depois do download, que é quando serve. */
function FlashingSteps({ guide }: { guide: FirmwarePackage["guide"] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-2xl bg-white/[0.04]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left text-sm font-semibold text-mist-100"
      >
        Como gravar na placa, passo a passo
        <ChevronDown className={open ? "size-4 shrink-0 rotate-180 transition-transform" : "size-4 shrink-0 transition-transform"} aria-hidden />
      </button>
      {open && (
        <ol className="space-y-3.5 border-t border-white/[0.06] px-3.5 py-3.5">
          {guide.map((passo) => (
            <li key={passo.title} className="space-y-1.5">
              <p className="text-sm font-semibold text-mist-100">{passo.title}</p>
              {passo.lines.map((linha) => (
                <p key={linha} className="text-xs leading-relaxed text-mist-400">
                  {linha}
                </p>
              ))}
              {passo.copy && <CopyLine text={passo.copy} />}
              {passo.whenItFails && (
                <p className="rounded-xl bg-white/[0.04] px-2.5 py-2 text-xs leading-relaxed text-mist-400">
                  <span className="font-semibold text-sun-300">Se travar: </span>
                  {passo.whenItFails}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ConnectionPanel({ view }: { view: CollectorSetupView }) {
  const now = useNow(30_000);
  if (!view.network) {
    return <p className="text-sm leading-relaxed text-mist-300">Este captador foi cadastrado antes da rede de configuração.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-mist-300">
        Ligue a placa. Ela cria a própria rede Wi-Fi e abre uma página com as redes do lugar: escolha a da escola e digite a senha dela. A
        senha fica guardada na placa.
      </p>
      <div className="space-y-2 rounded-2xl bg-white/[0.04] p-3.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-mist-100">
          <Radio className="size-4 text-aqua-300" aria-hidden />
          Rede deste captador
        </p>
        <CopyLine label="Rede" text={view.network.ssid} />
        <CopyLine label="Senha" text={view.network.password} />
        <p className="text-xs leading-relaxed text-mist-400">
          Se a página não abrir sozinha, digite <span className="text-mist-200">192.168.4.1</span> no navegador.
        </p>
      </div>
      <p className="rounded-2xl bg-aqua-400/10 px-3 py-2.5 text-xs leading-relaxed text-aqua-200">
        Guarde este nome e esta senha: são os mesmos que um estudante usa no ponto de acesso do celular para atender o captador quando a
        internet da escola cai.
      </p>
      {view.lastSeenAt !== null && now !== null && (
        <p className="text-xs text-mist-400">A placa falou com a plataforma {describeSilence(now - view.lastSeenAt)}.</p>
      )}
    </div>
  );
}

function CalibrationPanel({ view }: { view: CollectorSetupView }) {
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-mist-300">
        Última etapa. Com água medida — 0, 1, 2, 3 litros e o nível máximo — a plataforma aprende a converter distância em litros. É a
        calibração que habilita o captador: ao ser aceita, ele assume o código da escola e passa a aparecer nas missões.
      </p>
      <Link
        href={`/admin/captadores/${encodeURIComponent(view.code)}/calibracao`}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-control bg-linear-to-b from-leaf-300 to-leaf-500 font-semibold text-abyss-950"
      >
        <Sparkles className="size-5" aria-hidden />
        Abrir a calibração
      </Link>
      <p className="flex items-start gap-2 text-xs leading-relaxed text-mist-400">
        <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Faça a calibração junto ao captador: cada ponto vem da leitura do sensor, nenhum é digitado.
      </p>
    </div>
  );
}

/** Valor para copiar. No pátio, com uma mão no tubo, ninguém quer digitar nada. */
function CopyLine({ label, text }: { label?: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className="flex w-full items-center justify-between gap-2 rounded-xl bg-abyss-950/50 px-3 py-2.5 text-left"
    >
      <span className="min-w-0">
        {label && <span className="block text-[0.7rem] uppercase tracking-wide text-mist-500">{label}</span>}
        <span className="block truncate font-mono text-sm text-mist-100">{text}</span>
      </span>
      {copied ? <Check className="size-4 shrink-0 text-leaf-300" aria-hidden /> : <Copy className="size-4 shrink-0 text-mist-400" aria-hidden />}
    </button>
  );
}

/**
 * Baixa o arquivo gerado a partir da resposta que já está na memória.
 *
 * Não existe link de download: visitar um link geraria um token novo, e um
 * navegador que pré-carrega links calaria um captador sem ninguém pedir.
 */
function baixar(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
