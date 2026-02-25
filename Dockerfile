FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY dist/ ./dist/

ENV NODE_ENV=production

# Default values (override with docker-compose env)
ENV HUB_URL=http://localhost:3000
ENV AGENT_ID=agent
ENV AGENT_NAME=Agent
ENV AGENT_SPRITE=Yuki
ENV OWNER_ID=owner
ENV OWNER_NAME=Owner

CMD ["node", "dist/index.js"]
