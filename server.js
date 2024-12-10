require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const net = require('net');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs/promises');
const moment = require('moment');
const session = require('express-session');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 6000;

// Active sessions store (map username to session IDs)
const activeSessions = new Map();

// JSON files for user and schedule management
const USERS_FILE = path.join(__dirname, 'config', 'users.json');
const SCHEDULES_FILE = path.join(__dirname, 'config', 'schedules.json');
const RELAY_STATE_FILE = path.join(__dirname, 'config', 'relayStates.json');

// Function to load relay states from file
async function loadRelayStates() {
    try {
        const data = await fs.readFile(RELAY_STATE_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error loading relay states:', err);
        return {
            1: 'OFF',
            2: 'OFF',
            3: 'OFF',
            4: 'OFF',
            5: 'OFF',
            6: 'OFF',
            7: 'OFF',
            8: 'OFF',
            9: 'OFF',
            10: 'OFF',
            11: 'OFF',
            12: 'OFF',
            13: 'OFF',
            14: 'OFF',
            15: 'OFF',
            16: 'OFF',
        }; // Default states
    }
}

// Function to save relay states to file
async function saveRelayStates(relayStates) {
    try {
        await fs.writeFile(RELAY_STATE_FILE, JSON.stringify(relayStates, null, 2));
    } catch (err) {
        console.error('Error saving relay states:', err);
    }
}

let relayStates = {}; // Declare the variable globally

(async () => {
    try {
        relayStates = await loadRelayStates(); // Load relay states asynchronously
        console.log('Loaded relay states:', relayStates);
    } catch (err) {
        console.error('Failed to initialize relay states:', err);
    }
})();

// ngrok C++ server configuration
const cppServerHost = '5.tcp.ngrok.io';
const cppServerPort = 25030;

app.set('trust proxy', 1); // Trust the first proxy


// Middleware
app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  });

// Session middleware
app.use(session({
    secret: 'your-secret-key', // Replace with a strong secret
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
        httpOnly: true, // Prevent client-side JavaScript from accessing the cookie
        sameSite: 'lax' // Helps protect against CSRF attacks
    }
}));



// Helper Functions for JSON File Management
async function getUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data).users || [];
    } catch {
        return [];
    }
}

async function saveUsers(users) {
    await fs.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2));
}

async function getSchedules() {
    try {
        const data = await fs.readFile(SCHEDULES_FILE, 'utf8');
        return JSON.parse(data).schedules || [];
    } catch {
        return [];
    }
}

async function saveSchedules(schedules) {
    await fs.writeFile(SCHEDULES_FILE, JSON.stringify({ schedules }, null, 2));
}

