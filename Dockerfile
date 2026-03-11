FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src/ ./src/
COPY tsconfig.json ./
RUN npm run build && npm prune --production

ENV NODE_ENV=production

# Default values (override with docker-compose env)
ENV HUB_URL=http://localhost:3000
ENV AGENT_ID=agent
ENV AGENT_NAME=Agent
ENV AGENT_SPRITE=Kael
ENV OWNER_ID=owner
ENV OWNER_NAME=Owner
ENV MCP_HTTP_PORT=3001

EXPOSE 3001

CMD ["node", "dist/index.js"]
