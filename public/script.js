document.getElementById('data-form').addEventListener('submit', function(event) {
    event.preventDefault();
  
    const message = document.getElementById('data-input').value;
  
    fetch('/send-data', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: message }),
    })
    .then(response => response.json())
    .then(data => {
        // Correcting the string interpolation here by using backticks
        document.getElementById('response').textContent = `Response from C++ program:\n${data.output}`;
    })
    .catch(error => {
        // Correcting error message string interpolation too
        document.getElementById('response').textContent = `Error: ${error}`;
    });
  });