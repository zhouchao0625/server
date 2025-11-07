# Studious Backend Server

This is the backend server for the Studious application. It provides a RESTful and real-time API for managing users, classes, assignments, attendance, and more, supporting both HTTP (via tRPC) and WebSocket (via Socket.IO) communication.

## Features

- **Express.js** server with CORS support
- **tRPC** for type-safe API endpoints
- **Socket.IO** for real-time features
- **Prisma ORM** with PostgreSQL for database management
- **User authentication** and session management
- **Class, assignment, attendance, and file management**
- **Structured logging** for requests and server events

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- npm (v9+ recommended)
- PostgreSQL database

### Installation

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd server
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   Create a `.env` file in the root directory with the following variables:
   ```env
   DATABASE_URL="postgresql://username:password@localhost:5432/easy_lms"
   PORT=3001
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   NODE_ENV=development
   LOG_MODE=info
   ```

4. **Set up the database:**
   - Create a PostgreSQL database named `easy_lms`
   - Run the Prisma migrations:
     ```bash
     npx prisma migrate dev --name init
     ```
   - Generate the Prisma client:
     ```bash
     npx prisma generate
     ```

### Running the Server

- **Development mode (with hot reload):**
  ```bash
  npm run dev
  ```

- **Production build:**
  ```bash
  npm run build
  npm start
  ```

The server will start on the port specified in your `.env` file (default: `3001`).

## API Overview

- **tRPC endpoints:** Available at `/trpc`
- **WebSocket:** Available at `/socket.io/`
- **CORS:** Configured to allow requests from the frontend app URL via `NEXT_PUBLIC_APP_URL`

## Project Structure

```
src/
  index.ts         # Main server entry point
  routers/         # tRPC routers for API endpoints
  socket/          # Socket.IO event handlers
  middleware/      # Express and tRPC middleware
  utils/           # Utility functions (e.g., logger)
  lib/             # Shared libraries
  types/           # TypeScript types
prisma/
  schema.prisma    # Prisma database schema
  migrations/      # Database migrations
```

## Database

- **Database:** PostgreSQL
- **ORM:** Prisma
- **Schema:** Defined in `prisma/schema.prisma`
- **Migrations:** Stored in `prisma/migrations/`

### Database Commands

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Reset database
npx prisma migrate reset

# Open Prisma Studio (database GUI)
npx prisma studio
```

## Scripts

- `npm run dev` — Start in development mode with hot reload
- `npm run build` — Compile TypeScript to JavaScript
- `npm start` — Start the compiled server

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `PORT` | Server port | 3001 |
| `NEXT_PUBLIC_APP_URL` | Frontend app URL for CORS | http://localhost:3000 |
| `NODE_ENV` | Environment mode | development |
| `LOG_MODE` | Logging level | info |

## Development

The server uses TypeScript and includes:
- **tRPC** for type-safe API development
- **Socket.IO** for real-time communication
- **Prisma** for database operations
- **Express** middleware for CORS and logging

## License

[MIT](LICENSE.txt)