import type { Metadata } from "next";
import { OperationsView } from "@/components/views/operations-view";

export const metadata: Metadata = { title: "Operations" };

export default function Page() {
  return <OperationsView />;
}
