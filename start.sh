#!/bin/bash
# Starts the app server + a Cloudflare quick tunnel (both auto-restart). Public URL is written to tunnel-url.txt
cd "$(dirname "$0")"
pkill -f "node server.js"; pkill -f "cloudflared-bin tunnel"
nohup bash -c 'while true; do node server.js >> server.log 2>&1; sleep 2; done' >/dev/null 2>&1 &
sleep 1
[ "$TUNNEL" = 1 ] && nohup bash -c 'while true; do ./cloudflared-bin tunnel --no-autoupdate --url http://localhost:8080 2>&1 | tee -a tunnel.log | grep --line-buffered -o "https://[a-z0-9-]*\.trycloudflare\.com" | while read u; do echo "$u" > tunnel-url.txt; done; sleep 3; done' >/dev/null 2>&1 &
