// http-server.ts - Simplified version
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import { configureHaloscanServer } from "./haloscan-core.js";

// Setup Express
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "HALOSCAN_API_KEY"]
}));

app.use(express.json());

// Create an MCP server
const server = new McpServer({
  name: "Haloscan SEO",
  version: "1.0.0"
});

// Configure the server with Haloscan tools and prompts
configureHaloscanServer(server);

// Create transport map to track connections
const transports = {};

// Setup SSE endpoint
app.get("/sse", (req, res) => {
  console.log("SSE connection attempt received");
  
  try {
    // Set headers for SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    
    // Create transport
    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;
    
    console.log(`SSE connection established with session ID: ${transport.sessionId}`);
    
    // Handle connection close
    res.on("close", () => {
      console.log(`SSE connection closed for session ID: ${transport.sessionId}`);
      delete transports[transport.sessionId];
    });
    
    // Connect to the MCP server
    server.connect(transport);
  } catch (error) {
    console.error("Error establishing SSE connection:", error);
    if (!res.headersSent) {
      res.status(500).send("Error establishing SSE connection");
    }
  }
});

// Setup message endpoint
app.post("/messages", (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    console.log(`Message received for session: ${sessionId}`);
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }
    
    const transport = transports[sessionId];
    
    if (transport) {
      console.log(`Found transport for session ${sessionId}, handling message`);
      transport.handlePostMessage(req, res);
    } else {
      console.log(`No transport found for session ${sessionId}`);
      res.status(404).json({ error: 'Session not found' });
    }
  } catch (error) {
    console.error("Error handling message:", error);
    res.status(500).json({ error: 'Internal Server Error' });
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
  console.log(`Haloscan MCP Server running on port ${PORT}`);
  console.log(`Connect to /sse for SSE transport`);
});