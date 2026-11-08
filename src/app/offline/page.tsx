import type { Metadata } from "next";
import { OfflineView } from "./offline-view";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false },
};

/** Fallback page served by the service worker when a navigation fails offline. */
export default function OfflinePage() {
  return <OfflineView />;
}
