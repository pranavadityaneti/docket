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
import { listWorkflows, type ApiWorkflow } from "@/features/workflows/api";
import { AuthRequiredError } from "@/lib/http";
import {
  EMAIL_MAX,
  ORGANISATION_MAX,
  PERSON_NAME_MAX,
  PHONE_MAX,
  sanitizeEmail,
  sanitizePhone,
  setKeyedError,
  validateContactForm,
  validateEmail,
  validateOrganisation,
  validatePersonName,
  validatePhone,
} from "@/lib/validators";
import * as React from "react";

/** Create is only blocked while a submit or workflow load is in flight. */
export function createCaseSubmitDisabled(opts: {
  submitting: boolean;
  loading: boolean;
}): boolean {
  return opts.submitting || opts.loading;
}

export function CreateLeadDialog({
  open,
  onOpenChange,
  onCreate,
  workflows: workflowsProp,
  selectedSlug,
  loading: parentLoading = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateCaseInput) => Promise<void>;
  workflows: ApiWorkflow[];
  selectedSlug: string | null;
  loading?: boolean;
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
  const [fetched, setFetched] = React.useState<ApiWorkflow[] | null>(null);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [fetching, setFetching] = React.useState(false);

  const workflows = workflowsProp.length > 0 ? workflowsProp : (fetched ?? []);
  const loading = fetching || (parentLoading && workflows.length === 0);
  const workflow = workflows.find((item) => item.slug === (slug || selectedSlug))
    ?? workflows[0]
    ?? null;
  const subjectLabel = workflow?.subjectLabel ?? "Contact";
  const caseLabel = workflow?.caseLabel ?? "Case";
  const fields = React.useMemo(
    () => [...(workflow?.fields ?? [])].sort((a, b) => a.order - b.order),
    [workflow],
  );

  React.useEffect(() => {
    if (!open || workflowsProp.length > 0) return;
    let cancelled = false;
    // Syncing with GET /workflows when the parent list has not arrived yet.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFetching(true);
    setFetchError(null);
    void listWorkflows()
      .then((all) => {
        if (!cancelled) setFetched(all);
      })
      .catch((error) => {
        if (cancelled || error instanceof AuthRequiredError) return;
        setFetchError(
          error instanceof Error ? error.message : "Couldn't load the workflow.",
        );
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workflowsProp.length]);

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
    setFetched(null);
    setFetchError(null);
    setFetching(false);
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

  function patchError(key: string, message: string | null) {
    setErrors((prev) => setKeyedError(prev, key, message));
  }

  const nameLabel = `${subjectLabel} name`;

  async function submit() {
    const nextErrors = validateContactForm({
      name,
      organisation,
      email,
      phone,
      nameLabel,
    });
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
                  maxLength={PERSON_NAME_MAX}
                  aria-invalid={errors.__name ? true : undefined}
                  onChange={(event) => {
                    const next = event.target.value;
                    setName(next);
                    if (errors.__name) patchError("__name", validatePersonName(next, { label: nameLabel }));
                  }}
                  onBlur={() => patchError("__name", validatePersonName(name, { label: nameLabel }))}
                  placeholder="e.g. Ramesh Kumar"
                />
              </Field>
              <Field label="Organisation" error={errors.__organisation}>
                <Input
                  value={organisation}
                  maxLength={ORGANISATION_MAX}
                  aria-invalid={errors.__organisation ? true : undefined}
                  onChange={(event) => {
                    const next = event.target.value;
                    setOrganisation(next);
                    if (errors.__organisation) patchError("__organisation", validateOrganisation(next));
                  }}
                  onBlur={() => patchError("__organisation", validateOrganisation(organisation))}
                  placeholder="Business, college or firm (optional)"
                />
              </Field>
              <Field label="Email" error={errors.__email}>
                <Input
                  type="email"
                  value={email}
                  maxLength={EMAIL_MAX}
                  aria-invalid={errors.__email ? true : undefined}
                  onChange={(event) => {
                    const next = sanitizeEmail(event.target.value);
                    setEmail(next);
                    if (errors.__email) patchError("__email", validateEmail(next));
                  }}
                  onBlur={() => patchError("__email", validateEmail(email))}
                  placeholder="name@example.com"
                />
              </Field>
              <Field label="Phone" error={errors.__phone}>
                <Input
                  value={phone}
                  maxLength={PHONE_MAX}
                  inputMode="tel"
                  autoComplete="tel"
                  aria-invalid={errors.__phone ? true : undefined}
                  onChange={(event) => {
                    const next = sanitizePhone(event.target.value);
                    setPhone(next);
                    if (errors.__phone) patchError("__phone", validatePhone(next));
                  }}
                  onBlur={() => patchError("__phone", validatePhone(phone))}
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
                      onChange={(value) => {
                        setValues((previous) => ({
                          ...previous,
                          [field.field_key]: value,
                        }));
                        if (errors[field.field_key]) {
                          patchError(field.field_key, validateField(field, value));
                        }
                      }}
                      onBlur={(value) =>
                        patchError(field.field_key, validateField(field, value))
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
        ) : fetchError && !workflow ? (
          <div className="flex items-center gap-1.5 border-t bg-danger-muted px-4 py-2 text-sm text-danger">
            <Icon name="error" size={15} /> {fetchError}
          </div>
        ) : loading ? (
          <div className="flex items-center gap-1.5 border-t px-4 py-2 text-sm text-muted-foreground">
            <Icon name="progress_activity" size={15} className="animate-spin" />
            Loading the workflow…
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
            disabled={createCaseSubmitDisabled({ submitting, loading })}
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
