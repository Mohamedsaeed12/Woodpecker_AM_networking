#include <iostream>
#include <cstring>
#include <unistd.h>
#include <fcntl.h>
#include <termios.h>
#include <arpa/inet.h>

#define PORT 25030
#define SERIAL_PORT "/dev/ttyACM0" 

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

   
    tty.c_cflag = B9600 | CS8 | CLOCAL | CREAD; 
    tty.c_iflag = IGNPAR;                       
    tty.c_oflag = 0;
    tty.c_lflag = 0;

    tcflush(fd, TCIFLUSH);
    tcsetattr(fd, TCSANOW, &tty);
    return fd;
}

int main() {
    int server_fd, new_socket, serial_fd;
    struct sockaddr_in address;
    int opt = 1;
    int addrlen = sizeof(address);
    char buffer[1024] = {0};

 
    serial_fd = setupSerial(SERIAL_PORT);
    if (serial_fd < 0) {
        return -1;
    }
    std::cout << "Serial port connected to Arduino.\n";

    server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd == 0) {
        perror("Socket failed");
        return -1;
    }

    if (setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR | SO_REUSEPORT, &opt, sizeof(opt))) {
        perror("setsockopt");
        return -1;
    }

    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(PORT);

    if (bind(server_fd, (struct sockaddr*)&address, sizeof(address)) < 0) {
        perror("Bind failed");
        return -1;
    }

    if (listen(server_fd, 3) < 0) {
        perror("Listen failed");
        return -1;
    }

    std::cout << "C++ Server is listening on port " << PORT << "...\n";

    while (true) {
        new_socket = accept(server_fd, (struct sockaddr*)&address, (socklen_t*)&addrlen);
        if (new_socket < 0) {
            perror("Accept failed");
            continue;
        }

        std::cout << "Client connected!\n";

        int bytes_read = read(new_socket, buffer, sizeof(buffer) - 1);
        if (bytes_read > 0) {
            buffer[bytes_read] = '\0';
            std::cout << "Received: " << buffer << "\n";

            // Send command to Arduino
            if (strcmp(buffer, "ON") == 0 || strcmp(buffer, "OFF") == 0) {
                write(serial_fd, buffer, strlen(buffer));
                write(serial_fd, "\n", 1); // Add newline for Arduino to parse
                std::cout << "Sent command to Arduino: " << buffer << "\n";
            }

            // Respond to client
            std::string response = "Command received: " + std::string(buffer);
            send(new_socket, response.c_str(), response.length(), 0);
        } else {
            std::cerr << "Error reading from client.\n";
        }

        close(new_socket);
    }

    close(serial_fd);
    close(server_fd);
    return 0;
}
