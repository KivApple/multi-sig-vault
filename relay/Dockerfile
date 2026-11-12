FROM node:24-alpine
WORKDIR /app
COPY server.mjs .
# Icon cache; a named volume mounted here inherits this owner.
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=8080 ICON_CACHE_DIR=/data ICON_CACHE_DAYS=30
EXPOSE 8080
VOLUME /data
CMD ["node", "server.mjs"]
