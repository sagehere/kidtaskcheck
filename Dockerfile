FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY functions ./functions
COPY src/lib ./src/lib
COPY server ./server
COPY scripts ./scripts
COPY migrations ./migrations
EXPOSE 3000
CMD ["node", "server/index.mjs"]
