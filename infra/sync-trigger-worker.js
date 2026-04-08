export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN;
    const corsHeaders = {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
      Vary: "Origin",
    };

    if (!env.GITHUB_TOKEN) {
      return json(
        { error: "Worker secret GITHUB_TOKEN is missing." },
        500,
        corsHeaders,
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (request.method !== "POST") {
      return json(
        { error: "Method not allowed." },
        405,
        corsHeaders,
      );
    }

    const origin = request.headers.get("Origin");
    const referer = request.headers.get("Referer");
    const sameOrigin =
      origin === allowedOrigin &&
      typeof referer === "string" &&
      referer.startsWith(allowedOrigin);

    if (!sameOrigin) {
      return json(
        { error: "Origin not allowed." },
        403,
        corsHeaders,
      );
    }

    let payload = {};
    try {
      payload = await request.json();
    } catch {
      return json(
        { error: "Invalid JSON body." },
        400,
        corsHeaders,
      );
    }

    if (payload?.action !== "sync_keep") {
      return json(
        { error: "Unsupported action." },
        400,
        corsHeaders,
      );
    }

    const dispatchResponse = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          "User-Agent": "swimming-page-sync-trigger",
        },
        body: JSON.stringify({
          event_type: "sync_keep",
          client_payload: {
            source: payload?.source ?? "swimming-page",
            requested_at: new Date().toISOString(),
          },
        }),
      },
    );

    if (!dispatchResponse.ok) {
      const errorText = await dispatchResponse.text();
      return json(
        {
          error: `GitHub dispatch failed: ${errorText.slice(0, 280)}`,
        },
        502,
        corsHeaders,
      );
    }

    return json(
      {
        ok: true,
        triggered: true,
      },
      202,
      corsHeaders,
    );
  },
};

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
