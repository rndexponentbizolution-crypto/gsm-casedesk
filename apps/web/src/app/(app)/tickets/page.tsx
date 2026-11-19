import type { Metadata } from "next";
import { InboxPage } from "@/components/inbox";

export const metadata: Metadata = { title: "My tickets" };

export default function Page() {
  return <InboxPage view="mine" />;
}
