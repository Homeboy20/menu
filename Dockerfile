# Use Node.js 22 Alpine to match the production runtime configured in Coolify
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install curl for health checks
RUN apk add --no-cache curl

# Install dependencies (including dev deps so we can build Tailwind CSS)
RUN npm ci

# Copy application files
COPY . .

# Build Tailwind CSS and create data/uploads directories
RUN npm run build:css || true
RUN mkdir -p data uploads

# Remove dev dependencies to keep image small
RUN npm prune --production || true

# Set proper permissions
RUN chown -R node:node /app
USER node

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Copy and use entrypoint to run migrations before starting the app
# Note: chmod is run as root before switching to non-root user
USER root
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER node

ENTRYPOINT ["/entrypoint.sh"]
