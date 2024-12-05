const bcrypt = require('bcrypt');
const fs = require('fs').promises;
const path = require('path');

async function createUser(username, password, role = 'user') {
    const USERS_FILE = path.join(__dirname, '..', 'config', 'users.json');
    
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        const userData = JSON.parse(data);
        
        if (userData.users.some(user => user.name === username)) {
            console.error('User already exists');
            return;
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = {
            name: username,
            password: hashedPassword,
            role: role
        };
        
        userData.users.push(newUser);
        await fs.writeFile(USERS_FILE, JSON.stringify(userData, null, 2));
        console.log(`User ${username} created successfully`);
    } catch (error) {
        console.error('Error creating user:', error);
    }
}

// Example usage:
const [,, username, password, role] = process.argv;
if (username && password) {
    createUser(username, password, role).catch(console.error);
} else {
    console.log('Usage: node createUser.js <username> <password> [role]');
} 