require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const net = require('net');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs').promises;
const moment = require('moment');
const session = require('express-session');
const crypto = require('crypto');
const http = require('http');
const socketIo = require('socket.io');

const server = http.createServer(app);
const io = socketIo(server);
const app = express();
const port = process.env.PORT || 6000;

// JSON files for user and schedule management
const USERS_FILE = path.join(__dirname, 'config', 'users.json');
const SCHEDULES_FILE = path.join(__dirname, 'config', 'schedules.json');

// Relay states for dashboard controls
const relayStates = {
    1: 'OFF',
    2: 'OFF',
    3: 'OFF',
    4: 'OFF',
    5: 'OFF',
    6: 'OFF',
    7: 'OFF',
    8: 'OFF',
};


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

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Handle client connections
io.on('connection', (socket) => {
    console.log('A user connected');

    // Send current relay states to the newly connected client
    socket.emit('relayStates', relayStates);

    // Handle relay state change requests from clients
    socket.on('relayStateChange', ({ relayNumber, newState }) => {
        if (relayStates.hasOwnProperty(relayNumber)) {
            relayStates[relayNumber] = newState;

            // Broadcast the updated relay states to all connected clients
            io.emit('relayStates', relayStates);

            // Send command to C++ server (existing logic)
            const command = `${newState} ${relayNumber}`;
            const client = new net.Socket();

            client.connect(cppServerPort, cppServerHost, () => {
                console.log(`Connected to C++ server at ${cppServerHost}:${cppServerPort}`);
                client.write(command);
            });

            client.on('data', (data) => {
                console.log('Response from C++ server:', data.toString());
                client.destroy();
            });

            client.on('error', (err) => {
                console.error('Error communicating with C++ server:', err);
            });

            client.on('close', () => {
                console.log('Connection to C++ server closed');
            });
        }
    });

    // Handle client disconnection
    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

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

// Example of a protected route
app.get('/protected-route', isAuthenticated, checkAccessTime, (req, res) => {
    res.json({ success: true, message: 'You have access to this route' });
});

app.get('/dashboard', isAuthenticated, checkAccessTime, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/schedule', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'schedule.html'));
});


// Middleware to check if the user is authenticated
function isAuthenticated(req, res, next) {
    if (req.session && req.session.isLoggedIn) {
        next();
    } else {
        res.status(401).json({ success: false, message: 'Unauthorized access' });
    }
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


// Relay State Management
app.post('/sendRelayCommand', isAuthenticated, (req, res) => {
    const { relayNumber } = req.body;

    if (relayStates.hasOwnProperty(relayNumber)) {
        const newState = relayStates[relayNumber] === 'ON' ? 'OFF' : 'ON';
        relayStates[relayNumber] = newState;

        // Broadcast updated states
        io.emit('relayStates', relayStates);

        // Send command to C++ server
        const command = `${newState} ${relayNumber}`;
        const client = new net.Socket();

        client.connect(cppServerPort, cppServerHost, () => {
            client.write(command);
        });

        client.on('data', (data) => {
            res.json({ success: true, message: data.toString(), state: relayStates });
            client.destroy();
        });

        client.on('error', (err) => {
            res.status(500).json({ success: false, message: 'Server error' });
        });

        client.on('close', () => {
            console.log('Connection closed');
        });
    } else {
        res.status(400).json({ success: false, message: 'Invalid relay number' });
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
        const users = await getUsers();
        const user = users.find((u) => u.name === req.body.name);

        if (!user) {
            return res.status(400).json({ success: false, message: 'User not found' });
        }

        const isPasswordCorrect = await bcrypt.compare(req.body.password, user.password);
        if (!isPasswordCorrect) {
            return res.status(400).json({ success: false, message: 'Invalid password' });
        }

        // Check if current time is within user's scheduled access times
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

        req.session.isLoggedIn = true;
        req.session.username = user.name;
        res.json({ success: true, message: 'Login successful', role: user.role });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).json({ success: false, message: 'Failed to log out' });
        }
        res.clearCookie('connect.sid'); // Replace 'connect.sid' with your session cookie name if different
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
            return res.status(400).json({ success: false, message: 'Start time must be before end time' });
        }

        const schedules = await getSchedules();

        if (checkGlobalOverlap(startTime, endTime, schedules)) {
            return res.status(400).json({ success: false, message: 'Schedule overlaps with an existing booking' });
        }

        const userSchedules = schedules.filter(s => s.username === username);
        const limitCheck = checkLimits(startTime, endTime, userSchedules);

        if (!limitCheck.valid) {
            return res.status(400).json({ success: false, message: limitCheck.reason });
        }

        const newSchedule = { id: crypto.randomUUID(), username, startTime, endTime };
        schedules.push(newSchedule);
        await saveSchedules(schedules);

        res.json({ success: true, message: 'Schedule created successfully' });
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/schedules', isAuthenticated, async (req, res) => {
    try {
        const schedules = await getSchedules();
        res.json(schedules);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Relay commands are sent to C++ server via ngrok at ${cppServerHost}:${cppServerPort}`);
});
