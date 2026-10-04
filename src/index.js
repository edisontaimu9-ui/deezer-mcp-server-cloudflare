const API = "https://api.deezer.com";
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
];

async function handleRpc(msg) {
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
      return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return err(-32602, `Unknown tool: ${params?.name}`);
      try {
        const data = await tool.run(params.arguments || {});
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
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/" ) return json({ ...SERVER_INFO, mcp_endpoint: "/mcp", tools: TOOLS.length });
    if (url.pathname !== "/mcp") return json({ error: "Not found" }, 404);
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });
    let body;
    try { body = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map(handleRpc))).filter(Boolean);
      return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
    }
    const out = await handleRpc(body);
    return out ? json(out) : new Response(null, { status: 202, headers: CORS });
  },
};
