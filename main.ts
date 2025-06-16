import {
  withStripeflare,
  StripeUser,
  DORM,
  createClient,
  Env,
} from "stripeflare";
import { parse } from "sql-parser-cst";

export { DORM };

// Extended user interface for our implementation
interface QueryUser extends StripeUser {
  query_count?: number;
  last_query_at?: string;
}

// Shared database schema for the public read-only database
const sharedDbMigrations = {
  1: [
    `CREATE TABLE IF NOT EXISTS sample_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      value REAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sample_category ON sample_data(category)`,
    `CREATE INDEX IF NOT EXISTS idx_sample_created ON sample_data(created_at)`,
    // Insert some sample data
    `INSERT OR IGNORE INTO sample_data (id, name, category, value) VALUES 
      (1, 'Product A', 'electronics', 99.99),
      (2, 'Product B', 'books', 15.50),
      (3, 'Product C', 'electronics', 299.99),
      (4, 'Product D', 'books', 25.00),
      (5, 'Product E', 'clothing', 49.99)`,
  ],
};

// SQL Parser utility to validate read-only queries
function validateReadOnlyQuery(sql: string): {
  isValid: boolean;
  error?: string;
} {
  try {
    const cst = parse(sql, {
      dialect: "sqlite",
    });

    // Walk through the CST to check for non-read operations
    let hasNonReadOperation = false;
    let errorMessage = "";
    //@ts-ignore
    function checkNode(node: any): void {
      if (!node || typeof node !== "object") return;

      // Check for dangerous statement types
      if (
        node.type === "insert_stmt" ||
        node.type === "update_stmt" ||
        node.type === "delete_stmt" ||
        node.type === "create_table_stmt" ||
        node.type === "drop_table_stmt" ||
        node.type === "alter_table_stmt" ||
        node.type === "create_index_stmt" ||
        node.type === "drop_index_stmt"
      ) {
        hasNonReadOperation = true;
        errorMessage = `Write operation not allowed: ${node.type}`;
        return;
      }

      // Check for dangerous functions
      if (node.type === "function_call" && node.name) {
        const functionName = node.name.toLowerCase();
        const dangerousFunctions = [
          "load_extension",
          "sqlite_compileoption_used",
          "sqlite_compileoption_get",
          "pragma",
        ];

        if (dangerousFunctions.includes(functionName)) {
          hasNonReadOperation = true;
          errorMessage = `Function not allowed: ${functionName}`;
          return;
        }
      }

      // Recursively check all properties
      Object.values(node).forEach((value) => {
        if (Array.isArray(value)) {
          value.forEach(checkNode);
        } else if (value && typeof value === "object") {
          checkNode(value);
        }
      });
    }

    checkNode(cst);

    if (hasNonReadOperation) {
      return { isValid: false, error: errorMessage };
    }

    return { isValid: true };
  } catch (error: any) {
    return {
      isValid: false,
      error: `SQL parsing error: ${error.message}`,
    };
  }
}

// Create shared database client (singleton-like)
function createSharedDbClient(env: Env, ctx: ExecutionContext) {
  return createClient({
    doNamespace: env.DORM_NAMESPACE,
    version: "v1",
    migrations: sharedDbMigrations,
    name: "shared_readonly_db",
    ctx: ctx,
  });
}

type MyEnv = { MY_ENV_SECRET: string };

