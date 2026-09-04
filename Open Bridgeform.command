#!/bin/zsh
set -e
unsetopt BG_NICE

tool_dir=${0:A:h}/prototype
port=4173

cd "$tool_dir"
python3 -m http.server "$port" --bind 127.0.0.1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM

sleep 0.5
open "http://127.0.0.1:$port/"
wait "$server_pid"
