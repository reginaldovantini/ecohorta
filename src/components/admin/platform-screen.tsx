"use client";

import { motion } from "motion/react";
import { AlertTriangle, Building2, Check, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
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

const inputClass =
  "h-12 w-full rounded-control bg-white/[0.05] px-4 text-base text-mist-50 outline-none ring-1 ring-inset ring-white/10 transition-shadow placeholder:text-mist-500 focus:ring-2 focus:ring-aqua-400";

export function PlatformScreen() {
  const { platformAdmin, status } = useProfile();
  const source = useMemo(() => createPlatformApiSource(), []);
  useEffect(() => source.start(), [source]);
  const { loading, error, busy, schools, grants } = useSyncExternalStore(source.subscribe, source.getState, source.getServerState);

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

      <SchoolsSection schools={loading ? null : schools} salvando={busy} onCreate={source.createSchool} />

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
}: {
  schools: PlatformSchool[] | null;
  salvando: boolean;
  onCreate: (input: { name: string; city: string; state: string }) => Promise<{ ok: boolean }>;
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
              <input className={inputClass} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Município" />
              <select
                className={`${inputClass} w-24 shrink-0`}
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
              <Surface className="flex items-center gap-3 p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-leaf-400/12 text-leaf-300">
                  <Building2 className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display font-semibold text-mist-50">{school.name}</p>
                  <p className="truncate text-xs text-mist-400">
                    {school.city && school.state ? `${school.city} · ${school.state}` : "Sem município informado"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {school.activeCollectors > 0 && <Chip tone="leaf">{school.activeCollectors} na rede</Chip>}
                  {school.prototypes > 0 && <Chip tone="sun">{school.prototypes} em obra</Chip>}
                </div>
              </Surface>
            </li>
          ))}
        </ul>
      )}
    </section>
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
