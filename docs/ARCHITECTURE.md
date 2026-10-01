# 4VD App - Architecture & Design Patterns

## Architecture Overview

### Clean Architecture / Layered Architecture

```
┌─────────────────────────────────────────┐
│         Presentation Layer              │
│    (Routes, Controllers, Views)         │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│       Business Logic Layer              │
│    (Services, Use Cases, Validators)    │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│     Data Access Layer                   │
│    (Repositories, ORM, Database)        │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│     Database & External Services        │
│    (PostgreSQL, File Storage, APIs)     │
└─────────────────────────────────────────┘
```

**Benefits:**
- Clear separation of concerns
- Easy to test (mock at each layer)
- Scalable as business logic grows
- Easy to change implementations (swap repos, services, etc.)

---

## Backend Architecture

### Directory Structure (Best Practices)
```
backend/src/
├── config/           # Configuration (DB, env, constants)
├── middlewares/      # Express middlewares (auth, error handling, logging)
├── routes/           # API route definitions
├── controllers/      # Request handlers, input validation
├── services/         # Business logic layer
├── repositories/     # Data access layer (ORM queries)
├── models/           # Database models/schemas
├── utils/            # Helpers, utilities, constants
├── validators/       # Input validation schemas
├── errors/           # Custom error classes
├── types/            # TypeScript types/interfaces (if using TS)
├── constants/        # App-wide constants
└── server.js         # Express app initialization
```

### Key Layers

**1. Controllers** (Request → Response)
```
Route → Controller → Service → Repository → Database
         ↑ Input validation
         ↑ Parse request
         ↑ Call service
         ↑ Return response
```

**2. Services** (Business Logic)
- All business rules live here
- No direct database access
- Calls repositories
- Handles complex operations
- Pure functions when possible

**3. Repositories** (Data Access)
- Only database queries here
- Consistent query interface
- Easy to mock for testing
- No business logic

---

## Design Patterns

### 1. **Repository Pattern** (Data Access)
```javascript
// ProductRepository encapsulates all product queries
class ProductRepository {
  findById(id) { /* query */ }
  findAll(filters) { /* query */ }
  create(data) { /* insert */ }
  update(id, data) { /* update */ }
}
```

### 2. **Service Pattern** (Business Logic)
```javascript
// ProductService uses repository, no DB knowledge
class ProductService {
  constructor(productRepository, inventoryRepository) {
    this.productRepo = productRepository;
    this.inventoryRepo = inventoryRepository;
  }
  
  getAvailableProducts() {
    // Business logic here
  }
}
```

### 3. **Dependency Injection**
```javascript
// Constructor injection - loose coupling, testable
const productService = new ProductService(
  new ProductRepository(),
  new InventoryRepository()
);
```

### 4. **Strategy Pattern** (Pricing)
```javascript
// Different pricing strategies
class BulkPricingStrategy {
  calculate(basePrice, quantity) { /* bulk logic */ }
}

class SeasonalPricingStrategy {
  calculate(basePrice, quantity) { /* seasonal logic */ }
}
```

### 5. **Factory Pattern** (Object Creation)
```javascript
class PricingStrategyFactory {
  static create(strategyType) {
    switch(strategyType) {
      case 'bulk': return new BulkPricingStrategy();
      case 'seasonal': return new SeasonalPricingStrategy();
    }
  }
}
```

### 6. **Observer Pattern** (Real-time Notifications)
```javascript
// Inventory changes → notify subscribers
class InventoryNotifier {
  subscribe(observer) { /* add observer */ }
  notifyLowStock(product) { /* notify all */ }
}
```

### 7. **Singleton Pattern** (Database Connection)
```javascript
class Database {
  static instance;
  static getInstance() {
    if (!this.instance) this.instance = new Database();
    return this.instance;
  }
}
```

---

## Mobile Architecture (React Native)

### Directory Structure
```
mobile/src/
├── screens/          # Full-screen components (LoginScreen, ProductsScreen)
├── components/       # Reusable UI components (ProductCard, PriceDisplay)
├── services/         # API calls, external logic
├── hooks/            # Custom React hooks
├── navigation/       # Navigation setup
├── state/            # State management (Context API or Redux)
├── utils/            # Helpers, formatters
├── assets/           # Images, fonts
└── App.js            # Root component
```

