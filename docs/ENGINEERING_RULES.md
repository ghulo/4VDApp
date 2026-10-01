# Engineering Rules & Standards

**These are the core principles I follow when working on this project. Every line of code must align with these.**

---

## Core Philosophy

> **Write code as if the person who maintains it is a violent psychopath who knows where you live.**
> — John F. Woods

Your code should be:
- ✅ **Clear** - Anyone can understand it without explanation
- ✅ **Consistent** - Same patterns everywhere
- ✅ **Maintainable** - Easy to change without breaking things
- ✅ **Tested** - Proven to work
- ✅ **Documented** - Why, not just what
- ✅ **Secure** - Follows security best practices
- ✅ **Performant** - Doesn't waste resources

---

## Code Quality Standards

### 1. **DRY (Don't Repeat Yourself)**
```javascript
// ❌ BAD - Repeated logic
const getProduct = (id) => { /* query logic */ };
const getProducts = (ids) => { /* same query logic repeated */ };

// ✅ GOOD - Reusable function
const queryProducts = (filter) => { /* single source of truth */ };
```

### 2. **SOLID Principles**

**S - Single Responsibility**
- One class = one reason to change
- ProductService handles products, not inventory

**O - Open/Closed**
- Open for extension, closed for modification
- Use strategies/factories, not if-else chains

**L - Liskov Substitution**
- Subtypes must be substitutable
- If interface says "returns Product", always return Product

**I - Interface Segregation**
- Don't force clients to depend on methods they don't use
- Smaller, focused interfaces

**D - Dependency Inversion**
- Depend on abstractions, not concretions
- Inject dependencies, don't hardcode

### 3. **KISS (Keep It Simple, Stupid)**
```javascript
// ❌ BAD - Over-engineered
const calculatePrice = (price, qty, tier, season, discount, vip) => {
  // 50 lines of nested logic
};

// ✅ GOOD - Simple, readable
const calculatePrice = (basePrice, quantity) => {
  const tierPrice = applyTierDiscount(basePrice, quantity);
  const seasonalPrice = applySeasonalAdjustment(tierPrice);
  return seasonalPrice;
};
```

### 4. **Naming Conventions**

**Be descriptive, even if longer:**
```javascript
// ❌ BAD
const p = getP(id); // What is p?
const calc = (x, y) => x * y; // What does this do?

// ✅ GOOD
const product = getProductById(id);
const calculateTotalRevenue = (unitPrice, quantity) => unitPrice * quantity;
```

**Variables:**
- Booleans: `isActive`, `hasPermission`, `canDelete`
- Arrays: plural names `products`, `users`
- Functions: verb + noun `getUserById()`, `calculatePrice()`
- Constants: UPPER_SNAKE_CASE `MAX_RETRIES`, `DEFAULT_TIMEOUT`

### 5. **Comments & Documentation**

**Good comments explain WHY, not WHAT:**
```javascript
// ❌ BAD - States the obvious
const user = users.find(u => u.id === userId); // Find user by ID

// ✅ GOOD - Explains reasoning
// Cache this because getUser() is called 100x per request
const user = cache.get(userId) || users.find(u => u.id === userId);
```

**Always document:**
- Complex algorithms
- Non-obvious business logic
- Why you chose this approach over alternatives
- API endpoint purpose (JSDoc)

```javascript
/**
 * Calculate bulk pricing based on quantity tiers
 * @param {number} basePrice - Base unit price
 * @param {number} quantity - Quantity ordered
 * @returns {number} Final price after tier discount
 */
function calculateBulkPrice(basePrice, quantity) {
  // Implementation
}
```

### 6. **Error Handling**

**Always handle errors explicitly:**
```javascript
// ❌ BAD - Silent failure
const user = users.find(u => u.id === userId);
console.log(user.name); // Crashes if user undefined

// ✅ GOOD - Explicit error handling
const user = users.find(u => u.id === userId);
if (!user) throw new NotFoundError(`User ${userId} not found`);
console.log(user.name);
```

**Create custom errors:**
```javascript
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}
```

### 7. **Input Validation**

