FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy compiled code
COPY dist/ ./dist/

# Environment defaults
ENV NODE_ENV=production

# Run MCP server
CMD ["node", "dist/index.js"]