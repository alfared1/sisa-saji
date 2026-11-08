import { notFound } from "next/navigation";
import { MerchantShellPreview } from "./preview";

export const metadata = { title: "Preview MerchantShell (dev)", robots: { index: false } };

export default function MerchantShellPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MerchantShellPreview />;
}
