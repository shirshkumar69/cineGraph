import { getDb } from "../../../db/index";
import { getChatGPTUser } from "../../chatgpt-auth";
import { handleApi } from "../../../lib/api.mjs";

export const runtime = 'edge';

export async function GET(request: Request) {
  return handleApi(request, getDb(), await getChatGPTUser());
}
export const POST = GET;