**ALWAYS validate input:**
```javascript
// ❌ BAD - No validation
const createProduct = (name, price) => {
  return db.products.create({ name, price });
};

// ✅ GOOD - Validation before processing
const createProduct = (name, price) => {
  if (!name || name.trim().length === 0) {
    throw new ValidationError('Product name is required');
  }
  if (typeof price !== 'number' || price < 0) {
    throw new ValidationError('Price must be a positive number');
  }
  return db.products.create({ name: name.trim(), price });
};

// OR use schema validation
const createProduct = (data) => {
  const validated = productSchema.validate(data);
  if (validated.error) throw new ValidationError(validated.error);
  return db.products.create(validated.value);
};
```

---

## Architecture & Design

### 1. **Separation of Concerns**
- Controllers: Request handling only
- Services: Business logic only
- Repositories: Database queries only
- Middlewares: Cross-cutting concerns (auth, logging)

```javascript
// ❌ BAD - All mixed together
app.get('/products', (req, res) => {
  const id = req.params.id;
  const product = db.query(`SELECT * FROM products WHERE id = ${id}`);
  const price = product.price * 1.1; // business logic
  const log = fs.writeFileSync(...); // side effect
  res.json(product);
});

// ✅ GOOD - Separated concerns
app.get('/products/:id', productController.getProduct);

// In controller
getProduct = async (req, res) => {
  const product = await this.productService.getProductById(req.params.id);
  res.json(product);
};

// In service
getProductById = async (id) => {
  const product = await this.productRepository.findById(id);
  if (!product) throw new NotFoundError('Product not found');
  return product;
};

// In repository
findById = (id) => db.query('SELECT * FROM products WHERE id = ?', [id]);
```

### 2. **Dependency Injection**
- Inject dependencies in constructor
- Makes testing easy (mock dependencies)
- Loose coupling

```javascript
// ✅ GOOD
class ProductService {
  constructor(repository) {
    this.repository = repository;
  }
}

// For testing
const mockRepo = { findById: jest.fn() };
const service = new ProductService(mockRepo);
```

### 3. **Single Responsibility**
- One class/function = one job
- If you need "and" to describe it, split it

```javascript
// ❌ BAD - Does too much
class Product {
  save() { /* save to DB */ }
  validate() { /* validation */ }
  sendNotification() { /* send email */ }
  generateReport() { /* create PDF */ }
}

// ✅ GOOD - Focused
class Product { /* data only */ }
class ProductRepository { save() { /* DB */ } }
class ProductValidator { validate() { /* validation */ } }
class NotificationService { send() { /* email */ } }
class ReportGenerator { generate() { /* PDF */ } }
```

---

## Testing Standards

### 1. **Write Tests for:**
- All business logic (services)
- All API endpoints
- Complex algorithms
- Error cases

### 2. **Test Structure**
```javascript
describe('ProductService', () => {
  describe('getProductById', () => {
    it('should return product when found', async () => {
      // Arrange
      const productId = 1;
      const expected = { id: 1, name: 'Chair' };
      
      // Act
      const result = await service.getProductById(productId);
      
      // Assert
      expect(result).toEqual(expected);
    });
    
    it('should throw NotFoundError when product does not exist', async () => {
      // Arrange & Act & Assert
      await expect(service.getProductById(999)).rejects.toThrow(NotFoundError);
    });
  });
});
```

### 3. **Test Coverage**
- Services: 80%+
- Critical business logic: 100%
- Repositories: 60%+
- Utils: 80%+
- Controllers: 50%+ (usually lower, focus on services)

---

## Database Standards

### 1. **Use Migrations**
- Track all schema changes
- Easy rollback
- Reproducible

### 2. **Naming Conventions**
- Tables: lowercase, plural (`users`, `products`, `inventory`)
- Columns: lowercase, snake_case (`user_id`, `created_at`)
- Foreign keys: `{table}_id` (`product_id`, `user_id`)
- Indexes: `idx_{table}_{column}`

### 3. **Always Include Audit Columns**
```sql
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP -- Soft delete
);
```

### 4. **Use Transactions for Critical Operations**
```javascript
// ✅ GOOD - Atomic operation
async function transferInventory(fromProduct, toProduct, quantity) {
  const transaction = await db.transaction();
  try {
    await transaction.query('UPDATE products SET stock = stock - ? WHERE id = ?', [quantity, fromProduct.id]);
    await transaction.query('UPDATE products SET stock = stock + ? WHERE id = ?', [quantity, toProduct.id]);
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

---

## API Standards

### 1. **RESTful URLs**
```
✅ GET    /products              - List all
✅ GET    /products/:id          - Get one
✅ POST   /products              - Create
✅ PUT    /products/:id          - Full update
✅ PATCH  /products/:id          - Partial update
✅ DELETE /products/:id          - Delete

