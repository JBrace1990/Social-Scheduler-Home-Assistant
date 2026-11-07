import { NextResponse } from "next/server";

export const runtime = "nodejs";
const HEADERS = "path_url,caption,caption_variant,first_comment,schedule_text,scheduled_local,timezone,content_kind,content_status,target_channel_ids,tag_ids,period_links";

export async function GET() {
  return new NextResponse(HEADERS + "\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="social-scheduler-post-template.csv"' } });
}
