import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TemplateDemo } from "@/components/product/TemplateDemo";

const supported = ["ai-operations", "enterprise-governance", "agency-operations"] as const;
type SupportedTemplate = (typeof supported)[number];

function isSupported(value: string): value is SupportedTemplate {
  return supported.includes(value as SupportedTemplate);
}

export async function generateMetadata({ params }: { params: Promise<{ template: string }> }): Promise<Metadata> {
  const { template } = await params;
  return { title: isSupported(template) ? `${template.replaceAll("-", " ")} demo` : "Template demo", robots: { index: true, follow: true } };
}

export default async function TemplateDemoRoute({ params }: { params: Promise<{ template: string }> }) {
  const { template } = await params;
  if (!isSupported(template)) notFound();
  return <TemplateDemo templateId={template} />;
}
