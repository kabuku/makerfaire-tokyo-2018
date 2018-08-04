#!/usr/bin/env python
from enum import Enum
import RPi.GPIO as GPIO
import signal
import paho.mqtt.client as mqtt
import logging
import threading
import setting

logger = logging.getLogger(__name__)
GPIO.setmode(GPIO.BCM)


class Wheel(Enum):
    RIGHT = 1
    LEFT = 2


class Servo(object):

    def __init__(self, gpio_number):
        self.gpio_number = gpio_number
        GPIO.setup(gpio_number, GPIO.OUT)
        self.servo = GPIO.PWM(gpio_number, 50)
        self.servo.start(0)
        self.exit = threading.Event()

    def run(self, dudy_cycle):

        dudy_cycle = float(dudy_cycle)
        self.servo.ChangeDutyCycle(dudy_cycle)

    def __del__(self):
        self.servo.stop()


class Led(object):

    def __init__(self, pin_number):
        self.pin_number = pin_number
        GPIO.setup(pin_number, GPIO.OUT)
        # The default is True and the LED glows, so it set False
        GPIO.output(pin_number, False)

    def output(self, on):
        GPIO.output(self.pin_number, on)


class MQTTClient(object):

    def __init__(self, robot_name, server_hosts):
        self.client = mqtt.Client(client_id="{}".format(robot_name))
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        # self.client.on_disconnect = self.on_disconnect
        self.robot_name = robot_name
        self.right_servo = Servo(gpio_number=17)
        self.left_servo = Servo(gpio_number=27)
        # setup GPIO for LED
        self.led_connect = Led(9)
        self.led_message = Led(11)
        self.server_hosts = server_hosts

    def connect(self):
        self.client.will_set("{}/connection".format(self.robot_name), payload=0, qos=1, retain=True)
        import socket
        for count, host in enumerate(self.server_hosts):
            logger.info("try connection: {}".format(host))
            try:
                self.client.connect(host, 1883, 60)
            except socket.error:
                logger.warning("failed connection: {}".format(host))
                if len(self.server_hosts) - 1 > count:
                    continue
                else:
                    raise socket.error
            else:
                break

        # Blocking call that processes network traffic, dispatches callbacks and
        # handles reconnecting.
        # Other loop*() functions are available that give a threaded interface and a
        # manual interface.
        self.client.loop_forever()

    def on_connect(self, client, userdata, flags, rc):
        logger.info("Connected with result code " + str(rc))
        self.led_connect.output(True)
        # Subscribing in on_connect() means that if we lose the connection and
        # reconnect then subscriptions will be renewed.
        client.subscribe("{}/right".format(self.robot_name), qos=1)
        client.subscribe("{}/left".format(self.robot_name), qos=1)
        client.publish("{}/connection".format(self.robot_name), payload=1, qos=1, retain=True)

    # The callback for when a PUBLISH message is received from the server.
    def on_message(self, client, userdata, msg):
        self.led_message.output(True)
        logger.info(msg.topic + " " + str(msg.payload))
        if msg.topic == "{}/right".format(self.robot_name):
            self.right_servo.run(msg.payload)
            # self.right_servo.state = int(msg.payload)
        elif msg.topic == "{}/left".format(self.robot_name):
            self.left_servo.run(msg.payload)
            # self.left_servo.state = int(msg.payload)
        self.led_message.output(False)

    def signal_handler(self, number, frame):
        self.__del__()

    def __del__(self):
        self.client.publish("{}/connection".format(self.robot_name), payload=0, qos=1, retain=True)
        self.client.disconnect()
        self.right_servo.exit.set()
        self.left_servo.exit.set()
        self.left_servo.__del__()
        self.right_servo.__del__()
        GPIO.cleanup()
        logger.info("exit")


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    logger.info("robotname: {}, servers: {}".format(setting.robot_name, setting.servers))
    m_client = MQTTClient(setting.robot_name, setting.servers)
    signal.signal(signal.SIGINT, m_client.signal_handler)
    signal.signal(signal.SIGTERM, m_client.signal_handler)
    m_client.connect()


main()
