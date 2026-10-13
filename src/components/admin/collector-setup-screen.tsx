"use client";

import { motion } from "motion/react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  KeyRound,
  MapPin,
  QrCode,
  Radio,
  Ruler,
  School,
  ShieldCheck,
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
import { CollectorStickerCard } from "./collector-sticker-card";
import { DownloadLink } from "./download-link";

/*
 * A TELA DE QUEM ESTÁ CONSTRUINDO UM CAPTADOR.
 *
 * Quem chega aqui tem um tubo de PVC, uma placa e nenhuma certeza. A tela
 * responde uma pergunta por vez — "o que eu faço agora?" — e mostra o caminho
 * inteiro, para a pessoa saber onde está e quanto falta.
 *
 * Uma etapa acesa, as feitas em verde e discretas, as seguintes trancadas com o
 * motivo escrito. Nada de abrir tudo ao mesmo tempo: um celular de 360 px com
 * sete painéis abertos é a mesma coisa que nenhuma orientação.
 *
 * A tela se atualiza sozinha porque a etapa da conexão não tem botão: ela acende
 * no segundo em que o ESP32 fala, e quem está instalando tem as duas mãos
 * ocupadas.
 */

const ICONS: Record<SetupStepId, typeof School> = {
  cadastro: School,
  montagem: Ruler,
  identificacao: QrCode,
  firmware: Terminal,
  conexao: Wifi,
  calibracao: Sparkles,
  verificacao: ShieldCheck,
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

      {/*
        A linha do tempo. O fio à esquerda é o que transforma sete cartões numa
        jornada: ele mostra, sem texto nenhum, quanto do caminho já ficou para
        trás — e é verde só até onde é verdade.
      */}
      <ol className="space-y-3">
        {journey.steps.map((step, index) => (
          <li key={step.id} className="grid grid-cols-[2.25rem_1fr] gap-3">
            <TimelineMarker step={step} number={index + 1} last={index === journey.steps.length - 1} />
            <StepCard step={step} view={view} source={source} state={state} />
          </li>
        ))}
      </ol>

      <CredentialsCard view={view} source={source} state={state} />
    </div>
  );
}

/**
 * AS CREDENCIAIS DESTE CAPTADOR, PARA CONSULTAR QUANDO PRECISAR.
 *
 * Fica fora da linha do tempo porque não é etapa: é a gaveta onde se procura
 * uma coisa meses depois, quando o captador já está na rede e alguém precisa
 * socorrê-lo no pátio.
 *
 * As duas credenciais são de naturezas diferentes, e a tela não finge que são
 * iguais. A rede do captador está sempre aqui: ela é combinada entre o aparelho
 * e quem está na frente dele, não protege dado nenhum, e o estudante precisa
 * dela para atender o tubo offline. Já o código de responsável DÁ PODER sobre o
 * captador — por isso o banco guarda só o hash dele, e por isso ele não se
 * recupera: emite-se outro, e o papel dentro da caixa é trocado.
 */
function CredentialsCard({ view, source, state }: PanelProps) {
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const emitir = async () => {
    setErro(null);
    const result = await source.reissueStewardCode();
    setConfirmando(false);
    if (!result.ok) setErro(result.message);
  };

  return (
    <section className="space-y-3" aria-labelledby="credenciais-title">
      <h2 id="credenciais-title" className="flex items-center gap-2 font-display text-lg font-bold text-mist-50">
        <KeyRound className="size-5 text-aqua-300" aria-hidden /> Credenciais do captador
      </h2>

      {view.network && (
        <Surface className="space-y-2 p-4">
          <p className="text-sm font-semibold text-mist-100">Rede do captador</p>
          <p className="text-xs leading-relaxed text-mist-400">
            A rede que a placa cria. Serve para configurar o Wi-Fi da escola e para um estudante atender o captador
            quando a internet cai. Fica sempre aqui.
          </p>
          <CopyLine label="Rede" text={view.network.ssid} />
          <CopyLine label="Senha" text={view.network.password} />
        </Surface>
      )}

      <Surface className="space-y-3 p-4">
        <p className="text-sm font-semibold text-mist-100">Código de responsável</p>
        <p className="text-xs leading-relaxed text-mist-400">
          Quem digita este código passa a conduzir a construção e a calibração deste captador, mesmo sem administrar a
          escola. Guarde impresso dentro da caixa eletrônica.
        </p>

        {state.stewardCode ? (
          <>
            <CopyLine text={state.stewardCode} />
            <p className="rounded-xl bg-sun-400/10 px-3 py-2 text-xs leading-relaxed text-sun-300">
              Anote agora: ao sair desta tela ele some. O código anterior deixou de valer — troque o papel dentro da
              caixa.
            </p>
            <Button variant="secondary" className="w-full" onClick={() => source.forgetStewardCode()}>
              Anotei, pode esconder
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-mist-500">
              A plataforma guarda só o resultado de uma conta sobre o código — nem ela consegue mostrá-lo de novo. Se o
              papel se perdeu, emita outro.
            </p>
            {confirmando ? (
              <div className="space-y-2 rounded-2xl bg-alert-400/12 p-3.5">
                <p className="text-sm leading-relaxed text-mist-100">
                  O código atual para de funcionar agora. Quem já aderiu continua responsável; quem só tem o papel
                  antigo, não.
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setConfirmando(false)} disabled={state.busy}>
                    Cancelar
                  </Button>
                  <Button variant="leaf" className="flex-1" onClick={() => void emitir()} disabled={state.busy}>
                    Emitir novo
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" className="w-full" onClick={() => setConfirmando(true)} disabled={state.busy}>
                Emitir um código novo
              </Button>
            )}
            {erro && <p className="text-xs leading-relaxed text-alert-300">{erro}</p>}
          </>
        )}
      </Surface>
    </section>
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
  state: { busy: boolean; firmware: FirmwarePackage | null; firmwareWarning: string | null; stewardCode: string | null };
}

