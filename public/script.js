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
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        // Display the response from the server
        document.getElementById('response').textContent = `Response from C++ program:\n${data.output}`;
    })
    .catch(error => {
        // Handle errors
        console.error('Fetch error:', error);
        document.getElementById('response').textContent = `Error: ${error.message}`;
    });
});
