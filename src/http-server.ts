// http-server.ts - Fixed version for n8n 
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import { configureHaloscanServer } from "./haloscan-core.js";

// Setup Express
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS with preflight support
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Handle preflight OPTIONS requests globally
app.options("*", (req, res) => {
  res.sendStatus(200);
});

app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Create an MCP server
const server = new McpServer({
  name: "Haloscan SEO",
  version: "1.0.0"
});

// Configure the server with Haloscan tools and prompts
configureHaloscanServer(server);

// Create transport map to track connections
const transports: {[sessionId: string]: SSEServerTransport} = {};

// Custom message handling wrapper to prevent stream closing
const safeHandlePostMessage = (transport: SSEServerTransport, req: any, res: any) => {
  try {
    // Save original end method
    const originalEnd = res.end;
    
    // Override res.end to prevent connection closing
    res.end = function(chunk?: any, encoding?: any) {
      // Log instead of actually ending
      console.log(`Intercepted res.end call for session ${req.query.sessionId}`);
      
      // Send response headers and status, but don't end the actual SSE connection
      if (!res.headersSent) {
        res.writeHead(200, {
          'Content-Type': 'application/json'
        });
      }
      
      // Send the response data
      if (chunk) {
        res.write(chunk, encoding);
      }
      
      // Don't call the original end
      return res;
    };
    
    // Now call the original handlePostMessage
    transport.handlePostMessage(req, res);
    
    // Restore original end method after handling
    res.end = originalEnd;
    
    // Make sure we send a response if not already sent
    if (!res.headersSent) {
      res.status(200).json({ status: 'ok' });
    }
  } catch (error) {
    console.error(`Error in safeHandlePostMessage: ${error}`);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Error processing message'
      });
    }
  }
};

// Setup SSE endpoint
app.get("/sse", (req, res) => {
  console.log("SSE connection attempt received");
  
  try {
    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;
    
    console.log(`SSE connection established with session ID: ${transport.sessionId}`);
    
    res.on("close", () => {
      console.log(`SSE connection closed for session ID: ${transport.sessionId}`);
      delete transports[transport.sessionId];
    });
    
    server.connect(transport);
  } catch (error) {
    console.error("Error establishing SSE connection:", error);
    if (!res.headersSent) {
      res.status(500).send("Error establishing SSE connection");
    }
  }
});

// Setup message endpoint with our safe handler
app.post("/messages", (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    console.log(`Message received for session: ${sessionId}`);
    
    if (!sessionId) {
      console.warn("Message received without sessionId");
      return res.status(400).json({
        error: 'Missing sessionId',
        message: 'Session ID is required as a query parameter'
      });
    }
    
    const transport = transports[sessionId];
    
    if (transport) {
      console.log(`Found transport for session ${sessionId}, handling message`);
      // Use our safe wrapper instead of direct handlePostMessage
      safeHandlePostMessage(transport, req, res);
    } else {
      console.warn(`No transport found for session ${sessionId}`);
      res.status(404).json({
        error: 'Session not found',
        message: 'No active session with the provided ID'
      });
    }
  } catch (error) {
    console.error("Error handling message:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred'
      });
    }
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    server: "Haloscan MCP Server",
    version: "1.0.0",
    connections: Object.keys(transports).length
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Haloscan MCP Server running on http://localhost:${PORT}`);
  console.log(`Connect to /sse for SSE transport`);
  console.log(`Server started at: ${new Date().toISOString()}`);
});