const API = "https://api.deezer.com";
let OWNER_ID = "6901640743"; // owner account; override with DEEZER_USER_ID env var
const SERVER_INFO = { name: "deezer-mcp-server-cloudflare", version: "1.0.0" };

async function dz(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Deezer HTTP ${res.status}`);
  const data = await res.json();
  if (data && data.error) throw new Error(`Deezer: ${data.error.message || data.error.type || "error"}`);
  return data;
}

const lim = (n, d = 10) => Math.min(Math.max(parseInt(n ?? d, 10) || d, 1), 50);
const mmss = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : undefined);

const track = (t) => ({
  id: t.id,
  title: t.title,
  artist: t.artist?.name,
  artist_id: t.artist?.id,
  album: t.album?.title,
  album_id: t.album?.id,
  duration: mmss(t.duration),
  rank: t.rank,
  explicit: t.explicit_lyrics,
  preview_30s: t.preview,
  link: t.link,
});
const artist = (a) => ({ id: a.id, name: a.name, fans: a.nb_fan, albums: a.nb_album, link: a.link, picture: a.picture_medium });
const album = (a) => ({
  id: a.id, title: a.title, artist: a.artist?.name, artist_id: a.artist?.id,
  release_date: a.release_date, tracks: a.nb_tracks, type: a.record_type, link: a.link, cover: a.cover_medium,
});
const playlist = (p) => ({
  id: p.id, title: p.title, tracks: p.nb_tracks, fans: p.fans, creator: p.user?.name || p.creator?.name,
  description: p.description || undefined, link: p.link,
});

const idProp = (what) => ({ type: "object", properties: { id: { type: "integer", description: `Deezer ${what} ID` } }, required: ["id"] });
const searchProps = (what) => ({
  type: "object",
  properties: {
    query: { type: "string", description: `Search text for ${what}` },
    limit: { type: "integer", description: "Max results (1-50, default 10)" },
  },
  required: ["query"],
});
const limitProps = (extra = {}) => ({
  type: "object",
  properties: { id: { type: "integer", description: "Deezer ID" }, limit: { type: "integer", description: "Max results (1-50, default 10)" }, ...extra },
  required: ["id"],
});

const ownerProps = (extra = {}) => ({
  type: "object",
  properties: {
    id: { type: "integer", description: "Deezer user ID. Omit to use the owner's own account (default)." },
    limit: { type: "integer", description: "Max results (1-50, default 25)" },
    ...extra,
  },
});
const uid = (a) => a.id ?? OWNER_ID;

const TOOLS = [
  {
    name: "search_tracks",
    description: "Search Deezer tracks. Supports advanced syntax e.g. artist:\"Daft Punk\" track:\"One More Time\". Returns 30s preview URLs.",
    inputSchema: searchProps("tracks"),
    run: async (a) => (await dz("/search", { q: a.query, limit: lim(a.limit) })).data.map(track),
  },
  {
    name: "search_artists",
    description: "Search Deezer artists by name.",
    inputSchema: searchProps("artists"),
    run: async (a) => (await dz("/search/artist", { q: a.query, limit: lim(a.limit) })).data.map(artist),
  },
  {
    name: "search_albums",
    description: "Search Deezer albums by title or artist.",
    inputSchema: searchProps("albums"),
    run: async (a) => (await dz("/search/album", { q: a.query, limit: lim(a.limit) })).data.map(album),
  },
  {
    name: "search_playlists",
    description: "Search public Deezer playlists.",
    inputSchema: searchProps("playlists"),
    run: async (a) => (await dz("/search/playlist", { q: a.query, limit: lim(a.limit) })).data.map(playlist),
  },
  {
    name: "get_track",
    description: "Get full details of one track by Deezer ID (BPM, release date, contributors, preview URL).",
    inputSchema: idProp("track"),
    run: async (a) => {
      const t = await dz(`/track/${a.id}`);
      return { ...track(t), release_date: t.release_date, bpm: t.bpm || undefined, isrc: t.isrc, contributors: t.contributors?.map((c) => c.name) };
    },
  },
  {
    name: "get_artist",
    description: "Get an artist's profile by Deezer ID.",
    inputSchema: idProp("artist"),
    run: async (a) => artist(await dz(`/artist/${a.id}`)),
  },
  {
    name: "get_artist_top_tracks",
    description: "Get an artist's top tracks.",
    inputSchema: limitProps(),
    run: async (a) => (await dz(`/artist/${a.id}/top`, { limit: lim(a.limit) })).data.map(track),
  },
  {
    name: "get_artist_albums",
    description: "Get an artist's albums/discography.",
    inputSchema: limitProps(),
    run: async (a) => (await dz(`/artist/${a.id}/albums`, { limit: lim(a.limit) })).data.map(album),
  },
  {
    name: "get_related_artists",
    description: "Get artists similar to a given artist.",
    inputSchema: limitProps(),
    run: async (a) => (await dz(`/artist/${a.id}/related`, { limit: lim(a.limit) })).data.map(artist),
  },
  {
    name: "get_album",
    description: "Get an album with its full tracklist by Deezer ID.",
    inputSchema: idProp("album"),
    run: async (a) => {
      const x = await dz(`/album/${a.id}`);
      return { ...album(x), label: x.label, genres: x.genres?.data?.map((g) => g.name), duration: mmss(x.duration), tracklist: (x.tracks?.data || []).map((t, i) => ({ n: i + 1, ...track(t) })) };
    },
  },
  {
    name: "get_playlist",
    description: "Get a playlist and its tracks by Deezer ID.",
    inputSchema: limitProps(),
    run: async (a) => {
      const p = await dz(`/playlist/${a.id}`);
      return { ...playlist(p), tracklist: (p.tracks?.data || []).slice(0, lim(a.limit, 25)).map(track) };
    },
  },
  {
    name: "get_chart",
    description: "Deezer global charts: top tracks, albums, artists, playlists. Optional genre_id (0 = all).",
    inputSchema: { type: "object", properties: { genre_id: { type: "integer", description: "Genre ID, default 0 (all)" }, limit: { type: "integer", description: "Max per section (1-50, default 10)" } } },
    run: async (a) => {
      const c = await dz(`/chart/${a.genre_id ?? 0}`, { limit: lim(a.limit) });
      return {
        tracks: c.tracks?.data?.map(track),
        albums: c.albums?.data?.map(album),
        artists: c.artists?.data?.map(artist),
        playlists: c.playlists?.data?.map(playlist),
      };
    },
  },
  {
    name: "list_genres",
    description: "List Deezer genres with IDs (use with get_chart / get_genre_artists).",
    inputSchema: { type: "object", properties: {} },
    run: async () => (await dz("/genre")).data.map((g) => ({ id: g.id, name: g.name })),
  },
  {
    name: "get_genre_artists",
    description: "Get popular artists in a genre.",
    inputSchema: limitProps(),
    run: async (a) => (await dz(`/genre/${a.id}/artists`)).data.slice(0, lim(a.limit)).map(artist),
  },
  {
    name: "get_user",
    description: "Get the owner's Deezer profile (default) or any public user's profile by ID.",
    inputSchema: ownerProps(),
    run: async (a) => {
      const u = await dz(`/user/${uid(a)}`);
      return { id: u.id, name: u.name, country: u.country, link: u.link, picture: u.picture_medium };
    },
  },
  {
    name: "get_my_playlists",
    description: "List the owner's Deezer playlists (default account, no ID needed). Optional id for another public user.",
    inputSchema: ownerProps(),
    run: async (a) => (await dz(`/user/${uid(a)}/playlists`, { limit: lim(a.limit, 50) })).data.map(playlist),
  },
  {
    name: "get_my_favorite_tracks",
    description: "List the owner's favorite (loved) tracks (default account, no ID needed). Optional id for another public user.",
    inputSchema: ownerProps(),
    run: async (a) => (await dz(`/user/${uid(a)}/tracks`, { limit: lim(a.limit, 25) })).data.map(track),
  },
  {
    name: "get_my_favorite_artists",
    description: "List the owner's favorite artists (default account, no ID needed). Optional id for another public user.",
    inputSchema: ownerProps(),
    run: async (a) => (await dz(`/user/${uid(a)}/artists`, { limit: lim(a.limit, 25) })).data.map(artist),
  },
  {
    name: "find_my_playlist",
    description: "Find one of the owner's playlists by (partial) name and return it with its tracks. Use for 'what's in my Gospel playlist'.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Full or partial playlist name" }, limit: { type: "integer", description: "Max tracks (1-50, default 25)" } }, required: ["name"] },
    run: async (a) => {
      const all = (await dz(`/user/${OWNER_ID}/playlists`, { limit: 100 })).data;
      const q = a.name.toLowerCase();
      const hits = all.filter((p) => p.title.toLowerCase().includes(q));
      if (!hits.length) return { error: "No playlist matches", available: all.map((p) => p.title) };
      const best = hits.find((p) => p.title.toLowerCase() === q) || hits[0];
      const p = await dz(`/playlist/${best.id}`);
      return { ...playlist(p), other_matches: hits.filter((h) => h.id !== best.id).map((h) => h.title), tracklist: (p.tracks?.data || []).slice(0, lim(a.limit, 25)).map(track) };
    },
  },
];

// ---------- Owner-only write tools (unofficial Deezer gateway, ARL cookie) ----------
// Served ONLY at /mcp/<MCP_KEY>. Needs Worker secrets: DEEZER_ARL and MCP_KEY.
const GW = "https://www.deezer.com/ajax/gw-light.php";
const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
let gwSession = null;

async function gwLogin(env, force = false) {
  if (!env?.DEEZER_ARL) throw new Error("DEEZER_ARL secret is not set on the Worker");
  if (!force && gwSession && Date.now() - gwSession.at < 10 * 60 * 1000) return gwSession;
  const r = await fetch(`${GW}?method=deezer.getUserData&input=3&api_version=1.0&api_token=`, {
    method: "POST",
    headers: { Cookie: `arl=${env.DEEZER_ARL}`, "User-Agent": UA, "Content-Type": "application/json" },
    body: "{}",
  });
  const sc = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
  const sid = sc.map((c) => c.match(/(?:^|\s)sid=([^;]+)/)?.[1]).find(Boolean);
  const j = await r.json();
  const u = j?.results?.USER;
  if (!u || !u.USER_ID) throw new Error("ARL is invalid or expired — refresh the DEEZER_ARL secret");
  gwSession = { token: j.results.checkForm, cookie: `arl=${env.DEEZER_ARL}` + (sid ? `; sid=${sid}` : ""), userId: u.USER_ID, name: u.BLOG_NAME || u.NAME, at: Date.now() };
  return gwSession;
}

async function gw(env, method, body, retry = true) {
  const ses = await gwLogin(env);
  const r = await fetch(`${GW}?method=${method}&input=3&api_version=1.0&api_token=${encodeURIComponent(ses.token)}`, {
    method: "POST",
    headers: { Cookie: ses.cookie, "User-Agent": UA, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json();
  const e = j?.error;
  if (e && Object.keys(e).length) {
    if (retry && JSON.stringify(e).includes("TOKEN")) { gwSession = null; await gwLogin(env, true); return gw(env, method, body, false); }
    throw new Error(`Deezer gateway error: ${JSON.stringify(e)}`);
  }
  return j.results;
}

const ids = (arr) => {
  if (!Array.isArray(arr) || !arr.length) throw new Error("track_ids must be a non-empty array of Deezer track IDs");
  return arr.slice(0, 100).map((x) => [parseInt(x, 10), 0]);
};
const trackIdsProp = { type: "array", items: { type: "integer" }, description: "Deezer track IDs (get them from search_tracks). Max 100." };

const WRITE_TOOLS = [
  {
    name: "deezer_account_status",
    description: "Check that write access to the owner's Deezer account works (returns user ID and name only).",
    inputSchema: { type: "object", properties: {} },
    run: async (a, env) => { const s = await gwLogin(env, true); return { ok: true, user_id: s.userId, name: s.name }; },
  },
  {
    name: "create_playlist",
    description: "Create a playlist in the owner's Deezer account, optionally with tracks. Private by default.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        track_ids: trackIdsProp,
        public: { type: "boolean", description: "Make it public (default false = private)" },
      },
      required: ["title"],
    },
    run: async (a, env) => {
      const songs = a.track_ids?.length ? ids(a.track_ids) : [];
      const id = await gw(env, "playlist.create", { title: a.title, description: a.description || "", status: a.public ? 0 : 1, songs });
      return { playlist_id: id, tracks_added: songs.length, link: `https://www.deezer.com/playlist/${id}` };
    },
  },
  {
    name: "add_tracks_to_playlist",
    description: "Add tracks to one of the owner's playlists (appends to the end).",
    inputSchema: { type: "object", properties: { playlist_id: { type: "integer" }, track_ids: trackIdsProp }, required: ["playlist_id", "track_ids"] },
    run: async (a, env) => {
      const songs = ids(a.track_ids);
      await gw(env, "playlist.addSongs", { playlist_id: String(a.playlist_id), songs, offset: -1 });
      return { ok: true, tracks_added: songs.length, link: `https://www.deezer.com/playlist/${a.playlist_id}` };
    },
  },
  {
    name: "remove_tracks_from_playlist",
    description: "Remove tracks from one of the owner's playlists.",
    inputSchema: { type: "object", properties: { playlist_id: { type: "integer" }, track_ids: trackIdsProp }, required: ["playlist_id", "track_ids"] },
    run: async (a, env) => {
      const songs = ids(a.track_ids);
      await gw(env, "playlist.deleteSongs", { playlist_id: String(a.playlist_id), songs });
      return { ok: true, tracks_removed: songs.length };
    },
  },
  {
    name: "add_favorite_track",
    description: "Add a track to the owner's Deezer favorites (loved tracks).",
    inputSchema: { type: "object", properties: { track_id: { type: "integer" } }, required: ["track_id"] },
    run: async (a, env) => { await gw(env, "favorite_song.add", { SNG_ID: String(a.track_id) }); return { ok: true }; },
  },
  {
    name: "remove_favorite_track",
    description: "Remove a track from the owner's Deezer favorites.",
    inputSchema: { type: "object", properties: { track_id: { type: "integer" } }, required: ["track_id"] },
    run: async (a, env) => { await gw(env, "favorite_song.remove", { SNG_ID: String(a.track_id) }); return { ok: true }; },
  },
];

