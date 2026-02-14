FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY prompts ./prompts
COPY .env.example ./.env.example
COPY .env.example.essential ./.env.example.essential

EXPOSE 8081

CMD ["npm", "run", "start"]
