import type { Metadata } from "next";
import { AuthExperience } from "@/components/login/auth-experience";

export const metadata: Metadata = {
  title: "Login | Pulse",
  description: "Sign in to Pulse, the pharmacy intelligence platform.",
};

export default function LoginPage() {
  return <AuthExperience initialMode="login" />;
}