/**
 * O marcador de uma etapa no fio da jornada.
 *
 * Etapa cumprida leva visto; a atual, o ícone do que se faz nela; as que ainda
 * esperam levam o NÚMERO, e não um cadeado. O cadeado dizia "você não pode", e
 * o número diz "a sua vez chega" — para quem está montando o primeiro captador,
 * a diferença entre as duas frases é continuar ou parar.
 */
function TimelineMarker({ step, number, last }: { step: SetupStep; number: number; last: boolean }) {
  const Icon = ICONS[step.id];
  const feita = step.state === "done";
  const atual = step.state === "current";

  return (
    <div className="relative flex justify-center">
      {!last && (
        <span
          aria-hidden
          className={`absolute left-1/2 top-9 -ml-px h-[calc(100%-1.5rem)] w-0.5 rounded-full ${
            feita ? "bg-leaf-400/40" : "bg-white/[0.07]"
          }`}
        />
      )}
      <span
        className={`relative grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold ${
          feita
            ? "bg-leaf-400/20 text-leaf-300 ring-1 ring-inset ring-leaf-400/40"
            : atual
              ? "bg-aqua-400/20 text-aqua-200 ring-2 ring-inset ring-aqua-400/60"
              : "bg-white/[0.04] text-mist-500 ring-1 ring-inset ring-white/[0.08]"
        }`}
      >
        {feita ? <Check className="size-4" aria-hidden /> : atual ? <Icon className="size-4" aria-hidden /> : number}
      </span>
    </div>
  );
}

function StepCard({ step, view, source, state }: PanelProps & { step: SetupStep }) {
  const atual = step.state === "current";
  const feita = step.state === "done";

  return (
    <Surface
      tone={atual ? "raised" : "default"}
      className={atual ? "min-w-0 space-y-4 p-4" : "min-w-0 space-y-2 p-3.5"}
      aria-current={atual ? "step" : undefined}
    >
      <div className="flex items-start gap-2">
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
    case "identificacao":
      return <ManualStepPanel step={step} view={view} source={source} state={state} />;
    case "firmware":
      return <FirmwarePanel view={view} source={source} state={state} />;
    case "conexao":
      return <ConnectionPanel view={view} />;
    case "calibracao":
      return <CalibrationPanel view={view} />;
    case "verificacao":
      return <VerificationPanel view={view} />;
  }
}

function ManualStepPanel({ step, view, source, state }: PanelProps & { step: "montagem" | "identificacao" }) {
  const materiais = view.resources.filter((item) => item.step === step);

  return (
    <div className="space-y-3">
      {step === "montagem" && (
        <GuiaPdf
          code={view.code}
          guide="construcao"
          titulo="Manual de construção deste captador"
          descricao={`Materiais, cortes, posição do sensor e ligação — já com as medidas do ${view.code} e o sensor que você escolheu.`}
        />
      )}
      {step === "identificacao" && <CollectorStickerCard code={view.code} location={view.location} />}
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

      <Button
        variant="leaf"
        onClick={() => void source.markStep(step, true)}
        disabled={state.busy}
        className="w-full"
        icon={<Check className="size-5" aria-hidden />}
      >
        {step === "montagem" ? "Montei o captador" : "Colei o adesivo no tubo"}
      </Button>
      <p className="text-xs leading-relaxed text-mist-500">
        {step === "montagem"
          ? "Esta etapa é você que marca: a plataforma não tem como ver um tubo montado. As próximas ela confere sozinha."
          : "Esta etapa é você que marca: a plataforma não tem como ver um adesivo colado. As próximas ela confere sozinha."}
      </p>
    </div>
  );
}

