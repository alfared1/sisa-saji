import { notFound } from "next/navigation";
import { CustomerShellPreview } from "./preview";

export const metadata = { title: "Preview CustomerShell (dev)", robots: { index: false } };

export default function CustomerShellPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CustomerShellPreview />;
}
