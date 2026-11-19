import type { Metadata } from "next";
import { InboxPage } from "@/components/inbox";

export const metadata: Metadata = { title: "Escalated" };

export default function Page() {
  return <InboxPage view="escalated" />;
}
