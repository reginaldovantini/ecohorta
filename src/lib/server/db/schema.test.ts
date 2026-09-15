import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./types";
import { asUser, createTestDatabase, IDS, resetTestDatabase } from "./test-db";

/*
 * Valida as migrations em PostgreSQL real (PGlite): constraints, triggers,
 * índices de unicidade e Row Level Security com os papéis do Supabase.
 */

let pg: PGlite;
let db: Database;

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
});

const rejects = async (promise: Promise<unknown>, pattern: RegExp) => {
  await expect(promise).rejects.toThrow(pattern);
};

describe("migrations", () => {
  it("criam as tabelas e views do MVP", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "schools",
        "school_classes",
        "profiles",
        "person_records",
        "guardian_consents",
        "collectors",
        "devices",
        "collector_state",
        "telemetry",
        "device_commands",
        "mission_executions",
        "xp_transactions",
        "participant_age_bands",
        "profile_xp",
      ]),
    );
  });

  it("ativam RLS em todas as tabelas", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'",
    );
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(rows.filter((row) => !row.relrowsecurity)).toEqual([]);
  });
});

describe("constraints e triggers", () => {
  it("exige turma e código de acesso para estudantes", async () => {
    await db.query("insert into auth.users (id) values ('90000000-0000-4000-8000-000000000001')");
    await rejects(
      db.query("insert into profiles (id, school_id, role, access_code) values ('90000000-0000-4000-8000-000000000001', $1, 'student', '6C-ZZZZ')", [IDS.school]),
      /student_has_class/,
    );
    await rejects(
      db.query("insert into profiles (id, school_id, role, class_id) values ('90000000-0000-4000-8000-000000000001', $1, 'student', $2)", [IDS.school, IDS.class6c]),
      /student_has_access_code/,
    );
  });

  it("exige setor para funcionários e identidade completa ao concluir o primeiro acesso", async () => {
    await db.query("insert into auth.users (id) values ('90000000-0000-4000-8000-000000000002')");
    await rejects(
      db.query("insert into profiles (id, school_id, role, job_title) values ('90000000-0000-4000-8000-000000000002', $1, 'staff', 'Apoio')", [IDS.school]),
      /staff_has_sector/,
    );
    await rejects(
      db.query("insert into profiles (id, school_id, role, onboarded_at) values ('90000000-0000-4000-8000-000000000002', $1, 'teacher', now())", [IDS.school]),
      /onboarded_has_identity/,
    );
  });

  it("recusa data de nascimento futura e estudante sem data (trigger, não CHECK com current_date)", async () => {
    await rejects(db.query("update person_records set birth_date = current_date + 1 where profile_id = $1", [IDS.teacher]), /futuro/);
    await rejects(db.query("update person_records set birth_date = null where profile_id = $1", [IDS.student]), /data de nascimento/);
    await db.query("update person_records set birth_date = current_date where profile_id = $1", [IDS.teacher]);
  });

  it("mantém o consentimento quando a conta de quem registrou é removida", async () => {
    await db.query("insert into guardian_consents (profile_id, recorded_by, consented_at, method) values ($1, $2, now(), 'termo_impresso')", [
      IDS.student,
      IDS.teacher,
    ]);
    await db.query("delete from auth.users where id = $1", [IDS.teacher]);
    const { rows } = await db.query<{ recorded_by: string | null }>("select recorded_by from guardian_consents where profile_id = $1", [IDS.student]);
    expect(rows).toEqual([{ recorded_by: null }]);
  });

  it("permite só uma liberação ativa por captador", async () => {
    const insert = (id: string) =>
      db.query(
        `insert into device_commands (id, collector_id, device_id, requested_by, target_liters, is_simulated, queued_at)
         values ($1, $2, $3, $4, 1, true, now())`,
        [id, IDS.collector, IDS.device, IDS.student],
      );
    await insert("60000000-0000-4000-8000-000000000001");
    await rejects(insert("60000000-0000-4000-8000-000000000002"), /device_commands_one_active_per_collector/);
  });

  it("exige motivo de falha somente em FAILED", async () => {
    await rejects(
      db.query(
        `insert into device_commands (id, collector_id, target_liters, is_simulated, queued_at, status, finished_at)
         values ('60000000-0000-4000-8000-000000000003', $1, 1, true, now(), 'FAILED', now())`,
        [IDS.collector],
      ),
      /failure_only_when_failed/,
    );
  });

  it("concede XP uma única vez por origem", async () => {
    const source = "70000000-0000-4000-8000-000000000001";
    const insert = () =>
      db.query("insert into xp_transactions (profile_id, amount, source_type, source_id, reason) values ($1, 50, 'mission_execution', $2, 'Missão')", [
        IDS.student,
        source,
      ]);
    await insert();
    await rejects(insert(), /xp_once_per_source/);
  });
});

