// server.js - Home Lesson Management System Backend
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
        
        // Create tables if they don't exist
        await pool.query(`
            -- Teachers table
            CREATE TABLE IF NOT EXISTS teachers (
                teacher_id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                phone VARCHAR(20) NOT NULL,
                email VARCHAR(100),
                teaching_allowance INTEGER DEFAULT 20000,
                transport_allowance INTEGER DEFAULT 12000,
                status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'on-leave')),
                date_joined DATE DEFAULT CURRENT_DATE,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Subjects table
            CREATE TABLE IF NOT EXISTS subjects (
                subject_id SERIAL PRIMARY KEY,
                subject_name VARCHAR(50) UNIQUE NOT NULL,
                description TEXT
            );

            -- Teacher-Subject assignments
            CREATE TABLE IF NOT EXISTS teacher_subjects (
                assignment_id SERIAL PRIMARY KEY,
                teacher_id INTEGER REFERENCES teachers(teacher_id) ON DELETE CASCADE,
                subject_id INTEGER REFERENCES subjects(subject_id) ON DELETE CASCADE,
                is_primary BOOLEAN DEFAULT true,
                assigned_date DATE DEFAULT CURRENT_DATE,
                UNIQUE(teacher_id, subject_id)
            );

            -- Weekly timetable
            CREATE TABLE IF NOT EXISTS timetable (
                timetable_id SERIAL PRIMARY KEY,
                day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                subject_id INTEGER REFERENCES subjects(subject_id),
                teacher_id INTEGER REFERENCES teachers(teacher_id),
                is_break BOOLEAN DEFAULT false,
                break_description VARCHAR(50),
                week_number INTEGER,
                academic_year INTEGER,
                UNIQUE(day_of_week, start_time, week_number, academic_year)
            );

            -- Attendance records
            CREATE TABLE IF NOT EXISTS attendance (
                attendance_id SERIAL PRIMARY KEY,
                timetable_id INTEGER REFERENCES timetable(timetable_id),
                teacher_id INTEGER REFERENCES teachers(teacher_id),
                attendance_date DATE NOT NULL,
                status VARCHAR(20) NOT NULL CHECK (status IN ('present', 'absent', 'late', 'partial')),
                recorded_time TIME,
                notes TEXT,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                week_number INTEGER,
                academic_year INTEGER
            );

            -- Weekly payroll records
            CREATE TABLE IF NOT EXISTS payroll_weekly (
                payroll_id SERIAL PRIMARY KEY,
                teacher_id INTEGER REFERENCES teachers(teacher_id),
                week_number INTEGER NOT NULL,
                academic_year INTEGER NOT NULL,
                teaching_allowance INTEGER DEFAULT 0,
                transport_allowance INTEGER DEFAULT 0,
                bonus INTEGER DEFAULT 0,
                deduction INTEGER DEFAULT 0,
                total_amount INTEGER DEFAULT 0,
                payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'processed')),
                payment_date DATE,
                processed_date TIMESTAMP,
                processed_by VARCHAR(100),
                UNIQUE(teacher_id, week_number, academic_year)
            );

            -- Payment transactions
            CREATE TABLE IF NOT EXISTS payment_transactions (
                transaction_id SERIAL PRIMARY KEY,
                teacher_id INTEGER REFERENCES teachers(teacher_id),
                payroll_id INTEGER REFERENCES payroll_weekly(payroll_id),
                amount INTEGER NOT NULL,
                payment_type VARCHAR(30) CHECK (payment_type IN ('teaching_allowance', 'transport_allowance', 'bonus', 'deduction', 'advance')),
                payment_date DATE NOT NULL,
                scheduled_day INTEGER CHECK (scheduled_day BETWEEN 0 AND 6),
                actual_payment_date DATE,
                reference_number VARCHAR(50),
                payment_method VARCHAR(30),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- System configuration
            CREATE TABLE IF NOT EXISTS system_config (
                config_id SERIAL PRIMARY KEY,
                config_key VARCHAR(50) UNIQUE NOT NULL,
                config_value TEXT NOT NULL,
                data_type VARCHAR(20) DEFAULT 'string',
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Payment schedule configuration
            CREATE TABLE IF NOT EXISTS payment_schedule (
                schedule_id SERIAL PRIMARY KEY,
                payment_type VARCHAR(30) NOT NULL,
                scheduled_day INTEGER NOT NULL CHECK (scheduled_day BETWEEN 0 AND 6),
                amount INTEGER NOT NULL,
                is_active BOOLEAN DEFAULT true,
                effective_from DATE DEFAULT CURRENT_DATE,
                effective_to DATE,
                description TEXT
            );
        `);

        // Insert default data
        await pool.query(`
            -- Insert default subjects
            INSERT INTO subjects (subject_name) VALUES
                ('Mathematics'), ('Physics'), ('Chemistry'), ('English'),
                ('Chichewa'), ('Geography'), ('Biology')
            ON CONFLICT (subject_name) DO NOTHING;

            -- Insert default configuration
            INSERT INTO system_config (config_key, config_value, data_type, description) VALUES
                ('teaching_allowance', '20000', 'integer', 'Weekly teaching allowance in MWK'),
                ('transport_allowance', '12000', 'integer', 'Weekly transport allowance in MWK'),
                ('transport_payment_day', '0', 'integer', '0=Sunday transport payment day'),
                ('weekly_payment_day', '5', 'integer', '5=Friday weekly payment day'),
                ('currency', 'MWK', 'string', 'Currency used in the system'),
                ('auto_save_frequency', '5', 'integer', 'Auto-save frequency in minutes'),
                ('system_version', '2.0', 'string', 'Current system version')
            ON CONFLICT (config_key) DO NOTHING;

            -- Insert default payment schedule
            INSERT INTO payment_schedule (payment_type, scheduled_day, amount, description) VALUES
                ('transport_allowance', 0, 12000, 'Sunday transport payments'),
                ('teaching_allowance', 5, 20000, 'Friday weekly teaching payments')
            ON CONFLICT DO NOTHING;
        `);

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

