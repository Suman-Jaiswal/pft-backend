FROM node:20-alpine AS base
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
COPY test ./test

RUN npm run prisma:generate
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
