FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.33.0

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
# Keep the Prisma CLI available for Railway's pre-deploy migration command.
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .
RUN pnpm build

ENV NODE_ENV=production
USER node
EXPOSE 5000
CMD ["node", "server.js"]
