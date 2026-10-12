"use client";

import { motion } from "motion/react";
import { AlertTriangle, Building2, Check, Inbox, Pencil, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ScreenHeader } from "@/components/student/screen-header";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { useProfile } from "@/hooks/use-profile";
import { createPlatformApiSource, type PlatformSchool } from "@/lib/admin/platform-source";
import type { AdminGrant } from "@/lib/server/admin-grants";
import type { PartnershipRequest } from "@/lib/server/partnership-service";
import { UF_LIST } from "@/lib/server/school-registry";

/*
 * A MESA DE CONTROLE DA PLATAFORMA.
 *
 * Só uma pessoa chega aqui: quem está configurado como administração da
 * plataforma. É a tela onde a rede cresce — cada escola cadastrada e cada
 * e-mail autorizado é uma escola a mais capaz de construir captadores.
 *
 * A ordem na tela é a ordem dos fatos: primeiro existe a escola, depois existe
 * quem a administra. Autorizar sem ter escola seria autorizar para o nada, e
 * por isso o formulário de autorização nem aparece enquanto não houver uma.
 */

/*
 * A largura fica FORA da classe base de propósito.
 *
 * Com `w-full` embutido, o seletor de UF e o campo de município brigavam pela
 * mesma linha e o município sumia — duas classes de largura na mesma string não
 * se resolvem pela ordem em que foram escritas.
 */
const inputBase =
  "h-12 rounded-control bg-white/[0.05] px-4 text-base text-mist-50 outline-none ring-1 ring-inset ring-white/10 transition-shadow placeholder:text-mist-500 focus:ring-2 focus:ring-aqua-400";
const inputClass = `${inputBase} w-full`;

