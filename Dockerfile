FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html tsconfig.json types.d.ts vite.config.mjs ./
COPY src ./src
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY src/lib/domain.js ./src/lib/domain.js
COPY server ./server
COPY scripts ./scripts
COPY migrations ./migrations
RUN node --check server/api/utils.js
EXPOSE 3000
CMD ["node", "server/index.mjs"]
