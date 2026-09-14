import { getCollectorService } from "@/lib/server/collectors";
import { jsonOk } from "@/lib/server/http";

export async function GET() {
  return jsonOk({ collectors: getCollectorService().listCollectors() });
}
