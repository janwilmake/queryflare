## Key Features

### **Shielded User Database**

- Each user's data is stored in a separate DORM database
- User authentication via Stripe payment system
- Balance tracking and charging system

### **Shared Read-Only Database**

- Single shared database accessible to all authenticated users
- Sample data included for testing
- Read-only access enforced via SQL parsing

### **Pay-per-Query Model**

- Each query costs 0.001 cents (0.1 cents in integer representation)
- Balance checked before query execution
- Automatic charging with detailed error messages

### **SQL Security**

- Uses `sql-parser-cst` to parse and validate queries
- Blocks all write operations (INSERT, UPDATE, DELETE, DDL)
- Prevents dangerous function calls
- Supports parameterized queries for safety

### **DORM Compatibility**

- Response format matches DORM's `/query/raw` endpoint
- Includes column names, rows, and metadata
- CORS headers for web integration

## API Usage Examples

### Query Execution

```bash
curl -X POST https://your-worker.dev/query/shared \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=your_token" \
  -d '{
    "sql": "SELECT name, value FROM sample_data WHERE category = ? ORDER BY value DESC",
    "params": ["electronics"]
  }'
```

### Get Schema Information

```bash
curl https://your-worker.dev/query/shared/schema \
  -H "Cookie: access_token=your_token"
```

### Check User Stats

```bash
curl https://your-worker.dev/me/stats \
  -H "Cookie: access_token=your_token"
```

## Response Format

All query responses follow the DORM-compatible format:

```json
{
  "result": {
    "columns": ["name", "value"],
    "rows": [
      ["Product C", 299.99],
      ["Product A", 99.99]
    ],
    "meta": {
      "rows_read": 2,
      "rows_written": 0,
      "charge_applied": 0.1,
      "remaining_balance": 999.9
    }
  }
}
```

This implementation provides a secure, scalable pay-per-query database service that integrates seamlessly with Stripeflare's payment system and DORM's database capabilities.

<!-- https://lmpify.com/httpsuithubcomn-fv5t1q0 -->
