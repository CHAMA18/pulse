import type { Metadata } from "next";
import { AuthExperience } from "@/components/login/auth-experience";

export const metadata: Metadata = {
  title: "Register | Pulse",
  description: "Register your pharmacy with Pulse.",
};

export default function RegisterPage() {
  return <AuthExperience initialMode="register" />;
}
