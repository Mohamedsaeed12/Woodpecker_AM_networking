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

app.post('/send-status', (req, res) => {
  const status = req.body.status;

  const client = new net.Socket();
  const cppServerHost = '5.tcp.ngrok.io';
  const cppServerPort = 25030;

  client.connect(cppServerPort, cppServerHost, () => {
    console.log('Connected to C++ server');
    client.write(status);
  });

  client.on('data', (data) => {
    console.log('Received from C++ server:', data.toString());
    res.json({ message: `C++ server response: ${data.toString()}` });
    client.destroy();
  });

  client.on('error', (err) => {
    console.error('Error:', err);
    res.status(500).send('Error sending data to C++ server');
  });

  client.on('close', () => {
    console.log('Connection to C++ server closed');
  });

  client.on('end', () => {
    console.log('Connection ended by the C++ server');
  });
});

app.listen(port, () => {
  console.log(`Node.js server running at http://localhost:${port}`);
});

