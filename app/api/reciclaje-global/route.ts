import { listGlobalRecyclingExecutions } from "@/lib/server/global-recycling-storage";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function GET(request: Request) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "25");
  return Response.json(await listGlobalRecyclingExecutions({ page, limit }));
}
