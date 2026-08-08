# --- Stage 1: Build the Application ---
FROM node:20-alpine AS builder
WORKDIR /app

# Install all dependencies (including devDependencies needed for compilation)
COPY package*.json ./
RUN npm ci

# Copy project files and compile
COPY . .
RUN npx prisma generate
RUN npm run build

# Sanity check: Ensure compilation actually produced files where expected
RUN if [ ! -f dist/main.js ] && [ -f dist/src/main.js ]; then \
        echo "Found main.js inside dist/src instead of dist root. Adjusting structure..."; \
        mv dist/src/* dist/ && rm -rf dist/src; \
    fi

# --- Stage 2: Production Runtime Env ---
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies to keep the image slim
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled files and prisma binaries from builder layer
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 4000

# Start up the application from the verified dist root
CMD ["node", "dist/main.js"]
