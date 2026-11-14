import type { Metadata } from "next";
import { AuthExperience } from "@/components/login/auth-experience";

export const metadata: Metadata = {
  title: "Create an account | Pulse",
  description: "Create a Pulse admin or pharmacy account.",
};

export default function RegisterPage() {
  return <AuthExperience initialMode="register" />;
}
