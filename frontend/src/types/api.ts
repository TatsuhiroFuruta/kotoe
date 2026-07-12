// Rails API のレスポンスの型。

/** GET /api/health */
export type HealthResponse = {
  status: "ok" | "error";
  database: "ok" | "error";
};
