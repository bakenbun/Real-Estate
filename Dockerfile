FROM node:22-alpine

WORKDIR /app

COPY package.json server.js app.js index.html styles.css ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
