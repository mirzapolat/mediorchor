# ---- Build stage -----------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies (cached unless lockfile changes).
COPY package.json package-lock.json* ./
RUN npm ci

# Build the static site. VITE_* build args are optional — runtime config
# injection (docker/env.sh) is the primary mechanism, so the image stays generic.
COPY . .
RUN npm run build

# ---- Runtime stage ---------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/env.sh /docker-entrypoint.d/env.sh
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /docker-entrypoint.d/env.sh /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
