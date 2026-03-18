// Server Entry Point - Updated for PostgreSQL/Drizzle
import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { createServer } from "http";
import { storage } from "./storage";
import { pool } from "./db";

const app = express();
const httpServer = createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    // Test DB Connection
    await pool.query('SELECT NOW()');
    log("Connected to PostgreSQL successfully");

    // Initialize Public Viewer
    const publicViewer = await storage.getUserByMobileNumber("0000000000");
    if (!publicViewer) {
      await storage.createUser({
        fullName: "Public Viewer",
        username: "public_viewer",
        mobileNumber: "0000000000",
        password: "public",
        role: "public",
        isApproved: true,
        isActive: true,
        email: "",
        profileImage: "",
        teams: [],
        followers: [],
        following: []
      });
      log("Initialized Public Viewer account");
    }

    // Initialize Developer Account
    const developerAccount = await storage.getUserByMobileNumber("DEVILUPPER");
    if (!developerAccount) {
      await storage.createUser({
        fullName: "Developer",
        username: "DEVILUPPER",
        mobileNumber: "DEVILUPPER",
        password: "###DEVILUPPER###",
        role: "developer",
        isApproved: true,
        isActive: true,
        email: "",
        profileImage: "",
        teams: [],
        followers: [],
        following: []
      });
      log("Initialized Developer account");
    }
  } catch (err) {
    console.error("\n❌ DATABASE CONNECTION ERROR");
    console.error("---------------------------");
    console.error(err);
    console.error("---------------------------");
    
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    } else {
      log("Warning: Server started without database connection. Most features will not work.", "error");
    }
  }

  await registerRoutes(httpServer, app);

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "OK", timestamp: new Date().toISOString() });
  });

  // Base API v1 route
  app.get("/api/v1", (_req, res) => {
    res.json({ message: "Cricket Club Manager API v1" });
  });

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
