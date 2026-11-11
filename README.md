# Bobby's Bar Crawl – live parchment map
- `./start.sh` – runs the server on :8080 (auto-restarts). `TUNNEL=1 ./start.sh` also tries a Cloudflare quick tunnel (URL -> tunnel-url.txt); this is blocked from the current box network.
- Viewer: `/`  ·  Guide: `/guide` (PIN in data.json, or `/guide?pin=XXXXXX` as a secret link). Set your own with `GUIDE_PIN=1234 ./start.sh`.
- Demo: Guide tools → "Start demo walk" (or `DEMO=1`). Walks the real foot route (demo-route.json, from OSM foot routing) between the default stops at ~5x speed, pausing 8 s at each bar, with a simulated crawl clock.
- Stops: stops.json is the default Edinburgh route; edits made on the guide page are saved in data.json.
- Stack: Node + ws, Leaflet + OpenStreetMap tiles (sepia/multiply styling), no build step.
