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

describe("calibrações de volume", () => {
  const CALIBRATION = "80000000-0000-4000-8000-000000000001";

  /** Calibração ativa completa, versão 1, inserida direto no banco. */
  const insertActive = (id = CALIBRATION, version = 1) =>
    db.query(
      `insert into collector_calibrations
       (id, collector_id, device_id, is_simulated, status, version, completed_at, activated_at,
        zero_distance_mm, one_liter_distance_mm, two_liter_distance_mm, three_liter_distance_mm, maximum_distance_mm,
        calibration_constant, effective_diameter_mm, effective_height_mm, effective_capacity_liters, quality, quality_report)
       values ($1, $2, $3, true, 'active', $4, now(), now(), 1700, 1564, 1428, 1292, 200, 0.0073593, 96.8, 1500, 11.04, 'good', '{}')`,
      [id, IDS.collector, IDS.device, version],
    );

  it("existem com RLS ativo", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'collector_calibrations' and relnamespace = 'public'::regnamespace",
    );
    expect(rows).toEqual([{ relrowsecurity: true }]);
  });

  it("guardam o histórico: calibração concluída nunca é apagada nem alterada", async () => {
    await insertActive();
    await rejects(db.query("delete from collector_calibrations where id = $1", [CALIBRATION]), /nunca são apagadas/);
    await rejects(db.query("update collector_calibrations set zero_distance_mm = 1690 where id = $1", [CALIBRATION]), /não podem ser alteradas/);
    await rejects(db.query("update collector_calibrations set status = 'rejected' where id = $1", [CALIBRATION]), /Transição/);
    await rejects(db.query("delete from collectors where id = $1", [IDS.collector]), /foreign key constraint/);

    // Única mudança permitida: ativa → substituída.
    await db.query("update collector_calibrations set status = 'superseded', superseded_at = now() where id = $1", [CALIBRATION]);
    await rejects(db.query("update collector_calibrations set superseded_at = now() + interval '1 day' where id = $1", [CALIBRATION]), /não podem ser alteradas/);
  });

  it("permitem uma ativa e um procedimento em andamento por captador, com versão única", async () => {
    await insertActive();
    await rejects(insertActive("80000000-0000-4000-8000-000000000002", 2), /collector_calibrations_one_active/);
    await rejects(
      db.query("insert into collector_calibrations (collector_id, is_simulated, status, version) values ($1, true, 'cancelled', 1)", [IDS.collector]),
      /collector_calibrations_version_unique/,
    );
    const draft = () => db.query("insert into collector_calibrations (collector_id, is_simulated) values ($1, true)", [IDS.collector]);
    await draft();
    await rejects(draft(), /collector_calibrations_one_draft/);
  });

  it("não ativam calibração incompleta ou inconsistente", async () => {
    await rejects(
      db.query("insert into collector_calibrations (collector_id, is_simulated, status, version, completed_at) values ($1, true, 'active', 1, now())", [IDS.collector]),
      /completed_calibration_is_complete/,
    );
    await rejects(
      db.query(
        `insert into collector_calibrations (collector_id, is_simulated, status, version, completed_at, activated_at, quality, quality_report,
          zero_distance_mm, one_liter_distance_mm, two_liter_distance_mm, three_liter_distance_mm, maximum_distance_mm,
          calibration_constant, effective_diameter_mm, effective_height_mm, effective_capacity_liters)
         values ($1, true, 'active', 1, now(), now(), 'inconsistent', '{}', 1700, 1564, 1428, 1292, 200, 0.007, 96, 1500, 11)`,
        [IDS.collector],
      ),
      /usable_calibration_has_model/,
    );
  });

  it("telemetria e estado exigem coerência entre volume e origem", async () => {
    await rejects(
      db.query(
        `insert into telemetry (collector_id, device_id, recorded_at, uptime_ms, seq, distance_mm, volume_liters, fill_ratio, level_state, valve, status, overflowing, is_simulated, volume_source)
         values ($1, $2, now(), 1, 1, 1236, null, null, null, 'closed', 'READY', false, true, 'device')`,
        [IDS.collector, IDS.device],
      ),
      /telemetry_volume_matches_source/,
    );
    await rejects(
      db.query("update collector_state set volume_liters = 3, volume_source = 'calibration' where collector_id = $1", [IDS.collector]),
      /collector_state_volume_matches_source/,
    );
  });

  it("ficam visíveis só para a escola do captador e ninguém escreve pelo Supabase", async () => {
    await insertActive();
    const mine = await asUser(pg, IDS.student, (q) => q.query<{ id: string }>("select id from collector_calibrations"));
    expect(mine.rows).toEqual([{ id: CALIBRATION }]);
    const other = await asUser(pg, IDS.otherStudent, (q) => q.query("select id from collector_calibrations"));
    expect(other.rows).toEqual([]);
    await rejects(
      asUser(pg, IDS.teacher, (q) => q.query("insert into collector_calibrations (collector_id, is_simulated) values ($1, true)", [IDS.collector])),
      /permission denied/,
    );
    await rejects(asUser(pg, null, (q) => q.query("select id from collector_calibrations")), /permission denied/);
  });
});

