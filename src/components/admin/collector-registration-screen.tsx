"use client";

import { motion } from "motion/react";
import { AlertTriangle, ArrowRight, ChevronDown, Copy, KeyRound, MapPin, Plus, Users, Wifi } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ScreenHeader } from "@/components/student/screen-header";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { useProfile } from "@/hooks/use-profile";
import { DISTANCE_SENSORS, DISTANCE_SENSOR_MODELS, type DistanceSensorModel } from "@/lib/collector/distance-sensors";
import { nominalCapacityLiters } from "@/lib/collector/volume-calibration";
import { formatLiters } from "@/lib/utils/format";
import { UF_LIST } from "@/lib/server/school-registry";
import { RestrictedNotice } from "./calibration-screen";

/*
 * A PRIMEIRA ETAPA: O CAPTADOR NASCE.
 *
 * Quem chega aqui acabou de ser autorizado e nunca viu a plataforma por dentro.
 * Se esta tela pedir diâmetro nominal, altura útil e modelo do sensor de uma
 * vez, ela perde a pessoa antes do primeiro captador — e a rede não cresce.
 *
 * Então ela pergunta DUAS coisas: onde o tubo vai ficar, e quantos estudantes a
 * escola tem. O resto já vem preenchido com o tubo do manual, visível e
 * editável para quem fez diferente. Formulário com padrão certo é mais honesto
 * do que formulário vazio: o vazio finge que não existe uma resposta usual.
 *
 * Os matriculados são perguntados AQUI, e não na página de parceria, porque é
 * aqui que a resposta encontra quem sabe — e porque é o denominador do único
 * número que uma secretaria pergunta primeiro: que parte da escola isso alcançou.
 */

const inputBase =
  "h-12 rounded-control bg-white/[0.05] px-4 text-base text-mist-50 outline-none ring-1 ring-inset ring-white/10 transition-shadow placeholder:text-mist-500 focus:ring-2 focus:ring-aqua-400";
const inputClass = `${inputBase} w-full`;

/** O tubo do manual. Mudar aqui muda o padrão oferecido a toda escola nova. */
const PADRAO = { diameterMm: 100, usefulHeightMm: 1500, reserveLiters: "0,5" } as const;

interface SchoolOption {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  enrolledStudents: number | null;
}

interface Criado {
  code: string;
  location: string;
  name: string;
  estimatedCapacityLiters: number;
  distanceSensor: string;
  stewardCode: string;
  network: { ssid: string; password: string };
  connectivity: string;
}

export function CollectorRegistrationScreen() {
  const { status, canAdminister, platformAdmin, schoolName } = useProfile();
  const [criado, setCriado] = useState<Criado | null>(null);

  if (status === "ready" && !canAdminister) return <RestrictedNotice />;

  return (
    <div className="space-y-5 pt-6">
      <ScreenHeader
        eyebrow="Etapa 1 de 7"
        title="Cadastrar captador"
        subtitle={criado ? "Captador cadastrado" : (schoolName ?? "Carregando…")}
        isSimulation={false}
      />
      {criado ? (
        <Nasceu criado={criado} />
      ) : (
        <Formulario platformAdmin={platformAdmin} temEscolaPropria={schoolName !== null} onCriado={setCriado} />
      )}
    </div>
  );
}

