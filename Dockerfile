FROM node:20-bullseye-slim AS base
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
COPY test ./test

RUN npm run prisma:generate

# Explicitly pass memory configurations directly to the typescript compiler
ENV NODE_OPTIONS="--max-old-space-size=1536"
RUN npm run build

RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
