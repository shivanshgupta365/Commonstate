import type { Metadata } from "next";
import { LoginPage } from "@/components/product/LoginPage";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Commonstate operational context workspace.",
};

export default async function LoginRoute({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <LoginPage callbackError={error} />;
}