function FirmwarePanel({ view, source, state }: PanelProps) {
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

      {/*
        O guia impresso vem antes do arquivo: quem grava a placa sai de perto do
        telefone e vai para um computador, e o papel é o que atravessa com ele.
      */}
      <GuiaPdf
        code={view.code}
        guide="firmware"
        titulo="Guia de gravação, passo a passo"
        descricao="Quais programas instalar, onde baixar cada um, como ligar a placa e o que fazer quando der errado. Escrito para quem nunca programou."
      />

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
          <p role="status" className="rounded-2xl bg-leaf-400/10 px-3 py-2.5 text-xs leading-relaxed text-leaf-300">
            <span className="font-semibold">{pacote.fileName}</span> foi para a pasta <span className="font-semibold">Downloads</span> do
            aparelho.
          </p>
          <SecretsFallback pacote={pacote} />
          <p className="rounded-2xl bg-sun-400/10 px-3 py-2.5 text-xs leading-relaxed text-sun-300">
            Ele contém o token desta placa: não compartilhe e não versione. Se perder, gere outro — e a placa precisará ser regravada.
          </p>
          <FlashingSteps guide={pacote.guide} />
        </>
      )}
    </div>
  );
}

/** O passo a passo da gravação. Aparece depois do download, que é quando serve. */
/** Manual em PDF desta etapa, montado na hora para este captador. */
function GuiaPdf({ code, guide, titulo, descricao }: { code: string; guide: "construcao" | "firmware"; titulo: string; descricao: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] p-3.5">
      <p className="flex items-center gap-2 text-sm font-semibold text-mist-100">
        <FileText className="size-4 text-aqua-300" aria-hidden />
        {titulo}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-mist-400">{descricao}</p>
      <div className="mt-3">
        <DownloadLink
          href={`/api/admin/collectors/${encodeURIComponent(code)}/guides/${guide}`}
          fileName={`${guide === "construcao" ? "manual-construcao" : "manual-gravacao"}-${code}.pdf`}
          viewHref={`/api/admin/collectors/${encodeURIComponent(code)}/guides/${guide}?abrir=1`}
          label="Baixar PDF para imprimir"
        />
      </div>
    </div>
  );
}

/**
 * O MESMO ARQUIVO, QUANDO O DOWNLOAD NÃO BASTA.
 *
 * Dois casos reais. O primeiro: dentro do aplicativo instalado, um download
 * nem sempre dá sinal de vida, e a pessoa fica sem saber se tem o arquivo.
 * O segundo, mais comum: ela está no celular e o arquivo precisa estar no
 * COMPUTADOR, onde a placa vai ser gravada.
 *
 * Para os dois, o conteúdo na tela com um botão de copiar resolve — e copiar
 * funciona em qualquer navegador, sem depender de pasta, permissão ou gerenciador
 * de downloads.
 */
