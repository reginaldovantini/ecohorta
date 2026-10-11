import { GRADE_PHASE_LABEL, ROLE_LABEL, STAFF_SECTOR_LABEL, type DisplayIdentity } from "./types";

/** Linha descritiva do perfil (sem dados cadastrais). */
export function describeIdentity(identity: DisplayIdentity) {
  switch (identity.role) {
    case "student":
      return `${ROLE_LABEL.student} · ${GRADE_PHASE_LABEL[identity.gradePhase]}`;
    case "teacher":
      return identity.jobTitle ? `${ROLE_LABEL.teacher} · ${identity.jobTitle}` : ROLE_LABEL.teacher;
    case "staff":
      return identity.sector ? `${STAFF_SECTOR_LABEL[identity.sector]}` : ROLE_LABEL.staff;
    case "admin":
      return identity.jobTitle ? `${ROLE_LABEL.admin} · ${identity.jobTitle}` : ROLE_LABEL.admin;
  }
}
