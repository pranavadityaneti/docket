import { notFound } from "next/navigation";
import { ModelTestClient } from "./ui";

/**
 * Local-only ML playground. Production builds 404 here (middleware + this gate).
 */
export default function ModelTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ModelTestClient />;
}
