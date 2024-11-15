const express = require('express');
const path = require('path');
const allowedIPs = require('./allowedIPs');
const app = express();
const port = 6000;

app.use(bodyParser.json());

// IP checking middleware
const checkIP = (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    const ipAddress = clientIP.replace(/^::ffff:/, '');
    
    if (!allowedIPs.includes(ipAddress)) {
        return res.status(403).send(`
            <html>
                <head>
                    <title>Access Denied</title>
                    <style>
                        body { 
                            font-family: Arial, sans-serif;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            margin: 0;
                            background-color: #f0f2f5;
                        }
                        .error-container {
                            text-align: center;
                            padding: 2rem;
                            background: white;
                            border-radius: 8px;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                        }
                        h1 { color: #dc3545; }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <h1>Access Denied</h1>
                        <p>Your IP address (${ipAddress}) is not authorized to access this site.</p>
                    </div>
                </body>
            </html>
        `);
    }
    next();
};

// Apply IP checking middleware
app.use(checkIP);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Main route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


app.post('/send-data', (req, res) => {
  const message = req.body.message;

  const client = new net.Socket();
  const cppServerHost = '127.0.0.1'; 
  const cppServerPort = 25030; 

  client.connect(cppServerPort, cppServerHost, () => {
    console.log('Connected to C++ server');
    client.write(message);
  });

  client.on('data', (data) => {
    console.log('Received from C++ server:', data.toString());
    res.send(`C++ server response: ${data.toString()}`);
    client.destroy();
  });

  client.on('error', (err) => {
    console.error('Error:', err);
    res.status(500).send('Error sending data to C++ server');
  });

  client.on('close', () => {
    console.log('Connection to C++ server closed');
  });
});

