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

  // OAuth 2.0 Authorization Server Metadata (RFC8414) - Required by MCP spec
  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    console.log("OAuth authorization server metadata requested");
    const baseUrl = `https://${req.get('host')}`;
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
      scopes_supported: ["read", "write"],
      subject_types_supported: ["public"]
    });
  });

  // MCP-specific OAuth discovery endpoints (for SSE/message endpoints)
  app.get("/.well-known/oauth-authorization-server/sse", (req, res) => {
    console.log("MCP SSE endpoint discovery requested");
    const baseUrl = `https://${req.get('host')}`;
    res.json({
      sse_endpoint: `${baseUrl}/sse`,
      message_endpoint: `${baseUrl}/messages`
    });
  });

  app.get("/.well-known/oauth-protected-resource/sse", (req, res) => {
    console.log("OAuth protected resource discovery requested");
    const baseUrl = `https://${req.get('host')}`;
    res.json({
      resource_server: baseUrl,
      sse_endpoint: `${baseUrl}/sse`,
      message_endpoint: `${baseUrl}/messages`
    });
  });

  // OAuth Dynamic Client Registration (RFC7591) - Required for MCP
  app.post("/register", (req, res) => {
    console.log("Dynamic Client Registration requested:", {
      clientName: req.body.client_name,
      redirectUris: req.body.redirect_uris,
      grantTypes: req.body.grant_types
    });
    
    // For a public weather server, auto-approve registration
    const clientId = `weather-client-${Date.now()}`;
    res.json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // Public client
      redirect_uris: req.body.redirect_uris || ["https://claude.ai/api/mcp/auth_callback"]
    });
  });

  // OAuth authorization endpoint (simplified for public server)
  app.get("/authorize", (req, res) => {
    console.log("OAuth authorization requested:", req.query);
    // For a public server, auto-approve and redirect with code
    const code = `auth_code_${Date.now()}`;
    const redirectUri = req.query.redirect_uri;
    const state = req.query.state;
    
    if (!redirectUri) {
      res.status(400).json({ error: "invalid_request", error_description: "Missing redirect_uri" });
      return;
    }
    
    const callbackUrl = new URL(redirectUri as string);
    callbackUrl.searchParams.set('code', code);
    if (state) {
      callbackUrl.searchParams.set('state', state as string);
    }
    
    res.redirect(callbackUrl.toString());
  });

  // OAuth token endpoint
  app.post("/token", (req, res) => {
    console.log("OAuth token requested:", {
      grantType: req.body.grant_type,
      clientId: req.body.client_id
    });
    
    // For a public server, issue tokens without validation
    res.json({
      access_token: `access_token_${Date.now()}`,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "read write"
    });
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
      // Critical headers for Render/Nginx SSE support
      res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Connection', 'keep-alive');
      res.setTimeout(0); // Disable Express timeout
      
      // Let SSEServerTransport handle the core SSE headers
      sseTransport = new SSEServerTransport("/messages", res);
      console.log("SSEServerTransport created successfully");
      
      // Implement heartbeat to prevent 5-second timeout
      const heartbeat = setInterval(() => {
        try {
          if (!res.destroyed && !res.writableEnded) {
            // Send SSE comment as heartbeat
            res.write(': heartbeat\n\n');
            console.log('SSE heartbeat sent');
          } else {
            clearInterval(heartbeat);
            console.log('SSE heartbeat stopped - connection closed');
          }
        } catch (error) {
          console.error('Error sending heartbeat:', error);
          clearInterval(heartbeat);
        }
      }, 2000); // Every 2 seconds to prevent 5-second timeout
      
      // Clean up on client disconnect
      res.on('close', () => {
        console.log('Client disconnected from SSE:', {
          timestamp: new Date().toISOString(),
          wasTransportActive: sseTransport !== null,
          reason: 'close event'
        });
        clearInterval(heartbeat);
        sseTransport = null;
      });
      
      res.on('error', (error) => {
        console.error('SSE response error:', error);
        clearInterval(heartbeat);
        sseTransport = null;
      });
      
      res.on('finish', () => {
        console.log('SSE response finished:', {
          timestamp: new Date().toISOString(),
          reason: 'finish event'
        });
      });
      
      res.on('end', () => {
        console.log('SSE response ended:', {
          timestamp: new Date().toISOString(),
          reason: 'end event'
        });
      });
      
      // Let SSEServerTransport handle headers and connection setup
      
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