# Reproducible build + validate + auto-test for the playable.
#
# Uses Microsoft's Playwright image, which ships Chromium and its system deps pre-installed,
# so the headless tests run identically on your laptop and in CI with no host setup. This is
# the "containerize it" piece: one image that produces the single-file playable and proves it
# works, anywhere.
#
#   docker build -t parrot-playable .
#   docker run --rm parrot-playable          # runs the full gate, exits nonzero on failure
#   docker run --rm -v "$PWD/dist:/app/dist" parrot-playable   # also export the built file

FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Install deps first for layer caching.
COPY package*.json ./
RUN npm ci

COPY . .

# Full gate as one command: asset gate -> build single-file -> build gate -> headless tests.
# Any stage failing fails the container build/run, which is the point.
RUN npm run validate:assets
RUN npm run build:playable
RUN npm run validate:build

# The AI asset pipeline runs here too (mock providers, no API key) and renders its dashboard, so
# "it works anywhere" covers the generation pipeline, not just the game. With ANTHROPIC_API_KEY
# passed in (docker run -e ANTHROPIC_API_KEY=...), the same command uses the real Claude judge.
RUN npm run pipeline && npm run pipeline:dashboard

CMD ["npm", "run", "test:e2e"]
