import { afterEach, describe, expect, it } from "vitest";
import { publicBaseUrl } from "./http";

const pedido = (url: string) => new Request(url);
const original = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = original;
});

const mensagem = async (response: Response) => ((await response.json()) as { error: string }).error;

describe("URL pública dos artefatos permanentes", () => {
  it("usa NEXT_PUBLIC_APP_URL e descarta a barra final", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://ecohorta-inteligente.vercel.app/";
    expect(publicBaseUrl(pedido("http://localhost:3000/api/x")).url).toBe("https://ecohorta-inteligente.vercel.app");
  });

  it("sem a variável, aceita a origem pública da própria requisição", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(publicBaseUrl(pedido("https://ecohorta.exemplo/api/x")).url).toBe("https://ecohorta.exemplo");
  });

  it("recusa localhost: isso iria impresso no vinil e gravado na placa", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    for (const host of ["http://localhost:3000", "http://127.0.0.1:3000", "http://0.0.0.0:3000"]) {
      const resultado = publicBaseUrl(pedido(`${host}/api/x`));
      expect(resultado.url).toBeUndefined();
      expect(resultado.error!.status).toBe(503);
      expect(await mensagem(resultado.error!)).toMatch(/NEXT_PUBLIC_APP_URL/);
    }
  });

  it("recusa localhost também quando é a variável que está errada", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(publicBaseUrl(pedido("https://ecohorta.exemplo/api/x")).error!.status).toBe(503);
  });

  it("recusa valor que não é URL em vez de gerar um QR quebrado", () => {
    process.env.NEXT_PUBLIC_APP_URL = "ecohorta-inteligente.vercel.app";
    expect(publicBaseUrl(pedido("https://ecohorta.exemplo/api/x")).error!.status).toBe(503);
  });

  it("aceita um endereço de rede local: a bancada precisa que a placa alcance o servidor", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://192.168.0.14:3000";
    expect(publicBaseUrl(pedido("http://localhost:3000/api/x")).url).toBe("http://192.168.0.14:3000");
  });
});
