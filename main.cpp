#include <iostream>
#include <cstring>
#include <unistd.h>
#include <fcntl.h>
#include <termios.h>
#include <arpa/inet.h>
#include <sstream>
#include "nlohmann/json.hpp"
#include <string>
#include <fstream>
using json = nlohmann::json;



#define PORT 25030
#define SERIAL_PORT "/dev/ttyACM0" // Update as needed for your Arduino's port
#define RELAY_STATES_FILE "config/relayStates.json" // File to store relay states

// Relay states map
std::map<int, std::string> relayStates;

// Function to load relay states from a file
void loadRelayStates() {
    try {
        std::ifstream file("config/relayStates.json");
        if (file.is_open()) {
            json jsonData;
            file >> jsonData;

            for (auto& [key, value] : jsonData.items()) {
                relayStates[std::stoi(key)] = value;
            }

            std::cout << "Relay states loaded successfully.\n";
        } else {
            std::cerr << "Could not open relayStates.json. Defaulting to all OFF states.\n";
        }
    } catch (const std::exception& e) {
        std::cerr << "Error loading relay states: " << e.what() << "\n";
    }
}

void saveRelayStates() {
    try {
        std::ofstream file("config/relayStates.json");
        if (file.is_open()) {
            json jsonData;

            for (const auto& [relayNumber, state] : relayStates) {
                jsonData[std::to_string(relayNumber)] = state;
            }

            file << jsonData.dump(4); // Save with 4 spaces indentation
            std::cout << "Relay states saved successfully.\n";
        } else {
            std::cerr << "Could not open relayStates.json for writing.\n";
        }
    } catch (const std::exception& e) {
        std::cerr << "Error saving relay states: " << e.what() << "\n";
    }
}

// Setup Serial Port for Arduino Communication
int setupSerial(const char* port) {
    int fd = open(port, O_RDWR | O_NOCTTY);
    if (fd == -1) {
        std::cerr << "Failed to open serial port: " << port << "\n";
        return -1;
    }

    struct termios tty;
    if (tcgetattr(fd, &tty) != 0) {
        std::cerr << "Failed to get serial attributes\n";
        return -1;
    }

    tty.c_cflag = B9600 | CS8 | CLOCAL | CREAD; // Baud rate: 9600, 8 data bits, enable receiver
    tty.c_iflag = IGNPAR;                       // Ignore parity errors
    tty.c_oflag = 0;
    tty.c_lflag = 0;                            // Non-canonical mode

    tcflush(fd, TCIFLUSH);                      // Flush input buffer
    tcsetattr(fd, TCSANOW, &tty);               // Apply settings
    return fd;
}

// Process Command and Send to Arduino
void processCommand(const std::string& command, int serial_fd) {
    std::istringstream stream(command);
    std::string action;
    int relayNumber;

    stream >> action >> relayNumber;

    if (relayStates.find(relayNumber) != relayStates.end() && (action == "ON" || action == "OFF")) {
        std::cout << "Processing command: " << action << " " << relayNumber << "\n";

        // Update relay state
        relayStates[relayNumber] = action;
        saveRelayStates();

        // Send command to Arduino
        std::string serialCommand = action + " " + std::to_string(relayNumber) + "\n";
        write(serial_fd, serialCommand.c_str(), serialCommand.size());
        std::cout << "Sent to Arduino: " << serialCommand;
    } else {
        std::cerr << "Invalid command or relay number: " << command << "\n";
    }
}

int main() {
    int server_fd, new_socket, serial_fd;
    struct sockaddr_in address;
    int opt = 1;
    int addrlen = sizeof(address);

    // Load initial relay states
    loadRelayStates();

    // Initialize Serial Port for Arduino
    serial_fd = setupSerial(SERIAL_PORT);
    if (serial_fd < 0) {
        return -1;
    }
    std::cout << "Serial port connected to Arduino.\n";

    // Create Socket
    server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd == 0) {
        perror("Socket failed");
        return -1;
    }

    // Set Socket Options
    if (setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR | SO_REUSEPORT, &opt, sizeof(opt))) {
        perror("setsockopt");
        return -1;
    }

    // Configure Address
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(PORT);

    // Bind Socket
    if (bind(server_fd, (struct sockaddr*)&address, sizeof(address)) < 0) {
        perror("Bind failed");
        return -1;
    }

    // Start Listening
    if (listen(server_fd, 3) < 0) {
        perror("Listen failed");
        return -1;
    }

    std::cout << "C++ Server is listening on port " << PORT << "...\n";

    while (true) {
        // Accept Incoming Connection
        new_socket = accept(server_fd, (struct sockaddr*)&address, (socklen_t*)&addrlen);
        if (new_socket < 0) {
            perror("Accept failed");
            continue;
        }

        std::cout << "Client connected!\n";

        // Read Data from Client
        char buffer[1024] = {0};
        int bytes_read = read(new_socket, buffer, sizeof(buffer) - 1);
        if (bytes_read > 0) {
            buffer[bytes_read] = '\0'; // Null-terminate the received string
            std::string command(buffer);
            std::cout << "Received: " << command << "\n";

            // Process Command and Forward to Arduino
            processCommand(command, serial_fd);

            // Respond to Client
            std::string response = "Command processed: " + command;
            send(new_socket, response.c_str(), response.length(), 0);
        } else {
            std::cerr << "Error reading from client.\n";
        }

        close(new_socket); // Close Client Connection
    }

    close(serial_fd); // Close Serial Port
    close(server_fd); // Close Server Socket
    return 0;
}
