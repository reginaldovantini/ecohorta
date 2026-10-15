"use client";

import { motion } from "motion/react";
import { Droplets, Flag, Heart, Images } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ScreenHeader } from "@/components/student/screen-header";
import { Avatar } from "@/components/users/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { useNow } from "@/hooks/use-now";
import { createWallApiSource, type WallItem } from "@/lib/mural/wall-source";
import type { AvatarId } from "@/lib/users/avatars";
import { cn } from "@/lib/utils/cn";
import { formatLiters, formatRelativeTime } from "@/lib/utils/format";

/*
 * O MURAL.
 *
 * É a única tela do aplicativo que mostra o que foi feito com a água, e não
 * quanta água foi feita. O número já aparece em todo lugar; aqui aparece a
 * horta molhada, o canteiro, o regador na mão de alguém.
 *
 * Cada publicação carrega a missão e os LITROS MEDIDOS do lado da foto. Sem
 * isso o mural viraria um álbum, e a foto deixaria de ser evidência de uma
 * liberação que o sensor conferiu.
 */

export function WallScreen() {
  const source = useMemo(() => createWallApiSource(), []);
  useEffect(() => source.start(), [source]);
  const state = useSyncExternalStore(source.subscribe, source.getState, source.getServerState);
  const now = useNow(60_000);

  return (
    <div className="space-y-5 pt-6">
      <ScreenHeader
        eyebrow="Rede EcoHorta"
        title="Mural"
        subtitle="O que as escolas fizeram com a água que seria descartada"
        isSimulation={false}
      />

      {state.loading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Carregando">
          <Skeleton className="h-80 w-full rounded-card" />
          <Skeleton className="h-80 w-full rounded-card" />
        </div>
      ) : state.error ? (
        <Surface tone="alert" className="p-5 text-sm leading-relaxed text-mist-100">
          {state.error}
        </Surface>
      ) : state.posts.length === 0 ? (
        <Surface tone="leaf" className="space-y-2 p-5">
          <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
            <Images className="size-5 text-leaf-300" aria-hidden />O mural ainda está vazio
          </p>
          <p className="text-sm leading-relaxed text-mist-300">
            A primeira foto é de quem cumprir a próxima missão. Termine uma e registre a evidência — vale bônus de XP e
            abre o mural para a rede inteira.
          </p>
          <Link href="/missoes" className="inline-block pt-1 text-sm font-semibold text-leaf-300">
            Ver as missões
          </Link>
        </Surface>
      ) : (
        <>
          <ul className="space-y-4">
            {state.posts.map((post) => (
              <li key={post.id}>
                <PostCard
                  post={post}
                  now={now}
                  onLike={() => void source.toggleLike(post.id)}
                  onReport={(motivo) => source.report(post.id, motivo)}
                />
              </li>
            ))}
          </ul>

          {state.hasMore && (
            <Button variant="secondary" className="w-full" disabled={state.loadingMore} onClick={() => void source.loadMore()}>
              {state.loadingMore ? "Carregando…" : "Ver mais"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function PostCard({
  post,
  now,
  onLike,
  onReport,
}: {
  post: WallItem;
  now: number | null;
  onLike: () => void;
  onReport: (reason: string) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [denunciando, setDenunciando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const denunciar = async () => {
    const result = await onReport(motivo.trim());
    if (!result.ok) setErro(result.message ?? "Não foi possível denunciar.");
    else setDenunciando(false);
  };

  return (
    <Surface className="overflow-hidden p-0">
      <div className="flex items-center gap-3 p-3.5">
        <Avatar avatarId={post.author.avatarId as AvatarId} className="size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-mist-50">
            {post.author.nickname}
            {post.author.isMe && <span className="ml-1.5 text-xs font-normal text-mist-400">você</span>}
          </p>
          <p className="truncate text-xs text-mist-400">
            {post.school.name}
            {now !== null && ` · ${formatRelativeTime(post.createdAt, now)}`}
          </p>
        </div>
      </div>

      {post.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária do bucket privado
        <img src={post.imageUrl} alt={post.caption ?? `Missão ${post.mission.title}`} className="aspect-square w-full object-cover" />
      ) : (
        <div className="grid aspect-square w-full place-items-center bg-white/[0.04] text-sm text-mist-500">
          A foto expirou. Atualize a tela.
        </div>
      )}

      <div className="space-y-3 p-3.5">
        {/*
          A missão e os litros MEDIDOS ficam colados na foto: é o que separa o
          mural de um álbum. A foto é evidência de uma liberação que o sensor
          conferiu, e o número ao lado é essa conferência.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-aqua-400/12 px-2.5 py-1 text-xs font-semibold text-aqua-300">
            <Droplets className="size-3.5" aria-hidden />
            {formatLiters(post.deliveredLiters, 1)} reutilizados
          </span>
          <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-semibold text-mist-300">{post.mission.title}</span>
          <span className="text-xs text-mist-500">{post.collectorCode}</span>
        </div>

        {post.caption && <p className="text-sm leading-relaxed text-mist-200">{post.caption}</p>}

        <div className="flex items-center gap-1">
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={onLike}
            aria-pressed={post.likedByMe}
            aria-label={post.likedByMe ? "Remover curtida" : "Curtir"}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
              post.likedByMe ? "bg-leaf-400/15 text-leaf-300" : "text-mist-400",
            )}
          >
            <Heart className={cn("size-4", post.likedByMe && "fill-current")} aria-hidden />
            {post.likes > 0 ? post.likes : ""}
          </motion.button>
          <span className="flex-1" />
          {!post.author.isMe && (
            <button
              type="button"
              onClick={() => setDenunciando((aberto) => !aberto)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-mist-500"
            >
              <Flag className="size-3.5" aria-hidden />
              Denunciar
            </button>
          )}
        </div>

        {denunciando && (
          <div className="space-y-2 rounded-2xl bg-alert-400/10 p-3">
            <p className="text-xs leading-relaxed text-mist-300">
              A publicação sai do mural na hora e um responsável decide se volta. Conte em poucas palavras o que há de
              errado.
            </p>
            <input
              value={motivo}
              onChange={(event) => setMotivo(event.target.value.slice(0, 200))}
              placeholder="Ex.: foto fora do contexto da missão"
              className="h-11 w-full rounded-control bg-abyss-950/50 px-3 text-sm text-mist-50 outline-none ring-1 ring-inset ring-white/10 placeholder:text-mist-500 focus:ring-2 focus:ring-alert-400"
            />
            {erro && <p className="text-xs text-alert-200">{erro}</p>}
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="flex-1" onClick={() => setDenunciando(false)}>
                Cancelar
              </Button>
              <Button variant="danger" size="sm" className="flex-1" disabled={motivo.trim().length < 2} onClick={() => void denunciar()}>
                Enviar denúncia
              </Button>
            </div>
          </div>
        )}
      </div>
    </Surface>
  );
}
