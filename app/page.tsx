import type { Metadata } from "next";
import { LandingPage } from "../components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Commonstate — Every human. Every agent. Same state.",
  description:
    "The operational context control plane that versions decisions, compiles the right context, and explains every agent action.",
};

export default function Home() {
  return <LandingPage />;
}
