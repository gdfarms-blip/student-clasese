// server.js - Home Lesson Management System Backend (CORS FIXED)
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 10000;

// PostgreSQL Connection Pool with your Neon connection string
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_MCDA9Ppzm7Wi@ep-winter-pine-ahos0156-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Test database connection
pool.on('connect', () => {
    console.log('Connected to Neon PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// ==================== CORS CONFIGURATION ====================
// Allow all origins for development (you can restrict in production)
const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200,
    preflightContinue: false
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests for all routes
app.options('*', cors(corsOptions));

// Other middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==================== MANUAL CORS HEADERS ====================
// Add CORS headers to all responses
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
});

// Initialize database tables if they don't exist
async function initializeDatabase() {
    try {
        // Check if schema exists
        await pool.query(`
            CREATE SCHEMA IF NOT EXISTS lesson_manager;
        `);
        
        // Set search path
        await pool.query(`
            SET search_path TO lesson_manager, public;
        `);
        
        // Create tables if they don't exist (same as before)
        // [Keep all your existing table creation code here]
        // Make sure it matches what you had in your original server.js
        
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

// ==================== API ROUTES ====================
// (Keep all your existing API route code here - teachers, attendance, payroll, etc.)
// Make sure all routes start with /api/

// Example: Health check endpoint
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ 
            status: 'healthy', 
            database: 'connected',
            timestamp: new Date().toISOString(),
            message: 'Home Lesson Management System API',
            version: '2.0.0'
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'unhealthy', 
            database: 'disconnected',
            error: error.message 
        });
    }
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'API is working!',
        timestamp: new Date().toISOString(),
        endpoints: [
            '/api/teachers',
            '/api/attendance/week/:week',
            '/api/payroll/week/:week',
            '/api/dashboard/stats',
            '/health'
        ]
    });
});

// Default route
app.get('/', (req, res) => {
    res.json({ 
        message: 'Home Lesson Management System API',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
            teachers: '/api/teachers',
            attendance: '/api/attendance/week/:week',
            payroll: '/api/payroll/week/:week',
            dashboard: '/api/dashboard/stats',
            health: '/health',
            test: '/api/test'
        },
        documentation: 'See API endpoints above'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server Error:', err.stack);
    res.status(500).json({ 
        error: 'Internal server error',
        message: err.message,
        timestamp: new Date().toISOString()
    });
});

// Handle 404 errors
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found',
        requested: req.originalUrl,
        timestamp: new Date().toISOString(),
        availableEndpoints: [
            '/api/teachers',
            '/api/attendance/week/:week',
            '/api/payroll/week/:week',
            '/api/dashboard/stats',
            '/health',
            '/api/test'
        ]
    });
});

// Start server
async function startServer() {
    try {
        // Initialize database
        await initializeDatabase();
        
        // Start Express server
        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
            console.log('API Endpoints:');
            console.log(`  GET  /api/teachers              - Get all teachers`);
            console.log(`  POST /api/teachers              - Add new teacher`);
            console.log(`  GET  /api/attendance/week/:week - Get weekly attendance`);
            console.log(`  POST /api/attendance            - Record attendance`);
            console.log(`  GET  /api/payroll/week/:week    - Get weekly payroll`);
            console.log(`  POST /api/payroll/process/transport - Process Sunday transport payments`);
            console.log(`  POST /api/payroll/process/weekly   - Process Friday weekly payments`);
            console.log(`  GET  /api/timetable/week/:week  - Get weekly timetable`);
            console.log(`  GET  /api/dashboard/stats       - Get dashboard statistics`);
            console.log(`  GET  /health                    - Health check`);
            console.log(`  GET  /api/test                  - Test endpoint`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully');
    await pool.end();
    process.exit(0);
});

// Start the server
startServer();
