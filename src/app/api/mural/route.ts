import {
  isWallMimeType,
  WALL_BUCKET,
  WALL_MAX_BYTES,
  WALL_SIGNED_URL_TTL_SECONDS,
  wallImagePath,
} from "@/lib/collector/wall-storage";
import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { createPost, listWall } from "@/lib/server/mission-wall";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { jsonError, jsonOk, withErrors } from "@/lib/server/http";

/*
 * O MURAL: ler e publicar.
 *
 * A foto sobe POR AQUI, e não direto do navegador para o Storage. Assim o
 * servidor confere tamanho, formato e — principalmente — se aquela missão é
 * daquela pessoa e está concluída, antes de qualquer byte ser gravado. Uma URL
 * de upload entregue ao navegador seria uma porta para gravar no bucket sem
 * passar por nenhuma dessas perguntas.
 *
 * E a foto volta por URL ASSINADA, com prazo: o bucket é privado, e um endereço
 * público seria um álbum de fotos de menores aberto na internet.
 */

export async function GET(request: Request) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;

    const params = new URL(request.url).searchParams;
    const before = Number(params.get("antes"));
    const posts = await listWall(getDatabase(), auth.actor, {
      limit: Number(params.get("limite")) || 30,
      before: Number.isFinite(before) && before > 0 ? before : undefined,
    });
    if (posts.length === 0) return jsonOk({ posts: [] });

    // Uma chamada só para todas as assinaturas: o mural abre numa rolagem, não
    // numa dúzia de idas ao Storage.
    const storage = createSupabaseAdminClient().storage.from(WALL_BUCKET);
    const { data } = await storage.createSignedUrls(
      posts.map((post) => post.imagePath),
      WALL_SIGNED_URL_TTL_SECONDS,
    );
    const assinadas = new Map((data ?? []).map((item) => [item.path, item.signedUrl]));

    return jsonOk({
      posts: posts.map(({ imagePath, ...post }) => ({ ...post, imageUrl: assinadas.get(imagePath) ?? null })),
    });
  });
}

export async function POST(request: Request) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    if (!auth.actor.schoolId) return jsonError(409, "Entre numa escola lendo o QR de um captador antes de publicar.");

    const form = await request.formData().catch(() => null);
    if (!form) return jsonError(422, "Envio inválido.");
    const executionId = form.get("executionId");
    const caption = form.get("caption");
    const file = form.get("foto");

    if (typeof executionId !== "string") return jsonError(422, "Informe a missão desta foto.");
    if (!(file instanceof File)) return jsonError(422, "Escolha uma foto.");
    if (file.size > WALL_MAX_BYTES) return jsonError(413, "A foto passa de 6 MB. Tente de novo com a câmera do aplicativo.");
    if (!isWallMimeType(file.type)) return jsonError(415, "Formato não aceito. Use JPG, PNG ou WebP.");

    const caminho = wallImagePath(auth.actor.schoolId, executionId, file.type);
    const storage = createSupabaseAdminClient().storage.from(WALL_BUCKET);
    const { error } = await storage.upload(caminho, file, { contentType: file.type, upsert: true });
    if (error) return jsonError(502, "Não foi possível guardar a foto. Tente de novo.");

    const result = await createPost(getDatabase(), auth.actor, {
      executionId,
      imagePath: caminho,
      caption: typeof caption === "string" ? caption : null,
    });
    if (!result.ok) {
      // Publicação recusada: o arquivo não fica órfão no bucket.
      await storage.remove([caminho]);
      return jsonError(result.status, result.message);
    }
    return jsonOk(result.value, 201);
  });
}
