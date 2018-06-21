/***************************************************
  Adafruit MQTT Library ESP8266 Example

  Must use ESP8266 Arduino from:
    https://github.com/esp8266/Arduino

  Works great with Adafruit's Huzzah ESP board:
  ----> https://www.adafruit.com/product/2471

  Adafruit invests time and resources providing this open source code,
  please support Adafruit and open-source hardware by purchasing
  products from Adafruit!

  Written by Tony DiCola for Adafruit Industries.
  MIT license, all text above must be included in any redistribution
 ****************************************************/
#include <ESP8266WiFi.h>
#include "Adafruit_MQTT.h"
#include "Adafruit_MQTT_Client.h"
#include <Servo.h>
#include "setting.h"

/************ Global State (you don't need to change this!) ******************/

// Create an ESP8266 WiFiClient class to connect to the MQTT server.
WiFiClient client;

// Setup the MQTT client class by passing in the WiFi client and MQTT server and login details.
Adafruit_MQTT_Client mqtt(&client, AIO_SERVER, AIO_SERVERPORT, AIO_USERNAME, AIO_USERNAME, AIO_KEY);

/****************************** Feeds ***************************************/

Adafruit_MQTT_Subscribe leftController = Adafruit_MQTT_Subscribe(&mqtt, AIO_USERNAME "nobunaga/left", MQTT_QOS_1);

Adafruit_MQTT_Subscribe rightController = Adafruit_MQTT_Subscribe(&mqtt, AIO_USERNAME "nobunaga/right", MQTT_QOS_1);

/*************************** Sketch Code ************************************/

int sec;
int min_;
int hour;

int timeZone = -4; // utc-4 eastern daylight time (nyc)
Servo leftServo;
Servo rightServo;

void leftServoCallback(double x) {
  Serial.print("left value is: ");
  Serial.println(x);
  if (x >= 1) {
    leftServo.write(180);
  } else if ( x <= -1) {
    leftServo.write(-180);
  } else {
    leftServo.write(90);
  }
}

void rightServoCallback(double x) {
  Serial.print("right value is: ");
  Serial.println(x);
  if (x >= 1) {
    rightServo.write(-180);
  } else if ( x <= -1) {
    rightServo.write(180);
  } else {
    rightServo.write(90);
  }
}

void onoffcallback(char *data, uint16_t len) {
  Serial.print("Hey we're in a onoff callback, the button value is: ");
  Serial.println(data);
}


void setup() {
  Serial.begin(115200);
  delay(10);
  leftServo.attach(5);
  rightServo.attach(4);
  Serial.println(F("Adafruit MQTT demo"));

  // Connect to WiFi access point.
  Serial.println(); Serial.println();
  Serial.print("Connecting to ");
  Serial.println(WLAN_SSID);

  WiFi.begin(WLAN_SSID, WLAN_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  Serial.println("WiFi connected");
  Serial.println("IP address: "); Serial.println(WiFi.localIP());

  leftController.setCallback(leftServoCallback);
  rightController.setCallback(rightServoCallback);

  // Setup MQTT subscription for time feed.
  mqtt.subscribe(&leftController);
  mqtt.subscribe(&rightController);

}

uint32_t x = 0;

void loop() {
  // Ensure the connection to the MQTT server is alive (this will make the first
  // connection and automatically reconnect when disconnected).  See the MQTT_connect
  // function definition further below.
  MQTT_connect();

  // this is our 'wait for incoming subscription packets and callback em' busy subloop
  // try to spend your time here:
  mqtt.processPackets(10000);

  // ping the server to keep the mqtt connection alive
  // NOT required if you are publishing once every KEEPALIVE seconds

  if (! mqtt.ping()) {
    mqtt.disconnect();
  }
}

// Function to connect and reconnect as necessary to the MQTT server.
// Should be called in the loop function and it will take care if connecting.
void MQTT_connect() {
  int8_t ret;

  // Stop if already connected.
  if (mqtt.connected()) {
    return;
  }

  Serial.print("Connecting to MQTT... ");

  uint8_t retries = 3;
  while ((ret = mqtt.connect()) != 0) { // connect will return 0 for connected
    Serial.println(mqtt.connectErrorString(ret));
    Serial.println("Retrying MQTT connection in 10 seconds...");
    mqtt.disconnect();
    delay(10000);  // wait 10 seconds
    retries--;
    if (retries == 0) {
      // basically die and wait for WDT to reset me
      while (1);
    }
  }
  Serial.println("MQTT Connected!");
}