describe("validação física: observações e validações", () => {
  const CALIBRATION = "80000000-0000-4000-8000-000000000011";

  const insertCalibration = () =>
    db.query(
      `insert into collector_calibrations
       (id, collector_id, device_id, is_simulated, status, version, completed_at, activated_at,
        zero_distance_mm, one_liter_distance_mm, two_liter_distance_mm, three_liter_distance_mm, maximum_distance_mm,
        calibration_constant, effective_diameter_mm, effective_height_mm, effective_capacity_liters, quality, quality_report)
       values ($1, $2, $3, false, 'active', 1, now(), now(), 1700, 1564, 1428, 1292, 200, 0.0073593, 96.8, 1500, 11.04, 'good', '{}')`,
      [CALIBRATION, IDS.collector, IDS.device],
    );

  const insertValidation = (patch: Partial<Record<string, number | null>> = {}) => {
    const values = { known: 5, error: -0.08, absolute: 0.08, percent: -1.6, absolutePercent: 1.6, ...patch };
    return db.query<{ id: string }>(
      `insert into calibration_validations
       (collector_id, calibration_id, device_id, sensor_model, is_simulated, known_volume_liters, measurement_method,
        distance_mm, readings, height_mm, calculated_volume_liters, raw_volume_liters, below_zero, above_maximum,
        error_liters, absolute_error_liters, percent_error, absolute_percent_error)
       values ($1, $2, $3, 'VL53L1X', false, $4, 'balanca', 1031.4, 20, 668.6, 4.92, 4.92, false, false, $5, $6, $7, $8)
       returning id`,
      [IDS.collector, CALIBRATION, IDS.device, values.known, values.error, values.absolute, values.percent, values.absolutePercent],
    );
  };

  it("existem com RLS ativo", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('sensor_observations', 'calibration_validations') order by relname",
    );
    expect(rows).toEqual([
      { relname: "calibration_validations", relrowsecurity: true },
      { relname: "sensor_observations", relrowsecurity: true },
    ]);
  });

  it("validações exigem erro coerente e percentual só com volume conhecido maior que zero", async () => {
    await insertCalibration();
    await rejects(insertValidation({ absolute: 0.5 }), /validation_absolute_error/);
    await rejects(insertValidation({ known: 0 }), /validation_percent_needs_volume/);
    await insertValidation({ known: 0, error: 0.03, absolute: 0.03, percent: null, absolutePercent: null });
    await rejects(
      db.query("insert into calibration_validations (collector_id, calibration_id, sensor_model, is_simulated, known_volume_liters, measurement_method, distance_mm, readings, height_mm, calculated_volume_liters, raw_volume_liters, below_zero, above_maximum, error_liters, absolute_error_liters) values ($1, $2, 'VL53L1X', false, 1, 'palpite', 1000, 1, 700, 1, 1, false, false, 0, 0)", [
        IDS.collector,
        CALIBRATION,
      ]),
      /measurement_method/,
    );
  });

  it("registros experimentais nunca são apagados nem alterados", async () => {
    await insertCalibration();
    const { rows } = await insertValidation();
    const id = rows[0]!.id;
    await rejects(db.query("delete from calibration_validations where id = $1", [id]), /nunca são apagados/);
    await rejects(db.query("update calibration_validations set known_volume_liters = 4.92, error_liters = 0, absolute_error_liters = 0 where id = $1", [id]), /não podem ser alterados/);
    // A calibração validada também não pode sumir.
    await rejects(db.query("delete from collector_calibrations where id = $1", [CALIBRATION]), /nunca são apagadas|foreign key/);

    const observation = await db.query<{ id: string }>(
      `insert into sensor_observations (collector_id, device_id, sensor_model, is_simulated, condition, stability_state, readings, outliers, invalid, total)
       values ($1, $2, 'VL53L1X', false, 'sem_agua', 'invalid', 0, 0, 15, 15) returning id`,
      [IDS.collector, IDS.device],
    );
    await rejects(db.query("update sensor_observations set stability_state = 'stable' where id = $1", [observation.rows[0]!.id]), /não podem ser alterados/);
    await rejects(db.query("delete from sensor_observations where id = $1", [observation.rows[0]!.id]), /nunca são apagados/);
    // Remover a conta de quem registrou só anula a referência.
    await db.query("update calibration_validations set created_by = $2 where id = $1", [id, null]);
  });

  it("ficam visíveis só para a escola do captador e ninguém escreve pelo Supabase", async () => {
    await insertCalibration();
    await insertValidation();
    const mine = await asUser(pg, IDS.student, (q) => q.query("select id from calibration_validations"));
    expect(mine.rows).toHaveLength(1);
    const other = await asUser(pg, IDS.otherStudent, (q) => q.query("select id from calibration_validations"));
    expect(other.rows).toEqual([]);
    await rejects(
      asUser(pg, IDS.teacher, (q) =>
        q.query("insert into sensor_observations (collector_id, sensor_model, is_simulated, condition, stability_state, readings, outliers, invalid, total) values ($1, 'VL53L1X', false, 'outro', 'stable', 1, 0, 0, 1)", [IDS.collector]),
      ),
      /permission denied/,
    );
    await rejects(asUser(pg, null, (q) => q.query("select id from sensor_observations")), /permission denied/);
  });
});

