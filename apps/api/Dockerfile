FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Install with devDependencies so prisma CLI is available
RUN npm ci
COPY prisma ./prisma
# Generate Prisma client
RUN npx prisma generate || echo "Prisma generate skipped"

FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY prisma ./prisma
# Prune devDependencies to slim the image
RUN npm prune --omit=dev || true
EXPOSE 4000
CMD ["node", "src/index.js"]
