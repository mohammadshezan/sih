# Supabase Migration Guide

## Steps to migrate from local PostgreSQL to Supabase

### 1. Create a Supabase Project
1. Go to [supabase.com](https://supabase.com)
2. Sign up/Login and create a new project
3. Choose a database password and region
4. Wait for the project to be provisioned

### 2. Get your Supabase credentials
From your Supabase dashboard:
1. Go to Settings > API
2. Copy your `Project URL` and `anon` key
3. Go to Settings > Database
4. Copy your database connection string

### 3. Set up your environment variables
1. Copy `supabase.env.example` to `.env` in your API directory
2. Replace the placeholder values with your actual Supabase credentials:
   - `[YOUR-PROJECT-REF]` with your project reference ID
   - `[YOUR-PASSWORD]` with your database password
   - `[YOUR-ANON-KEY]` with your anon key
   - `[YOUR-SERVICE-ROLE-KEY]` with your service role key

### 4. Run the SQL schema in Supabase
1. Open Supabase Dashboard > SQL Editor
2. Copy and paste the content of `supabase-schema.sql`
3. Click "Run" to execute the schema

### 5. Update your Prisma configuration
The Prisma schema has already been updated to work with Supabase:
- Added `directUrl` for connection pooling
- Kept PostgreSQL as the provider (Supabase uses PostgreSQL)

### 6. Generate Prisma client and migrate
```bash
cd apps/api
npx prisma generate
npx prisma db push
```

### 7. Update your docker-compose.yml
The local PostgreSQL service has been removed from docker-compose.yml since you'll be using Supabase.

### 8. Install Supabase client (if needed)
If you want to use Supabase auth and real-time features:
```bash
npm install @supabase/supabase-js
```

### 9. Test the connection
Run your API server and test if it connects to Supabase successfully.

## Additional Configuration

### Row Level Security (RLS)
The SQL schema includes basic RLS policies. You may need to customize these based on your authentication strategy.

### Real-time subscriptions
If you want to use Supabase real-time features, you can enable them for specific tables in the Supabase dashboard.

### Backups
Supabase automatically backs up your database. You can also set up additional backup strategies if needed.

## Troubleshooting

### Connection issues
- Make sure your DATABASE_URL is correct
- Check if your IP is allowed (Supabase allows all IPs by default)
- Verify your database password

### SSL issues
- Supabase requires SSL connections
- Make sure your connection string includes `sslmode=require`

### Migration issues
- If you have existing data, export it first using pg_dump
- Import the data after running the schema SQL