describe("configuração de hardware do captador", () => {
  const CALIBRATION = "80000000-0000-4000-8000-000000000009";
  const insertChange = (patch: { previous?: string; next?: string; confirmed?: boolean; revision?: number } = {}) =>
    db.query<{ id: string }>(
      `insert into collector_hardware_changes (collector_id, revision, previous_sensor, new_sensor, changed_by, physical_match_confirmed, is_simulated)
       values ($1, $2, $3, $4, $5, $6, true) returning id`,
      [IDS.collector, patch.revision ?? 2, patch.previous ?? "VL53L1X", patch.next ?? "VL53L0X", IDS.teacher, patch.confirmed ?? true],
    );

  it("existe com RLS ativo e o VL53L1X, revisão 1, como padrão", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'collector_hardware_changes' and relnamespace = 'public'::regnamespace",
    );
    expect(rows).toEqual([{ relrowsecurity: true }]);
    const collector = await db.query("select distance_sensor, hardware_revision from collectors where id = $1", [IDS.collector]);
    expect(collector.rows).toEqual([{ distance_sensor: "VL53L1X", hardware_revision: 1 }]);
  });

  it("a troca do sensor exige a próxima revisão, e a revisão nunca volta", async () => {
    await rejects(db.query("update collectors set distance_sensor = 'VL53L0X' where id = $1", [IDS.collector]), /nova revisão de hardware/);
    await rejects(db.query("update collectors set distance_sensor = 'VL53L0X', hardware_revision = 5 where id = $1", [IDS.collector]), /nova revisão de hardware/);
    await db.query("update collectors set distance_sensor = 'VL53L0X', hardware_revision = 2 where id = $1", [IDS.collector]);
    await rejects(db.query("update collectors set hardware_revision = 1 where id = $1", [IDS.collector]), /nunca diminui/);
    await rejects(db.query("update collectors set distance_sensor = 'HC-SR04', hardware_revision = 3 where id = $1", [IDS.collector]), /invalid input value/);
  });

  it("o histórico exige a confirmação do sensor físico e uma troca de fato, e nunca muda", async () => {
    await rejects(insertChange({ confirmed: false }), /physical_match_confirmed/);
    await rejects(insertChange({ next: "VL53L1X" }), /hardware_change_changes_sensor/);
    const { rows } = await insertChange();
    await rejects(insertChange(), /collector_hardware_changes_revision_unique/);
    const id = rows[0]!.id;
    await rejects(db.query("update collector_hardware_changes set new_sensor = 'VL53L1X', previous_sensor = 'VL53L0X' where id = $1", [id]), /não pode ser alterado/);
    await rejects(db.query("delete from collector_hardware_changes where id = $1", [id]), /nunca é apagado/);
    // Remover a conta de quem trocou só anula a referência.
    await db.query("update collector_hardware_changes set changed_by = null where id = $1", [id]);
  });

  it("a calibração concluída guarda o sensor e a revisão de hardware, sem alteração", async () => {
    await db.query(
      `insert into collector_calibrations
       (id, collector_id, device_id, is_simulated, status, version, completed_at, activated_at, sensor_model, hardware_revision,
        zero_distance_mm, one_liter_distance_mm, two_liter_distance_mm, three_liter_distance_mm, maximum_distance_mm,
        calibration_constant, effective_diameter_mm, effective_height_mm, effective_capacity_liters, quality, quality_report)
       values ($1, $2, $3, true, 'active', 1, now(), now(), 'VL53L1X', 1, 1700, 1564, 1428, 1292, 200, 0.0073593, 96.8, 1500, 11.04, 'good', '{}')`,
      [CALIBRATION, IDS.collector, IDS.device],
    );
    await rejects(db.query("update collector_calibrations set hardware_revision = 2 where id = $1", [CALIBRATION]), /não podem ser alteradas/);
    await rejects(db.query("update collector_calibrations set sensor_model = 'VL53L0X' where id = $1", [CALIBRATION]), /não podem ser alteradas/);
    await db.query("update collector_calibrations set status = 'superseded', superseded_at = now() where id = $1", [CALIBRATION]);
  });

  it("fica visível só para a escola do captador e ninguém escreve pelo Supabase", async () => {
    await insertChange();
    const mine = await asUser(pg, IDS.student, (q) => q.query("select revision from collector_hardware_changes"));
    expect(mine.rows).toEqual([{ revision: 2 }]);
    const other = await asUser(pg, IDS.otherStudent, (q) => q.query("select revision from collector_hardware_changes"));
    expect(other.rows).toEqual([]);
    await rejects(
      asUser(pg, IDS.teacher, (q) =>
        q.query(
          "insert into collector_hardware_changes (collector_id, revision, previous_sensor, new_sensor, physical_match_confirmed, is_simulated) values ($1, 3, 'VL53L0X', 'VL53L1X', true, true)",
          [IDS.collector],
        ),
      ),
      /permission denied/,
    );
    await rejects(asUser(pg, IDS.teacher, (q) => q.query("update collectors set distance_sensor = 'VL53L0X', hardware_revision = 2 where id = $1", [IDS.collector])), /permission denied/);
    await rejects(asUser(pg, null, (q) => q.query("select revision from collector_hardware_changes")), /permission denied/);
  });
});

