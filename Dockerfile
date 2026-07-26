FROM node:20-slim AS base

WORKDIR /app

# Install deps
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

# Copy source
COPY shared/ shared/
COPY server/ server/
COPY client/ client/
COPY data/fixtures/ data/fixtures/
COPY tsconfig.base.json ./

# Build shared (needed by both client and server)
RUN npm run build -w shared

# Build client (static files)
RUN npm run build -w client

# Build server
RUN npm run build -w server

# Production stage
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=base /app/shared/dist/ shared/dist/
COPY --from=base /app/shared/package.json shared/
COPY --from=base /app/server/dist/ server/dist/
COPY --from=base /app/server/package.json server/
COPY --from=base /app/client/dist/ client/dist/

# Copy server migrations and fixture data
COPY server/src/db/migrations/ server/dist/db/migrations/
COPY data/fixtures/ data/fixtures/

ENV NODE_ENV=production
ENV PORT=8080
ENV DATABASE_PATH=/data/empire-fantasy.db
ENV DATA_DIR=/app/data

EXPOSE 8080

CMD ["node", "server/dist/index.js"]
