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

// Middleware to check if the user is authenticated
function isAuthenticated(req, res, next) {
    if (req.session && req.session.isLoggedIn) {
        next();
    } else {
        res.status(401).json({ success: false, message: 'Unauthorized access' });
    }
}

// Relay State Management
app.post('/sendRelayCommand', isAuthenticated, (req, res) => {
    const { relayNumber } = req.body;

    if (relayStates.hasOwnProperty(relayNumber)) {
        // Toggle relay state
        const newState = relayStates[relayNumber] === 'ON' ? 'OFF' : 'ON';
        relayStates[relayNumber] = newState;

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
    } else {
        res.status(400).json({ success: false, message: 'Invalid relay number specified' });
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

// Schedule Management
app.post('/schedule', isAuthenticated, async (req, res) => {
    const { startTime, endTime } = req.body;
    const username = req.session.username;

    try {
        const schedules = await getSchedules();

        // Validate time order
        if (moment(startTime).isAfter(moment(endTime))) {
            return res.status(400).json({ success: false, message: 'Start time must be before end time' });
        }

        // Check for overlapping schedules
        const userSchedules = schedules.filter((s) => s.username === username);
        if (checkOverlap(startTime, endTime, userSchedules)) {
            return res.status(400).json({ success: false, message: 'Schedule overlaps with an existing booking' });
        }

        const newSchedule = { id: Date.now().toString(), username, startTime, endTime };
        schedules.push(newSchedule);
        await saveSchedules(schedules);

        res.json({ success: true, message: 'Schedule created successfully' });
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Start Server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Relay commands are sent to C++ server via ngrok at ${cppServerHost}:${cppServerPort}`);
});
