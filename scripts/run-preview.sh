#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT_DIR/apps/api"
WEB_DIR="$ROOT_DIR/apps/web"
LOG_DIR="$ROOT_DIR"
API_LOG="$LOG_DIR/api.out.log"
WEB_LOG="$LOG_DIR/web.out.log"
PID_DIR="$ROOT_DIR"
API_PID_FILE="$PID_DIR/api.pid"
WEB_PID_FILE="$PID_DIR/web.pid"

PORT_API=${PORT_API:-4000}
PORT_WEB=${PORT_WEB:-3000}

function already_running() {
  local pid_file="$1"; local port="$2"; local name="$3";
  if [[ -f "$pid_file" ]] && ps -p "$(cat "$pid_file" 2>/dev/null)" >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "[RUN-PREVIEW] $name already running (pid $(cat "$pid_file"), port $port)"; return 0; fi
  fi
  return 1
}

if ! already_running "$API_PID_FILE" "$PORT_API" API; then
  echo "[RUN-PREVIEW] Starting API on $PORT_API ..."
  (cd "$API_DIR" && nohup node src/index.js > "$API_LOG" 2>&1 & echo $! > "$API_PID_FILE")
  sleep 1
fi
if ! lsof -nP -iTCP:"$PORT_API" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[RUN-PREVIEW][ERROR] API failed to bind to port $PORT_API"; tail -n 50 "$API_LOG"; exit 1; fi

if ! already_running "$WEB_PID_FILE" "$PORT_WEB" WEB; then
  echo "[RUN-PREVIEW] Starting Web on $PORT_WEB ..."
  (cd "$WEB_DIR" && nohup npm run dev > "$WEB_LOG" 2>&1 & echo $! > "$WEB_PID_FILE")
  sleep 2
fi
if ! lsof -nP -iTCP:"$PORT_WEB" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[RUN-PREVIEW][ERROR] Web failed to bind to port $PORT_WEB"; tail -n 60 "$WEB_LOG"; exit 1; fi

API_STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT_API/healthz || echo '000')
if [[ "$API_STATUS" != "200" ]]; then
  echo "[RUN-PREVIEW][WARN] /healthz returned $API_STATUS"; fi

cat <<EOF

========================================
QSTEEL Preview Running
----------------------------------------
API   : http://localhost:$PORT_API  (log: $API_LOG)
Web   : http://localhost:$PORT_WEB  (log: $WEB_LOG)
API PID: $(cat "$API_PID_FILE")  Web PID: $(cat "$WEB_PID_FILE")
CTRL+C will NOT stop these detached processes.
To stop:
  kill $(cat "$API_PID_FILE") || true
  kill $(cat "$WEB_PID_FILE") || true
Tail logs:
  tail -f $API_LOG
  tail -f $WEB_LOG
========================================
EOF