describe("auditoria do schema", () => {
  it("toda chave estrangeira tem índice", async () => {
    const { rows } = await db.query<{ fk: string }>(`
      select c.conrelid::regclass::text || '.' || c.conname as fk
      from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid and (i.indkey::int2[])[0] = c.conkey[1]
        )`);
    expect(rows).toEqual([]);
  });

  it("apagar um dispositivo nunca apaga a telemetria dele: dispositivos são desativados", async () => {
    await db.query(
      `insert into telemetry (collector_id, device_id, recorded_at, uptime_ms, seq, distance_mm, volume_liters, fill_ratio, level_state, valve, status, overflowing, is_simulated, volume_source)
       values ($1, $2, now(), 1, 1, 1236, null, null, null, 'closed', 'READY', false, true, 'none')`,
      [IDS.collector, IDS.device],
    );
    await rejects(db.query("delete from devices where id = $1", [IDS.device]), /foreign key constraint/);
    await db.query("update devices set active = false where id = $1", [IDS.device]);
    const { rows } = await db.query("select 1 from telemetry where device_id = $1", [IDS.device]);
    expect(rows).toHaveLength(1);
  });

  it("usuários do Supabase não têm TRUNCATE nem escrita pelas views", async () => {
    const { rows } = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated')
         and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'INSERT', 'DELETE')`,
    );
    expect(rows).toEqual([]);
    await rejects(asUser(pg, IDS.teacher, (q) => q.query("truncate telemetry")), /permission denied/);
  });

  it("funções têm search_path fixo", async () => {
    const { rows } = await db.query<{ proname: string }>(
      "select proname from pg_proc where pronamespace = 'public'::regnamespace and (proconfig is null or not exists (select 1 from unnest(proconfig) c where c like 'search_path=%'))",
    );
    expect(rows).toEqual([]);
  });
});
