"use client";

import { motion } from "motion/react";
import { Camera, Check, ImageUp, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/hooks/use-profile";
import { WALL_MAX_BYTES } from "@/lib/collector/wall-storage";
import { profileStore } from "@/lib/student/profile-store";

/*
 * A EVIDÊNCIA, LOGO DEPOIS DA ÁGUA.
 *
 * A missão termina com o sensor confirmando o volume — e é aí, com o regador
 * ainda na mão e a horta molhada na frente, que a foto existe. Pedir depois, na
 * tela de perfil, é pedir uma foto que ninguém mais vai tirar.
 *
 * O bônus aparece no botão, não escondido: ele é o motivo de a pessoa parar
 * mais quinze segundos. E a pontuação da missão JÁ ENTROU — quem fechar esta
 * tela sem publicar não perde nada do que fez, só o bônus.
 *
 * Quem não autorizou o uso da imagem não vê um erro: vê o que a autorização
 * significa e onde mudá-la, se quiser.
 */

export function MissionEvidence({
  executionId,
  bonusXp,
  onPublished,
}: {
  executionId: string;
  bonusXp: number;
  onPublished: () => void;
}) {
  const { imageConsent } = useProfile();
  const [aberto, setAberto] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [legenda, setLegenda] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const previaRef = useRef<string | null>(null);

  /*
   * A prévia nasce no momento da escolha, não num efeito.
   *
   * O endereço do blob é um recurso do navegador: quem cria tem de soltar. Aqui
   * ele é criado no toque e solto ali mesmo quando outra foto entra — e ao sair
   * da tela, pelo efeito de limpeza, que não mexe em estado nenhum.
   */
  const escolher = (file: File | undefined) => {
    setErro(null);
    if (!file) return;
    if (file.size > WALL_MAX_BYTES) {
      setErro("Esta foto passa de 6 MB. Tire outra com a câmera do aplicativo.");
      return;
    }
    if (previa) URL.revokeObjectURL(previa);
    const url = URL.createObjectURL(file);
    previaRef.current = url;
    setArquivo(file);
    setPrevia(url);
  };

  // Só limpeza: o endereço do blob morre com a tela.
  useEffect(() => () => {
    if (previaRef.current) URL.revokeObjectURL(previaRef.current);
  }, []);

  const publicar = async () => {
    if (!arquivo) return;
    setEnviando(true);
    setErro(null);
    try {
      const corpo = new FormData();
      corpo.append("executionId", executionId);
      corpo.append("foto", arquivo);
      if (legenda.trim()) corpo.append("caption", legenda.trim());
      const response = await fetch("/api/mural", { method: "POST", body: corpo });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setErro(body.error ?? "Não foi possível publicar. Tente de novo.");
        return;
      }
      await profileStore.refresh();
      setPronto(true);
      onPublished();
    } catch {
      setErro("Sem conexão. Tente de novo em instantes.");
    } finally {
      setEnviando(false);
    }
  };

  if (pronto) {
    return (
      <div className="rounded-2xl bg-leaf-400/12 p-4 text-center">
        <p className="flex items-center justify-center gap-2 font-display font-semibold text-leaf-300">
          <Check className="size-5" aria-hidden />
          Missão registrada no mural
        </p>
        <p className="mt-1 text-sm text-mist-300">+{bonusXp} XP de bônus pela evidência.</p>
      </div>
    );
  }

  return (
    <>
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={() => setAberto(true)}
        className="flex w-full items-center gap-3 rounded-2xl bg-sun-400/12 p-4 text-left ring-1 ring-inset ring-sun-400/30"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sun-400/20 text-sun-300">
          <Camera className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display font-semibold text-mist-50">Registre sua missão</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-mist-300">
            Uma foto do que você fez com a água, no mural para as outras escolas verem.
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-sun-400/20 px-2.5 py-1 text-xs font-bold text-sun-300">
          <Sparkles className="size-3.5" aria-hidden />+{bonusXp}
        </span>
      </motion.button>

      <BottomSheet
        open={aberto}
        onClose={() => setAberto(false)}
        title="Registre sua missão"
        description={`Uma foto do que você fez com a água. Vale +${bonusXp} XP de bônus.`}
      >
        {!imageConsent ? (
          <div className="space-y-3">
            <div className="rounded-2xl bg-sun-400/10 p-4">
              <p className="flex items-center gap-2 font-display font-semibold text-sun-300">
                <TriangleAlert className="size-5" aria-hidden />
                Falta a autorização de imagem
              </p>
              <p className="mt-1 text-sm leading-relaxed text-mist-300">
                O mural é visto pelas outras escolas da rede, então publicar exige a sua autorização de uso de imagem.
                Sua missão já está registrada e a pontuação já entrou — isto é só o bônus.
              </p>
            </div>
            <Link
              href="/perfil"
              className="flex h-12 w-full items-center justify-center rounded-control bg-white/[0.07] text-sm font-semibold text-mist-50 ring-1 ring-inset ring-white/10"
            >
              Abrir o perfil e autorizar
            </Link>
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setAberto(false)}>
              Agora não
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              ref={entrada}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="hidden"
              onChange={(event) => escolher(event.target.files?.[0])}
            />

            {previa ? (
              // eslint-disable-next-line @next/next/no-img-element -- blob local da prévia, não entra no otimizador
              <img src={previa} alt="Prévia da foto escolhida" className="aspect-square w-full rounded-2xl object-cover" />
            ) : (
              <button
                type="button"
                onClick={() => entrada.current?.click()}
                className="grid aspect-square w-full place-items-center rounded-2xl bg-white/[0.04] text-center ring-1 ring-inset ring-white/10"
              >
                <span className="space-y-2 p-6">
                  <ImageUp className="mx-auto size-10 text-mist-500" aria-hidden />
                  <span className="block text-sm leading-relaxed text-mist-300">
                    Toque para abrir a câmera e fotografar o que você fez com a água.
                  </span>
                </span>
              </button>
            )}

            {previa && (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => entrada.current?.click()}>
                Trocar a foto
              </Button>
            )}

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-mist-400">
                Legenda (opcional)
              </span>
              <input
                value={legenda}
                onChange={(event) => setLegenda(event.target.value.slice(0, 140))}
                placeholder="Reguei os canteiros da horta"
                className="h-12 w-full rounded-control bg-white/[0.05] px-4 text-base text-mist-50 outline-none ring-1 ring-inset ring-white/10 placeholder:text-mist-500 focus:ring-2 focus:ring-aqua-400"
              />
              <span className="mt-1 block text-right text-[0.7rem] text-mist-500">{legenda.length}/140</span>
            </label>

            {erro && <p className="rounded-xl bg-alert-400/12 px-3 py-2 text-sm text-alert-200">{erro}</p>}

            <Button
              variant="leaf"
              className="w-full"
              disabled={!arquivo || enviando}
              onClick={() => void publicar()}
              icon={<Sparkles className="size-5" aria-hidden />}
            >
              {enviando ? "Publicando…" : `Publicar e ganhar +${bonusXp} XP`}
            </Button>
            <p className="text-center text-xs leading-relaxed text-mist-500">
              Fotografe a horta, o canteiro, o regador — o que a água fez. Evite rostos de quem não quer aparecer.
            </p>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
