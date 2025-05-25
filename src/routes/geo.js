import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getGeoInfo } from "../services/geoService.js";
import { formatGeoResponse } from "../utils/response.js";

const app = new Hono();

// Schema for geo query parameters
const geoQuerySchema = z.object({
  format: z.enum(["json", "xml", "csv"]).optional().default("json"),
  lang: z.string().optional().default("en"),
  fields: z.string().optional(), // Comma-separated list of fields
  include_threat: z
    .string()
    .optional()
    .transform((val) => val === "true"),
});

// Schema for IP validation
const ipSchema = z.object({
  ip: z.string().ip().optional(),
});

// Get geolocation information for client IP
app.get("/geo", zValidator("query", geoQuerySchema), async (c) => {
  try {
    const clientIP = c.get("clientIP");
    const query = c.req.valid("query");

    // Get geolocation information from multiple providers
    const geoInfo = await getGeoInfo(clientIP, c.req, {
      language: query.lang,
      includeThreat: query.include_threat,
    });

    // Add client IP to response headers
    c.header("X-Client-IP", clientIP);

    // Parse requested fields
    const requestedFields = query.fields ? query.fields.split(",") : null;

    // Format response
    const response = formatGeoResponse(geoInfo, {
      format: query.format,
      fields: requestedFields,
      includeHeaders: false,
      includeThreatInfo: query.include_threat,
    });

    // Set appropriate content type with UTF-8 encoding
    const contentType = getContentType(query.format);
    c.header("Content-Type", contentType);

    if (query.format === "json") {
      return c.json(response);
    } else {
      return c.text(response);
    }
  } catch (_error) {
    return c.json(
      {
        error: "Internal Server Error",
        message: "Failed to retrieve geolocation information",
        timestamp: new Date().toISOString(),
      },
      500,
    );
  }
});

// Get geolocation for specific IP
app.get(
  "/geo/:ip",
  zValidator("param", ipSchema),
  zValidator("query", geoQuerySchema),
  async (c) => {
    try {
      const { ip } = c.req.valid("param");
      const query = c.req.valid("query");

      const geoInfo = await getGeoInfo(ip, c.req, {
        language: query.lang,
        includeThreat: query.include_threat,
      });

      // Parse requested fields
      const requestedFields = query.fields ? query.fields.split(",") : null;

      // Format response
      const response = formatGeoResponse(geoInfo, {
        format: query.format,
        fields: requestedFields,
        includeHeaders: false,
        includeThreatInfo: query.include_threat,
      });

      // Set appropriate content type
      const contentType = getContentType(query.format);
      c.header("Content-Type", contentType);

      if (query.format === "json") {
        return c.json(response);
      } else {
        return c.text(response);
      }
    } catch (_error) {
      return c.json(
        {
          error: "Internal Server Error",
          message: "Failed to retrieve geolocation information",
          timestamp: new Date().toISOString(),
        },
        500,
      );
    }
  },
);

// Batch geolocation lookup
app.post(
  "/geo/batch",
  zValidator(
    "json",
    z.object({
      ips: z.array(z.string().ip()).max(10), // Limit to 10 IPs per request
      options: z
        .object({
          format: z.enum(["json", "xml", "csv"]).optional().default("json"),
          lang: z.string().optional().default("en"),
          fields: z.string().optional(),
          include_threat: z.boolean().optional().default(false),
        })
        .optional()
        .default({}),
    }),
  ),
  async (c) => {
    try {
      const { ips, options } = c.req.valid("json");

      const results = await Promise.allSettled(
        ips.map(async (ip) => {
          const geoInfo = await getGeoInfo(ip, c.req, {
            language: options.lang,
            includeThreat: options.include_threat,
          });

          const requestedFields = options.fields
            ? options.fields.split(",")
            : null;

          return formatGeoResponse(geoInfo, {
            format: options.format,
            fields: requestedFields,
            includeHeaders: false,
            includeThreatInfo: options.include_threat,
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
      });
    } catch (_error) {
      return c.json(
        {
          error: "Internal Server Error",
          message: "Failed to process batch geolocation lookup",
          timestamp: new Date().toISOString(),
        },
        500,
      );
    }
  },
);

function getContentType(format) {
  switch (format) {
    case "xml":
      return "application/xml; charset=utf-8";
    case "csv":
      return "text/csv; charset=utf-8";
    case "json":
    default:
      return "application/json; charset=utf-8";
  }
}

export default app;
