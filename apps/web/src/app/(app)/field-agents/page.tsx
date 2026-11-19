import type { Metadata } from "next";
import { FieldAgentsView } from "@/components/views/people-views";

export const metadata: Metadata = { title: "Field agents" };

export default function Page() {
  return <FieldAgentsView />;
}