async function handleRpc(msg, ctx = {}) {
  const tools = ctx.full ? [...TOOLS, ...WRITE_TOOLS] : TOOLS;
  const { id, method, params } = msg || {};
  if (id === undefined) return null; // notification
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  switch (method) {
    case "initialize":
      return ok({ protocolVersion: params?.protocolVersion || "2025-03-26", capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) return err(-32602, `Unknown tool: ${params?.name}`);
      try {
        const data = await tool.run(params.arguments || {}, ctx.env);
        return ok({ content: [{ type: "text", text: JSON.stringify(data) }] });
      } catch (e) {
        return ok({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    }
    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, mcp-session-id, mcp-protocol-version, authorization",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

export default {
  async fetch(request, env) {
    if (env && env.DEEZER_USER_ID) OWNER_ID = String(env.DEEZER_USER_ID);
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/" ) return json({ ...SERVER_INFO, mcp_endpoint: "/mcp", tools: TOOLS.length });
    const m = url.pathname.match(/^\/mcp(?:\/([^/]+))?$/);
    if (!m) return json({ error: "Not found" }, 404);
    let full = false;
    if (m[1]) {
      if (!env?.MCP_KEY || m[1] !== env.MCP_KEY) return json({ error: "Not found" }, 404);
      full = true;
    }
    const ctx = { env, full };
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });
    let body;
    try { body = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((b) => handleRpc(b, ctx)))).filter(Boolean);
      return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
    }
    const out = await handleRpc(body, ctx);
    return out ? json(out) : new Response(null, { status: 202, headers: CORS });
  },
};
