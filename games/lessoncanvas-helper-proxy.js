/**
 * LessonCanvas AI Helper — alternative Cloudflare Worker backend (Claude via
 * the Anthropic API).
 *
 * IMPORTANT — read this before assuming it's what's live: the AI Helper button
 * in lessoncanvas.html currently talks to https://lessoncanvas.jtraini.workers.dev,
 * a Worker running Llama 3.1 8B that was built separately and is NOT this file
 * (its source isn't in this repo). That deployment is live and working today.
 * This file is a self-contained alternative you can deploy yourself if you'd
 * rather run the helper on Claude with your own Anthropic API key. Its request/
 * response contract matches exactly what lessoncanvas.html's sendAiHelperQuestion()
 * actually sends and expects ({ question, context } -> { answer }), so it's a
 * drop-in replacement for the URL hardcoded there — it is not, on its own,
 * "the" backend.
 *
 * Why a Worker at all: lessoncanvas.html is a static file with no server, so it
 * has nowhere safe to hold an API key — anything shipped to the browser is
 * readable by anyone who opens dev tools, which matters a lot once a lesson
 * file is handed to students. A Worker fixes that: your key lives only here,
 * as a server-side secret, never sent to the browser.
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
 * 5. lessoncanvas.html does not read this URL from a config constant -- it's a
 *    literal string inside sendAiHelperQuestion() (search lessoncanvas.html for
 *    "workers.dev"). To actually switch the lesson over to this Worker, edit
 *    that fetch() call's URL by hand to point at your deployed URL + "/api/ask"
 *    and re-save the lesson file. Only do this if you intend to replace the
 *    already-live Llama backend -- it's a real, working deployment today.
 *
 * ---- What this does NOT do ----
 * - No per-student accounts or rate limiting beyond the basic caps below. If you
 *   share this Worker URL widely, anyone who finds it can call it (they still
 *   never see your key, but they could run up your API bill). Cloudflare's free
 *   tier and the caps below make abuse cheap to absorb for a small class, but
 *   this is not hardened for public/viral distribution.
 * - ALLOWED_ORIGIN below defaults to '*' for local testing convenience. Shipping
 *   a lesson to students with '*' still set means accepting that anyone who opens
 *   dev tools and finds this Worker's URL has a free relay to your API key's
 *   billing -- there is no other access control here. Set it to your lesson's
 *   real hosting origin before wide distribution. The Worker logs a warning on
 *   every request while it's still '*', as a reminder this hasn't been done.
 */

const MAX_MESSAGES = 20;          // only the most recent N turns are sent upstream
const MAX_MESSAGE_CHARS = 4000;   // per-message cap, keeps a single request cheap
const MAX_CONTEXT_CHARS = 8000;
const MAX_TOKENS = 600;           // caps the reply length (and therefore cost) per turn
const MODEL = 'claude-sonnet-5';  // verify this is still a valid model id before deploying --
                                   // an invalid id surfaces to the student only as a generic
                                   // "AI helper is unavailable right now", never the real reason

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
    const url = new URL(request.url);
    // matches the path lessoncanvas.html has always called -- kept as an explicit
    // route (rather than answering on any path) so a typo'd URL 404s instead of
    // silently working, which would make the real mismatch harder to notice
    if(url.pathname !== '/api/ask'){
      return jsonResponse({ error: 'Not found. This Worker only serves POST /api/ask.' }, 404);
    }
    if(request.method === 'OPTIONS'){
      return new Response(null, { headers: corsHeaders() });
    }
    if(request.method !== 'POST'){
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }
    if(ALLOWED_ORIGIN === '*'){
      console.warn('[lessoncanvas-helper-proxy] ALLOWED_ORIGIN is still "*" -- anyone who finds this Worker URL can call it and spend your API budget. See the header comment before shipping this to students.');
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

    // Matches lessoncanvas.html's actual request shape: { question, context }.
    // question becomes the final user turn; any earlier turns the lesson sends
    // (if it ever does) are accepted as a messages[] array for forward-compat,
    // but today the lesson sends a single standalone question each call.
    const question = String(payload.question || '').slice(0, MAX_MESSAGE_CHARS);
    if(!question.trim()){
      return jsonResponse({ error: '"question" must be a non-empty string' }, 400);
    }
    const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
    const priorMessages = rawMessages.slice(-MAX_MESSAGES).map(m => ({
      role: m && m.role === 'user' ? 'user' : 'assistant',
      content: String((m && m.content) || '').slice(0, MAX_MESSAGE_CHARS),
    }));
    const messages = [...priorMessages, { role: 'user', content: question }];
    const context = String(payload.context || '').slice(0, MAX_CONTEXT_CHARS);

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
          system: context,
          messages,
        }),
      });
    }catch(e){
      return jsonResponse({ error: 'Could not reach Anthropic: ' + e.message }, 502);
    }

    if(!anthropicRes.ok){
      const detail = await anthropicRes.text().catch(()=>'(no body)');
      // surfaced distinctly from a network failure above -- a 404 here almost
      // always means MODEL is wrong, which is worth being able to tell apart
      // from "Anthropic is down" when this only ever reaches the console
      return jsonResponse({ error: 'Upstream error', status: anthropicRes.status, detail: detail.slice(0,300) }, 502);
    }

    const data = await anthropicRes.json();
    // Don't assume content[0] is text -- filter by type and join, since a
    // response could in principle include other block types first.
    const answer = (data.content || [])
      .filter(b => b && b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim() || '(no response text)';
    return jsonResponse({ answer });
  },
};
