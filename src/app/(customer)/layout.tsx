import { DemoNotice } from "@/components/common/demo-notice";
import { CustomerEffects } from "@/components/shell/customer-effects";
import { CustomerShell } from "@/components/shell/customer-shell";

/** Customer app: mobile container + bottom tabs + presence ping. Pages own their headers. */
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <CustomerShell>
      <CustomerEffects />
      <DemoNotice audience="pembeli" className="lg:mt-2 lg:rounded-xl" />
      {children}
    </CustomerShell>
  );
}
