FROM node:20-alpine

# Set production variables early
ENV NODE_ENV=production

WORKDIR /app

# Copy dependency configuration files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (Railway keeps devDependencies intact for the build script)
RUN npm ci --include=dev

# Copy all application files
COPY . .

# Run the database client generation and application compilation steps
RUN npx prisma generate
RUN npm run build

# Prune development packages post-build to reduce deployment size
RUN npm prune --omit=dev

# Expose the internal port mapped dynamically by Railway architectures
EXPOSE 4000

# Start the application using a fallback check for nested structures (like dist/src/main.js)
CMD ["sh", "-c", "if [ -f dist/src/main.js ]; then node dist/src/main.js; else node dist/main.js; fi"]
