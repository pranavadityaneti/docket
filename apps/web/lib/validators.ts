/** Client-side checks that match the API DTO ceilings. */

export const PERSON_NAME_MAX = 200;
export const MEMBER_NAME_MAX = 80;
export const ORGANISATION_MAX = 200;
export const EMAIL_MAX = 320;
export const PHONE_MAX = 10;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 200;
export const MEMBER_TITLE_MAX = 40;
export const LOGIN_ID_MIN = 11;
export const LOGIN_ID_MAX = 16;

const LOGIN_ID_RE = /^dpu-[0-9a-z]{7}$/;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\d+$/;

/** Strip characters the field must never accept, as the user types. */
export function sanitizePhone(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, PHONE_MAX);
}

export function sanitizeEmail(raw: string): string {
  return raw.replace(/\s/g, "");
}

export function sanitizeLoginId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9-]/g, "").toUpperCase().slice(0, LOGIN_ID_MAX);
}

export function sanitizeSlug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 63);
}

export function sanitizeInteger(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function setKeyedError(
  prev: Record<string, string>,
  key: string,
  message: string | null,
): Record<string, string> {
  if (!message) {
    if (!(key in prev)) return prev;
    const next = { ...prev };
    delete next[key];
    return next;
  }
  if (prev[key] === message) return prev;
  return { ...prev, [key]: message };
}

export function validatePersonName(
  raw: string,
  opts?: { label?: string; max?: number },
): string | null {
  const label = opts?.label ?? "Name";
  const max = opts?.max ?? PERSON_NAME_MAX;
  const value = raw.trim();
  if (!value) return `${label} is required.`;
  if (value.length > max) return `${label} must be at most ${max} characters.`;
  return null;
}

export function validateOrganisation(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.length > ORGANISATION_MAX) {
    return `Organisation must be at most ${ORGANISATION_MAX} characters.`;
  }
  return null;
}

export function validateLoginId(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return "User ID is required.";
  if (!LOGIN_ID_RE.test(value)) {
    return "User ID must look like DPU-XXXXXXX.";
  }
  return null;
}

export function validateEmail(raw: string, opts?: { required?: boolean }): string | null {
  const value = raw.trim();
  if (!value) return opts?.required ? "Email is required." : null;
  if (value.length > EMAIL_MAX) return `Email must be at most ${EMAIL_MAX} characters.`;
  if (!EMAIL_RE.test(value)) return "That does not look like an email.";
  return null;
}

export function validatePhone(raw: string, opts?: { required?: boolean }): string | null {
  const value = raw.trim();
  if (!value) return opts?.required ? "Phone is required." : null;
  if (!PHONE_RE.test(value) || value.length !== PHONE_MAX) {
    return `Enter a ${PHONE_MAX}-digit phone number.`;
  }
  return null;
}

export function validatePassword(raw: string): string | null {
  if (!raw) return "Password is required.";
  if (raw.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters.`;
  }
  if (raw.length > PASSWORD_MAX) {
    return `Password must be at most ${PASSWORD_MAX} characters.`;
  }
  return null;
}

export function validateMemberTitle(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.length > MEMBER_TITLE_MAX) {
    return `Title must be at most ${MEMBER_TITLE_MAX} characters.`;
  }
  return null;
}

/** Keys are prefixed so they never collide with a workflow field_key. */
export function validateContactForm(input: {
  name: string;
  organisation: string;
  email: string;
  phone: string;
  nameLabel?: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = validatePersonName(input.name, { label: input.nameLabel ?? "Name" });
  const organisation = validateOrganisation(input.organisation);
  const email = validateEmail(input.email);
  const phone = validatePhone(input.phone);
  if (name) errors.__name = name;
  if (organisation) errors.__organisation = organisation;
  if (email) errors.__email = email;
  if (phone) errors.__phone = phone;
  return errors;
}
