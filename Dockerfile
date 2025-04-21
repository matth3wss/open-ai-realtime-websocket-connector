# Use Node.js as base image
FROM node:18-alpine

# Add label for the image name
LABEL name="open-ai-realtime-websocket-connector"
LABEL version="1.0"

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy project files
COPY . .

# Build the application
RUN npm run build

# Default port - will be overridden by Docker if needed
ENV PORT=1234

# Expose container port
EXPOSE 1234

# Command to run the application
CMD ["npm", "start"]
