#!/bin/sh
# Records the scripted product tour against a disposable Ticketry profile,
# then converts it for Remotion. Output: public/tour.mp4 + public/marks.json.
set -e
cd "$(dirname "$0")/../studio"
TMPDIR=/tmp TICKETRY_E2E_FRONTEND_PORT=${PORT:-4273} TICKETRY_E2E_ADAPTER_PORT=$(( ${PORT:-4273} + 1 )) \
  npx playwright test -c e2e-video/playwright.config.ts
cd ../video
ffmpeg -v error -y -i capture-output/tour-product-tour-capture/video.webm \
  -c:v libx264 -crf 10 -preset slow -pix_fmt yuv420p -r 30 public/tour.mp4
