FROM node:22-alpine

WORKDIR /app

# Install only production deps for a smaller image
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source (worker reads from src/workers + src/lib at runtime via tsx)
COPY tsconfig.json ./
COPY src ./src

# tsx is a dev dependency, install it explicitly for the runtime
RUN npm install tsx@^4 --no-save

ENV NODE_ENV=production
CMD ["npx", "tsx", "src/workers/scrape-worker.ts"]