### State Management Pattern
Use **Context API + Custom Hooks** for simple state, or **Redux** if complex.

```javascript
// Custom hook pattern (preferred for simplicity)
const useProducts = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const fetchProducts = async () => {
    setLoading(true);
    const data = await api.getProducts();
    setProducts(data);
    setLoading(false);
  };
  
  return { products, loading, fetchProducts };
};
```

---

## Database Design Principles

1. **Normalization** - Minimize redundancy
2. **Foreign Keys** - Maintain data integrity
3. **Indexes** - Performance on common queries
4. **Audit Trail** - `created_at`, `updated_at` timestamps
5. **Soft Deletes** - Mark deleted instead of removing (optional)
6. **Constraints** - Data validation at DB level

---

## API Design

### RESTful Principles
- **GET** - Fetch data (safe, idempotent)
- **POST** - Create data (not idempotent)
- **PUT** - Full update (idempotent)
- **PATCH** - Partial update (idempotent)
- **DELETE** - Remove data (idempotent)

### Response Format (Consistent)
```json
{
  "success": true,
  "data": { /* actual data */ },
  "message": "Success message",
  "error": null,
  "meta": {
    "page": 1,
    "total": 100,
    "limit": 20
  }
}
```

### Status Codes
- 200 - OK
- 201 - Created
- 400 - Bad Request (validation error)
- 401 - Unauthorized
- 403 - Forbidden
- 404 - Not Found
- 409 - Conflict
- 500 - Server Error

---

## Error Handling Strategy

```javascript
// Custom error classes
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.code = 'VALIDATION_ERROR';
    this.status = 400;
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.code = 'NOT_FOUND';
    this.status = 404;
  }
}

// Global error handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  res.status(status).json({ success: false, error: message });
});
```

---

## Testing Strategy

### Unit Tests (Services, Utils)
- Test business logic in isolation
- Mock repositories
- Fast, deterministic

### Integration Tests (API Endpoints)
- Test full flow: controller → service → repository
- Real database (or test DB)
- Slower but comprehensive

### Test Coverage Target
- **Minimum**: 70% coverage
- **Critical paths** (auth, payments, inventory): 100%
- **Services**: 80%+

---

## Security Best Practices

1. **Authentication** - JWT tokens
2. **Authorization** - Role-based access control (RBAC)
3. **Input Validation** - Sanitize all inputs
4. **SQL Injection Prevention** - Use parameterized queries (ORM handles this)
5. **CORS** - Restrict to allowed origins
6. **Rate Limiting** - Prevent abuse
7. **Environment Variables** - Never hardcode secrets
8. **Password Hashing** - bcrypt or similar
9. **HTTPS Only** - Encrypted communication

---

## Performance Considerations

1. **Database**
   - Index frequently queried columns
   - Avoid N+1 queries (eager load relations)
   - Paginate large result sets

2. **Caching**
   - Cache product catalog (doesn't change often)
   - Cache user sessions
   - Invalidate on updates

3. **API**
   - Compress responses (gzip)
   - Pagination for lists
   - Lazy loading for images

4. **Mobile**
   - Lazy load lists
   - Cache API responses
   - Optimize bundle size

---

## Scalability

### Current Phase (MVP)
- Single Node.js server
- Single PostgreSQL database
- Sufficient for team + employees

### Future Growth
- **Load Balancing** - Multiple Node servers
- **Database Replication** - Read replicas
- **Caching Layer** - Redis for hot data
- **CDN** - For image delivery
- **Message Queue** - For async tasks (notifications, reports)

---

## Summary

| Layer | Pattern | Purpose |
|-------|---------|---------|
| Routes | REST API | HTTP interface |
| Controllers | Input validation | Parse & validate requests |
| Services | Business logic | Core app logic |
| Repositories | Data access | Database queries |
| Models | Database schema | Data structure |
| Middleware | Cross-cutting concerns | Auth, logging, error handling |
| Utils | Reusable helpers | Formatting, validation |

This architecture ensures:
✅ **Maintainability** - Clear code organization  
✅ **Testability** - Easy to test each layer  
✅ **Scalability** - Add features without refactoring  
✅ **Reusability** - Services/utils across endpoints  
✅ **Professional Standards** - Industry best practicess