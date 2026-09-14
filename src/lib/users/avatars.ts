/**
 * Emblemas ilustrados da EcoHorta. Sem fotos: preserva a privacidade de
 * estudantes menores e mantém a identidade visual da plataforma.
 */
export const AVATARS = [
  { id: "gota", label: "Gota", glyph: "droplets", from: "#8fe2f9", to: "#0a6fa8" },
  { id: "broto", label: "Broto", glyph: "sprout", from: "#9af0b9", to: "#178a4a" },
  { id: "folha", label: "Folha", glyph: "leaf", from: "#c6f28a", to: "#3f8f2a" },
  { id: "flor", label: "Flor", glyph: "flower", from: "#ffb3c7", to: "#b83a64" },
  { id: "horta", label: "Horta", glyph: "carrot", from: "#ffc58a", to: "#c95a17" },
  { id: "cientista", label: "Cientista", glyph: "flask", from: "#cbbdff", to: "#6246d0" },
  { id: "sensor", label: "Sensor", glyph: "gauge", from: "#a5f3eb", to: "#0e8a82" },
  { id: "estrela", label: "Estrela", glyph: "sparkles", from: "#fbe08f", to: "#bf810a" },
] as const;

export type Avatar = (typeof AVATARS)[number];
export type AvatarId = Avatar["id"];
export type AvatarGlyph = Avatar["glyph"];

export const AVATAR_IDS = AVATARS.map((avatar) => avatar.id) as [AvatarId, ...AvatarId[]];
export const DEFAULT_AVATAR_ID: AvatarId = "gota";

export function findAvatar(id: string): Avatar {
  return AVATARS.find((avatar) => avatar.id === id) ?? AVATARS[0];
}
