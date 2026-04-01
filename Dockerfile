FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
COPY ecosystem.config.js .
EXPOSE 3001
CMD ["node", "dist/index.js"]
