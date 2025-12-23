// migrate.js - Data migration from localStorage to Neon PostgreSQL
const fs = require('fs');
const { Pool } = require('pg');

// Connect to Neon
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_MCDA9Ppzm7Wi@ep-winter-pine-ahos0156-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    ssl: { rejectUnauthorized: false }
});

async function migrateData(jsonData) {
    try {
        await pool.query('BEGIN');
        
        // 1. Migrate teachers
        for (const teacher of jsonData.teachers) {
            const teacherResult = await pool.query(`
                INSERT INTO lesson_manager.teachers 
                (name, phone, email, teaching_allowance, transport_allowance, status, notes, date_joined)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING teacher_id
            `, [
                teacher.name,
                teacher.phone,
                teacher.email || '',
                teacher.teachingAllowance || 20000,
                teacher.transportAllowance || 12000,
                teacher.status || 'active',
                teacher.notes || '',
                teacher.dateJoined || new Date().toISOString().split('T')[0]
            ]);
            
            const teacherId = teacherResult.rows[0].teacher_id;
            
            // Migrate teacher subjects
            for (const subjectName of teacher.subjects || []) {
                let subjectResult = await pool.query(`
                    SELECT subject_id FROM lesson_manager.subjects 
                    WHERE subject_name = $1
                `, [subjectName]);
                
                let subjectId;
                if (subjectResult.rows.length === 0) {
                    subjectResult = await pool.query(`
                        INSERT INTO lesson_manager.subjects (subject_name)
                        VALUES ($1) RETURNING subject_id
                    `, [subjectName]);
                    subjectId = subjectResult.rows[0].subject_id;
                } else {
                    subjectId = subjectResult.rows[0].subject_id;
                }
                
                await pool.query(`
                    INSERT INTO lesson_manager.teacher_subjects (teacher_id, subject_id)
                    VALUES ($1, $2)
                    ON CONFLICT DO NOTHING
                `, [teacherId, subjectId]);
            }
        }
        
        // 2. Migrate timetable
        const currentYear = jsonData.currentYear || new Date().getFullYear();
        const currentWeek = jsonData.currentWeek || 1;
        
        for (const [dayIndex, lessons] of Object.entries(jsonData.timetable || {})) {
            for (const lesson of lessons) {
                if (lesson.isBreak) continue;
                
                // Get subject
                let subjectResult = await pool.query(`
                    SELECT subject_id FROM lesson_manager.subjects 
                    WHERE subject_name = $1
                `, [lesson.subject]);
                
                let subjectId = null;
                if (subjectResult.rows.length > 0) {
                    subjectId = subjectResult.rows[0].subject_id;
                }
                
                // Get teacher
                let teacherResult = await pool.query(`
                    SELECT teacher_id FROM lesson_manager.teachers 
                    WHERE name = $1 LIMIT 1
                `, [lesson.teacher]);
                
                let teacherId = null;
                if (teacherResult.rows.length > 0) {
                    teacherId = teacherResult.rows[0].teacher_id;
                }
                
                // Parse time
                const [startTime, endTime] = lesson.time.split('-');
                
                await pool.query(`
                    INSERT INTO lesson_manager.timetable 
                    (day_of_week, start_time, end_time, subject_id, teacher_id, 
                     is_break, week_number, academic_year)
                    VALUES ($1, $2, $3, $4, $5, false, $6, $7)
                `, [
                    parseInt(dayIndex),
                    startTime.trim(),
                    endTime.trim(),
                    subjectId,
                    teacherId,
                    currentWeek,
                    currentYear
                ]);
            }
        }
        
        await pool.query('COMMIT');
        console.log('Migration completed successfully!');
        
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Migration failed:', err);
        throw err;
    } finally {
        await pool.end();
    }
}

// Read your exported JSON file
const jsonData = JSON.parse(fs.readFileSync('exported-data.json', 'utf8'));
migrateData(jsonData).catch(console.error);
