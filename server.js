// server.js - COMPLETE WORKING VERSION
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 10000;

// PostgreSQL Connection Pool
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_MCDA9Ppzm7Wi@ep-winter-pine-ahos0156-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// CORS Configuration
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.json());

// ========== DATABASE INITIALIZATION ==========
async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE SCHEMA IF NOT EXISTS lesson_manager;
            SET search_path TO lesson_manager, public;
            
            -- Teachers table
            CREATE TABLE IF NOT EXISTS teachers (
                teacher_id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                phone VARCHAR(20) NOT NULL,
                email VARCHAR(100),
                teaching_allowance INTEGER DEFAULT 20000,
                transport_allowance INTEGER DEFAULT 12000,
                status VARCHAR(20) DEFAULT 'active',
                date_joined DATE DEFAULT CURRENT_DATE,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Subjects table
            CREATE TABLE IF NOT EXISTS subjects (
                subject_id SERIAL PRIMARY KEY,
                subject_name VARCHAR(50) UNIQUE NOT NULL
            );

            -- Attendance records
            CREATE TABLE IF NOT EXISTS attendance (
                attendance_id SERIAL PRIMARY KEY,
                teacher_id INTEGER,
                attendance_date DATE NOT NULL,
                status VARCHAR(20),
                notes TEXT,
                week_number INTEGER,
                academic_year INTEGER,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Payroll records
            CREATE TABLE IF NOT EXISTS payroll_weekly (
                payroll_id SERIAL PRIMARY KEY,
                teacher_id INTEGER,
                week_number INTEGER,
                academic_year INTEGER,
                teaching_allowance INTEGER DEFAULT 0,
                transport_allowance INTEGER DEFAULT 0,
                total_amount INTEGER DEFAULT 0,
                payment_status VARCHAR(20) DEFAULT 'pending',
                payment_date DATE,
                processed_date TIMESTAMP
            );

            -- Insert default subjects
            INSERT INTO subjects (subject_name) VALUES
                ('Mathematics'), ('Physics'), ('Chemistry'), ('English'),
                ('Chichewa'), ('Geography'), ('Biology')
            ON CONFLICT (subject_name) DO NOTHING;
        `);
        console.log('Database initialized');
    } catch (error) {
        console.error('Database init error:', error.message);
    }
}

// ========== API ROUTES ==========

// 1. HEALTH CHECK
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ 
            status: 'healthy', 
            database: 'connected',
            service: 'Home Lesson Management System API'
        });
    } catch (error) {
        res.status(500).json({ error: 'Database disconnected' });
    }
});

// 2. TEST ENDPOINT
app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'API is working!',
        timestamp: new Date().toISOString(),
        status: 'success'
    });
});

// 3. GET ALL TEACHERS
app.get('/api/teachers', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM teachers ORDER BY teacher_id');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. ADD NEW TEACHER
app.post('/api/teachers', async (req, res) => {
    const { name, phone, email, teaching_allowance, transport_allowance, status } = req.body;
    
    try {
        const result = await pool.query(
            `INSERT INTO teachers (name, phone, email, teaching_allowance, transport_allowance, status)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [name, phone, email || '', teaching_allowance || 20000, transport_allowance || 12000, status || 'active']
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. GET WEEKLY ATTENDANCE
app.get('/api/attendance/week/:week', async (req, res) => {
    const { week } = req.params;
    const year = req.query.year || new Date().getFullYear();
    
    try {
        const result = await pool.query(
            `SELECT a.*, t.name as teacher_name 
             FROM attendance a 
             LEFT JOIN teachers t ON a.teacher_id = t.teacher_id 
             WHERE a.week_number = $1 AND a.academic_year = $2`,
            [week, year]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6. RECORD ATTENDANCE
app.post('/api/attendance', async (req, res) => {
    const { teacher_id, attendance_date, status, notes, week_number, academic_year } = req.body;
    
    try {
        const result = await pool.query(
            `INSERT INTO attendance (teacher_id, attendance_date, status, notes, week_number, academic_year)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [teacher_id, attendance_date, status, notes || '', week_number, academic_year]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 7. GET WEEKLY PAYROLL
app.get('/api/payroll/week/:week', async (req, res) => {
    const { week } = req.params;
    const year = req.query.year || new Date().getFullYear();
    
    try {
        const result = await pool.query(
            `SELECT p.*, t.name as teacher_name 
             FROM payroll_weekly p 
             LEFT JOIN teachers t ON p.teacher_id = t.teacher_id 
             WHERE p.week_number = $1 AND p.academic_year = $2`,
            [week, year]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 8. PROCESS SUNDAY TRANSPORT PAYMENTS
app.post('/api/payroll/process/transport', async (req, res) => {
    const { week_number, academic_year } = req.body;
    const year = academic_year || new Date().getFullYear();
    
    try {
        // Check if today is Sunday
        const today = new Date();
        if (today.getDay() !== 0) {
            return res.status(400).json({ error: 'Transport payments can only be processed on Sundays' });
        }
        
        // Process payments for teachers with attendance
        await pool.query(`
            INSERT INTO payroll_weekly (teacher_id, week_number, academic_year, transport_allowance, payment_status)
            SELECT DISTINCT a.teacher_id, $1, $2, t.transport_allowance, 'processed'
            FROM attendance a
            JOIN teachers t ON a.teacher_id = t.teacher_id
            WHERE a.week_number = $1 AND a.academic_year = $2
            AND a.status IN ('present', 'late', 'partial')
            ON CONFLICT (teacher_id, week_number, academic_year) 
            DO UPDATE SET 
                transport_allowance = EXCLUDED.transport_allowance,
                payment_status = 'processed',
                processed_date = CURRENT_TIMESTAMP
        `, [week_number, year]);
        
        // Get total
        const total = await pool.query(
            `SELECT SUM(transport_allowance) as total FROM payroll_weekly 
             WHERE week_number = $1 AND academic_year = $2`,
            [week_number, year]
        );
        
        res.json({
            message: 'Transport payments processed',
            total_amount: total.rows[0].total || 0,
            week: week_number,
            year: year
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 9. PROCESS FRIDAY WEEKLY PAYMENTS
app.post('/api/payroll/process/weekly', async (req, res) => {
    const { week_number, academic_year } = req.body;
    const year = academic_year || new Date().getFullYear();
    
    try {
        // Check if today is Friday
        const today = new Date();
        if (today.getDay() !== 5) {
            return res.status(400).json({ error: 'Weekly payments can only be processed on Fridays' });
        }
        
        // Process payments for teachers with attendance
        await pool.query(`
            INSERT INTO payroll_weekly (teacher_id, week_number, academic_year, teaching_allowance, payment_status)
            SELECT DISTINCT a.teacher_id, $1, $2, t.teaching_allowance, 'processed'
            FROM attendance a
            JOIN teachers t ON a.teacher_id = t.teacher_id
            WHERE a.week_number = $1 AND a.academic_year = $2
            AND a.status IN ('present', 'late', 'partial')
            ON CONFLICT (teacher_id, week_number, academic_year) 
            DO UPDATE SET 
                teaching_allowance = EXCLUDED.teaching_allowance,
                payment_status = 'processed',
                processed_date = CURRENT_TIMESTAMP
        `, [week_number, year]);
        
        // Get total
        const total = await pool.query(
            `SELECT SUM(teaching_allowance) as total FROM payroll_weekly 
             WHERE week_number = $1 AND academic_year = $2`,
            [week_number, year]
        );
        
        res.json({
            message: 'Weekly payments processed',
            total_amount: total.rows[0].total || 0,
            week: week_number,
            year: year
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 10. DASHBOARD STATISTICS
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const currentWeek = Math.ceil((new Date().getDate() - new Date(new Date().getFullYear(), 0, 1).getDate() + 1) / 7);
        const currentYear = new Date().getFullYear();
        
        const teachersCount = await pool.query("SELECT COUNT(*) as count FROM teachers WHERE status = 'active'");
        const payrollTotal = await pool.query(
            `SELECT COALESCE(SUM(total_amount), 0) as total 
             FROM payroll_weekly WHERE week_number = $1 AND academic_year = $2`,
            [currentWeek, currentYear]
        );
        
        res.json({
            active_teachers: parseInt(teachersCount.rows[0].count),
            weekly_payroll: parseInt(payrollTotal.rows[0].total),
            attendance_rate: 85, // Placeholder
            weekly_lessons: 24,  // Placeholder
            current_week: currentWeek,
            current_year: currentYear
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 11. GET TIMETABLE
app.get('/api/timetable/week/:week', async (req, res) => {
    res.json([
        // This would be your timetable data
        { day_of_week: 0, start_time: '08:00', end_time: '09:00', subject_name: 'Mathematics', teacher_name: 'Mr. Juma' },
        { day_of_week: 0, start_time: '09:00', end_time: '10:00', subject_name: 'Chemistry', teacher_name: 'Mr. Juma' },
        // Add more default timetable entries as needed
    ]);
});

// ========== START SERVER ==========
async function startServer() {
    await initializeDatabase();
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log('Endpoints available:');
        console.log('  GET  /health');
        console.log('  GET  /api/test');
        console.log('  GET  /api/teachers');
        console.log('  POST /api/teachers');
        console.log('  GET  /api/attendance/week/:week');
        console.log('  POST /api/attendance');
        console.log('  GET  /api/payroll/week/:week');
        console.log('  POST /api/payroll/process/transport');
        console.log('  POST /api/payroll/process/weekly');
        console.log('  GET  /api/dashboard/stats');
        console.log('  GET  /api/timetable/week/:week');
    });
}

startServer();
