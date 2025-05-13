// http-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import { configureHaloscanServer } from "./haloscan-core.js";

// Setup Express
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());
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

// Create an MCP server
const server = new McpServer({
  name: "Haloscan SEO",
  version: "1.0.0"
});

// Configure the server with Haloscan tools and prompts
configureHaloscanServer(server);

// Create transport map to track connections with proper typing
const transports: Record<string, SSEServerTransport> = {};

// Setup SSE endpoint
app.get("/sse", (req, res) => {
  // Set a longer timeout for the request
  req.socket.setTimeout(60000); // 60 seconds
  
  // Set SSE-specific headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  
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

// Setup message endpoint
app.post("/messages", (req, res) => {
  // Use type assertion to fix TypeScript error
  const sessionId = req.query.sessionId as string;
  
  if (!sessionId) {
    return res.status(400).send('Missing sessionId parameter');
  }
  
  const transport = transports[sessionId];
  
  if (transport) {
    // Save original end method
    const originalEnd = res.end;
    
    // Override end to prevent closing the SSE connection
    res.end = function(...args: any[]) {
      // Send the response but don't end the actual socket
      if (args.length > 0) {
        res.write(args[0]);
      }
      return res;
    };
    
    // Handle the message
    try {
      transport.handlePostMessage(req, res);
    } catch (error) {
      console.error("Error handling message:", error);
    }
    
    // Restore original end
    res.end = originalEnd;
    
    // If headers not sent, send a response
    if (!res.headersSent) {
      res.status(200).json({ status: 'ok' });
    }
  } else {
    res.status(404).send('No transport found for sessionId');
  }
});

// Simple health check endpoint
app.get("/health", (req, res) => {
  res.status(200).send({
    status: "ok",
    server: "Haloscan MCP Server",
    version: "1.0.0",
    connections: Object.keys(transports).length
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.redirect("/health");
});

// Start the server
const server_instance = app.listen(PORT, () => {
  console.log(`Haloscan MCP Server running on http://localhost:${PORT}`);
  console.log(`Connect to /sse for SSE transport`);
  console.log(`Server started at: ${new Date().toISOString()}`);
});

// Enable keepalive
server_instance.keepAliveTimeout = 120000; // 2 minutes
server_instance.headersTimeout = 125000; // Just above keepAliveTimeout