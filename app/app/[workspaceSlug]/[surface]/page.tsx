import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductConsole } from "@/components/product/ProductConsole";
import { isSurfaceId } from "@/lib/product/templates";

const labels = {
  overview: "Overview",
  inbox: "Change Inbox",
  map: "Memory Map",
  ask: "Ask Commonstate",
  agents: "Agent Console",
  replay: "Replay",
  evals: "Evals",
  settings: "Workspace Settings",
} as const;

export async function generateMetadata({ params }: { params: Promise<{ workspaceSlug: string; surface: string }> }): Promise<Metadata> {
  const { surface } = await params;
  return { title: isSurfaceId(surface) ? labels[surface] : "Workspace" };
}

export default async function ProductWorkspaceSurface({ params }: { params: Promise<{ workspaceSlug: string; surface: string }> }) {
  const { workspaceSlug, surface } = await params;
  if (!isSurfaceId(surface)) notFound();
  return <ProductConsole workspaceSlug={workspaceSlug} activeSurface={surface} />;
}
