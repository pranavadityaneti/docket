import { Injectable, Logger, Module } from "@nestjs/common";
import { Resend } from "resend";
import { env } from "../config/env";
import { resendFrom } from "./from";

/**
 * Transactional email via Resend.
 *
 * If the API key or from-address is unset it logs and no-ops, so local dev and
 * tests run with no email credentials - the same posture as config/secrets
 * hydration. Reuses the Resend account and verified domain the marketing site
 * already sends from.
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private readonly resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    if (!this.resend || !env.resendFromEmail) {
      this.log.warn(`Resend not configured - skipping password-reset email to ${to}`);
      return;
    }
    const { error } = await this.resend.emails.send({
      from: resendFrom("Docket", env.resendFromEmail),
      to,
      subject: "Reset your Docket password",
      text:
        `Someone asked to reset the password for this Docket account.\n\n` +
        `Reset it here (the link expires in 1 hour):\n${resetUrl}\n\n` +
        `If you didn't ask for this, ignore this email - your password stays the same.`,
    });
    // Logged, never thrown: the caller must return the same response whether or
    // not the account exists, so a send failure must not surface to the user.
    if (error) {
      this.log.error(`Password-reset email to ${to} failed: ${error.message ?? String(error)}`);
    }
  }

  async sendWelcomeEmail(
    to: string,
    input: {
      userId: string;
      email: string;
      password: string;
      workspaceName: string;
      signInUrl: string;
    },
  ): Promise<void> {
    if (!this.resend || !env.resendFromEmail) {
      this.log.warn(`Resend not configured - skipping welcome email to ${to}`);
      return;
    }
    const { error } = await this.resend.emails.send({
      from: resendFrom("Docket", env.resendFromEmail),
      to,
      subject: `Your ${input.workspaceName} Docket account`,
      text:
        `An account was created for you on ${input.workspaceName}.\n\n` +
        `User ID: ${input.userId}\n` +
        `Email: ${input.email}\n` +
        `Password: ${input.password}\n\n` +
        `Sign in here:\n${input.signInUrl}\n`,
    });
    if (error) {
      this.log.error(`Welcome email to ${to} failed: ${error.message ?? String(error)}`);
    }
  }
}

@Module({ providers: [EmailService], exports: [EmailService] })
export class EmailModule { }
