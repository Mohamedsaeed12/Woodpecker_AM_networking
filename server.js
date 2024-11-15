const express = require('express');
const path = require('path');
const net = require('net');
const bodyParser = require('body-parser');

const app = express();
const port = 6000;

app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

app.listen(port, () => {
  console.log(`Node.js server running at http://localhost:${port}`);
});
