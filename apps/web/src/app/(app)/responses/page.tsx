import type { Metadata } from "next";
import { ResponsesView } from "@/components/views/responses-view";

export const metadata: Metadata = { title: "Standard responses" };

export default function Page() {
  return <ResponsesView />;
}
