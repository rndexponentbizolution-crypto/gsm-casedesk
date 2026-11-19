import type { Metadata } from "next";
import { StaffView } from "@/components/views/people-views";

export const metadata: Metadata = { title: "Staff" };

export default function Page() {
  return <StaffView />;
}
