# API Documentation

## Base URL
```
Development: http://localhost:3000/api
Production: [Your production domain]/api
```

## Authentication
**Method:** JWT Tokens (JSON Web Tokens)

**Flow:**
1. User logs in with credentials
2. Server returns JWT token + refresh token
3. Include token in Authorization header for subsequent requests
4. Token expires after 7 days
5. Use refresh token to get new JWT

**Header Format:**
```
Authorization: Bearer <jwt_token>
```

**JWT Payload:**
```json
{
  "userId": 1,
  "email": "user@example.com",
  "role": "admin",
  "iat": 1234567890,
  "exp": 1234654290
}
```

## Rate Limiting
**Enabled:** Yes

**Limits:**
- Public endpoints: 100 requests per 15 minutes per IP
- Authenticated endpoints: 500 requests per 15 minutes per user
- Admin endpoints: 1000 requests per 15 minutes per admin

**Response Header:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1234567890
```

## Response Format
All responses follow this structure:
```json
{
  "success": true/false,
  "data": {},
  "message": "Success/error message",
  "error": null,
  "meta": {
    "page": 1,
    "total": 100,
    "limit": 20
  }
}
```

---

## Endpoints

### Products

#### GET /products
Fetch all products with filtering options
- **Query Params:**
  - `category`: Filter by category
  - `search`: Search by name
  - `inStock`: true/false
  - `limit`: Results per page
  - `page`: Page number
- **Response:** Array of products with images, prices, stock levels
- **Auth:** Not required

#### GET /products/:id
Fetch single product details
- **Params:** `id` - Product ID
- **Response:** Product object with full details, bulk pricing tiers
- **Auth:** Not required

#### POST /products (Admin only)
Add new product
- **Auth:** Required (admin role)
- **Body:**
  ```json
  {
    "name": "Product Name",
    "description": "Description",
    "category": "Category",
    "price": 100,
    "stock": 50,
    "image": "image_url",
    "bulkPricingTiers": [
      { "quantity": 10, "price": 90 },
      { "quantity": 50, "price": 80 }
    ]
  }
  ```

#### PUT /products/:id (Admin only)
Update product
- **Params:** `id` - Product ID
- **Auth:** Required (admin role)
- **Body:** Same as POST

#### DELETE /products/:id (Admin only)
Delete product
- **Params:** `id` - Product ID
- **Auth:** Required (admin role)

---

### Authentication

#### POST /auth/login
User login
- **Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "password123"
  }
  ```
- **Response:**
  ```json
  {
    "token": "jwt_token",
    "refreshToken": "refresh_token",
    "user": {
      "id": 1,
      "email": "user@example.com",
      "role": "admin"
    }
  }
  ```

#### POST /auth/refresh
Refresh JWT token using refresh token
- **Body:**
  ```json
  {
    "refreshToken": "refresh_token"
  }
  ```
- **Response:** New JWT token

#### POST /auth/logout
Logout user
- **Auth:** Required
- **Response:** Success message

---

### Inventory

#### GET /inventory
Get real-time stock levels
- **Auth:** Not required
- **Response:** Array of products with current stock

#### GET /inventory/:productId
Get stock level for specific product
- **Params:** `productId` - Product ID
- **Auth:** Not required
- **Response:** Stock count, reorder level, warnings

#### PATCH /inventory/:productId
Update stock (manual adjustment)
- **Params:** `productId` - Product ID
- **Auth:** Required (admin role)
- **Body:**
  ```json
  {
    "quantity": 10,
    "reason": "Manual adjustment/Sale/Return"
  }
  ```

---

### Sales & Analytics

#### GET /sales
Get sales history with filters
- **Query Params:**
  - `startDate`: Start date for range
  - `endDate`: End date for range
  - `productId`: Filter by product
  - `limit`: Results per page
- **Auth:** Required (admin role)
- **Response:** Sales records with dates, quantities, prices

#### GET /analytics/dashboard
Get admin dashboard data
- **Auth:** Required (admin role)
- **Response:**
  ```json
  {
    "totalSales": 0,
    "totalRevenue": 0,
    "topProducts": [],
    "lowStockItems": [],
    "recentSales": [],
    "inventoryValue": 0
  }
  ```

#### GET /analytics/revenue
Get revenue trends
- **Query Params:**
  - `period`: "daily", "weekly", "monthly"
  - `startDate`: Start date
  - `endDate`: End date
- **Auth:** Required (admin role)
- **Response:** Revenue data for charting

#### GET /analytics/products/:productId
Get product-specific analytics
- **Params:** `productId` - Product ID
- **Auth:** Required (admin role)
- **Response:** Sales count, revenue, trends, stock history

---

### Bulk Pricing

#### GET /pricing/tiers/:productId
Get bulk pricing tiers for product
- **Auth:** Not required
- **Response:** Array of pricing tiers

#### PUT /pricing/tiers/:productId (Admin only)
Update bulk pricing tiers
- **Auth:** Required (admin role)
- **Body:**
  ```json
  {
    "tiers": [
      { "quantity": 10, "price": 90 },
      { "quantity": 50, "price": 80 }
    ]
  }
  ```

---

### Users & Access

#### GET /users
List users with access
- **Auth:** Required (admin role)
- **Response:** Array of users, roles, access levels

#### POST /users (Admin only)
Create new user account
- **Auth:** Required (admin role)
- **Body:** User details (email, role, name)

#### PUT /users/:id (Admin only)
Update user permissions/role
- **Auth:** Required (admin role)

#### DELETE /users/:id (Admin only)
Remove user access
- **Auth:** Required (admin role)

---

## Error Codes
| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 429 | Too Many Requests (rate limited) |
| 500 | Server Error |

## Error Response Example
```json
{
  "success": false,
  "error": "Product not found",
  "message": "The product with ID 999 does not exist",
  "statusCode": 404
}
```

## Notes
- All timestamps are in UTC
- Prices are in currency units (e.g., euros)
- Images should be uploaded separately (multipart/form-data)
- Pagination defaults to 20 items per page
- All POST/PUT/PATCH requests require Content-Type: application/json