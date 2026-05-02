/**
 * Thin SSE proxy: forwards multipart POST to the Python backend's streaming
 * turn endpoint and pipes the event-stream back to the browser.
 *
 * Responsibilities: read session cookie, attach it to the upstream request,
 * and pipe the response body. No business logic here.
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await props.params;
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.formData();

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/sessions/${sessionId}/turns/stream`, {
      method: "POST",
      headers: { Cookie: `session=${token}` },
      body,
    });
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }

  if (!upstream.ok) {
    try {
      const json = await upstream.json() as Record<string, unknown>;
      return NextResponse.json(json, { status: upstream.status });
    } catch {
      const text = await upstream.text();
      return NextResponse.json({ detail: text }, { status: upstream.status });
    }
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
