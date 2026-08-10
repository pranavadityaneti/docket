"use client";

import { useCallback, useMemo, useState } from "react";
import { API_URL } from "@/lib/http";

type ScoreRow = { id: string; title: string; score: number };

type ClassifyResult = {
  label: string;
  title: string;
  confidence: number;
  band: "high" | "medium" | "low" | "unknown";
  scores: ScoreRow[];
  modelVersion: string;
  route: string;
};

const LABEL_ORDER = [
  "pan_card",
  "aadhaar_front",
  "aadhaar_back",
  "passport",
  "photograph",
  "bank_statement",
  "rental_agreement",
  "cancelled_cheque",
  "salary_slip",
  "utility_bill",
  "form_16",
  "gst_certificate",
  "other",
] as const;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function pct(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

function bandColor(band: ClassifyResult["band"]): string {
  switch (band) {
    case "high":
      return "var(--green-600, #15803d)";
    case "medium":
      return "var(--amber-600, #d97706)";
    case "low":
      return "var(--orange-600, #ea580c)";
    default:
      return "var(--slate-500, #64748b)";
  }
}

export function ModelTestClient() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClassifyResult | null>(null);

  const onPick = useCallback((next: File | null) => {
    setResult(null);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    if (next && next.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(next));
    } else {
      setPreviewUrl(null);
    }
  }, [previewUrl]);

  const run = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await fetch(`${API_URL}/classify/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mimeType: file.type || "application/octet-stream",
          dataBase64,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          body?.message && Array.isArray(body.message)
            ? body.message.join(", ")
            : body?.message || body?.error || `HTTP ${res.status}`;
        throw new Error(typeof msg === "string" ? msg : "Classification failed");
      }
      setResult(body as ClassifyResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [file]);

  const orderedScores = useMemo(() => {
    if (!result) return [];
    const byId = new Map(result.scores.map((s) => [s.id, s]));
    return LABEL_ORDER.map((id) => byId.get(id)).filter(Boolean) as ScoreRow[];
  }, [result]);

  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: "2rem 1.25rem 3rem",
        background:
          "radial-gradient(1200px 600px at 10% -10%, color-mix(in oklab, var(--brand, #0f766e) 18%, transparent), transparent), linear-gradient(180deg, #f8fafc, #eef2f7)",
        color: "#0f172a",
        fontFamily: "var(--font-sans), system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <p style={{ margin: 0, letterSpacing: "0.08em", fontSize: 12, opacity: 0.65, textTransform: "uppercase" }}>
          Local ML playground
        </p>
        <h1 style={{ margin: "0.35rem 0 0.5rem", fontSize: "clamp(1.8rem, 4vw, 2.6rem)", fontWeight: 700 }}>
          Document classifier
        </h1>
        <p style={{ margin: "0 0 1.75rem", maxWidth: 54, width: "100%", opacity: 0.75, lineHeight: 1.5 }}>
          Upload an image or PDF. Filename is ignored — the local EfficientNet
          ONNX model (or PDF text path) returns the ontology label and confidence.
        </p>

        <section
          style={{
            display: "grid",
            gap: "1.25rem",
            gridTemplateColumns: "minmax(0, 1fr)",
          }}
        >
          <div
            style={{
              border: "1px dashed color-mix(in oklab, #0f172a 25%, transparent)",
              borderRadius: 16,
              padding: "1.25rem",
              background: "color-mix(in oklab, white 82%, transparent)",
              backdropFilter: "blur(8px)",
            }}
          >
            <label
              htmlFor="doc-file"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                cursor: "pointer",
              }}
            >
              <span style={{ fontWeight: 600 }}>Choose image or PDF</span>
              <input
                id="doc-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                onChange={(e) => onPick(e.target.files?.[0] ?? null)}
                style={{ fontSize: 14 }}
              />
            </label>

            {file && (
              <p style={{ margin: "0.85rem 0 0", fontSize: 14, opacity: 0.7 }}>
                Selected: {file.name} · {(file.size / 1024).toFixed(1)} KB · {file.type || "unknown type"}
              </p>
            )}

            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Upload preview"
                style={{
                  display: "block",
                  marginTop: "1rem",
                  maxWidth: "100%",
                  maxHeight: 280,
                  borderRadius: 12,
                  objectFit: "contain",
                  background: "#0f172a0d",
                }}
              />
            )}

            <button
              type="button"
              onClick={run}
              disabled={!file || busy}
              style={{
                marginTop: "1.1rem",
                border: 0,
                borderRadius: 999,
                padding: "0.7rem 1.25rem",
                fontWeight: 600,
                fontSize: 15,
                color: "white",
                background: !file || busy ? "#94a3b8" : "#0f766e",
                cursor: !file || busy ? "not-allowed" : "pointer",
              }}
            >
              {busy ? "Classifying…" : "Identify document"}
            </button>
          </div>

          {error && (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: "0.9rem 1rem",
                borderRadius: 12,
                background: "#fef2f2",
                color: "#b91c1c",
                whiteSpace: "pre-wrap",
              }}
            >
              {error}
            </p>
          )}

          {result && (
            <div
              style={{
                borderRadius: 16,
                padding: "1.25rem",
                background: "white",
                boxShadow: "0 1px 0 #0f172a12, 0 12px 40px #0f172a0d",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem 1.25rem", alignItems: "baseline" }}>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Prediction
                  </div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{result.label}</div>
                  <div style={{ opacity: 0.7 }}>{result.title}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Confidence
                  </div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700, color: bandColor(result.band) }}>
                    {pct(result.confidence)}
                  </div>
                  <div style={{ opacity: 0.7 }}>band: {result.band}</div>
                </div>
                <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.55, textAlign: "right" }}>
                  <div>{result.modelVersion}</div>
                  <div>route: {result.route}</div>
                </div>
              </div>

              <h2 style={{ margin: "1.35rem 0 0.75rem", fontSize: 15, fontWeight: 600 }}>
                All ontology scores
              </h2>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
                {orderedScores.map((row) => (
                  <li key={row.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                      <span>
                        <strong>{row.id}</strong>
                        <span style={{ opacity: 0.55 }}> · {row.title}</span>
                      </span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{pct(row.score)}</span>
                    </div>
                    <div
                      style={{
                        height: 8,
                        borderRadius: 999,
                        background: "#e2e8f0",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(0, row.score * 100))}%`,
                          height: "100%",
                          background: row.id === result.label ? "#0f766e" : "#94a3b8",
                          borderRadius: 999,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
