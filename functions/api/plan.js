// Cloudflare Pages Function: GET /api/plan. Logic lives in js/server/plan-proxy.js.
import { handlePlanRequest } from '../../js/server/plan-proxy.js';

export const onRequest = ({ request, env }) => handlePlanRequest(request, env);