export default {
  fetch: withStripeflare<MyEnv, QueryUser>(
    async (request, env, ctx) => {
      const { user, charge, client } = ctx;
      const url = new URL(request.url);

      // Handle the shared read-only query endpoint
      if (url.pathname === "/query/shared" && request.method === "POST") {
        try {
          // Check if user is authenticated
          if (!user.access_token) {
            return new Response(
              JSON.stringify({ error: "Authentication required" }),
              {
                status: 401,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          // Parse request body
          const data = (await request.json()) as {
            sql?: string;
            params?: any[];
          };

          if (!data.sql) {
            return new Response(
              JSON.stringify({ error: "SQL query is required" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          // Validate that it's a read-only query
          const validation = validateReadOnlyQuery(data.sql);
          if (!validation.isValid) {
            return new Response(
              JSON.stringify({
                error: "Invalid query",
                details: validation.error,
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          // Charge user 0.001 cent (0.1 cents in integer representation)
          const chargeResult = await charge(0.1, false); // 0.1 cents = 0.001 dollars

          if (!chargeResult.charged) {
            return new Response(
              JSON.stringify({
                error: "Insufficient balance",
                message: chargeResult.message,
                balance: user.balance,
              }),
              {
                status: 402,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          // Create shared database client
          const sharedClient = createSharedDbClient(env, ctx);

          // Execute the query on shared database
          const cursor = sharedClient.exec(data.sql, ...(data.params || []));
          const rows = Array.from(await cursor.raw());

          // Return result in DORM-compatible format
          const result = {
            columns: cursor.columnNames,
            rows,
            meta: {
              rows_read: cursor.rowsRead,
              rows_written: cursor.rowsWritten,
              charge_applied: 0.1, // cents
              remaining_balance: user.balance - 0.1,
            },
          };

          return new Response(JSON.stringify({ result }), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        } catch (error: any) {
          console.error("Query execution error:", error);
          return new Response(
            JSON.stringify({
              error: "Query execution failed",
              details: error.message,
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      }

      // Default welcome page
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>QueryFlare - Pay-per-Query Database Access</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            .user-info { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .endpoint { background: #e8f4fd; padding: 15px; margin: 10px 0; border-radius: 5px; }
            .example { background: #f8f8f8; padding: 10px; border-left: 3px solid #007acc; margin: 10px 0; }
            pre { background: #2d3748; color: #e2e8f0; padding: 15px; border-radius: 5px; overflow-x: auto; }
          </style>
        </head>
        <body>
          <h1>QueryFlare - Pay-per-Query Database Access</h1>
          
          <div class="user-info">
            <h3>User Status</h3>
            <p><strong>Email:</strong> ${user.email || "Anonymous"}</p>
            <p><strong>Balance:</strong> $${((user.balance || 0) / 100).toFixed(
              3,
            )}</p>
            <p><strong>Authenticated:</strong> ${
              user.access_token ? "Yes" : "No"
            }</p>
          </div>

          <h2>Available Endpoints</h2>
          
          <div class="endpoint">
            <h3>POST /query/shared</h3>
            <p>Execute read-only SQL queries on the shared database. Costs 0.001 cents per query.</p>
            <div class="example">
              <strong>Example Request:</strong>
              <pre>{
  "sql": "SELECT * FROM sample_data WHERE category = ? LIMIT 5",
  "params": ["electronics"]
}</pre>
            </div>
          </div>


          <h2>Example Usage</h2>
          <div class="example">
            <strong>Query with curl:</strong>
            <pre>curl -X POST ${url.origin}/query/shared \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${user.access_token || "your_token_here"}" \\
  -d '{"sql": "SELECT COUNT(*) as total FROM sample_data"}'</pre>
          </div>

          <h2>Supported SQL Features</h2>
          <ul>
            <li>SELECT statements</li>
            <li>WHERE clauses with parameters</li>
            <li>JOINs, GROUP BY, ORDER BY</li>
            <li>Aggregate functions (COUNT, SUM, AVG, etc.)</li>
            <li>LIMIT and OFFSET</li>
          </ul>

          <h2>Restrictions</h2>
          <ul>
            <li>No INSERT, UPDATE, DELETE operations</li>
            <li>No DDL statements (CREATE, DROP, ALTER)</li>
            <li>No system functions or PRAGMA statements</li>
            <li>Queries are parsed and validated before execution</li>
          </ul>

          <div style="background: #ffe6e6; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Authentication Required</h3>
            <p>You need to authenticate via Stripe payment to access the query endpoints.</p>
            <p><a href="/me">Click here to see authentication options</a></p>
          <a href="${ctx.paymentLink}">Deposit</a>
          </div>
       

        </body>
        </html>
      `;

      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    },
    { version: "v2" },
  ),
};