describe("Row Level Security", () => {
  it("anônimo não lê nada", async () => {
    await rejects(asUser(pg, null, (q) => q.query("select id from collectors")), /permission denied/);
    await rejects(asUser(pg, null, (q) => q.query("select profile_id from person_records")), /permission denied/);
  });

  it("estudante vê só o próprio cadastro; professor vê os da escola", async () => {
    const own = await asUser(pg, IDS.student, (q) => q.query<{ profile_id: string }>("select profile_id from person_records"));
    expect(own.rows.map((row) => row.profile_id)).toEqual([IDS.student]);

    const teacher = await asUser(pg, IDS.teacher, (q) => q.query<{ profile_id: string }>("select profile_id from person_records"));
    expect(teacher.rows.map((row) => row.profile_id).sort()).toEqual([IDS.student, IDS.student2, IDS.teacher, IDS.staff].sort());
  });

  it("funcionário não é educador: não vê cadastros alheios", async () => {
    const staff = await asUser(pg, IDS.staff, (q) => q.query<{ profile_id: string }>("select profile_id from person_records"));
    expect(staff.rows.map((row) => row.profile_id)).toEqual([IDS.staff]);
  });

  it("perfis de exibição ficam restritos à escola e sem o código de acesso", async () => {
    const visible = await asUser(pg, IDS.student, (q) => q.query<{ id: string }>("select id, nickname from profiles"));
    expect(visible.rows.map((row) => row.id)).not.toContain(IDS.otherStudent);
    expect(visible.rows).toHaveLength(4);
    await rejects(asUser(pg, IDS.student, (q) => q.query("select access_code from profiles")), /permission denied/);
  });

  it("usuário altera apenas o próprio apelido e avatar", async () => {
    await asUser(pg, IDS.student, (q) => q.query("update profiles set nickname = 'Jhow Novo' where id = $1", [IDS.student]));
    const updated = await db.query<{ nickname: string }>("select nickname from profiles where id = $1", [IDS.student]);
    expect(updated.rows[0]?.nickname).toBe("Jhow Novo");

    await asUser(pg, IDS.student, (q) => q.query("update profiles set nickname = 'Invasor' where id = $1", [IDS.student2]));
    const other = await db.query<{ nickname: string }>("select nickname from profiles where id = $1", [IDS.student2]);
    expect(other.rows[0]?.nickname).toBe("Ana");

    await rejects(asUser(pg, IDS.student, (q) => q.query("update profiles set role = 'admin' where id = $1", [IDS.student])), /permission denied/);
  });

  it("ninguém lê dispositivos (hash de token) nem escreve comandos ou XP", async () => {
    await rejects(asUser(pg, IDS.teacher, (q) => q.query("select token_hash from devices")), /permission denied/);
    await rejects(
      asUser(pg, IDS.student, (q) =>
        q.query("insert into xp_transactions (profile_id, amount, source_type, source_id, reason) values ($1, 999, 'adjustment', $1, 'hack')", [IDS.student]),
      ),
      /permission denied/,
    );
    await rejects(
      asUser(pg, IDS.student, (q) =>
        q.query("insert into device_commands (id, collector_id, target_liters, is_simulated, queued_at) values (gen_random_uuid(), $1, 1, true, now())", [IDS.collector]),
      ),
      /permission denied/,
    );
  });

  it("captadores e telemetria ficam restritos à escola", async () => {
    const mine = await asUser(pg, IDS.student, (q) => q.query<{ code: string }>("select code from collectors"));
    expect(mine.rows.map((row) => row.code)).toEqual(["EC-001"]);
    const other = await asUser(pg, IDS.otherStudent, (q) => q.query<{ code: string }>("select code from collectors"));
    expect(other.rows.map((row) => row.code)).toEqual(["EC-900"]);
  });

  it("XP e execuções: participante vê os próprios; educador vê os da escola", async () => {
    await db.query("insert into xp_transactions (profile_id, amount, source_type, source_id, reason) values ($1, 50, 'mission_execution', gen_random_uuid(), 'Missão'), ($2, 20, 'mission_execution', gen_random_uuid(), 'Missão')", [
      IDS.student,
      IDS.student2,
    ]);
    const own = await asUser(pg, IDS.student, (q) => q.query<{ xp: number }>("select xp from profile_xp"));
    expect(own.rows).toEqual([{ xp: 50 }]);
    const teacher = await asUser(pg, IDS.teacher, (q) => q.query<{ profile_id: string }>("select profile_id from xp_transactions"));
    expect(teacher.rows).toHaveLength(2);
  });

  it("faixa etária: educador vê a escola, estudante só a si, sem datas", async () => {
    const teacher = await asUser(pg, IDS.teacher, (q) => q.query<{ age_band: string }>("select age_band from participant_age_bands where role = 'student'"));
    expect(teacher.rows).toHaveLength(2);
    const student = await asUser(pg, IDS.student, (q) => q.query<{ profile_id: string }>("select profile_id from participant_age_bands"));
    expect(student.rows.map((row) => row.profile_id)).toEqual([IDS.student]);
  });
});
