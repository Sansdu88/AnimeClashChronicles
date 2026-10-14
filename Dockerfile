FROM node:24-alpine
WORKDIR /app
COPY . .
ENV HOST=0.0.0.0 NO_OPEN=1 PORT=3000
EXPOSE 3000
CMD ["npm", "start"]