"use client";

import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import * as React from "react";

/**
 * A password field with a show/hide toggle.
 *
 * Typing a password you cannot see, twice, is how people end up locked out of
 * an account they just set a password on - so this exists mainly for the reset
 * screen, where a typo is only discovered at the next sign-in.
 *
 * Hidden by default and never persisted: revealing is a deliberate act, because
 * the risk it trades against is someone reading the screen over your shoulder.
 *
 * The button is a real focusable control (not tabIndex={-1}) so it can be used
 * without a mouse, and `type="button"` keeps it from submitting the form it
 * sits in - a submit-by-default button here would fire the form on every toggle.
 */
export function PasswordInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        // Room for the button so long values don't run underneath it.
        className={`pr-9 ${className ?? ""}`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon name={visible ? "visibility_off" : "visibility"} size={16} />
      </button>
    </div>
  );
}
