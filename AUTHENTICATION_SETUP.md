# Authentication System Setup Guide

## Overview

This authentication system supports role-based signup and login with the following roles:
- **Admin**: Full system access
- **Manager**: Management dashboard access
- **Supervisor**: Supervision and monitoring access
- **Customer**: Customer portal access
- **Rake Planner**: Rake planning and scheduling access
- **Yard**: Yard operations access

## Features

✅ **Role-based signup** with different required fields based on role
✅ **Email uniqueness validation** with proper error messages
✅ **Password strength validation** (minimum 6 characters)
✅ **Automatic redirect to login** after successful signup
✅ **JWT token-based authentication**
✅ **TypeScript support** for type safety
✅ **Responsive design** using Tailwind CSS

## Database Schema Updates

The following changes have been made to support the authentication system:

### Updated Role Enum
```sql
CREATE TYPE "Role" AS ENUM ('admin', 'manager', 'supervisor', 'customer', 'rake_planner', 'yard');
```

### Updated User Table
```sql
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
```

## Setup Instructions

### 1. Database Setup

1. **Create Supabase Project** (if not already done)
   - Go to [supabase.com](https://supabase.com)
   - Create a new project
   - Note your project URL and API keys

2. **Run Database Schema**
   - Open Supabase Dashboard > SQL Editor
   - Copy and paste the content from `apps/api/prisma/supabase-schema.sql`
   - Execute the SQL to create all tables and constraints

3. **Configure Environment Variables**
   - Copy `supabase.env.example` to `.env` in your API directory
   - Update with your actual Supabase credentials:
   ```env
   DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
   DIRECT_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
   JWT_SECRET="your-secure-jwt-secret"
   ```

### 2. Backend Setup

1. **Install Dependencies**
   ```bash
   cd apps/api
   npm install
   ```

2. **Generate Prisma Client**
   ```bash
   npx prisma generate
   npx prisma db push
   ```

3. **Start API Server**
   ```bash
   npm run dev
   ```

### 3. Frontend Setup

1. **Install Dependencies**
   ```bash
   cd apps/web
   npm install
   ```

2. **Start Development Server**
   ```bash
   npm run dev
   ```

### 4. Integration with Express API (Optional)

If you want to use the full Express authentication system:

1. **Update your main API server** (`apps/api/src/index.js`):
   ```javascript
   const authRoutes = require('./auth/authRoutes');
   
   // Add auth routes
   app.use('/api/auth', authRoutes);
   ```

2. **Add authentication middleware** to protected routes:
   ```javascript
   const { authenticateToken, authorizeRoles } = require('./auth/authMiddleware');
   
   // Protect routes
   app.use('/api/protected', authenticateToken);
   app.use('/api/admin', authenticateToken, authorizeRoles('admin'));
   ```

## API Endpoints

### Authentication Routes

| Method | Endpoint | Description | Required Fields |
|--------|----------|-------------|-----------------|
| POST | `/api/auth/signup` | Register new user | email, password, role, name, company*, phone* |
| POST | `/api/auth/login` | User login | email, password |
| POST | `/api/auth/check-email` | Check email availability | email |
| POST | `/api/auth/verify` | Verify JWT token | token |
| GET | `/api/auth/roles` | Get available roles | - |
| POST | `/api/auth/logout` | User logout | - |

*Required only for customer role

### Example Requests

**Signup (Customer)**
```json
{
  "email": "customer@example.com",
  "password": "securepassword",
  "role": "customer",
  "name": "John Doe",
  "company": "ABC Corp",
  "phone": "+1234567890",
  "gstin": "optional-gstin"
}
```

**Signup (Other Roles)**
```json
{
  "email": "admin@example.com",
  "password": "securepassword",
  "role": "admin",
  "name": "Admin User"
}
```

**Login**
```json
{
  "email": "user@example.com",
  "password": "password"
}
```

## Error Handling

The system provides comprehensive error messages:

- ✅ **Email format validation**
- ✅ **Password strength requirements**
- ✅ **Duplicate email detection** with specific user type
- ✅ **Role validation**
- ✅ **Required field validation** (role-specific)

### Example Error Responses

**Duplicate Email**
```json
{
  "success": false,
  "message": "This email is already registered as a customer. Please use a different email or try logging in."
}
```

**Invalid Role**
```json
{
  "success": false,
  "message": "Invalid role. Valid roles are: admin, manager, supervisor, customer, rake_planner, yard"
}
```

## Frontend Components

### Signup Form (`/signup`)
- **Role selection** with dynamic field requirements
- **Real-time validation** with error display
- **Email availability checking**
- **Automatic redirect** to login after success

### Login Form (`/login`)
- **Simple email/password form**
- **Role-based dashboard redirect**
- **"Remember me" option**
- **Forgot password link** (placeholder)

## Role-based Redirects

After successful login, users are redirected based on their role:

| Role | Redirect Path |
|------|---------------|
| admin | `/admin/dashboard` |
| manager | `/manager/dashboard` |
| supervisor | `/supervisor/dashboard` |
| customer | `/customer/dashboard` |
| rake_planner | `/planner/dashboard` |
| yard | `/yard/dashboard` |

## Security Features

- **Password hashing** using bcrypt (salt rounds: 12)
- **JWT tokens** with 24-hour expiry
- **Row Level Security** enabled on all Supabase tables
- **Input validation** and sanitization
- **CORS protection**
- **Rate limiting** ready for implementation

## Testing

You can test the authentication system by:

1. **Navigate to** `http://localhost:3000/signup`
2. **Fill out the form** with different roles
3. **Check email validation** by trying duplicate emails
4. **Verify redirects** after successful signup/login

## Troubleshooting

### Common Issues

1. **Database Connection Error**
   - Verify Supabase credentials
   - Check if DATABASE_URL is correct
   - Ensure Supabase project is active

2. **Prisma Client Error**
   - Run `npx prisma generate`
   - Check if schema is up to date

3. **JWT Token Issues**
   - Verify JWT_SECRET is set
   - Check token expiry

### Development Tips

- Use Supabase Dashboard > Table Editor to view user data
- Check browser Network tab for API call details
- Use browser console for client-side debugging
- Check API server logs for backend issues

## Next Steps

1. **Implement password reset** functionality
2. **Add email verification** for new signups
3. **Implement session management** with refresh tokens
4. **Add user profile management**
5. **Implement role-based dashboard content**
6. **Add audit logging** for authentication events

## Files Created/Modified

### Database
- ✅ `apps/api/prisma/schema.prisma` - Updated with new roles and User fields
- ✅ `apps/api/prisma/supabase-schema.sql` - Complete SQL schema for Supabase

### Backend
- ✅ `apps/api/src/auth/AuthService.js` - Complete authentication service
- ✅ `apps/api/src/auth/authRoutes.js` - Express authentication routes
- ✅ `apps/api/src/auth/authMiddleware.js` - JWT and role-based middleware
- ✅ `apps/api/package.json` - Added bcrypt dependency

### Frontend
- ✅ `apps/web/src/components/auth/SignupForm.tsx` - Role-based signup form
- ✅ `apps/web/src/components/auth/LoginForm.tsx` - Login form with redirects
- ✅ `apps/web/src/app/signup/page.tsx` - Signup page
- ✅ `apps/web/src/app/login/page.tsx` - Login page
- ✅ `apps/web/src/app/api/auth/signup/route.ts` - Next.js API route for signup
- ✅ `apps/web/src/app/api/auth/login/route.ts` - Next.js API route for login
- ✅ `apps/web/src/app/api/auth/check-email/route.ts` - Email availability check

### Configuration
- ✅ `supabase.env.example` - Environment variables template
- ✅ `docker-compose.yml` - Removed local PostgreSQL (using Supabase)
- ✅ `SUPABASE_MIGRATION.md` - Migration guide
- ✅ `AUTHENTICATION_SETUP.md` - This setup guide