import { EDUCATION_LEVEL_LABEL, type EducationLevel, type School, type SchoolClass } from "./types";

export const SCHOOL: School = { id: "school-clarinda", name: "EE Prof.ª Clarinda Mendes de Aquino" };

/**
 * Turmas de EXEMPLO para o cadastro local. A lista oficial vem do cadastro
 * da escola (tabela school_classes) a partir dos Dias 6–7.
 */
export const SCHOOL_CLASSES: readonly SchoolClass[] = [
  { id: "ef-6c", schoolId: SCHOOL.id, name: "6º Ano C", educationLevel: "elementary", grade: 6, section: "C" },
  { id: "ef-7a", schoolId: SCHOOL.id, name: "7º Ano A", educationLevel: "elementary", grade: 7, section: "A" },
  { id: "em-2a", schoolId: SCHOOL.id, name: "2º Ano A", educationLevel: "high_school", grade: 2, section: "A" },
  { id: "em-2b", schoolId: SCHOOL.id, name: "2º Ano B", educationLevel: "high_school", grade: 2, section: "B" },
];

export function findClass(classId: string) {
  return SCHOOL_CLASSES.find((schoolClass) => schoolClass.id === classId) ?? null;
}

export function classLabel(schoolClass: SchoolClass) {
  return `${schoolClass.name} — ${EDUCATION_LEVEL_LABEL[schoolClass.educationLevel]}`;
}

/** Turmas agrupadas por nível de ensino, na ordem de EDUCATION_LEVELS. */
export function classesByLevel() {
  const groups = new Map<EducationLevel, SchoolClass[]>();
  for (const schoolClass of SCHOOL_CLASSES) {
    groups.set(schoolClass.educationLevel, [...(groups.get(schoolClass.educationLevel) ?? []), schoolClass]);
  }
  return [...groups.entries()];
}
