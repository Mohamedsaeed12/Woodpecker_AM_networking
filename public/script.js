// public/script.js
document.getElementById('data-form').addEventListener('submit', function(event) {
  event.preventDefault();
  
  const message = document.getElementById('data-input').value;
  
  // Send the message to the server
  fetch('/send-data', {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: message }),
  })
  .then(response => response.json())
  .then(data => {
      document.getElementById('response').textContent = `Response from C++ program:\n${data.output}`;
  })
  .catch(error => {
      document.getElementById('response').textContent = `Error: ${error}`;
  });
});