export function PlatformScreen() {
  const { platformAdmin, status } = useProfile();
  const source = useMemo(() => createPlatformApiSource(), []);
  useEffect(() => source.start(), [source]);
  const { loading, error, busy, schools, grants, requests } = useSyncExternalStore(
    source.subscribe,
    source.getState,
    source.getServerState,
  );

  if (status === "ready" && !platformAdmin) {
    return (
      <div className="space-y-5 pt-6">
        <ScreenHeader eyebrow="Plataforma" title="Área restrita" isSimulation={false} />
        <Surface tone="alert" className="p-5 text-sm leading-relaxed text-mist-100">
          Esta área é da administração da plataforma. Se você administra uma escola, o que você procura está em{" "}
          <Link href="/admin/captadores" className="font-semibold text-mist-50 underline">
            Captadores
          </Link>
          .
        </Surface>
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-6">
      <ScreenHeader
        eyebrow="Plataforma"
        title="Rede EcoHorta"
        subtitle="Escolas e quem as administra"
        isSimulation={false}
      />

      {error && (
        <Surface tone="alert" className="flex items-start gap-2.5 p-4 text-sm leading-relaxed text-mist-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-alert-400" aria-hidden />
          {error}
        </Surface>
      )}

      <RequestsSection requests={loading ? [] : requests} salvando={busy} onAnswer={source.answerRequest} />

      <SchoolsSection
        schools={loading ? null : schools}
        salvando={busy}
        onCreate={source.createSchool}
        onUpdate={source.updateSchool}
      />

      <GrantsSection
        grants={loading ? null : grants}
        schools={schools}
        salvando={busy}
        onGrant={source.grant}
        onRevoke={source.revoke}
      />
    </div>
  );
}

function SchoolsSection({
  schools,
  salvando,
  onCreate,
  onUpdate,
}: {
  schools: PlatformSchool[] | null;
  salvando: boolean;
  onCreate: (input: { name: string; city: string; state: string }) => Promise<{ ok: boolean }>;
  onUpdate: (id: string, input: { name: string; city: string; state: string }) => Promise<{ ok: boolean }>;
}) {
  const [aberto, setAberto] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");

  const valido = name.trim().length >= 3 && city.trim().length >= 2 && state.length === 2;

  const criar = async () => {
    if (!valido) return;
    const { ok } = await onCreate({ name: name.trim(), city: city.trim(), state });
    if (ok) {
      setName("");
      setCity("");
      setState("");
      setAberto(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="eyebrow">Escolas</h2>
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-semibold text-leaf-300"
        >
          <Plus className="size-4" aria-hidden />
          Nova escola
        </button>
      </div>

      {aberto && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <Surface className="space-y-3 p-4">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da escola" />
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
            <p className="text-xs leading-relaxed text-mist-500">
              Município e estado são o que permite dizer &ldquo;27 captadores em 9 municípios&rdquo; em vez de contar tubos.
            </p>
            <Button variant="leaf" className="w-full" onClick={() => void criar()} disabled={!valido || salvando}>
              Cadastrar escola
            </Button>
          </Surface>
        </motion.div>
      )}

      {schools === null ? (
        <Skeleton className="h-20 w-full rounded-card" />
      ) : schools.length === 0 ? (
        <Surface className="p-5 text-sm leading-relaxed text-mist-300">
          Nenhuma escola ainda. Comece por aqui: sem escola não há onde cadastrar captador nem quem administrar.
        </Surface>
      ) : (
        <ul className="space-y-2.5">
          {schools.map((school) => (
            <li key={school.id}>
              <SchoolRow school={school} salvando={salvando} onSave={(input) => onUpdate(school.id, input)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/*
 * Pedidos de parceria — a fila de trabalho desta tela.
 *
 * Vem antes das escolas de propósito: é a única coisa aqui em que alguém está
 * esperando resposta. Aprovar cria a escola e autoriza o e-mail de uma vez,
 * porque fazer em dois passos abriria a chance de autorizar alguém para uma
 * escola que ninguém cadastrou.
 */
function RequestsSection({
  requests,
  salvando,
  onAnswer,
}: {
  requests: PartnershipRequest[];
  salvando: boolean;
  onAnswer: (id: string, decision: "approve" | "decline") => Promise<{ ok: boolean }>;
}) {
  const pendentes = requests.filter((r) => r.status === "pending");
  const respondidos = requests.filter((r) => r.status !== "pending");
  if (requests.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="eyebrow">Pedidos de parceria</h2>
        {pendentes.length > 0 && <Chip tone="sun">{pendentes.length} aguardando</Chip>}
      </div>

      {pendentes.map((pedido) => (
        <Surface key={pedido.id} tone="leaf" className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-leaf-400/15 text-leaf-300">
              <Inbox className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display font-semibold text-mist-50">{pedido.schoolName}</p>
              <p className="truncate text-xs text-mist-300">
                {pedido.city} · {pedido.state}
              </p>
              <p className="mt-1.5 truncate text-xs text-mist-400">
                {pedido.name}
                {pedido.jobTitle ? ` · ${pedido.jobTitle}` : ""}
              </p>
              <p className="truncate text-xs text-mist-500">{pedido.email}</p>
            </div>
          </div>

          {pedido.message && (
            <p className="rounded-2xl bg-abyss-950/40 px-3.5 py-2.5 text-xs leading-relaxed text-mist-300">{pedido.message}</p>
          )}

          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => void onAnswer(pedido.id, "decline")}
              disabled={salvando}
            >
              Recusar
            </Button>
            <Button
              variant="leaf"
              size="sm"
              className="flex-1"
              onClick={() => void onAnswer(pedido.id, "approve")}
              disabled={salvando}
              icon={<Check className="size-4" aria-hidden />}
            >
              Aprovar
            </Button>
          </div>
          <p className="text-[0.7rem] leading-relaxed text-mist-400">
            Aprovar cria a escola com município e estado e autoriza este e-mail a administrá-la.
          </p>
        </Surface>
      ))}

      {pendentes.length === 0 && (
        <Surface className="p-5 text-sm leading-relaxed text-mist-300">Nenhum pedido aguardando resposta.</Surface>
      )}

      {respondidos.length > 0 && (
        <details className="rounded-card bg-white/[0.03] px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-mist-400">
            Pedidos respondidos ({respondidos.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {respondidos.map((pedido) => (
              <li key={pedido.id} className="text-xs leading-relaxed text-mist-500">
                <span className="text-mist-300">{pedido.schoolName}</span> · {pedido.email} ·{" "}
                {pedido.status === "approved" ? "aprovado" : "recusado"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/*
 * Uma escola da lista — e o formulário dela, no mesmo lugar.
 *
 * Escola cadastrada antes desta tela chegou sem município, e sem município o
 * indicador de replicabilidade não fecha. Em vez de uma tela separada de
 * edição, a própria linha abre: quem percebe o dado faltando está olhando
 * exatamente para ele.
 */
function SchoolRow({
  school,
  salvando,
  onSave,
}: {
  school: PlatformSchool;
  salvando: boolean;
  onSave: (input: { name: string; city: string; state: string }) => Promise<{ ok: boolean }>;
}) {
  const [editando, setEditando] = useState(false);
  const [name, setName] = useState(school.name);
  const [city, setCity] = useState(school.city ?? "");
  const [state, setState] = useState(school.state ?? "");
  const incompleta = !school.city || !school.state;
  const valido = name.trim().length >= 3 && city.trim().length >= 2 && state.length === 2;

  const salvar = async () => {
    if (!valido) return;
    const { ok } = await onSave({ name: name.trim(), city: city.trim(), state });
    if (ok) setEditando(false);
  };

  if (editando) {
    return (
      <Surface className="space-y-3 p-4">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da escola" />
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
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setEditando(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button variant="leaf" className="flex-1" onClick={() => void salvar()} disabled={!valido || salvando}>
            Salvar
          </Button>
        </div>
      </Surface>
    );
  }

  return (
    <button type="button" onClick={() => setEditando(true)} className="block w-full text-left active:scale-[0.99] transition-transform">
      <Surface className="flex items-center gap-3 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-leaf-400/12 text-leaf-300">
          <Building2 className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display font-semibold text-mist-50">{school.name}</p>
          <p className={incompleta ? "truncate text-xs text-sun-300" : "truncate text-xs text-mist-400"}>
            {incompleta ? "Toque para informar o município" : `${school.city} · ${school.state}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {school.activeCollectors > 0 && <Chip tone="leaf">{school.activeCollectors} na rede</Chip>}
          {school.prototypes > 0 && <Chip tone="sun">{school.prototypes} em obra</Chip>}
          <Pencil className="size-4 text-mist-500" aria-hidden />
        </div>
      </Surface>
    </button>
  );
}

function GrantsSection({
  grants,
  schools,
  salvando,
  onGrant,
  onRevoke,
}: {
  grants: AdminGrant[] | null;
  schools: PlatformSchool[];
  salvando: boolean;
  onGrant: (input: { email: string; schoolId: string }) => Promise<{ ok: boolean }>;
  onRevoke: (email: string) => Promise<{ ok: boolean }>;
}) {
  const [email, setEmail] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const ativos = useMemo(() => grants?.filter((g) => g.revokedAt === null) ?? [], [grants]);
  const revogados = useMemo(() => grants?.filter((g) => g.revokedAt !== null) ?? [], [grants]);

  const valido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && schoolId.length > 0;

  const autorizar = async () => {
    if (!valido) return;
    const { ok } = await onGrant({ email: email.trim(), schoolId });
    if (ok) {
      setEmail("");
      setSchoolId("");
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="eyebrow">Administradores de escola</h2>

      <Surface tone="aqua" className="space-y-3 p-4">
        <p className="flex items-start gap-2 text-sm leading-relaxed text-mist-200">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-aqua-300" aria-hidden />
          Quem você autorizar aqui cadastra captadores da escola escolhida — e só dela. A autorização vale antes de a
          pessoa entrar: no primeiro acesso pelo Google ela já chega administradora.
        </p>

        {schools.length === 0 ? (
          <p className="rounded-2xl bg-sun-400/10 px-3 py-2.5 text-xs leading-relaxed text-sun-300">
            Cadastre uma escola primeiro: autorizar alguém sem escola seria autorizar para o nada.
          </p>
        ) : (
          <>
            <input
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="E-mail do Google da pessoa"
            />
            <select className={inputClass} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} aria-label="Escola">
              <option value="">Escolha a escola</option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
            <Button
              variant="leaf"
              className="w-full"
              onClick={() => void autorizar()}
              disabled={!valido || salvando}
              icon={<UserPlus className="size-5" aria-hidden />}
            >
              Autorizar
            </Button>
          </>
        )}
      </Surface>

      {grants === null ? (
        <Skeleton className="h-20 w-full rounded-card" />
      ) : (
        <>
          {ativos.length > 0 && (
            <ul className="space-y-2.5">
              {ativos.map((grant) => (
                <li key={grant.email}>
                  <Surface className="flex items-center gap-3 p-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-leaf-400/12 text-leaf-300">
                      <Check className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-mist-50">{grant.email}</p>
                      <p className="truncate text-xs text-mist-400">
                        {grant.platformAdmin ? "Administração da plataforma" : (grant.schoolName ?? "Escola removida")}
                      </p>
                    </div>
                    {!grant.platformAdmin && (
                      <button
                        type="button"
                        onClick={() => void onRevoke(grant.email)}
                        disabled={salvando}
                        aria-label={`Revogar ${grant.email}`}
                        className="grid size-9 shrink-0 place-items-center rounded-xl bg-alert-400/12 text-alert-400 active:scale-95"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    )}
                  </Surface>
                </li>
              ))}
            </ul>
          )}

          {ativos.length === 0 && (
            <Surface className="p-5 text-sm leading-relaxed text-mist-300">
              Ninguém autorizado ainda. Enquanto isso, só você cadastra captadores.
            </Surface>
          )}

          {revogados.length > 0 && (
            <details className="rounded-card bg-white/[0.03] px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-mist-400">
                Acessos encerrados ({revogados.length})
              </summary>
              <ul className="mt-3 space-y-2">
                {revogados.map((grant) => (
                  <li key={grant.email} className="text-xs leading-relaxed text-mist-500">
                    <span className="text-mist-300">{grant.email}</span> · {grant.schoolName ?? "—"} · encerrado em{" "}
                    {new Date(grant.revokedAt!).toLocaleDateString("pt-BR")}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[0.7rem] leading-relaxed text-mist-600">
                A lista fica: o histórico de quem teve acesso a dados de estudantes não se apaga.
              </p>
            </details>
          )}
        </>
      )}
    </section>
  );
}