function Formulario({
  platformAdmin,
  temEscolaPropria,
  onCriado,
}: {
  platformAdmin: boolean;
  /** A pessoa pertence a alguma escola? A administração da plataforma pode não pertencer. */
  temEscolaPropria: boolean;
  onCriado: (criado: Criado) => void;
}) {
  const [location, setLocation] = useState("");
  const [matriculados, setMatriculados] = useState("");
  const [diametro, setDiametro] = useState(String(PADRAO.diameterMm));
  const [altura, setAltura] = useState(String(PADRAO.usefulHeightMm));
  const [reserva, setReserva] = useState<string>(PADRAO.reserveLiters);
  const [sensor, setSensor] = useState<DistanceSensorModel>("VL53L1X");
  const [semRede, setSemRede] = useState(false);
  const [avancado, setAvancado] = useState(false);

  // Só a administração da plataforma escolhe a escola; quem administra uma
  // escola cadastra na dela, e o servidor recusa qualquer outra.
  const [escolas, setEscolas] = useState<SchoolOption[]>([]);
  const [escolaId, setEscolaId] = useState("");
  const [novaEscola, setNovaEscola] = useState({ name: "", city: "", state: "MS" });

  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!platformAdmin) return;
    let vivo = true;
    void fetch("/api/admin/schools", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { schools: [] }))
      .then((body: { schools?: SchoolOption[] }) => {
        if (vivo) setEscolas(body.schools ?? []);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [platformAdmin]);

  const capacidade = nominalCapacityLiters({ diameterMm: Number(diametro), usefulHeightMm: Number(altura) });
  const escolaEscolhida = escolas.find((escola) => escola.id === escolaId);
  const criandoEscola = platformAdmin && escolaId === "nova";

  async function enviar() {
    setErro(null);
    setEnviando(true);
    try {
      const matriculadosNumero = Number(matriculados.replace(/\D/g, ""));
      const response = await fetch("/api/admin/collectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location,
          nominalDiameterMm: Number(diametro),
          nominalUsefulHeightMm: Number(altura),
          reserveLiters: Number(reserva.replace(",", ".")),
          distanceSensor: sensor,
          connectivity: semRede ? "hotspot_only" : "school_network",
          ...(matriculadosNumero > 0 ? { enrolledStudents: matriculadosNumero } : {}),
          ...(criandoEscola ? { school: novaEscola } : escolaId ? { schoolId: escolaId } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Criado & { error?: string };
      if (!response.ok) {
        setErro(body.error ?? "Não foi possível cadastrar o captador.");
        return;
      }
      onCriado(body);
    } catch {
      setErro("Sem conexão com a plataforma.");
    } finally {
      setEnviando(false);
    }
  }

  const escolaDefinida = !platformAdmin || temEscolaPropria || escolaId !== "";
  const pronto =
    location.trim().length >= 2 && escolaDefinida && (!criandoEscola || novaEscola.name.trim().length >= 3);

  return (
    <div className="space-y-4">
      <Surface className="space-y-3 p-4">
        <p className="text-sm leading-relaxed text-mist-300">
          Duas perguntas e o captador nasce. O resto já vem preenchido com o tubo do manual — confira e mude só se o seu
          for diferente.
        </p>
      </Surface>

      {platformAdmin && (
        <Campo titulo="Escola" descricao="Em qual escola este tubo vai ficar.">
          <select className={inputClass} value={escolaId} onChange={(e) => setEscolaId(e.target.value)}>
            {/*
              Quem administra a plataforma pode não pertencer a escola nenhuma —
              e aí "a minha escola" é uma opção que só produz erro. Sem escola
              própria, escolher deixa de ser atalho e passa a ser obrigatório.
            */}
            <option value="">{temEscolaPropria ? "A minha escola" : "Escolha a escola"}</option>
            {escolas.map((escola) => (
              <option key={escola.id} value={escola.id}>
                {escola.name}
                {escola.city ? ` · ${escola.city}` : ""}
              </option>
            ))}
            <option value="nova">+ Cadastrar uma escola nova</option>
          </select>
          {criandoEscola && (
            <div className="mt-2 space-y-2">
              <input
                className={inputClass}
                value={novaEscola.name}
                onChange={(e) => setNovaEscola({ ...novaEscola, name: e.target.value })}
                placeholder="Nome da escola"
              />
              <div className="flex gap-2">
                <input
                  className={`${inputBase} min-w-0 flex-1`}
                  value={novaEscola.city}
                  onChange={(e) => setNovaEscola({ ...novaEscola, city: e.target.value })}
                  placeholder="Município"
                />
                <select
                  className={`${inputBase} w-[5.5rem] shrink-0`}
                  value={novaEscola.state}
                  onChange={(e) => setNovaEscola({ ...novaEscola, state: e.target.value })}
                  aria-label="Estado"
                >
                  {UF_LIST.map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </Campo>
      )}

      <Campo
        titulo="Onde o captador vai ficar"
        descricao="O lugar exato, do jeito que a escola chama. É o que o estudante lê no aplicativo para achar o tubo."
        icone={MapPin}
      >
        <input
          className={inputClass}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Pátio coberto, ao lado da sala 3"
          maxLength={80}
        />
      </Campo>

      <Campo
        titulo="Quantos estudantes a escola tem"
        descricao="Matriculados na unidade, todos os turnos. É com este número que a plataforma mostra qual parte da escola o projeto alcançou."
        icone={Users}
      >
        <input
          className={inputClass}
          value={escolaEscolhida?.enrolledStudents != null && !matriculados ? String(escolaEscolhida.enrolledStudents) : matriculados}
          onChange={(e) => setMatriculados(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="Ex.: 820"
          inputMode="numeric"
        />
      </Campo>

      <button
        type="button"
        onClick={() => setAvancado((aberto) => !aberto)}
        className="flex w-full items-center justify-between gap-2 rounded-card bg-white/[0.04] px-4 py-3.5 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-mist-100">O tubo e a placa</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-mist-400">
            PVC DN{diametro}, {(Number(altura) / 1000).toLocaleString("pt-BR")} m úteis, sensor {sensor}
            {capacidade ? ` · cerca de ${formatLiters(capacidade, 0)}` : ""}
          </span>
        </span>
        <ChevronDown className={`size-5 shrink-0 text-mist-400 transition-transform ${avancado ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {avancado && (
        <Surface className="space-y-4 p-4">
          <div className="flex items-start gap-2">
            <Numero label="Diâmetro (mm)" value={diametro} onChange={setDiametro} />
            <Numero label="Altura (mm)" value={altura} onChange={setAltura} />
          </div>
          <Numero
            label="Reserva no fundo (litros)"
            value={reserva}
            onChange={setReserva}
            ajuda="Água que nunca é liberada: protege o sensor de ler fundo sujo e a torneira de puxar borra."
          />
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-mist-400">Sensor de distância</p>
            <div className="grid grid-cols-2 gap-2">
              {DISTANCE_SENSOR_MODELS.map((modelo) => (
                <button
                  key={modelo}
                  type="button"
                  onClick={() => setSensor(modelo)}
                  className={`rounded-control px-3 py-2.5 text-left text-xs leading-relaxed ring-1 ring-inset ${
                    sensor === modelo ? "bg-aqua-400/15 text-mist-50 ring-aqua-400/40" : "bg-white/[0.04] text-mist-400 ring-white/10"
                  }`}
                >
                  <span className="block text-sm font-semibold">{modelo}</span>
                  {DISTANCE_SENSORS[modelo].rangeSummary}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[0.7rem] leading-relaxed text-mist-500">
              Está escrito na plaquinha do sensor. Em caso de dúvida, dá para trocar depois em Ligações.
            </p>
          </div>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={semRede}
              onChange={(e) => setSemRede(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-aqua-400"
            />
            <span className="text-xs leading-relaxed text-mist-300">
              <span className="block text-sm font-semibold text-mist-100">A escola não tem Wi-Fi onde o tubo fica</span>
              O captador cria a própria rede e o celular de quem faz a missão se conecta a ela.
            </span>
          </label>
        </Surface>
      )}

      {erro && (
        <p className="flex items-start gap-2 rounded-card bg-rose-400/10 px-4 py-3 text-sm leading-relaxed text-rose-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {erro}
        </p>
      )}

      <Button variant="leaf" className="w-full" disabled={!pronto || enviando} onClick={() => void enviar()} icon={<Plus className="size-5" aria-hidden />}>
        {enviando ? "Cadastrando…" : "Cadastrar captador"}
      </Button>
      {!escolaDefinida && (
        <p className="text-xs leading-relaxed text-sun-300">Escolha a escola deste captador para continuar.</p>
      )}
      <p className="text-xs leading-relaxed text-mist-500">
        O captador nasce como protótipo. Ele assume o número da escola quando a calibração for aceita — nenhum código é
        digitado por ninguém.
      </p>
    </div>
  );
}

/**
 * O QUE SÓ APARECE UMA VEZ.
 *
 * O código de responsável e a senha da rede do captador saem desta resposta e de
 * nenhum registro: o banco guarda só o hash do primeiro. Quem fechar esta tela
 * sem anotar precisa cadastrar de novo — então ela não tem botão de "continuar"
 * no topo, e diz o tamanho da perda antes de oferecer qualquer saída.
 */
function Nasceu({ criado }: { criado: Criado }) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <Surface tone="leaf" className="space-y-2 p-5">
        <p className="font-display text-xl font-bold text-mist-50">{criado.code}</p>
        <p className="text-sm leading-relaxed text-mist-300">
          {criado.location} · cerca de {formatLiters(criado.estimatedCapacityLiters, 0)} até a calibração medir de verdade.
        </p>
      </Surface>

      <div className="rounded-card bg-sun-400/10 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-sun-300">
          <AlertTriangle className="size-4" aria-hidden />
          Anote agora: isto não aparece de novo
        </p>
        <p className="mt-1 text-xs leading-relaxed text-mist-300">
          Imprima ou escreva e guarde dentro da caixa eletrônica do captador. A plataforma guarda só o resultado de uma
          conta sobre o código — nem ela consegue mostrá-lo outra vez.
        </p>
      </div>

      <Segredo
        icone={KeyRound}
        titulo="Código de responsável"
        texto={criado.stewardCode}
        descricao="Quem digitar este código passa a conduzir a construção e a calibração deste captador, mesmo sem administrar a escola."
      />
      <Segredo
        icone={Wifi}
        titulo={`Rede do captador · ${criado.network.ssid}`}
        texto={criado.network.password}
        descricao="A rede que o ESP32 cria para ser configurado, e que socorre o captador quando a internet da escola cai."
      />

      <Button
        variant="leaf"
        className="w-full"
        onClick={() => router.push(`/admin/captadores/${encodeURIComponent(criado.code)}/construcao`)}
        icon={<ArrowRight className="size-5" aria-hidden />}
      >
        Anotei. Ir para a construção
      </Button>
      <Link href="/admin/captadores" className="block text-center text-xs font-semibold text-mist-400 underline-offset-2 hover:underline">
        Ver todos os captadores
      </Link>
    </div>
  );
}

function Campo({
  titulo,
  descricao,
  icone: Icone,
  children,
}: {
  titulo: string;
  descricao: string;
  icone?: typeof MapPin;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card bg-white/[0.04] p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-mist-100">
        {Icone && <Icone className="size-4 text-aqua-300" aria-hidden />}
        {titulo}
      </p>
      <p className="mb-3 mt-1 text-xs leading-relaxed text-mist-400">{descricao}</p>
      {children}
    </div>
  );
}

function Numero({
  label,
  value,
  onChange,
  ajuda,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  ajuda?: string;
}) {
  return (
    <label className="block min-w-0 flex-1">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-mist-400">{label}</span>
      <input className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" />
      {ajuda && <span className="mt-1.5 block text-[0.7rem] leading-relaxed text-mist-500">{ajuda}</span>}
    </label>
  );
}

/** Segredo com cópia de um toque: no pátio, ninguém transcreve à mão sem errar. */
function Segredo({
  icone: Icone,
  titulo,
  texto,
  descricao,
}: {
  icone: typeof KeyRound;
  titulo: string;
  texto: string;
  descricao: string;
}) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="rounded-card bg-white/[0.04] p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-mist-100">
        <Icone className="size-4 text-aqua-300" aria-hidden />
        {titulo}
      </p>
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={() => {
          void navigator.clipboard?.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1600);
        }}
        className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl bg-abyss-950/50 px-3 py-3 text-left"
      >
        <span className="min-w-0 break-all font-mono text-base font-semibold text-mist-50">{texto}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-aqua-300">
          <Copy className="size-4" aria-hidden />
          {copiado ? "Copiado" : "Copiar"}
        </span>
      </motion.button>
      <p className="mt-2 text-xs leading-relaxed text-mist-400">{descricao}</p>
    </div>
  );
}