async function checkAccessTime(req, res, next) {
    const username = req.session.username;
    if (!username) {
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    try {
        const schedules = await getSchedules();
        const userSchedules = schedules.filter(schedule => schedule.username === username);
        const now = moment();

        const hasAccess = userSchedules.some(schedule => {
            const startTime = moment(schedule.startTime);
            const endTime = moment(schedule.endTime);
            return now.isBetween(startTime, endTime, null, '[)');
        });

        if (hasAccess) {
            next();
        } else {
            res.status(403).json({ success: false, message: 'Access not allowed at this time' });
        }
    } catch (error) {
        console.error('Error checking access time:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}


// Use this middleware for protected routes
app.get('/dashboard', isAuthenticated, checkAccessTime, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});


// Example of a protected route
app.get('/protected-route', isAuthenticated, checkAccessTime, (req, res) => {
    res.json({ success: true, message: 'You have access to this route' });
});


function isAuthenticated(req, res, next) {
    const username = req.session?.username;
    const sessionID = req.sessionID;

    console.log(`Authenticated check: username=${username}, sessionID=${sessionID}`);

    if (!username || !activeSessions.has(username)) {
        console.log(`Unauthorized access: No active session for ${username}`);
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    if (activeSessions.get(username) !== sessionID) {
        console.log(`Session mismatch for ${username}: active=${activeSessions.get(username)}, current=${sessionID}`);
        return res.status(401).json({ success: false, message: 'Session invalidated.' });
    }

    console.log(`Session valid for ${username}`);
    next();
}

const checkGlobalOverlap = (start, end, schedules) => {
    const startTime = moment(start, moment.ISO_8601, true);
    const endTime = moment(end, moment.ISO_8601, true);

    if (!startTime.isValid() || !endTime.isValid()) {
        console.error('Invalid date format:', { start, end });
        return false;
    }

    for (const schedule of schedules) {
        const scheduleStart = moment(schedule.startTime, moment.ISO_8601, true);
        const scheduleEnd = moment(schedule.endTime, moment.ISO_8601, true);

        if (
            startTime.isBetween(scheduleStart, scheduleEnd, null, '[)') ||
            endTime.isBetween(scheduleStart, scheduleEnd, null, '(]') ||
            (startTime.isSameOrBefore(scheduleStart) && endTime.isSameOrAfter(scheduleEnd))
        ) {
            console.log('Overlap detected:', { startTime, endTime, scheduleStart, scheduleEnd });
            return true; // Overlap found
        }
    }
    return false; // No overlap
};

const checkLimits = (start, end, schedules) => {
    const startTime = moment(start);
    const endTime = moment(end);
    const requestedDuration = endTime.diff(startTime, 'hours', true);

    const dayStart = startTime.clone().startOf('day');
    const dayEnd = startTime.clone().endOf('day');
    const weekStart = startTime.clone().startOf('week');
    const weekEnd = startTime.clone().endOf('week');

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

    if (dailyTotal + requestedDuration > 4) {
        return { valid: false, reason: 'Exceeds daily limit of 4 hours' };
    }

    if (weeklyTotal + requestedDuration > 28) {
        return { valid: false, reason: 'Exceeds weekly limit of 28 hours' };
    }

    return { valid: true };
};

app.post('/sendRelayCommand', isAuthenticated, async (req, res) => {
    const { relayNumber } = req.body;

    if (!relayStates.hasOwnProperty(relayNumber)) {
        return res.status(400).json({ success: false, message: 'Invalid relay number specified' });
    }

    // Toggle relay state
    const newState = relayStates[relayNumber] === 'ON' ? 'OFF' : 'ON';
    relayStates[relayNumber] = newState;

    try {
        // Save the updated states
        await saveRelayStates(relayStates);

        // Send command to C++ server
        const command = `${newState} ${relayNumber}`;
        const client = new net.Socket();

        client.connect(cppServerPort, cppServerHost, () => {
            console.log(`Connected to C++ server at ${cppServerHost}:${cppServerPort}`);
            client.write(command);
        });

        client.on('data', (data) => {
            console.log('Response from C++ server:', data.toString());
            res.json({ success: true, message: data.toString(), state: relayStates });
            client.destroy();
        });

        client.on('error', (err) => {
            console.error('Error communicating with C++ server:', err);
            res.status(500).json({ success: false, message: 'Failed to send command to server' });
        });

        client.on('close', () => {
            console.log('Connection to C++ server closed');
        });
    } catch (error) {
        console.error('Error handling relay state change:', error);
        res.status(500).json({ success: false, message: 'Failed to handle relay state change.' });
    }
});

// Endpoint to get the current relay states
app.get('/getRelayStates', isAuthenticated, (req, res) => {
    try {
        res.json({ success: true, relayStates });
    } catch (error) {
        console.error('Error fetching relay states:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch relay states.' });
    }
});



// User Management
app.post('/users', async (req, res) => {
    try {
        const users = await getUsers();
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const newUser = { name: req.body.name, password: hashedPassword, role: req.body.role || 'user' };
        users.push(newUser);
        await saveUsers(users);
        res.status(201).json({ success: true, message: 'User added successfully' });
    } catch (error) {
        console.error('Error adding user:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/checkSession', (req, res) => {
    if (req.session && req.session.isLoggedIn) {
        res.json({ isLoggedIn: true });
    } else {
        res.json({ isLoggedIn: false });
    }
});

app.post('/users/login', async (req, res) => {
    try {
        const { name, password, accessType } = req.body; // Extract accessType from the request body
        const users = await getUsers();
        const user = users.find((u) => u.name === name);

        if (!user) {
            return res.status(400).json({ success: false, message: 'User not found' });
        }

        const isPasswordCorrect = await bcrypt.compare(password, user.password);
        if (!isPasswordCorrect) {
            return res.status(400).json({ success: false, message: 'Invalid password' });
        }

        // Apply time-based access control only for dashboard login
        if (accessType === 'dashboard') {
            const schedules = await getSchedules();
            const userSchedules = schedules.filter((s) => s.username === user.name);
            const now = moment();

            const hasAccess = userSchedules.some((schedule) => {
                const startTime = moment(schedule.startTime);
                const endTime = moment(schedule.endTime);
                return now.isBetween(startTime, endTime, null, '[)');
            });

            if (!hasAccess) {
                return res.status(403).json({ success: false, message: 'Access not allowed at this time' });
            }
        }

        // Check for existing active session
        if (activeSessions.has(user.name)) {
            const oldSessionId = activeSessions.get(user.name);
            console.log(`Invalidating old session for ${user.name}: ${oldSessionId}`);
            req.sessionStore.destroy(oldSessionId, (err) => {
                if (err) {
                    console.error(`Error destroying old session for ${user.name}:`, err);
                } else {
                    console.log(`Old session destroyed for ${user.name}`);
                }
            });
        }

        // Save new session
        activeSessions.set(user.name, req.sessionID);
        console.log(`New session created for ${user.name}: ${req.sessionID}`);
        req.session.isLoggedIn = true;
        req.session.username = user.name;

        res.json({ success: true, message: 'Login successful', role: user.role });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


app.post('/logout', (req, res) => {
    if (req.session && req.session.username) {
        const username = req.session.username;
        console.log(`Logging out ${username}`);
        activeSessions.delete(username); // Remove from active sessions
    }

    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).json({ success: false, message: 'Failed to log out' });
        }
        res.clearCookie('connect.sid'); // Clear session cookie
        console.log('Session destroyed');
        res.json({ success: true, message: 'Logged out successfully' });
    });
});



app.get('/schedules/:username', isAuthenticated, async (req, res) => {
    try {
        const schedules = await getSchedules();
        const userSchedules = schedules.filter((s) => s.username === req.params.username);
        res.json(userSchedules);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/schedule/:id', isAuthenticated, async (req, res) => {
    try {
        const schedules = await getSchedules();
        const filteredSchedules = schedules.filter((s) => s.id !== req.params.id);
        await saveSchedules(filteredSchedules);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/schedule', isAuthenticated, async (req, res) => {
    const { startTime, endTime } = req.body;
    const username = req.session.username;

    if (!username || !startTime || !endTime) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    try {
        if (moment(startTime).isSameOrAfter(moment(endTime))) {
            return res.status(400).json({ success: false, message: 'Start time must be before end time.' });
        }

        const schedules = await getSchedules();

        if (checkGlobalOverlap(startTime, endTime, schedules)) {
            return res.status(400).json({ success: false, message: 'Schedule overlaps with an existing booking.' });
        }

        const userSchedules = schedules.filter((s) => s.username === username);
        const limitCheck = checkLimits(startTime, endTime, userSchedules);

        if (!limitCheck.valid) {
            return res.status(400).json({ success: false, message: limitCheck.reason });
        }

        const newSchedule = { id: crypto.randomUUID(), username, startTime, endTime };
        schedules.push(newSchedule);
        await saveSchedules(schedules);

        res.json({ success: true, message: 'Schedule created successfully.' });
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

app.get('/schedule', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'schedule.html'));
});

app.get('/schedules', isAuthenticated, async (req, res) => {
    try {
        const schedules = await getSchedules();
        res.json(schedules);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Start Server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Relay commands are sent to C++ server via ngrok at ${cppServerHost}:${cppServerPort}`);
});
