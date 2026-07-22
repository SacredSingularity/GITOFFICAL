/**
 * LessonCanvas Help-chat proxy — Cloudflare Worker.
 *
 * Why this exists: lessoncanvas.html is a static file with no server, so it has
 * nowhere safe to hold an Anthropic API key — anything shipped to the browser is
 * readable by anyone who opens dev tools, which matters a lot once a lesson file
 * is handed to students. This Worker is the fix: your API key lives only here,
 * as a server-side secret, never sent to the browser. The lesson file calls this
 * Worker's URL instead of calling Anthropic directly.
 *
 * ---- Deploy (one-time setup) ----
 * 1. Create a free Cloudflare account (https://dash.cloudflare.com) if you don't
 *    have one, and install Wrangler (Cloudflare's CLI): `npm install -g wrangler`
 * 2. In this folder, run: `wrangler init lessoncanvas-helper --yes` — then replace
 *    the generated worker file's contents with this file's contents.
 * 3. Set your Anthropic API key as a secret (never put it in this file):
 *      wrangler secret put ANTHROPIC_API_KEY
 *    (paste your key when prompted — it's stored encrypted by Cloudflare, not in
 *    this source file, and never visible to anyone opening the lesson).
 * 4. Deploy: `wrangler deploy` — this prints your Worker's URL, something like
 *    https://lessoncanvas-helper.YOUR-SUBDOMAIN.workers.dev
 * 5. Paste that URL into lessoncanvas.html's `LESSON_HELPER_PROXY_URL` constant
 *    (search for it near the Help chat code) and re-save the lesson file. The
 *    Help chat goes live immediately — no key ever touches the browser.
 *
 * ---- What this does NOT do ----
 * - No per-student accounts or rate limiting beyond the basic caps below. If you
 *   share this Worker URL widely, anyone who finds it can call it (they still
 *   never see your key, but they could run up your API bill). Cloudflare's free
 *   tier and the caps below make abuse cheap to absorb for a small class, but
 *   this is not hardened for public/viral distribution.
 * - Restrict `access-control-allow-origin` below to your actual lesson's real
 *   hosting origin once you know it, instead of '*', to stop other sites from
 *   using your Worker as their own free API relay.
 */

const MAX_MESSAGES = 20;          // only the most recent N turns are sent upstream
const MAX_MESSAGE_CHARS = 4000;   // per-message cap, keeps a single request cheap
const MAX_SYSTEM_PROMPT_CHARS = 8000;
const MAX_TOKENS = 600;           // caps the reply length (and therefore cost) per turn
const MODEL = 'claude-sonnet-4-5';

const ALLOWED_ORIGIN = '*'; // TODO: replace with your lesson's real origin before wide distribution

function corsHeaders(){
  return {
    'content-type': 'application/json',
    'access-control-allow-origin': ALLOWED_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

function jsonResponse(body, status){
  return new Response(JSON.stringify(body), { status: status || 200, headers: corsHeaders() });
}

export default {
  async fetch(request, env){
    if(request.method === 'OPTIONS'){
      return new Response(null, { headers: corsHeaders() });
    }
    if(request.method !== 'POST'){
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }
    if(!env.ANTHROPIC_API_KEY){
      return jsonResponse({ error: 'Server is missing ANTHROPIC_API_KEY — run: wrangler secret put ANTHROPIC_API_KEY' }, 500);
    }

    let payload;
    try{
      payload = await request.json();
    }catch(e){
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
    if(!rawMessages.length){
      return jsonResponse({ error: '"messages" must be a non-empty array' }, 400);
    }

    // Sanitize/cap everything before it ever reaches the model — the lesson file
    // already builds a safe prompt, but the proxy shouldn't just trust the client.
    const messages = rawMessages.slice(-MAX_MESSAGES).map(m => ({
      role: m && m.role === 'user' ? 'user' : 'assistant',
      content: String((m && m.content) || '').slice(0, MAX_MESSAGE_CHARS),
    }));
    const systemPrompt = String(payload.systemPrompt || '').slice(0, MAX_SYSTEM_PROMPT_CHARS);

    let anthropicRes;
    try{
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          messages,
        }),
      });
    }catch(e){
      return jsonResponse({ error: 'Could not reach Anthropic: ' + e.message }, 502);
    }

    if(!anthropicRes.ok){
      const detail = await anthropicRes.text().catch(()=>'(no body)');
      return jsonResponse({ error: 'Upstream error', status: anthropicRes.status, detail: detail.slice(0,300) }, 502);
    }

    const data = await anthropicRes.json();
    const reply = (data.content && data.content[0] && data.content[0].text) || '(no response text)';
    return jsonResponse({ reply });
  },
};
