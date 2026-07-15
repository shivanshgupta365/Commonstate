import type { Metadata } from "next";
import { TanoConsole } from "@/components/console/TanoConsole";

export const metadata: Metadata = {
  title: "Tano Edition",
  description:
    "A living, permissioned operational truth shared by every human and every agent.",
};

export default function TanoEditionPage() {
  return <TanoConsole />;
}
