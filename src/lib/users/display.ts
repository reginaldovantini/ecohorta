import { classLabel, findClass } from "./school";
import { ROLE_LABEL, STAFF_SECTOR_LABEL, type DisplayIdentity } from "./types";

/** Linha descritiva do perfil (sem dados cadastrais). */
export function describeIdentity(identity: DisplayIdentity) {
  switch (identity.role) {
    case "student": {
      const schoolClass = findClass(identity.classId);
      return schoolClass ? `${ROLE_LABEL.student} · ${classLabel(schoolClass)}` : ROLE_LABEL.student;
    }
    case "teacher":
      return `${ROLE_LABEL.teacher} · ${identity.jobTitle}`;
    case "staff":
      return `${STAFF_SECTOR_LABEL[identity.sector]} · ${identity.jobTitle}`;
  }
}
