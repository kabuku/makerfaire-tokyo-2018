#!/usr/bin/env python
from time import sleep
import RPi.GPIO as GPIO
import subprocess
import logging
import signal

logger = logging.getLogger(__name__)

GPIO.setmode(GPIO.BCM)
GPIO.setup(10, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)


def loop():
    while True:
        if GPIO.input(10) == GPIO.HIGH:
            logger.info("restart")
            logger.info("ifdown result_code: {}".format(subprocess.call(["sudo", "ifdown", "ra0"])))
            logger.info("ifup result_code: {}".format(subprocess.call(["sudo", "ifup", "ra0"])))
            logger.info("systemctl restart mqttclient result_code: {}".format(subprocess.call(["sudo", "systemctl", "restart", "mqttclient"])))
            sleep(2)
        sleep(1)


def signal_handler(number, frame):
    GPIO.cleanup()


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    loop()


main()
