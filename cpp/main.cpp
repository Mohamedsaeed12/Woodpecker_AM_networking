#include <iostream>

int main(int argc, char *argv[]) {
    if (argc > 1) {
        std::string packetData = argv[1];  // First argument is the packet data
        std::cout << "Received packet data: " << packetData << std::endl;
        // Add code here to process the packet and send to Arduino
    } else {
        std::cerr << "No data received!" << std::endl;
    }
    return 0;
}
