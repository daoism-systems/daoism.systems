# Build stage
FROM oven/bun:latest AS build

WORKDIR /app

# Copy package files first
COPY package.json bun.lockb* ./

# Install dependencies with Bun
RUN bun install --frozen-lockfile

# Copy application code
COPY . .

# Make sure we're using the Node adapter (still needed for SvelteKit)
RUN bunx svelte-kit sync

# Build the application with Bun
RUN bun run build

# Runtime stage
FROM oven/bun:latest AS runtime

WORKDIR /app

# Configure the app to listen on all interfaces
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Copy built application and dependencies
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

# Create non-root user for security
RUN addgroup --system --gid 1001 bunjs && \
    adduser --system --uid 1001 sveltekit && \
    chown -R sveltekit:bunjs /app

USER sveltekit

# Expose the port
EXPOSE 3000

# Start the server with Bun
CMD ["bun", "run", "start"]