// API Routes

// 1. TEACHERS ENDPOINTS
app.get('/api/teachers', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, 
                   array_agg(s.subject_name) as subjects
            FROM teachers t
            LEFT JOIN teacher_subjects ts ON t.teacher_id = ts.teacher_id
            LEFT JOIN subjects s ON ts.subject_id = s.subject_id
            GROUP BY t.teacher_id
            ORDER BY t.name
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching teachers:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/teachers', async (req, res) => {
    const { name, phone, email, subjects, teaching_allowance, transport_allowance, status, notes } = req.body;
    
    try {
        const result = await pool.query(
            `INSERT INTO teachers (name, phone, email, teaching_allowance, transport_allowance, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [name, phone, email, teaching_allowance || 20000, transport_allowance || 12000, status || 'active', notes || '']
        );
        
        const teacherId = result.rows[0].teacher_id;
        
        // Assign subjects
        if (subjects && subjects.length > 0) {
            for (const subjectName of subjects) {
                const subjectResult = await pool.query(
                    'SELECT subject_id FROM subjects WHERE subject_name = $1',
                    [subjectName]
                );
                
                if (subjectResult.rows.length > 0) {
                    await pool.query(
                        'INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ($1, $2)',
                        [teacherId, subjectResult.rows[0].subject_id]
                    );
                }
            }
        }
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating teacher:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 2. ATTENDANCE ENDPOINTS
app.get('/api/attendance/week/:week', async (req, res) => {
    const { week } = req.params;
    const { year } = req.query;
    
    try {
        const result = await pool.query(`
            SELECT a.*, t.name as teacher_name, s.subject_name, tt.start_time, tt.end_time
            FROM attendance a
            JOIN teachers t ON a.teacher_id = t.teacher_id
            JOIN timetable tt ON a.timetable_id = tt.timetable_id
            JOIN subjects s ON tt.subject_id = s.subject_id
            WHERE a.week_number = $1 AND a.academic_year = $2
            ORDER BY a.attendance_date, tt.start_time
        `, [week, year || new Date().getFullYear()]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching attendance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/attendance', async (req, res) => {
    const { timetable_id, teacher_id, attendance_date, status, recorded_time, notes, week_number, academic_year } = req.body;
    
    try {
        const result = await pool.query(
            `INSERT INTO attendance (timetable_id, teacher_id, attendance_date, status, recorded_time, notes, week_number, academic_year)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [timetable_id, teacher_id, attendance_date, status, recorded_time, notes, week_number, academic_year || new Date().getFullYear()]
        );
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error saving attendance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 3. PAYROLL ENDPOINTS
app.get('/api/payroll/week/:week', async (req, res) => {
    const { week } = req.params;
    const { year } = req.query;
    
    try {
        const result = await pool.query(`
            SELECT p.*, t.name as teacher_name
            FROM payroll_weekly p
            JOIN teachers t ON p.teacher_id = t.teacher_id
            WHERE p.week_number = $1 AND p.academic_year = $2
            ORDER BY t.name
        `, [week, year || new Date().getFullYear()]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching payroll:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Process transport payments (Sundays)
app.post('/api/payroll/process/transport', async (req, res) => {
    const { week_number, academic_year } = req.body;
    const currentYear = academic_year || new Date().getFullYear();
    
    try {
        const today = new Date();
        const currentDay = today.getDay(); // 0 = Sunday
        
        if (currentDay !== 0) {
            return res.status(400).json({ 
                error: 'Transport payments can only be processed on Sundays' 
            });
        }
        
        await pool.query('BEGIN');
        
        // Get active teachers with attendance this week
        const teachersResult = await pool.query(`
            SELECT DISTINCT a.teacher_id
            FROM attendance a
            JOIN teachers t ON a.teacher_id = t.teacher_id
            WHERE a.week_number = $1 AND a.academic_year = $2
            AND a.status IN ('present', 'late', 'partial')
            AND t.status = 'active'
        `, [week_number, currentYear]);
        
        for (const row of teachersResult.rows) {
            const teacherId = row.teacher_id;
            
            // Get teacher's transport allowance amount
            const teacherResult = await pool.query(
                'SELECT transport_allowance FROM teachers WHERE teacher_id = $1',
                [teacherId]
            );
            
            const transportAmount = teacherResult.rows[0].transport_allowance;
            
            // Update or insert payroll record
            await pool.query(`
                INSERT INTO payroll_weekly (teacher_id, week_number, academic_year, transport_allowance, payment_status)
                VALUES ($1, $2, $3, $4, 'processed')
                ON CONFLICT (teacher_id, week_number, academic_year) 
                DO UPDATE SET 
                    transport_allowance = EXCLUDED.transport_allowance,
                    payment_status = 'processed',
                    processed_date = CURRENT_TIMESTAMP
            `, [teacherId, week_number, currentYear, transportAmount]);
            
            // Record transaction
            await pool.query(`
                INSERT INTO payment_transactions 
                (teacher_id, amount, payment_type, payment_date, scheduled_day, reference_number)
                VALUES ($1, $2, 'transport_allowance', CURRENT_DATE, 0, 
                        CONCAT('TRANS-', $1, '-W', $3, '-', EXTRACT(EPOCH FROM NOW())::INT))
            `, [teacherId, transportAmount, week_number]);
        }
        
        await pool.query('COMMIT');
        
        const totalResult = await pool.query(`
            SELECT SUM(transport_allowance) as total_amount, COUNT(*) as teacher_count
            FROM payroll_weekly
            WHERE week_number = $1 AND academic_year = $2
        `, [week_number, currentYear]);
        
        res.json({
            message: 'Transport payments processed successfully',
            total_amount: totalResult.rows[0].total_amount,
            teacher_count: totalResult.rows[0].teacher_count,
            payment_date: today.toISOString().split('T')[0]
        });
        
    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Error processing transport payments:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Process weekly teaching payments (Fridays)
app.post('/api/payroll/process/weekly', async (req, res) => {
    const { week_number, academic_year } = req.body;
    const currentYear = academic_year || new Date().getFullYear();
    
    try {
        const today = new Date();
        const currentDay = today.getDay(); // 5 = Friday
        
        if (currentDay !== 5) {
            return res.status(400).json({ 
                error: 'Weekly payments can only be processed on Fridays' 
            });
        }
        
        await pool.query('BEGIN');
        
        // Get active teachers with attendance this week
        const teachersResult = await pool.query(`
            SELECT DISTINCT a.teacher_id
            FROM attendance a
            JOIN teachers t ON a.teacher_id = t.teacher_id
            WHERE a.week_number = $1 AND a.academic_year = $2
            AND a.status IN ('present', 'late', 'partial')
            AND t.status = 'active'
        `, [week_number, currentYear]);
        
        for (const row of teachersResult.rows) {
            const teacherId = row.teacher_id;
            
            // Get teacher's teaching allowance amount
            const teacherResult = await pool.query(
                'SELECT teaching_allowance FROM teachers WHERE teacher_id = $1',
                [teacherId]
            );
            
            const teachingAmount = teacherResult.rows[0].teaching_allowance;
            
            // Update or insert payroll record
            await pool.query(`
                INSERT INTO payroll_weekly (teacher_id, week_number, academic_year, teaching_allowance, payment_status)
                VALUES ($1, $2, $3, $4, 'processed')
                ON CONFLICT (teacher_id, week_number, academic_year) 
                DO UPDATE SET 
                    teaching_allowance = EXCLUDED.teaching_allowance,
                    payment_status = 'processed',
                    processed_date = CURRENT_TIMESTAMP
            `, [teacherId, week_number, currentYear, teachingAmount]);
            
            // Record transaction
            await pool.query(`
                INSERT INTO payment_transactions 
                (teacher_id, amount, payment_type, payment_date, scheduled_day, reference_number)
                VALUES ($1, $2, 'teaching_allowance', CURRENT_DATE, 5, 
                        CONCAT('TEACH-', $1, '-W', $3, '-', EXTRACT(EPOCH FROM NOW())::INT))
            `, [teacherId, teachingAmount, week_number]);
        }
        
        await pool.query('COMMIT');
        
        const totalResult = await pool.query(`
            SELECT SUM(teaching_allowance) as total_amount, COUNT(*) as teacher_count
            FROM payroll_weekly
            WHERE week_number = $1 AND academic_year = $2
        `, [week_number, currentYear]);
        
        res.json({
            message: 'Weekly teaching payments processed successfully',
            total_amount: totalResult.rows[0].total_amount,
            teacher_count: totalResult.rows[0].teacher_count,
            payment_date: today.toISOString().split('T')[0]
        });
        
    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Error processing weekly payments:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 4. TIMETABLE ENDPOINTS
app.get('/api/timetable/week/:week', async (req, res) => {
    const { week } = req.params;
    const { year } = req.query;
    
    try {
        const result = await pool.query(`
            SELECT tt.*, t.name as teacher_name, s.subject_name,
                   CASE tt.day_of_week 
                       WHEN 0 THEN 'Sunday'
                       WHEN 1 THEN 'Monday'
                       WHEN 2 THEN 'Tuesday'
                       WHEN 3 THEN 'Wednesday'
                       WHEN 4 THEN 'Thursday'
                       WHEN 5 THEN 'Friday'
                       WHEN 6 THEN 'Saturday'
                   END as day_name
            FROM timetable tt
            LEFT JOIN teachers t ON tt.teacher_id = t.teacher_id
            LEFT JOIN subjects s ON tt.subject_id = s.subject_id
            WHERE tt.week_number = $1 AND tt.academic_year = $2
            ORDER BY tt.day_of_week, tt.start_time
        `, [week, year || new Date().getFullYear()]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching timetable:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 5. PAYMENT TRANSACTIONS
app.get('/api/transactions', async (req, res) => {
    const { start_date, end_date, teacher_id } = req.query;
    
    try {
        let query = `
            SELECT pt.*, t.name as teacher_name
            FROM payment_transactions pt
            JOIN teachers t ON pt.teacher_id = t.teacher_id
            WHERE 1=1
        `;
        const params = [];
        
        if (start_date) {
            params.push(start_date);
            query += ` AND pt.payment_date >= $${params.length}`;
        }
        
        if (end_date) {
            params.push(end_date);
            query += ` AND pt.payment_date <= $${params.length}`;
        }
        
        if (teacher_id) {
            params.push(teacher_id);
            query += ` AND pt.teacher_id = $${params.length}`;
        }
        
        query += ` ORDER BY pt.payment_date DESC LIMIT 100`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 6. DASHBOARD STATISTICS
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const currentWeek = Math.ceil((new Date().getDate() - new Date(new Date().getFullYear(), 0, 1).getDate() + 1) / 7);
        const currentYear = new Date().getFullYear();
        
        // Get active teachers count
        const teachersResult = await pool.query(
            "SELECT COUNT(*) as count FROM teachers WHERE status = 'active'"
        );
        
        // Get weekly payroll total
        const payrollResult = await pool.query(
            `SELECT COALESCE(SUM(total_amount), 0) as total 
             FROM payroll_weekly 
             WHERE week_number = $1 AND academic_year = $2`,
            [currentWeek, currentYear]
        );
        
        // Get attendance rate
        const attendanceResult = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END), 0) as present,
                COALESCE(SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END), 0) as absent,
                COALESCE(COUNT(*), 0) as total
            FROM attendance 
            WHERE week_number = $1 AND academic_year = $2
        `, [currentWeek, currentYear]);
        
        // Get lessons count
        const lessonsResult = await pool.query(
            `SELECT COUNT(*) as count FROM timetable 
             WHERE week_number = $1 AND academic_year = $2 AND is_break = false`,
            [currentWeek, currentYear]
        );
        
        const stats = {
            active_teachers: parseInt(teachersResult.rows[0].count),
            weekly_payroll: parseInt(payrollResult.rows[0].total),
            attendance_rate: attendanceResult.rows[0].total > 0 ? 
                Math.round((attendanceResult.rows[0].present / attendanceResult.rows[0].total) * 100) : 0,
            weekly_lessons: parseInt(lessonsResult.rows[0].count),
            current_week: currentWeek,
            current_year: currentYear
        };
        
        res.json(stats);
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 7. CONFIGURATION ENDPOINTS
app.get('/api/config', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM system_config ORDER BY config_key');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching config:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ 
            status: 'healthy', 
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'unhealthy', 
            database: 'disconnected',
            error: error.message 
        });
    }
});

// Serve static files (for your frontend)
app.use(express.static('public'));

// Default route
app.get('/', (req, res) => {
    res.send('Home Lesson Management System API');
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