function SecretsFallback({ pacote }: { pacote: FirmwarePackage }) {
  const [aberto, setAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);

  return (
    <div className="rounded-2xl bg-white/[0.04]">
      <button
        type="button"
        onClick={() => setAberto((valor) => !valor)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left text-sm font-semibold text-mist-100"
      >
        Não achou o arquivo? Copie o conteúdo
        <ChevronDown className={aberto ? "size-4 shrink-0 rotate-180 transition-transform" : "size-4 shrink-0 transition-transform"} aria-hidden />
      </button>
      {aberto && (
        <div className="space-y-2 border-t border-white/[0.06] px-3.5 py-3.5">
          <p className="text-xs leading-relaxed text-mist-400">
            Se você está no celular, o arquivo precisa ir para o computador onde a placa será gravada. Copie daqui e cole
            num arquivo chamado <code className="text-aqua-300">{pacote.fileName}</code>, dentro de{" "}
            <code className="text-aqua-300">firmware/include/</code>.
          </p>
          <pre className="max-h-56 overflow-auto rounded-xl bg-abyss-950/60 p-3 text-[0.65rem] leading-relaxed text-mist-300">
            {pacote.content}
          </pre>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              void navigator.clipboard?.writeText(pacote.content);
              setCopiado(true);
              setTimeout(() => setCopiado(false), 1600);
            }}
            icon={<Copy className="size-4" aria-hidden />}
          >
            {copiado ? "Copiado" : "Copiar o conteúdo"}
          </Button>
        </div>
      )}
    </div>
  );
}

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
          {guide.map((passo, index) => (
            <li key={passo.title} className="space-y-1.5">
              <p className="text-sm font-semibold text-mist-100">
                {index + 1}. {passo.title}
              </p>
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

/**
 * A SÉTIMA ETAPA: o captador está no ar?
 *
 * Esta tela não pede nada. Ela existe porque percorrer seis etapas e ficar sem
 * saber se deu certo é pior do que não ter começado — e porque "deu certo" aqui
 * tem significado exato: a placa falou faz pouco, a calibração vale para o
 * sensor de hoje, e o captador tem o número da escola.
 *
 * Quando algo falta, a tela diz o que falta. Nunca diz "pronto" por otimismo.
 */
function VerificationPanel({ view }: { view: CollectorSetupView }) {
  // `null` no servidor: antes de montar não há relógio, e o silêncio fica sem
  // medida em vez de inventar uma.
  const agora = useNow(30_000);
  const silencio = agora === null || view.lastSeenAt === null ? null : agora - view.lastSeenAt;
  const falandoAgora = silencio !== null && silencio < 10 * 60_000;

  const conferencias = [
    {
      ok: view.lastSeenAt !== null,
      titulo: "A placa fala com a plataforma",
      detalhe:
        view.lastSeenAt === null
          ? "Nenhuma leitura recebida até agora."
          : falandoAgora || silencio === null
            ? "Leitura recebida agora há pouco."
            : `Última leitura ${describeSilence(silencio)}. Confira a energia e o Wi-Fi do captador.`,
    },
    {
      ok: view.journey.steps.find((step) => step.id === "calibracao")!.state === "done",
      titulo: "A calibração vale para este sensor",
      detalhe:
        view.journey.steps.find((step) => step.id === "calibracao")!.state === "done"
          ? "Os litros que o app mostra vêm desta calibração."
          : "Sem calibração aceita, o captador mede distância mas não entrega litros.",
    },
    {
      ok: view.protoCode !== null || view.code.startsWith("ECO"),
      titulo: "O captador tem o número da escola",
      detalhe:
        view.protoCode !== null
          ? `Era ${view.protoCode} enquanto era obra. Agora é ${view.code}.`
          : view.code.startsWith("ECO")
            ? `Este captador é o ${view.code} da escola.`
            : "O número da escola é assumido quando a calibração é aceita.",
    },
  ];

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {conferencias.map((item) => (
          <li key={item.titulo} className="flex gap-3 rounded-2xl bg-white/[0.04] p-3.5">
            <span
              className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${
                item.ok ? "bg-leaf-400/20 text-leaf-300" : "bg-sun-400/15 text-sun-300"
              }`}
            >
              {item.ok ? <Check className="size-3.5" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-mist-100">{item.titulo}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-mist-400">{item.detalhe}</span>
            </span>
          </li>
        ))}
      </ul>

      {view.journey.live && (
        <Surface tone="leaf" className="space-y-2 p-4">
          <p className="font-display font-semibold text-mist-50">As missões estão liberadas</p>
          <p className="text-sm leading-relaxed text-mist-300">
            Os estudantes da escola já veem o {view.code} no aplicativo. Para começar, basta apontar a câmera para o
            adesivo colado no tubo.
          </p>
        </Surface>
      )}

      {/*
        O que esta etapa NÃO consegue ver: se a válvula realmente abre e a água
        realmente sai. Isso só o primeiro teste com o tubo cheio mostra — e é
        melhor dizer isso aqui do que deixar a primeira missão de um estudante
        falhar sem explicação.
      */}
      <div className="rounded-2xl bg-sun-400/10 p-3.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-sun-300">
          <AlertTriangle className="size-4" aria-hidden />
          Faça a primeira liberação com você por perto
        </p>
        <p className="mt-1 text-xs leading-relaxed text-mist-300">
          A plataforma confere o que ela mede: sensor, calibração e número da escola. Que a válvula abre e a água sai
          pela mangueira, só o pátio mostra. Faça a primeira missão acompanhando, com um balde embaixo da saída.
        </p>
      </div>
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
/**
 * Salva um texto como arquivo.
 *
 * Três detalhes que parecem supérfluos e não são, porque cada um deles já
 * impediu um download de acontecer:
 *
 *   - o link precisa estar NO documento antes do clique (o Firefox ignora um
 *     link solto na memória);
 *   - o endereço do blob não pode ser revogado na linha seguinte ao clique:
 *     alguns navegadores ainda não começaram a gravar, e revogar cancela o
 *     download — sem erro, sem aviso, sem arquivo;
 *   - e o navegador precisa de um instante antes de a aba mexer em outra coisa.
 */
function baixar(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Um minuto é folga de sobra para o navegador terminar, e o endereço morre
  // com a aba de qualquer jeito.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
