"use client";

import {
  DynamicField,
  Field,
  FormSection,
  validateField,
} from "@/components/shared/case-fields";
import { SelectMenu } from "@/components/shared/select-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import type { CreateCaseInput } from "@/features/cases/api";
import type { ApiWorkflow } from "@/features/workflows/api";
import * as React from "react";

export function CreateLeadDialog({
  open,
  onOpenChange,
  onCreate,
  workflows,
  selectedSlug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateCaseInput) => Promise<void>;
  workflows: ApiWorkflow[];
  selectedSlug: string | null;
}) {
  const [slug, setSlug] = React.useState<string>("");
  const [name, setName] = React.useState("");
  const [organisation, setOrganisation] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const workflow = workflows.find((item) => item.slug === (slug || selectedSlug))
    ?? workflows[0]
    ?? null;
  const subjectLabel = workflow?.subjectLabel ?? "Contact";
  const caseLabel = workflow?.caseLabel ?? "Case";
  const fields = React.useMemo(
    () => [...(workflow?.fields ?? [])].sort((a, b) => a.order - b.order),
    [workflow],
  );

  function reset() {
    setSlug("");
    setName("");
    setOrganisation("");
    setEmail("");
    setPhone("");
    setValues({});
    setErrors({});
    setSubmitError(null);
    setSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function chooseWorkflow(next: string) {
    setSlug(next);
    setValues({});
    setErrors({});
  }

  async function submit() {
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.__name = `${subjectLabel} name is required.`;
    if (email.trim() && !email.includes("@")) {
      nextErrors.__email = "That does not look like an email.";
    }
    for (const field of fields) {
      const error = validateField(field, values[field.field_key] ?? "");
      if (error) nextErrors[field.field_key] = error;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const data: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = (values[field.field_key] ?? "").trim();
      if (!raw) continue;
      data[field.field_key] =
        field.field_type === "integer" ? Number(raw) : raw;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onCreate({
        name: name.trim(),
        organisation: organisation.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        source: typeof data.source === "string" ? data.source : undefined,
        workflow: workflow?.slug,
        data,
      });
      handleOpenChange(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Couldn't create the case. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b pr-10">
          <DialogTitle>New {caseLabel.toLowerCase()}</DialogTitle>
          <DialogDescription>
            {workflow
              ? `${workflow.name} workflow`
              : "No workflow configured"}{" "}
            · the document checklist is built when it is created.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {workflows.length > 1 ? (
            <FormSection title="Workflow">
              <Field label="What is this for?">
                <SelectMenu
                  value={workflow?.slug ?? ""}
                  onChange={chooseWorkflow}
                  options={workflows.map((item) => ({
                    value: item.slug,
                    label: item.name,
                  }))}
                  placeholder="Choose a workflow..."
                />
              </Field>
            </FormSection>
          ) : null}

          <FormSection title={subjectLabel}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name" error={errors.__name} required>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                />
              </Field>
              <Field label="Organisation">
                <Input
                  value={organisation}
                  onChange={(event) => setOrganisation(event.target.value)}
                  placeholder="Business, college or firm (optional)"
                />
              </Field>
              <Field label="Email" error={errors.__email}>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="9876543210"
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Email and phone are how documents this{" "}
              {subjectLabel.toLowerCase()} sends are matched back to this{" "}
              {caseLabel.toLowerCase()}.
            </p>
          </FormSection>

          <div className="mb-5 rounded-[12px] border bg-muted/40 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Icon
                name="fact_check"
                size={15}
                className="text-muted-foreground"
              />
              <span>
                {`The document checklist is built from these answers when the ${caseLabel.toLowerCase()} is created - you’ll land on it next.`}
              </span>
            </div>
          </div>

          {fields.length > 0 ? (
            <FormSection title="Details">
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((field) => (
                  <div
                    key={field.field_key}
                    className={
                      field.input_type === "textarea"
                        ? "sm:col-span-2"
                        : undefined
                    }
                  >
                    <DynamicField
                      field={field}
                      value={values[field.field_key] ?? ""}
                      error={errors[field.field_key]}
                      onChange={(value) =>
                        setValues((previous) => ({
                          ...previous,
                          [field.field_key]: value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </FormSection>
          ) : null}
        </div>

        {submitError ? (
          <div className="flex items-center gap-1.5 border-t bg-danger-muted px-4 py-2 text-sm text-danger">
            <Icon name="error" size={15} /> {submitError}
          </div>
        ) : null}

        <DialogFooter className="flex-row justify-end gap-2 border-t">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !workflow}
            className="gap-1.5"
          >
            {submitting ? (
              <>
                <Icon
                  name="progress_activity"
                  size={16}
                  className="animate-spin"
                />{" "}
                Creating...
              </>
            ) : (
              <>
                <Icon name="add" size={16} /> Create {caseLabel.toLowerCase()}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
