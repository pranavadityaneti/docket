/**
 * Resend From header: display name over the shared verified sender.
 * Document nudges / replies and password-reset all use RESEND_FROM_EMAIL.
 */
export function resendFrom(displayName: string, fromEmail: string): string {
  return `${displayName} <${fromEmail}>`;
}
