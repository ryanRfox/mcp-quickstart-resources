import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import express, { Request, Response } from "express";
import cors from "cors";

const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "weather-app/1.0";

// Helper function for making NWS API requests
async function makeNWSRequest<T>(url: string): Promise<T | null> {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/geo+json",
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Error making NWS request:", error);
    return null;
  }
}

interface AlertFeature {
  properties: {
    event?: string;
    areaDesc?: string;
    severity?: string;
    status?: string;
    headline?: string;
  };
}

// Format alert data
function formatAlert(feature: AlertFeature): string {
  const props = feature.properties;
  return [
    `Event: ${props.event || "Unknown"}`,
    `Area: ${props.areaDesc || "Unknown"}`,
    `Severity: ${props.severity || "Unknown"}`,
    `Status: ${props.status || "Unknown"}`,
    `Headline: ${props.headline || "No headline"}`,
    "---",
  ].join("\n");
}

interface ForecastPeriod {
  name?: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  windDirection?: string;
  shortForecast?: string;
}

interface AlertsResponse {
  features: AlertFeature[];
}

interface PointsResponse {
  properties: {
    forecast?: string;
  };
}

interface ForecastResponse {
  properties: {
    periods: ForecastPeriod[];
  };
}

// Create server instance
const server = new McpServer({
  name: "weather",
  version: "1.0.0",
});

// Register weather tools
server.tool(
  "get-alerts",
  "Get weather alerts for a state",
  {
    state: z.string().length(2).describe("Two-letter state code (e.g. CA, NY)"),
  },
  async ({ state }) => {
    const stateCode = state.toUpperCase();
    const alertsUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`;
    const alertsData = await makeNWSRequest<AlertsResponse>(alertsUrl);

    if (!alertsData) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve alerts data",
          },
        ],
      };
    }

    const features = alertsData.features || [];
    if (features.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No active alerts for ${stateCode}`,
          },
        ],
      };
    }

    const formattedAlerts = features.map(formatAlert);
    const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join("\n")}`;

    return {
      content: [
        {
          type: "text",
          text: alertsText,
        },
      ],
    };
  },
);

server.tool(
  "get-forecast",
  "Get weather forecast for a location",
  {
    latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .describe("Longitude of the location"),
  },
  async ({ latitude, longitude }) => {
    // Get grid point data
    const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const pointsData = await makeNWSRequest<PointsResponse>(pointsUrl);

    if (!pointsData) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to retrieve grid point data for coordinates: ${latitude}, ${longitude}. This location may not be supported by the NWS API (only US locations are supported).`,
          },
        ],
      };
    }

    const forecastUrl = pointsData.properties?.forecast;
    if (!forecastUrl) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to get forecast URL from grid point data",
          },
        ],
      };
    }

    // Get forecast data
    const forecastData = await makeNWSRequest<ForecastResponse>(forecastUrl);
    if (!forecastData) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve forecast data",
          },
        ],
      };
    }

    const periods = forecastData.properties?.periods || [];
    if (periods.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No forecast periods available",
          },
        ],
      };
    }

    // Format forecast periods
    const formattedForecast = periods.map((period: ForecastPeriod) =>
      [
        `${period.name || "Unknown"}:`,
        `Temperature: ${period.temperature || "Unknown"}°${period.temperatureUnit || "F"}`,
        `Wind: ${period.windSpeed || "Unknown"} ${period.windDirection || ""}`,
        `${period.shortForecast || "No forecast available"}`,
        "---",
      ].join("\n"),
    );

    const forecastText = `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join("\n")}`;

    return {
      content: [
        {
          type: "text",
          text: forecastText,
        },
      ],
    };
  },
);

// Start the HTTP server
async function main() {
  const app = express();
  const PORT = process.env.PORT || 3000;
  
  console.log("Initializing MCP HTTP/SSE server...");
  console.log("Environment:", {
    NODE_ENV: process.env.NODE_ENV,
    PORT: PORT,
    Platform: process.platform,
    NodeVersion: process.version
  });
  
  // Parse JSON bodies
  app.use(express.json());
  
  // Enable CORS for all origins
  app.use(cors());
  
  // Log all requests
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
  
  // Store active transports
  let sseTransport: SSEServerTransport | null = null;
  
  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", name: "weather-mcp-server" });
  });
  
  // SSE endpoint for MCP - establishes SSE connection
  app.get("/sse", async (req, res) => {
    const clientInfo = {
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString()
    };
    console.log("SSE connection initiated:", clientInfo);
    
    try {
      // Let SSEServerTransport handle the headers
      sseTransport = new SSEServerTransport("/messages", res);
      console.log("SSEServerTransport created successfully");
      
      // Clean up on client disconnect
      res.on('close', () => {
        console.log('Client disconnected from SSE:', {
          timestamp: new Date().toISOString(),
          wasTransportActive: sseTransport !== null
        });
        sseTransport = null;
      });
      
      res.on('error', (error) => {
        console.error('SSE response error:', error);
        sseTransport = null;
      });
      
      console.log("Connecting server to transport...");
      await server.connect(sseTransport);
      console.log("Server connected to SSE transport successfully");
      
    } catch (error) {
      console.error("Error establishing SSE connection:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to establish SSE connection" });
      }
    }
  });
  
  // Message endpoint for MCP - handles client-to-server messages
  app.post("/messages", async (req, res) => {
    console.log("Received POST to /messages:", {
      hasTransport: sseTransport !== null,
      bodySize: JSON.stringify(req.body).length,
      contentType: req.headers['content-type']
    });
    
    if (!sseTransport) {
      console.error("No active SSE connection for message handling");
      res.status(400).json({ error: "No active SSE connection" });
      return;
    }
    
    try {
      console.log("Handling message with transport...");
      await sseTransport.handlePostMessage(req, res);
      console.log("Message handled successfully");
    } catch (error) {
      console.error("Error handling message:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to handle message" });
      }
    }
  });
  
  app.listen(PORT, () => {
    console.log("========================================");
    console.log(`Weather MCP Server running on port ${PORT}`);
    console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
    console.log(`Messages endpoint: http://localhost:${PORT}/messages`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log("========================================");
    console.log("Server ready to accept connections");
  });
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});