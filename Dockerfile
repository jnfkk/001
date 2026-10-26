FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Verify the required Node proxy flag; the app has no production dependencies.
RUN node --use-env-proxy --version
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node public/ ./public/

USER node
EXPOSE 3000
CMD ["node", "--use-env-proxy", "server.mjs"]
