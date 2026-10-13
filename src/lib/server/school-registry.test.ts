import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { listSchools, parseEnrolledStudents, registerSchool, setEnrolledStudents, updateSchool } from "./school-registry";
import { createTestDatabase, resetTestDatabase } from "./db/test-db";
import type { Database } from "./db/types";

/*
 * Quantos estudantes a escola tem.
 *
 * O número existe por um motivo só: ser o DENOMINADOR. "280 missões cumpridas"
 * não diz nada sozinho — pode ser a escola inteira ou uma turma. Por isso os
 * testes aqui cuidam de duas coisas que o fariam mentir: um número perdido numa
 * edição que não falava dele, e um número aceito fora do que é possível.
 */

let pg: PGlite;
let db: Database;

const ESCOLA = { name: "EE Monteiro Lobato", city: "Campo Grande", state: "MS" } as const;

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
});

afterAll(async () => {
  await pg.close();
});

const cadastrar = (input: Partial<typeof ESCOLA> & { enrolledStudents?: number | null } = {}) =>
  db.transaction((tx) => registerSchool(tx, { ...ESCOLA, ...input }));

describe("matriculados", () => {
  it("entra junto com a escola", async () => {
    const escola = await cadastrar({ enrolledStudents: 820 });
    expect(escola.enrolledStudents).toBe(820);
  });

  it("escola cadastrada sem o número continua válida", async () => {
    expect((await cadastrar()).enrolledStudents).toBeNull();
  });

  it("corrigir a escola não apaga o número que ninguém mencionou", async () => {
    const escola = await cadastrar({ enrolledStudents: 820 });
    const corrigida = await db.transaction((tx) =>
      updateSchool(tx, escola.id, { name: "EE Monteiro Lobato", city: "Três Lagoas", state: "MS" }),
    );
    expect(corrigida.city).toBe("Três Lagoas");
    expect(corrigida.enrolledStudents).toBe(820);
  });

  it("muda todo ano, então sobrescrever é o comportamento certo", async () => {
    const escola = await cadastrar({ enrolledStudents: 820 });
    await db.transaction((tx) => setEnrolledStudents(tx, escola.id, 905));
    const [listada] = await listSchools(db);
    expect(listada!.enrolledStudents).toBe(905);
  });

  it("recusa número impossível antes de chegar ao banco", async () => {
    const escola = await cadastrar();
    await expect(db.transaction((tx) => setEnrolledStudents(tx, escola.id, 0))).rejects.toThrow(/matriculados/i);
    await expect(db.transaction((tx) => setEnrolledStudents(tx, escola.id, 1_000_000))).rejects.toThrow(/matriculados/i);
    await expect(db.transaction((tx) => setEnrolledStudents(tx, escola.id, 12.5))).rejects.toThrow(/matriculados/i);
  });

  it("cadastrar a mesma escola de novo completa o número que faltava", async () => {
    const escola = await cadastrar();
    const outra = await cadastrar({ enrolledStudents: 640 });
    expect(outra.id).toBe(escola.id);
    expect(outra.enrolledStudents).toBe(640);
  });
});

describe("o que se digita vira número, ou recusa", () => {
  it("aceita o que a tela manda, inclusive já numérico", () => {
    expect(parseEnrolledStudents(820)).toBe(820);
    expect(parseEnrolledStudents("820")).toBe(820);
    expect(parseEnrolledStudents("1.240")).toBe(1240);
  });

  it("campo vazio é ausência, não zero", () => {
    expect(parseEnrolledStudents("")).toBeNull();
    expect(parseEnrolledStudents(null)).toBeNull();
    expect(parseEnrolledStudents(undefined)).toBeNull();
  });

  it("recusa o que não é um número de estudantes", () => {
    expect(() => parseEnrolledStudents("0")).toThrow();
    expect(() => parseEnrolledStudents("abc")).toThrow();
    expect(() => parseEnrolledStudents(-5)).toThrow();
  });
});
