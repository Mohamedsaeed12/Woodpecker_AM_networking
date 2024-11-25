require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const cors = require('cors');
const fs = require('fs').promises;
const sqlite3 = require('sqlite3').verbose();
const moment = require('moment');

const app = express();
const port = 5500;

// JSON Files for user and schedule management
const USERS_FILE = path.join(__dirname, 'config', 'users.json');
const SCHEDULES_FILE = path.join(__dirname, 'config', 'schedules.json');

// SQLite Database Connection
const db = new sqlite3.Database('./reservations.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database');
    }
});

// Relay states
const relayStates = {
    brake: false,
    steering1: false,
    steering2: false,
    mcm: false,
    tcm: false,
    lscm: false,
    power: false,
    canhat: false,
};

// Initialize SQLite tables
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            start TEXT NOT NULL,
            end TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
});

// Helper Functions for JSON file management
async function getUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data).users;
    } catch (error) {
        return [];
    }
}

async function saveUsers(users) {
    await fs.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2));
}
// Helper Function: Check for Overlapping Schedules
const checkOverlap = (start, end, schedules) => {
    const startTime = moment(start);
    const endTime = moment(end);

    for (const schedule of schedules) {
        const scheduleStart = moment(schedule.startTime);
        const scheduleEnd = moment(schedule.endTime);

        if (
            startTime.isBetween(scheduleStart, scheduleEnd, null, '[)') ||
            endTime.isBetween(scheduleStart, scheduleEnd, null, '(]') ||
            (startTime.isSameOrBefore(scheduleStart) && endTime.isSameOrAfter(scheduleEnd))
        ) {
            return true; // Overlap detected
        }
    }
    return false; // No overlap
};

// Helper Function: Check Daily and Weekly Limits
const checkLimits = (start, end, schedules) => {
    const startTime = moment(start);
    const endTime = moment(end);
    const requestedDuration = endTime.diff(startTime, 'hours', true);

    const dayStart = startTime.startOf('day');
    const dayEnd = startTime.endOf('day');
    const weekStart = startTime.startOf('week');
    const weekEnd = startTime.endOf('week');

    let dailyTotal = 0;
    let weeklyTotal = 0;

    for (const schedule of schedules) {
        const scheduleStart = moment(schedule.startTime);
        const scheduleEnd = moment(schedule.endTime);
        const duration = scheduleEnd.diff(scheduleStart, 'hours', true);

        if (scheduleStart.isBetween(dayStart, dayEnd, null, '[)')) {
            dailyTotal += duration;
        }
        if (scheduleStart.isBetween(weekStart, weekEnd, null, '[)')) {
            weeklyTotal += duration;
        }
    }

    if (dailyTotal + requestedDuration > 3) {
        return { valid: false, reason: 'Exceeds daily limit of 3 hours' };
    }

    if (weeklyTotal + requestedDuration > 21) {
        return { valid: false, reason: 'Exceeds weekly limit of 21 hours' };
    }

    return { valid: true };
};


async function getSchedules() {
    try {
        const data = await fs.readFile(SCHEDULES_FILE, 'utf8');
        return JSON.parse(data).schedules;
    } catch (error) {
        return [];
    }
}

async function saveSchedules(schedules) {
    await fs.writeFile(SCHEDULES_FILE, JSON.stringify({ schedules }, null, 2));
}

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static('public'));
app.use(express.static(path.join(__dirname)));

// Routes
app.get('/', (req, res) => {
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/relay-states', (req, res) => {
    res.json(relayStates);
});

app.post('/relay-state', (req, res) => {
    const { relay, state } = req.body;
    if (relay in relayStates) {
        relayStates[relay] = state;
        res.json({ success: true, state: relayStates[relay] });
    } else {
        res.status(400).json({ success: false, message: 'Invalid relay' });
    }
});

// User Management (JSON-based)
app.post('/users', async (req, res) => {
    try {
        const users = await getUsers();
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const user = {
            name: req.body.name,
            password: hashedPassword,
            role: 'user',
        };
        users.push(user);
        await saveUsers(users);
        res.status(201).send();
    } catch {
        res.status(500).send();
    }
});

app.post('/users/login', async (req, res) => {
    try {
        const users = await getUsers();
        const user = users.find((user) => user.name === req.body.name);
        if (!user) {
            return res.status(400).json({ success: false, message: 'Cannot find user' });
        }

        if (await bcrypt.compare(req.body.password, user.password)) {
            res.json({
                success: true,
                message: 'Success',
                role: user.role,
            });
        } else {
            res.json({ success: false, message: 'Invalid password' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Schedule Management (JSON-based)
app.get('/schedule', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'schedule.html'));
});

// Add Schedule Endpoint with Validation
app.post('/schedule', async (req, res) => {
    const { username, startTime, endTime } = req.body;

    try {
        // Get all schedules from the JSON file or database
        const schedules = await getSchedules();
        
        // Filter schedules to only those for the current user
        const userSchedules = schedules.filter(s => s.username === username);

        // Check for overlapping schedules
        if (checkOverlap(startTime, endTime, userSchedules)) {
            return res.status(400).json({ success: false, message: 'Schedule overlaps with an existing booking' });
        }

        // Check daily and weekly limits
        const limitCheck = checkLimits(startTime, endTime, userSchedules);
        if (!limitCheck.valid) {
            return res.status(400).json({ success: false, message: limitCheck.reason });
        }

        // Create and save the new schedule
        const newSchedule = { id: Date.now().toString(), username, startTime, endTime };
        schedules.push(newSchedule);
        await saveSchedules(schedules);

        res.json({ success: true, message: 'Schedule added successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


app.get('/schedules/:username', async (req, res) => {
    try {
        const schedules = await getSchedules();
        const userSchedules = schedules.filter((s) => s.username === req.params.username);
        res.json(userSchedules);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/schedule/:id', async (req, res) => {
    try {
        const schedules = await getSchedules();
        const filteredSchedules = schedules.filter((s) => s.id !== req.params.id);
        await saveSchedules(filteredSchedules);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// SQLite-Based Reservation Management
app.post('/reserve', (req, res) => {
    const { username, start, end } = req.body;

    if (!username || !start || !end) {
        return res.status(400).send('Missing required fields: username, start, end');
    }

    db.get('SELECT id FROM users WHERE username = ?', [username], (err, user) => {
        if (err || !user) {
            return res.status(404).send('User not found');
        }

        const userId = user.id;

        db.run(
            'INSERT INTO reservations (user_id, start, end) VALUES (?, ?, ?)',
            [userId, start, end],
            (err) => {
                if (err) {
                    return res.status(500).send('Error adding reservation: ' + err.message);
                }
                res.status(201).send('Reservation added successfully');
            }
        );
    });
});

app.get('/reservations/:username', (req, res) => {
    const { username } = req.params;

    db.get('SELECT id FROM users WHERE username = ?', [username], (err, user) => {
        if (err || !user) {
            return res.status(404).send('User not found');
        }

        db.all('SELECT * FROM reservations WHERE user_id = ?', [user.id], (err, rows) => {
            if (err) {
                return res.status(500).send('Error fetching reservations: ' + err.message);
            }
            res.status(200).json(rows);
        });
    });
});

// Start Server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
