# deezer-mcp-server-cloudflare

Remote MCP server (streamable HTTP, JSON-RPC, zero dependencies) wrapping Deezer's public API.
Endpoint: `POST /mcp`. No auth needed for Deezer public data.

Tools: search_tracks, search_artists, search_albums, search_playlists, get_track, get_artist,
get_artist_top_tracks, get_artist_albums, get_related_artists, get_album, get_playlist,
get_chart, list_genres, get_genre_artists.

Test:
curl -s -X POST https://<worker>.workers.dev/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
