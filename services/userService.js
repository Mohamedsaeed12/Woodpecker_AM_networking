const fs = require('fs').promises;
const bcrypt = require('bcrypt');
const path = require('path');

const USERS_FILE = path.join(__dirname, '../config/users.json');

class UserService {
    async getUsers() {
        try {
            const data = await fs.readFile(USERS_FILE, 'utf8');
            return JSON.parse(data).users;
        } catch (error) {
            return [];
        }
    }

    async findUser(username) {
        const users = await this.getUsers();
        return users.find(user => user.username === username);
    }

    async validateCredentials(username, password) {
        const user = await this.findUser(username);
        if (!user) return null;
        
        const valid = await bcrypt.compare(password, user.password);
        return valid ? user : null;
    }
}

module.exports = new UserService(); 