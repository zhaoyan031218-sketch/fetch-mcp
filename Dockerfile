FROM oven/bun:1-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN bun install --production

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "src/http.ts"]
