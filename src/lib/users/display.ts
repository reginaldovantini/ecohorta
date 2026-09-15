import { EDUCATION_LEVEL_LABEL, ROLE_LABEL, STAFF_SECTOR_LABEL, type DisplayIdentity } from "./types";

/** Linha descritiva do perfil (sem dados cadastrais). */
export function describeIdentity(identity: DisplayIdentity) {
  switch (identity.role) {
    case "student":
      return `${ROLE_LABEL.student} · ${identity.className} — ${EDUCATION_LEVEL_LABEL[identity.educationLevel]}`;
    case "teacher":
      return `${ROLE_LABEL.teacher} · ${identity.jobTitle}`;
    case "staff":
      return `${STAFF_SECTOR_LABEL[identity.sector]} · ${identity.jobTitle}`;
    case "admin":
      return identity.jobTitle ? `${ROLE_LABEL.admin} · ${identity.jobTitle}` : ROLE_LABEL.admin;
  }
}