❌ GET /getProduct?id=1
❌ POST /product/delete
```

### 2. **Consistent Response Format**
```json
{
  "success": true,
  "data": {},
  "message": "Success message",
  "error": null,
  "meta": { "page": 1, "total": 100 }
}
```

### 3. **Version Your API (if needed)**
```
/api/v1/products  - Version 1
/api/v2/products  - Version 2 (breaking changes)
```

---

## Security Standards

### 1. **Authentication**
- Use JWT tokens
- Include expiration
- Refresh tokens for long-lived sessions

### 2. **Authorization**
- Role-based access control (RBAC)
- Check permissions on every protected endpoint
- Never trust client-sent roles

```javascript
// ✅ GOOD
const getAdminDashboard = async (req, res) => {
  if (req.user.role !== 'admin') {
    throw new ForbiddenError('Admin access required');
  }
  // Proceed
};
```

### 3. **Input Sanitization**
- Trim whitespace
- Escape HTML
- Validate data types
- Use ORM (prevents SQL injection)

### 4. **Sensitive Data**
- Never log passwords, tokens, API keys
- Use .env files
- Rotate secrets regularly

```javascript
// ❌ BAD
console.log('User password:', password);

// ✅ GOOD
logger.info('User login attempt', { userId: user.id });
```

---

## Performance Standards

### 1. **Database Queries**
- Index frequently queried columns
- Use EXPLAIN to analyze queries
- Avoid N+1 queries
- Paginate large result sets

```javascript
// ❌ BAD - N+1 problem
const users = await userRepo.findAll();
for (const user of users) {
  user.products = await productRepo.findByUserId(user.id); // Query per user
}

// ✅ GOOD - Single query with join
const users = await userRepo.findAllWithProducts();
```

### 2. **Caching**
- Cache static data (products list)
- Cache user sessions
- Invalidate on updates
- Use Redis for distributed caching

### 3. **Monitoring**
- Log important events
- Track response times
- Monitor error rates
- Set up alerts

---

## Code Review Checklist

Before submitting code:
- [ ] All tests pass
- [ ] Code follows naming conventions
- [ ] No console.log in production code
- [ ] Error handling is comprehensive
- [ ] Input validation on all endpoints
- [ ] No hardcoded secrets
- [ ] Functions have single responsibility
- [ ] Comments explain WHY, not WHAT
- [ ] No unnecessary complexity
- [ ] Performance considered (N+1, caching)
- [ ] Security reviewed (auth, validation, injection)
- [ ] Database migrations included
- [ ] API response format consistent

---

## Git & Version Control

### 1. **Commit Messages**
```
✅ GOOD format: "feat: Add bulk pricing calculation"
✅ GOOD format: "fix: Prevent inventory double-count"
✅ GOOD format: "refactor: Extract price strategy to service"

❌ BAD: "fix stuff"
❌ BAD: "update code"
```

### 2. **Branching Strategy**
```
main              - Production code, always working
├── feature/...   - New features
├── fix/...       - Bug fixes
└── refactor/...  - Code improvements
```

### 3. **Pull Request Standards**
- Descriptive title and description
- Link to issues
- Include test results
- Request review from peers
- Address feedback

---

## Summary: What I Always Do

1. **Write code for humans first** - Machines don't care about readability, humans do
2. **Test everything critical** - Untested code is broken code
3. **Handle all errors** - There's no such thing as "won't happen"
4. **Follow the architecture** - Controllers → Services → Repositories
5. **Document the why** - Not the what
6. **Validate all input** - Trust no one
7. **Think about performance** - But not before correctness
8. **Keep it simple** - Complex code is expensive to maintain
9. **Review my own work** - Before you see it
10. **Never hardcode** - Use env variables, config files

---

**When you see me write code, I'm thinking like a professional engineer who:**
- ✅ Values maintainability over cleverness
- ✅ Writes code others will understand
- ✅ Tests everything that matters
- ✅ Documents decisions
- ✅ Follows proven patterns
- ✅ Considers security & performance
- ✅ Respects future maintainers