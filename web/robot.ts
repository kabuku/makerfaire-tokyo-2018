import { connect, Packet, MqttClient } from 'mqtt';

export const enum Robot {
  NOBUNAGA = 'nobunaga'
}

export const enum Wheel {
  LEFT = 'left', RIGHT = 'right'
}

export class RobotController {
  static createInstance(robot: Robot, wheel: Wheel): Promise<RobotController> {
    const client = connect(`mqtt://${location.hostname}:9001`);
    return new Promise((resolve, reject) => client
      .on('connect', () => {
        console.log('MQTT connected');
        resolve(new RobotController(client, `${robot}-${wheel}`));
      })
      .on('error', err => reject(err))
    );
  }

  private constructor(private client: MqttClient, private topic: string) {
  }

  setVelocity(velocity: number): Promise<Packet> {
    return new Promise<Packet>((resolve, reject) =>
      this.client.publish(this.topic, velocity.toString(), (err, packet) => err ? reject(err) : resolve(packet))
    );
  }
}
