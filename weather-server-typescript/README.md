# MCP Weather Server - TypeScript

A Model Context Protocol (MCP) server that provides weather data from the US National Weather Service API. This server can be used locally with Claude Desktop or deployed as a public service.

## Features

- **Get Weather Alerts**: Retrieve active weather alerts for any US state
- **Get Forecast**: Get detailed weather forecasts for specific coordinates (US locations only)

## Architecture

This project includes two server implementations:

1. **Local stdio server** (`src/index.ts`) - For local use with Claude Desktop
2. **HTTP/SSE server** (`src/index-http.ts`) - For deployment as a web service

## Installation

```bash
npm install
npm run build
```

## Local Usage with Claude Desktop

### 1. Configure Claude Desktop

Add to your Claude Desktop config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["/path/to/weather-server-typescript/build/index.js"]
    }
  }
}
```

**Note:** Use the full path to your node executable if it's not in your PATH.

### 2. Restart Claude Desktop

The weather tools will be available in your conversations.

## Deployment on Render

This project is configured for easy deployment on Render.io:

1. Push this repository to GitHub
2. Create a new Web Service on Render
3. Connect your GitHub repository
4. Render will automatically use the `render.yaml` configuration

The HTTP server will be available at your Render URL with:
- Health check endpoint: `GET /health`
- SSE endpoint for MCP: `GET /sse`

## Available Tools

### get-alerts
Get weather alerts for a US state.

**Parameters:**
- `state` (string): Two-letter state code (e.g., "CA", "NY")

### get-forecast
Get weather forecast for a location.

**Parameters:**
- `latitude` (number): Latitude of the location (-90 to 90)
- `longitude` (number): Longitude of the location (-180 to 180)

## Development

```bash
# Run local stdio server
npm run dev

# Run HTTP server
npm start

# Build TypeScript
npm run build
```

## API Reference

This server uses the [National Weather Service API](https://www.weather.gov/documentation/services-web-api) which provides free weather data for US locations.

## Requirements

- Node.js 16+
- npm or yarn

## License

ISC

## See Also

- [Model Context Protocol Documentation](https://modelcontextprotocol.io)
- [MCP Quickstart Tutorial](https://modelcontextprotocol.io/quickstart)