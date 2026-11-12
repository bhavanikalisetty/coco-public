import type { Bootstrap } from "./types";
export function graphScopes(data: Bootstrap) {
  if (data.access === "demo") return ["conference"];
  return [
    "conference",
    ...(data.capabilities.personalMemory === false ? [] : ["me"]),
    ...(data.capabilities.companyCrm === false ? [] : ["company"]),
  ];
}
export function observeDeviceCommands(data: Bootstrap) {
  return (
    data.access !== "demo" &&
    (data.capabilities.deviceCommands === true ||
      (!data.access && data.capabilities.deviceCommands !== false))
  );
}
export function canManageDemoBadge(data: Bootstrap) {
  return (
    data.access !== "demo" &&
    ["person_maya", "person_leo"].includes(data.me.personId)
  );
}
export function usernameSuggestion(first: string, last: string) {
  return [first, last]
    .filter(Boolean)
    .join("_")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .slice(0, 30);
}
export function reviewableTopics(
  ids: unknown[],
  catalogue: { id: string }[] | undefined,
) {
  const allowed = new Set(catalogue?.map((topic) => topic.id) ?? []);
  return [
    ...new Set(
      ids.filter(
        (id): id is string => typeof id === "string" && allowed.has(id),
      ),
    ),
  ].slice(0, 8);
}
export type Registration = {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  linkedinUrl: string;
  socials?: { instagram?: string; x?: string };
  topicIds?: string[];
  eventPreferences?: string;
};
export type EntrySession = {
  token: string;
  personId: string;
  access: "demo" | "owner";
  expiresAt: string;
  username?: string;
};
