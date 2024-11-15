const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const bodyParser = require('body-parser');
const net = require('net');
const app = express();
const port = 5000;

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Serve static files (CSS, JS, etc.) from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Route to serve the index.html file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint to handle sending data
app.post('/send-data', (req, res) => {
  const message = req.body.message;

  // Create a TCP client and connect to the C++ server
  const client = new net.Socket();
  const cppServerHost = '127.0.0.1'; // The address of the C++ server
  const cppServerPort = 12345; // The port of the C++ server

  client.connect(cppServerPort, cppServerHost, () => {
    console.log('Connected to C++ server');
    // Send the message to the C++ server
    client.write(message);
  });

  // Handle receiving data from the C++ server
  client.on('data', (data) => {
    console.log('Received from C++ server:', data.toString());
    res.send(`C++ server response: ${data.toString()}`);
    client.destroy(); // Close the connection after receiving data
  });

  // Handle error
  client.on('error', (err) => {
    console.error('Error:', err);
    res.status(500).send('Error sending data to C++ server');
  });

  // Handle connection close
  client.on('close', () => {
    console.log('Connection to C++ server closed');
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
