# SUPERSCADE: Express + SSE server that also serves the built Vite client in production.
FROM node:24-alpine
WORKDIR /app
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
ENV NODE_ENV=production PORT=8787 TICK_MS=1400
EXPOSE 8787
CMD ["pnpm", "start"]
