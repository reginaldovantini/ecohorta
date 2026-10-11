import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    /*
     * Os testes de banco criam um PostgreSQL real (PGlite) por arquivo e aplicam
     * todas as migrations. Com os arquivos rodando em paralelo, isso passa dos
     * limites padrão (5 s por teste, 10 s por hook) em máquinas mais lentas e no CI.
     * Os limites abaixo são folga para a carga, não para lógica lenta: um teste
     * que realmente demore isso tudo está dizendo outra coisa.
     */
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
