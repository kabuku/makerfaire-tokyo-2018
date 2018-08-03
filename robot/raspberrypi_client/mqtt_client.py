#!/usr/bin/env python
from enum import Enum
import RPi.GPIO as GPIO
import signal
import paho.mqtt.client as mqtt
import logging
import argparse

logger = logging.getLogger(__name__)
GPIO.setmode(GPIO.BCM)


class Wheel(Enum):
    RIGHT = 1
    LEFT = 2


class Servo(object):

    def __init__(self, gpio_number, wheel):
        self.gpio_number = gpio_number
        GPIO.setup(gpio_number, GPIO.OUT)
        self.servo = GPIO.PWM(gpio_number, 50)
        self.servo.start(0)

        if wheel == Wheel.LEFT:
            self.forward_dudy_cycle = 2.5
            self.backward_dudy_cycle = 12
            self.stop_dudy_cycle = 0
        else:
            self.forward_dudy_cycle = 12
            self.backward_dudy_cycle = 2.5
            self.stop_dudy_cycle = 0

    def run(self, number):

        number = int(number)
        if number >= 1:
            self.servo.ChangeDutyCycle(self.forward_dudy_cycle)
        elif number <= -1:
            self.servo.ChangeDutyCycle(self.backward_dudy_cycle)
        else:
            self.servo.ChangeDutyCycle(self.stop_dudy_cycle)

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

    def __init__(self, robot_name, server_host):
        self.client = mqtt.Client()
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        # self.client.on_disconnect = self.on_disconnect
        self.robot_name = robot_name
        self.right_servo = Servo(gpio_number=3, wheel=Wheel.RIGHT)
        self.left_servo = Servo(gpio_number=4, wheel=Wheel.LEFT)
        # setup GPIO for LED
        self.led_connect = Led(24)
        self.led_message = Led(21)
        self.server_host = server_host

    def connect(self):
        self.client.connect(self.server_host, 1883, 60)

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
        client.will_set("{}/connection".format(self.robot_name), payload=0, qos=1, retain=True)
        client.publish("{}/connection".format(self.robot_name), payload=1, qos=1, retain=True)

    # The callback for when a PUBLISH message is received from the server.
    def on_message(self, client, userdata, msg):
        self.led_message.output(True)
        logger.info(msg.topic + " " + str(msg.payload))
        if msg.topic == "{}/right".format(self.robot_name):
            self.right_servo.run(msg.payload)
        elif msg.topic == "{}/left".format(self.robot_name):
            self.left_servo.run(msg.payload)
        self.led_message.output(False)

    def signal_handler(self, number, frame):
        self.__del__()

    def __del__(self):
        self.client.publish("{}/connection".format(self.robot_name), payload=0, qos=1, retain=True)
        self.client.disconnect()
        self.left_servo.__del__()
        self.right_servo.__del__()
        GPIO.cleanup()
        logger.info("exit")


def main():
    p = argparse.ArgumentParser()
    p.add_argument('-n', '--name', default="nobunaga")
    p.add_argument('-s', '--server', default="tinjyuuMac.local", help="mqtt server hostname or ip")

    client_args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

    m_client = MQTTClient(client_args.name, client_args.server)
    signal.signal(signal.SIGINT, m_client.signal_handler)
    signal.signal(signal.SIGTERM, m_client.signal_handler)
    m_client.connect()


main()
