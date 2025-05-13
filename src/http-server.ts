// http-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import { configureHaloscanServer } from "./haloscan-core.js";

console.log("Server starting up...");

// Setup Express
const app = express();
const PORT = process.env.PORT || 3000;
const SSE_TIMEOUT = 120000; // 2 minutes

// Enable CORS with preflight support
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "HALOSCAN_API_KEY"]
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
try {
  console.log("Configuring Haloscan server with tools...");
  configureHaloscanServer(server);
  console.log("Haloscan server tools configured successfully");
  
  // Log registered tools
  if ((server as any)._registeredTools) {
    console.log(`Server has ${Object.keys((server as any)._registeredTools).length} tools registered:`);
    for (const [name, tool] of Object.entries((server as any)._registeredTools)) {
      console.log(` - ${name}: ${(tool as any).description || 'No description'}`);
    }
  } else {
    console.log("No tools were registered in the server!");
  }
} catch (error) {
  console.error("Error configuring Haloscan server:", error);
}

// Create transport map to track connections
const transports: {[sessionId: string]: SSEServerTransport} = {};

// Capture the tools for easy access
const getTools = () => {
  const tools = [];
  
  try {
    if ((server as any)._registeredTools) {
      for (const [name, tool] of Object.entries((server as any)._registeredTools)) {
        tools.push({
          name,
          description: (tool as any).description || '',
          parameters: (tool as any).parameters || {}
        });
      }
    }
  } catch (error) {
    console.error("Error extracting tools:", error);
  }
  
  return tools;
};

// Setup SSE endpoint
app.get("/sse", (req, res) => {
  console.log("SSE connection attempt received");
  
  // Set longer timeout
  req.socket.setTimeout(SSE_TIMEOUT);
  if (res.socket) {
    res.socket.setTimeout(SSE_TIMEOUT);
  }
  
  try {
    // Prepare headers for SSE
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
    
    // CRITICAL: Manually send endpoint and tools events
    res.write(`event: endpoint\ndata: "/messages?sessionId=${transport.sessionId}"\n\n`);
    
    // Get and send tools
    const tools = getTools();
    console.log(`Sending ${tools.length} tools to client:`, JSON.stringify(tools));
    res.write(`event: tools\ndata: ${JSON.stringify(tools)}\n\n`);
    
    // Keep connection alive with pings
    const pingInterval = setInterval(() => {
      try {
        if (res.writableEnded) {
          console.log(`Ping canceled - connection ended for session ${transport.sessionId}`);
          clearInterval(pingInterval);
          return;
        }
        
        res.write(`event: ping\ndata: ${Date.now()}\n\n`);
        console.log(`Ping sent to session ${transport.sessionId}`);
      } catch (error) {
        console.error(`Error sending ping to session ${transport.sessionId}:`, error);
        clearInterval(pingInterval);
      }
    }, 30000);
    
    // Handle connection close
    res.on("close", () => {
      console.log(`SSE connection closed for session ID: ${transport.sessionId}`);
      clearInterval(pingInterval);
      delete transports[transport.sessionId];
    });
    
    // Connect to server AFTER sending tools manually
    server.connect(transport);
  } catch (error) {
    console.error("Error establishing SSE connection:", error);
    if (!res.headersSent) {
      res.status(500).send("Error establishing SSE connection");
    }
  }
});

// Custom message handling wrapper
const safeHandlePostMessage = (transport: SSEServerTransport, req: any, res: any) => {
  try {
    console.log(`Handling message for session ${req.query.sessionId} safely`);
    
    // Save original end method
    const originalEnd = res.end;
    
    // Override res.end to prevent stream closing
    res.end = function(chunk?: any, encoding?: any) {
      console.log(`Intercepted res.end call for session ${req.query.sessionId}`);
      
      // Send response headers and status
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
    
    // Call the original handlePostMessage
    transport.handlePostMessage(req, res);
    
    // Restore original end method after handling
    res.end = originalEnd;
    
    // Ensure we send a response if not already sent
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

// Setup message endpoint
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
      // Use our safe wrapper instead of direct call
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

// Test endpoint to see available tools
app.get("/test-tools", (req, res) => {
  const toolsInfo = {
    serverHasTools: !!(server as any)._registeredTools,
    toolCount: (server as any)._registeredTools ? Object.keys((server as any)._registeredTools).length : 0,
    tools: {}
  };
  
  if ((server as any)._registeredTools) {
    for (const [name, tool] of Object.entries((server as any)._registeredTools)) {
      toolsInfo.tools[name] = {
        description: (tool as any).description || 'No description',
        hasParameters: !!(tool as any).parameters,
        hasCallback: !!(tool as any).callback
      };
    }
  }
  
  res.json(toolsInfo);
});

// Health check endpoint
app.get("/health", (req, res) => {
  const tools = getTools();
  
  res.status(200).json({
    status: "ok",
    server: "Haloscan MCP Server",
    version: "1.0.0",
    connections: Object.keys(transports).length,
    toolCount: tools.length
  });
});

// Just redirect root to health
app.get("/", (req, res) => {
  res.redirect("/health");
});

// Configure server with keepalive
const server_instance = app.listen(PORT, () => {
  console.log(`Haloscan MCP Server running on http://localhost:${PORT}`);
  console.log(`Connect to /sse for SSE transport`);
  console.log(`Server started at: ${new Date().toISOString()}`);
  
  // Log tools at startup
  const tools = getTools();
  if (tools.length > 0) {
    console.log(`Server has ${tools.length} tools available:`);
    tools.forEach(tool => {
      console.log(` - ${tool.name}: ${tool.description}`);
    });
  } else {
    console.log("WARNING: Server has no tools available!");
  }
});

// Enable keepalive
server_instance.keepAliveTimeout = 120000; // 2 minutes
server_instance.headersTimeout = 125000; // Just above keepAliveTimeout