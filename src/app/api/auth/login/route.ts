import { NextResponse } from "next/server";
import { z } from "zod";

const DEMO_USER = {
  email: "demo@duniyahealthcare.com",
  password: "Pulse@1234",
  name: "Amina Otieno",
};

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
  remember: z.boolean().optional(),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Please provide a valid email and password." },
      { status: 400 }
    );
  }

  // Simulate network + auth latency
  await sleep(950);

  const { email, password } = parsed.data;
  if (
    email.trim().toLowerCase() === DEMO_USER.email &&
    password === DEMO_USER.password
  ) {
    return NextResponse.json({
      ok: true,
      user: { name: DEMO_USER.name, email: DEMO_USER.email },
    });
  }

  return NextResponse.json(
    {
      ok: false,
      message: "Incorrect email or password. Tap “Demo access” below the form to get test credentials.",
    },
    { status: 401 }
  );
}
