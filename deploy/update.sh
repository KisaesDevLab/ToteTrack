#!/usr/bin/env sh
# Update ToteTrack to the latest published image (run from the folder that holds docker-compose.yml).
#   curl -fsSLO https://raw.githubusercontent.com/KisaesDevLab/ToteTrack/main/deploy/update.sh && sh update.sh
# Pin a version instead of :latest with TOTETRACK_TAG (e.g. TOTETRACK_TAG=0.2.0 sh update.sh, or set it in .env).
set -eu
cd "$(dirname "$0")"
# Keep the compose file itself current too (new services/settings ship there).
curl -fsSL -o docker-compose.yml.new https://raw.githubusercontent.com/KisaesDevLab/ToteTrack/main/deploy/docker-compose.yml \
  && mv docker-compose.yml.new docker-compose.yml
docker compose pull
docker compose up -d --remove-orphans   # migrations run automatically on start
docker image prune -f >/dev/null
echo
docker compose ps
echo "Health: $(curl -fsS http://localhost:${APP_PORT:-3000}/api/health 2>/dev/null || echo 'not up yet — check: docker compose logs -f app')"
