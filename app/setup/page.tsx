import type { Metadata } from "next";
import { SetupWizard } from "@/components/product/SetupWizard";
import { isTemplateId } from "@/lib/product/templates";

export const metadata: Metadata = {
  title: "Set up your workspace",
  description: "Configure a governed Commonstate workspace around how your company operates.",
};

export default async function SetupRoute({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const { template } = await searchParams;
  return <SetupWizard initialTemplate={template && isTemplateId(template) ? template : "ai-operations"} />;
}
