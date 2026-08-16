"use client";

import {
  DynamicField,
  Field,
  fieldToInput,
  inputsToData,
  validateField,
} from "@/components/shared/case-fields";
import { SelectMenu } from "@/components/shared/select-menu";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { listMembers, type ApiMember } from "@/features/auth/api";
import type { ApiCaseDetail } from "@/features/case-detail/api";
import { updateCase } from "@/features/cases/api";
import type { ApiFieldDef } from "@/features/workflows/api";
import { formatDate } from "@/lib/format";
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

function humanise(key: string): string {
  const text = key.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const grouped = value.toLocaleString("en-IN");
    return /amount|turnover|income|revenue/i.test(key) ? `₹${grouped}` : grouped;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value).trim();
  return text === "" || text === "undefined" || text === "null" ? null : text;
}

function ReadRow({ label, value }: { label: string; value: string | null }) {
  const empty = value === null || value === "";
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          empty
            ? "mt-0.5 break-words font-normal text-muted-foreground"
            : "mt-0.5 break-words font-medium"
        }
      >
        {empty ? "N/A" : value}
      </dd>
    </div>
  );
}

function OwnerAssign({
  detail,
  onSaved,
}: {
  detail: ApiCaseDetail;
  onSaved: () => Promise<void>;
}) {
  const [members, setMembers] = React.useState<ApiMember[]>([]);
  const [ownerId, setOwnerId] = React.useState(detail.ownerId ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setOwnerId(detail.ownerId ?? "");
  }, [detail.ownerId]);

  React.useEffect(() => {
    let cancelled = false;
    void listMembers()
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch(() => {
        // Owner dropdown stays empty; read-only name still shows.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveOwner(next: string) {
    setOwnerId(next);
    setSaving(true);
    setError(null);
    try {
      await updateCase(detail.id, { ownerId: next === "" ? null : next });
      await onSaved();
    } catch (cause) {
      if (cause instanceof AuthRequiredError) return;
      setOwnerId(detail.ownerId ?? "");
      setError(cause instanceof Error ? cause.message : "Couldn't update the owner.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xs space-y-1.5">
      <label htmlFor="case-owner" className="text-sm text-muted-foreground">
        Owner
      </label>
      <SelectMenu
        id="case-owner"
        value={ownerId}
        disabled={saving || members.length === 0}
        placeholder="Unassigned"
        className="w-full"
        options={[
          { value: "", label: "Unassigned" },
          ...members.map((m) => ({
            value: m.id,
            label: m.title ? `${m.name} · ${m.title}` : m.name,
          })),
        ]}
        onChange={(next) => void saveOwner(next)}
      />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function OverviewTab({
  detail,
  subject,
  fields,
  onSaved,
}: {
  detail: ApiCaseDetail;
  subject: string;
  fields: ApiFieldDef[];
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState("");
  const [organisation, setOrganisation] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const sorted = React.useMemo(
    () => [...fields].sort((left, right) => left.order - right.order),
    [fields],
  );

  function beginEdit() {
    setName(detail.subjectName ?? "");
    setOrganisation(detail.subjectOrganisation ?? "");
    setEmail(detail.subjectEmail ?? "");
    setPhone(detail.subjectPhone ?? "");
    const seeded: Record<string, string> = {};
    for (const field of sorted) {
      seeded[field.field_key] = fieldToInput((detail.data ?? {})[field.field_key]);
    }
    setValues(seeded);
    setErrors({});
    setSaveError(null);
    setEditing(true);
  }

  function patchError(key: string, message: string | null) {
    setErrors((prev) => setKeyedError(prev, key, message));
  }

  const nameLabel = `${subject} name`;

  async function save() {
    const nextErrors = validateContactForm({
      name,
      organisation,
      email,
      phone,
      nameLabel,
    });
    for (const field of sorted) {
      const message = validateField(field, values[field.field_key] ?? "");
      if (message) nextErrors[field.field_key] = message;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateCase(detail.id, {
        name: name.trim(),
        organisation: organisation.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        data: inputsToData(sorted, values),
      });
      await onSaved();
      setEditing(false);
    } catch (cause) {
      if (cause instanceof AuthRequiredError) return;
      setSaveError(cause instanceof Error ? cause.message : "Couldn't save the changes.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    const known = new Set(sorted.map((field) => field.field_key));
    const extra = Object.entries(detail.data ?? {}).filter(
      ([key]) => key !== "source" && !known.has(key),
    );
    return (
      <div className="flex flex-col gap-4">
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
            <div className="font-medium">{subject}</div>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={beginEdit}>
              <Icon name="edit" size={15} /> Edit details
            </Button>
          </div>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 p-4 text-sm sm:grid-cols-2">
            <ReadRow label="Name" value={detail.subjectName ?? ""} />
            <ReadRow label="Organisation" value={detail.subjectOrganisation ?? ""} />
            <ReadRow label="Email" value={detail.subjectEmail ?? ""} />
            <ReadRow label="Phone" value={detail.subjectPhone ?? ""} />
          </dl>
        </Card>
        <Card className="gap-0 overflow-hidden py-0">
          <div className="border-b p-4 font-medium">{detail.caseLabel}</div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-3 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Reference</dt>
              <dd className="mt-0.5 font-mono text-[13px]">{detail.reference}</dd>
            </div>
            <ReadRow label="Workflow" value={detail.workflowName} />
            <ReadRow label="Stage" value={detail.stageName ?? ""} />
            <ReadRow label="Source" value={detail.source ?? ""} />
            <ReadRow label="Created" value={formatDate(detail.createdAt, "")} />
            <ReadRow label="Reminders" value={detail.nudgesPausedAt ? "Paused" : "Active"} />
            <OwnerAssign detail={detail} onSaved={onSaved} />
          </div>
        </Card>
        {sorted.length > 0 || extra.length > 0 ? (
          <Card className="gap-0 overflow-hidden py-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
              <div className="font-medium">Details</div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={beginEdit}>
                <Icon name="edit" size={15} /> Edit details
              </Button>
            </div>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 p-4 text-sm sm:grid-cols-2">
              {sorted.map((field) => (
                <ReadRow
                  key={field.field_key}
                  label={field.label}
                  value={formatValue(field.field_key, (detail.data ?? {})[field.field_key])}
                />
              ))}
              {extra.map(([key, value]) => (
                <ReadRow key={key} label={humanise(key)} value={formatValue(key, value)} />
              ))}
            </dl>
          </Card>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b p-4 font-medium">{subject}</div>
        <div className="p-4">
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
            />
          </Field>
          <div className="mt-3">
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
              />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              />
            </Field>
          </div>
          <div className="mt-3 inline-flex max-w-xl items-start gap-1.5 rounded-[12px] border border-warning-border bg-warning-muted px-3 py-2 text-xs text-warning-muted-foreground">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" />
            <span>
              Email and phone decide which documents reach this {detail.caseLabel.toLowerCase()}.
              Changing them changes what the {subject.toLowerCase()} can send to.
            </span>
          </div>
        </div>
      </Card>
      {sorted.length > 0 ? (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="border-b p-4 font-medium">Details</div>
          <div className="flex flex-col gap-3 p-4">
            {sorted.map((field) => (
              <DynamicField
                key={field.field_key}
                field={field}
                value={values[field.field_key] ?? ""}
                error={errors[field.field_key]}
                onChange={(value) => {
                  setValues((previous) => ({ ...previous, [field.field_key]: value }));
                  if (errors[field.field_key]) {
                    patchError(field.field_key, validateField(field, value));
                  }
                }}
                onBlur={(value) =>
                  patchError(field.field_key, validateField(field, value))
                }
              />
            ))}
            <div className="flex items-start gap-1.5 rounded-[12px] border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Icon name="fact_check" size={14} className="mt-0.5 shrink-0" />
              <span>
                The document checklist is built from these answers - changing them can add or remove
                required documents.
              </span>
            </div>
          </div>
        </Card>
      ) : null}
      {saveError ? (
        <div className="border border-danger-border bg-danger-muted px-3 py-2 text-sm text-danger-muted-foreground">
          {saveError}
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={saving} className="gap-1.5">
          {saving ? (
            <>
              <Icon name="progress_activity" size={16} className="animate-spin" /> Saving...
            </>
          ) : (
            <>
              <Icon name="check" size={16} /> Save changes
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
