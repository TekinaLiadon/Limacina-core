export const ROLE_WEIGHTS = {
  user: 1,
  moderator: 2,
  admin: 3,
  owner: 4,
} as const;

export type UserRole = keyof typeof ROLE_WEIGHTS;

export const ASSIGNABLE_ROLES = ["admin", "moderator", "user"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isKnownRole(role: string): role is UserRole {
  return role in ROLE_WEIGHTS;
}

export function roleWeight(role: string): number {
  return isKnownRole(role) ? ROLE_WEIGHTS[role] : 0;
}
