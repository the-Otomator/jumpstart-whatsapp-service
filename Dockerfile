FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist ./dist
RUN mkdir -p sessions
EXPOSE 3001
CMD ["node", "dist/index.js"]
