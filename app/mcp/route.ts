import { env } from "cloudflare:workers";
import { handleMcp } from "@/lib/mybox/mcp";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleMcp(request, env); }
export async function GET() { return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } }); }
export async function DELETE() { return new Response(null, { status: 405, headers: { Allow: "POST" } }); }
