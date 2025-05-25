import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getIPInfo } from "../services/ipService.js";
import { formatIPResponse, generateRequestId } from "../utils/response.js";
import { isValidIP } from "../utils/ipValidation.js";
import { ValidationError, asyncErrorHandler } from "../utils/errorHandler.js";

const app = new Hono();

// Schema for IP validation
const ipSchema = z.object({
  ip: z.string().ip().optional(),
});

// Get client IP address in JSON format
app.get(
  "/",
  asyncErrorHandler(async (c) => {
    // Check for IP parameter in query string
    const queryIP = c.req.query("ip");
    const clientIP = c.get("clientIP");

    // Validate query IP if provided
    if (queryIP && !isValidIP(queryIP)) {
      throw new ValidationError(
        "The provided IP address is not valid",
        "ip",
        queryIP,
      );
    }

    // Use query IP if provided and valid, otherwise use client IP
    const targetIP = queryIP || clientIP;

    const ipInfo = await getIPInfo(targetIP, c.req);

    // Get threat information
    const { ThreatService } = await import("../services/threatService.js");
    const threatService = new ThreatService();
    const threatInfo = await threatService.getThreatInfo(targetIP, c.req);

    // Add client IP to response headers and set UTF-8 encoding
    c.header("X-Client-IP", clientIP);
    c.header("Content-Type", "application/json; charset=utf-8");

    // Format response as JSON
    const response = formatIPResponse(ipInfo, {
      format: "json",
      includeHeaders: false,
      includeThreatInfo: true,
      threatInfo,
    });

    return c.json(response);
  }),
);

// Get IP information in JSON format (legacy endpoint)
app.get(
  "/json",
  asyncErrorHandler(async (c) => {
    const clientIP = c.get("clientIP");

    const ipInfo = await getIPInfo(clientIP, c.req);

    // Get threat information
    const { ThreatService } = await import("../services/threatService.js");
    const threatService = new ThreatService();
    const threatInfo = await threatService.getThreatInfo(clientIP, c.req);

    // Add client IP to response headers and set UTF-8 encoding
    c.header("X-Client-IP", clientIP);
    c.header("Content-Type", "application/json; charset=utf-8");

    // Format response
    const response = formatIPResponse(ipInfo, {
      format: "json",
      includeHeaders: false,
      includeThreatInfo: true,
      threatInfo,
    });

    return c.json(response);
  }),
);

// Lookup specific IP address
app.get(
  "/lookup/:ip",
  zValidator("param", ipSchema),
  asyncErrorHandler(async (c) => {
    const { ip } = c.req.valid("param");

    const ipInfo = await getIPInfo(ip, c.req);

    // Set UTF-8 encoding
    c.header("Content-Type", "application/json; charset=utf-8");

    // Format response
    const response = formatIPResponse(ipInfo, {
      format: "json",
      includeHeaders: false,
      includeThreatInfo: false,
    });

    return c.json(response);
  }),
);

// Batch IP lookup
app.post(
  "/batch",
  zValidator(
    "json",
    z.object({
      ips: z.array(z.string().ip()).max(10), // Limit to 10 IPs per request
    }),
  ),
  asyncErrorHandler(async (c) => {
    const { ips } = c.req.valid("json");

    // Set UTF-8 encoding
    c.header("Content-Type", "application/json; charset=utf-8");

    const results = await Promise.allSettled(
      ips.map(async (ip) => {
        const ipInfo = await getIPInfo(ip, c.req);
        return formatIPResponse(ipInfo, {
          format: "json",
          includeHeaders: false,
          includeThreatInfo: false,
        });
      }),
    );

    const response = results.map((result, index) => ({
      ip: ips[index],
      success: result.status === "fulfilled",
      data: result.status === "fulfilled" ? result.value : null,
      error: result.status === "rejected" ? result.reason.message : null,
    }));

    return c.json({
      results: response,
      timestamp: new Date().toISOString(),
      requestId: generateRequestId(),
    });
  }),
);

export default app;
