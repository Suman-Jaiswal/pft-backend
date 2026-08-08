FROM node:20-bullseye-slim

ENV NODE_ENV=production
WORKDIR /app

# Ensure runtime libs and CA certs are present
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/*

# Copy dependency config and prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install dev deps for build (Railway keeps devDependencies for build scripts)
RUN npm ci --include=dev

# Copy app sources
COPY . .

# Generate Prisma client & build app
RUN npx prisma generate
RUN npm run build

# Remove dev deps to slim down the image
RUN npm prune --omit=dev

EXPOSE 4000

CMD ["sh", "-c", "if [ -f dist/src/main.js ]; then node dist/src/main.js; else node dist/main.js; fi"]
