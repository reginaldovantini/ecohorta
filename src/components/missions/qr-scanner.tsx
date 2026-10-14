"use client";

import { motion } from "motion/react";
import { Camera, Keyboard, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  cameraFailure,
  CAMERA_FAILURE_MESSAGE,
  nativeDetector,
  readFrame,
  tokenFromScan,
  type CameraFailure,
} from "@/lib/missions/qr-reader";

/*
 * A CÂMERA, NO MEIO DA MISSÃO.
 *
 * Esta tela aparece com o estudante em pé na frente do tubo, de celular na mão,
 * às vezes com um regador na outra. Ela tem uma função só: ler o adesivo e sair
 * da frente. Nada de instrução longa, nada de botão para confirmar o que a
 * câmera já viu — leu, seguiu.
 *
 * A câmera não abre sozinha. Abrir a câmera de alguém sem um toque é o tipo de
 * coisa que faz uma pessoa fechar o aplicativo; e, em iPhone, o navegador nem
 * permite sem gesto. Então o primeiro estado é um botão grande que diz o que
 * vai acontecer.
 *
 * E existe uma saída sem câmera: o código digitado à mão. Celular velho, câmera
 * quebrada, vidro arranhado — a missão não pode morrer por causa disso.
 */

export function QrScanner({
  onToken,
  onCancel,
}: {
  /** Token lido. A tela de cima decide o que fazer — aqui não se valida nada. */
  onToken: (token: string) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const entregue = useRef(false);

  const [ligando, setLigando] = useState(false);
  const [ligada, setLigada] = useState(false);
  const [falha, setFalha] = useState<CameraFailure | null>(null);
  const [digitando, setDigitando] = useState(false);
  const [codigo, setCodigo] = useState("");

  const desligar = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLigada(false);
  }, []);

  // A câmera é um recurso do aparelho: sair da tela precisa devolvê-la, ou a
  // luzinha fica acesa e o celular esquenta no bolso do estudante.
  useEffect(() => desligar, [desligar]);

  const entregar = useCallback(
    (token: string) => {
      if (entregue.current) return;
      entregue.current = true;
      desligar();
      onToken(token);
    },
    [desligar, onToken],
  );

  const abrir = useCallback(async () => {
    setFalha(null);
    setLigando(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // A câmera de trás é a que aponta para o tubo.
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      await video.play();
      setLigada(true);
    } catch (error) {
      setFalha(cameraFailure(error));
    } finally {
      setLigando(false);
    }
  }, []);

  // A busca pelo QR: um quadro de cada vez, enquanto a câmera estiver aberta.
  useEffect(() => {
    if (!ligada) return;
    let vivo = true;
    let frame = 0;

    void (async () => {
      const detector = await nativeDetector();
      const procurar = async () => {
        if (!vivo) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (video && canvas) {
          try {
            const texto = await readFrame(video, canvas, detector);
            const token = texto ? tokenFromScan(texto) : null;
            if (token) {
              entregar(token);
              return;
            }
          } catch {
            // Um quadro ruim não interrompe a procura: o próximo vem em 100 ms.
          }
        }
        frame = window.setTimeout(procurar, 120);
      };
      void procurar();
    })();

    return () => {
      vivo = false;
      window.clearTimeout(frame);
    };
  }, [ligada, entregar]);

  if (digitando) {
    const token = tokenFromScan(codigo);
    return (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-mist-300">
          O código está impresso embaixo do QR, no adesivo do tubo. São 32 caracteres.
        </p>
        <input
          value={codigo}
          onChange={(event) => setCodigo(event.target.value)}
          placeholder="Código do captador"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="h-12 w-full rounded-control bg-white/[0.05] px-4 font-mono text-base text-mist-50 outline-none ring-1 ring-inset ring-white/10 placeholder:font-sans placeholder:text-mist-500 focus:ring-2 focus:ring-aqua-400"
        />
        <Button variant="leaf" className="w-full" disabled={!token} onClick={() => token && entregar(token)}>
          Usar este código
        </Button>
        <Button variant="ghost" size="sm" className="w-full" onClick={() => setDigitando(false)}>
          Voltar para a câmera
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-abyss-950/60 ring-1 ring-inset ring-white/10">
        <video
          ref={videoRef}
          playsInline
          muted
          className={ligada ? "size-full object-cover" : "hidden"}
          aria-label="Câmera procurando o QR Code do captador"
        />
        <canvas ref={canvasRef} className="hidden" />

        {ligada && (
          <>
            {/* A mira. Ela existe para a pessoa saber onde pôr o adesivo. */}
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="relative size-48">
                {[
                  "left-0 top-0 border-l-4 border-t-4 rounded-tl-xl",
                  "right-0 top-0 border-r-4 border-t-4 rounded-tr-xl",
                  "left-0 bottom-0 border-b-4 border-l-4 rounded-bl-xl",
                  "right-0 bottom-0 border-b-4 border-r-4 rounded-br-xl",
                ].map((canto) => (
                  <span key={canto} className={`absolute size-10 border-aqua-300 ${canto}`} />
                ))}
                <motion.span
                  aria-hidden
                  className="absolute inset-x-2 h-0.5 rounded-full bg-aqua-300/80"
                  animate={{ top: ["8%", "92%", "8%"] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
            </div>
            <p className="absolute inset-x-0 bottom-0 bg-abyss-950/70 px-4 py-2.5 text-center text-sm text-mist-100">
              Aponte para o adesivo colado no tubo
            </p>
          </>
        )}

        {!ligada && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="space-y-3">
              <Camera className="mx-auto size-10 text-mist-500" aria-hidden />
              <p className="text-sm leading-relaxed text-mist-300">
                {falha ? CAMERA_FAILURE_MESSAGE[falha] : "A câmera vai procurar o QR Code colado no captador."}
              </p>
            </div>
          </div>
        )}
      </div>

      {!ligada && (
        <Button variant="leaf" className="w-full" disabled={ligando} onClick={() => void abrir()} icon={<Camera className="size-5" aria-hidden />}>
          {ligando ? "Abrindo a câmera…" : falha ? "Tentar de novo" : "Abrir câmera"}
        </Button>
      )}

      {falha && (
        <p className="flex items-start gap-2 rounded-xl bg-sun-400/10 px-3 py-2 text-xs leading-relaxed text-sun-300">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Sem câmera dá para seguir: use o código impresso no adesivo.
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="flex-1" onClick={() => setDigitando(true)} icon={<Keyboard className="size-4" aria-hidden />}>
          Digitar o código
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1"
          onClick={() => {
            desligar();
            onCancel();
          }}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
