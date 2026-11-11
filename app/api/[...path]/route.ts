import {env} from "cloudflare:workers";
import {getChatGPTUser} from "../../chatgpt-auth";
import {handleApi} from "../../../lib/api.mjs";
export async function GET(request:Request){return handleApi(request,env.DB,await getChatGPTUser())}
export const POST=GET;
